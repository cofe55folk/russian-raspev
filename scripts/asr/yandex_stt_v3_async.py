#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
from typing import Optional
import urllib.error
import urllib.request

RECOGNIZE_URL = "https://stt.api.cloud.yandex.net/stt/v3/recognizeFileAsync"
OPERATIONS_URL = "https://operation.api.cloud.yandex.net/operations/{operation_id}"
GET_RECOGNITION_URL = "https://stt.api.cloud.yandex.net/stt/v3/getRecognition"


def http_json(url: str, method: str, headers: dict, payload: Optional[dict] = None) -> dict:
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url=url, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {url}\n{body}") from exc


def extract_operation_id(start_resp: dict) -> str:
    op_id = start_resp.get("id")
    if op_id:
        return op_id
    for key in ("operationId", "operation_id"):
        if key in start_resp:
            return str(start_resp[key])
    raise RuntimeError(f"Cannot find operation id in response: {json.dumps(start_resp, ensure_ascii=False)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Yandex SpeechKit STT v3 async recognizeFile and fetch final recognition")
    parser.add_argument("--folder-id", required=True)
    parser.add_argument("--audio-uri", required=True, help="Yandex Object Storage URI (https://storage.yandexcloud.net/<bucket>/<key>)")
    parser.add_argument("--api-key", default=os.getenv("YC_API_KEY", ""))
    parser.add_argument("--language", default="ru-RU")
    parser.add_argument("--model", default="general")
    parser.add_argument("--audio-container", default="WAV", choices=["WAV", "MP3", "OGG_OPUS"])
    parser.add_argument("--output", required=True, help="Path for final getRecognition JSON")
    parser.add_argument("--operation-output", default="", help="Optional path for operation status JSON")
    parser.add_argument("--poll-sec", type=float, default=4.0)
    parser.add_argument("--timeout-sec", type=float, default=1800.0)
    args = parser.parse_args()

    if not args.api_key:
        raise RuntimeError("YC API key is empty. Set --api-key or YC_API_KEY env var.")

    headers = {
        "Authorization": f"Api-Key {args.api_key}",
        "x-folder-id": args.folder_id,
        "Content-Type": "application/json",
    }

    start_payload = {
        "uri": args.audio_uri,
        "recognition_model": {
            "model": args.model,
            "audio_processing_type": "FULL_DATA",
            "audio_format": {
                "container_audio": {
                    "container_audio_type": args.audio_container,
                }
            },
            "language_restriction": {
                "restriction_type": "WHITELIST",
                "language_code": [args.language],
            },
        },
    }

    start_resp = http_json(RECOGNIZE_URL, "POST", headers, start_payload)
    operation_id = extract_operation_id(start_resp)
    print(f"operation_id={operation_id}")

    deadline = time.time() + args.timeout_sec
    op_resp = {}
    while True:
        if time.time() > deadline:
            raise RuntimeError(f"Timed out waiting for operation {operation_id}")
        op_resp = http_json(OPERATIONS_URL.format(operation_id=operation_id), "GET", headers)
        done = bool(op_resp.get("done"))
        print(f"done={done}")
        if done:
            break
        time.sleep(args.poll_sec)

    if args.operation_output:
        with open(args.operation_output, "w", encoding="utf-8") as f:
            json.dump(op_resp, f, ensure_ascii=False, indent=2)

    if op_resp.get("error"):
        raise RuntimeError(f"Operation failed: {json.dumps(op_resp['error'], ensure_ascii=False)}")

    # getRecognition is GET with operationId query parameter; response is
    # line-delimited JSON events.
    req = urllib.request.Request(
        url=f"{GET_RECOGNITION_URL}?operationId={operation_id}",
        method="GET",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            recognition_text = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {GET_RECOGNITION_URL}\\n{body}") from exc

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(recognition_text)

    print(f"saved={args.output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise
