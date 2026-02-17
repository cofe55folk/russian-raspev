#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/evgenij/russian-raspev"
PY="$ROOT/.venv-asr/bin/python"

API_KEY="${YC_API_KEY:-}"
FOLDER_ID="${YC_FOLDER_ID:-}"
AUDIO_URI="${YC_AUDIO_URI:-}"

REF_TXT="$ROOT/public/audio/balman-seyu_veyu/balman-seyu-veyu-lyrics-source.txt"
RAW_JSON="$ROOT/public/audio/balman-seyu_veyu/balman-seyu-veyu-01.yandex-recognition.json"
OP_JSON="$ROOT/public/audio/balman-seyu_veyu/balman-seyu-veyu-01.yandex-operation.json"
ALIGN_JSON="$ROOT/public/audio/balman-seyu_veyu/balman-seyu-veyu-01.yandex-aligned.json"

if [[ ! -f "$REF_TXT" ]]; then
  echo "Missing reference lyrics: $REF_TXT" >&2
  exit 1
fi

if [[ -z "$API_KEY" || -z "$FOLDER_ID" ]]; then
  cat >&2 <<MSG
Set required env vars first:
  export YC_API_KEY='<your_yandex_api_key>'
  export YC_FOLDER_ID='<your_folder_id>'
Also set audio URI after upload to Yandex Object Storage:
  export YC_AUDIO_URI='https://storage.yandexcloud.net/<bucket>/<key>.wav'
MSG
  exit 1
fi

echo "[1/4] Convert m4a -> wav"
echo "Skip local conversion (using Object Storage URI directly)"

if [[ -z "$AUDIO_URI" ]]; then
  cat <<MSG
[2/4] Upload required
Upload audio (WAV/MP3/OGG_OPUS) to Yandex Object Storage, then set:
  export YC_AUDIO_URI='https://storage.yandexcloud.net/<bucket>/<key>.<wav|mp3|ogg>'
And run this script again.
MSG
  exit 2
fi

echo "[3/4] Run Yandex SpeechKit STT v3 async"
"$PY" "$ROOT/scripts/asr/yandex_stt_v3_async.py" \
  --folder-id "$FOLDER_ID" \
  --api-key "$API_KEY" \
  --audio-uri "$AUDIO_URI" \
  --audio-container WAV \
  --language ru-RU \
  --model general \
  --output "$RAW_JSON" \
  --operation-output "$OP_JSON"

echo "[4/4] Align reference lyrics to recognized word timestamps"
"$PY" "$ROOT/scripts/asr/align_reference_to_yandex_words.py" \
  --reference "$REF_TXT" \
  --recognition-json "$RAW_JSON" \
  --output "$ALIGN_JSON"

echo "Done"
echo "- raw recognition: $RAW_JSON"
echo "- operation:       $OP_JSON"
echo "- aligned lyrics:  $ALIGN_JSON"
