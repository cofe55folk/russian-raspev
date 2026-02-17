#!/usr/bin/env python3
import argparse
import json
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List

WORD_RE = re.compile(r"[A-Za-zА-Яа-яЁё0-9]+(?:[-'][A-Za-zА-Яа-яЁё0-9]+)*")


@dataclass
class WordSpan:
    text: str
    norm: str
    start_sec: float
    end_sec: float
    confidence: float


def normalize_token(s: str) -> str:
    s = s.lower().replace("ё", "е")
    s = re.sub(r"[^a-zа-я0-9-']", "", s)
    return s


def extract_words(obj: Any, out: List[WordSpan]) -> None:
    if isinstance(obj, dict):
        has_word = "text" in obj and ("startTimeMs" in obj or "startMs" in obj or "startTime" in obj)
        if has_word:
            start_ms = obj.get("startTimeMs", obj.get("startMs"))
            end_ms = obj.get("endTimeMs", obj.get("endMs"))
            # Fallback for string-like fields if API shape changes.
            if start_ms is None and isinstance(obj.get("startTime"), str):
                try:
                    start_ms = float(obj["startTime"]) * 1000.0
                except ValueError:
                    start_ms = None
            if end_ms is None and isinstance(obj.get("endTime"), str):
                try:
                    end_ms = float(obj["endTime"]) * 1000.0
                except ValueError:
                    end_ms = None

            if start_ms is not None and end_ms is not None:
                text = str(obj.get("text", "")).strip()
                if text:
                    out.append(
                        WordSpan(
                            text=text,
                            norm=normalize_token(text),
                            start_sec=float(start_ms) / 1000.0,
                            end_sec=float(end_ms) / 1000.0,
                            confidence=float(obj.get("confidence", 0.0) or 0.0),
                        )
                    )

        for v in obj.values():
            extract_words(v, out)
    elif isinstance(obj, list):
        for item in obj:
            extract_words(item, out)


def read_reference_lines(path: str) -> List[str]:
    lines: List[str] = []
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            lines.append(line)
    return lines


def tokenize_line(line: str) -> List[str]:
    out: List[str] = []
    for raw in WORD_RE.findall(line):
        norm = normalize_token(raw)
        if not norm:
            continue
        if "-" in norm:
            parts = [p for p in norm.split("-") if p]
            out.extend(parts)
        else:
            out.append(norm)
    return out


def align_lines(reference_lines: List[str], rec_words: List[WordSpan]) -> Dict[str, Any]:
    rec_norm = [w.norm for w in rec_words]
    rec_time = [w.start_sec for w in rec_words]
    if not rec_words:
        raise RuntimeError("No word timestamps extracted from Yandex response")

    cursor = 0
    aligned = []
    prev_end = rec_words[0].start_sec

    for idx, line in enumerate(reference_lines):
        line_tokens = tokenize_line(line)
        if not line_tokens:
            aligned.append(
                {
                    "line_index": idx,
                    "text": line,
                    "start_sec": round(prev_end, 3),
                    "end_sec": round(prev_end, 3),
                    "confidence": 0.0,
                    "matched_tokens": 0,
                    "total_tokens": 0,
                    "words": [],
                }
            )
            continue

        matched_indices: List[int] = []
        search_pos = max(cursor, 0)

        for tok in line_tokens:
            found = -1
            max_pos = min(len(rec_norm), search_pos + 40)
            for j in range(search_pos, max_pos):
                if rec_norm[j] == tok:
                    found = j
                    break
            if found >= 0:
                matched_indices.append(found)
                search_pos = found + 1

        if matched_indices:
            start_i = matched_indices[0]
            end_i = matched_indices[-1]
            cursor = end_i + 1
            line_words = rec_words[start_i : end_i + 1]
            conf = sum(w.confidence for w in line_words) / max(1, len(line_words))
            start_sec = rec_words[start_i].start_sec
            end_sec = rec_words[end_i].end_sec
            prev_end = end_sec
            aligned.append(
                {
                    "line_index": idx,
                    "text": line,
                    "start_sec": round(start_sec, 3),
                    "end_sec": round(end_sec, 3),
                    "confidence": round(conf, 3),
                    "matched_tokens": len(matched_indices),
                    "total_tokens": len(line_tokens),
                    "words": [
                        {
                            "word": w.text,
                            "start_sec": round(w.start_sec, 3),
                            "end_sec": round(w.end_sec, 3),
                            "confidence": round(w.confidence, 3),
                        }
                        for w in line_words
                    ],
                }
            )
        else:
            # Unmatched line: keep monotonic timeline and low confidence marker.
            start_sec = prev_end
            end_sec = min(prev_end + 1.2, rec_words[-1].end_sec)
            prev_end = end_sec
            aligned.append(
                {
                    "line_index": idx,
                    "text": line,
                    "start_sec": round(start_sec, 3),
                    "end_sec": round(end_sec, 3),
                    "confidence": 0.0,
                    "matched_tokens": 0,
                    "total_tokens": len(line_tokens),
                    "words": [],
                }
            )

    return {
        "language": "ru",
        "source": "yandex_speechkit_v3_reference_alignment",
        "lines": aligned,
        "stats": {
            "recognized_words": len(rec_words),
            "aligned_lines": len(aligned),
            "lines_with_matches": sum(1 for l in aligned if l["matched_tokens"] > 0),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Align reference lyrics lines to Yandex STT word timestamps")
    parser.add_argument("--reference", required=True)
    parser.add_argument("--recognition-json", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    with open(args.recognition_json, "r", encoding="utf-8") as f:
        raw = f.read().strip()

    # SpeechKit v3 getRecognition may return either a single JSON object or
    # line-delimited JSON events.
    try:
        recognition: Any = json.loads(raw)
    except json.JSONDecodeError:
        events: List[Any] = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        recognition = events

    rec_words: List[WordSpan] = []
    extract_words(recognition, rec_words)
    rec_words.sort(key=lambda w: (w.start_sec, w.end_sec))

    reference_lines = read_reference_lines(args.reference)
    aligned = align_lines(reference_lines, rec_words)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(aligned, f, ensure_ascii=False, indent=2)

    print(f"saved={args.output}")
    print(
        "stats:",
        f"recognized_words={aligned['stats']['recognized_words']}",
        f"aligned_lines={aligned['stats']['aligned_lines']}",
        f"lines_with_matches={aligned['stats']['lines_with_matches']}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
