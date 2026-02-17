# Music.AI test: Сею-вею 01 (text-to-audio alignment)

Audio file:
- /Users/evgenij/russian-raspev/public/audio/balman-seyu_veyu/balman-seyu-veyu-01.m4a

Reference lyrics (from song card):
- /Users/evgenij/russian-raspev/public/audio/balman-seyu_veyu/balman-seyu-veyu-lyrics-source.txt

## 1) Prepare env

```bash
export MUSIC_AI_API_KEY="<YOUR_MUSIC_AI_API_KEY>"
export MUSIC_AI_WORKFLOW_SLUG="<YOUR_LYRICS_WORKFLOW_SLUG>"
```

`MUSIC_AI_WORKFLOW_SLUG` is your workflow slug in Music.AI dashboard for Lyrics Transcription.

## 2) Request upload URL and upload audio

```bash
UPLOAD_JSON=$(curl -sS -X GET \
  "https://api.music.ai/v1/upload?fileName=balman-seyu-veyu-01.m4a&type=audio%2Fx-m4a" \
  -H "Authorization: Bearer $MUSIC_AI_API_KEY")

SIGNED_UPLOAD_URL=$(echo "$UPLOAD_JSON" | node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(j.data.signedUrl)')
INPUT_FILE_URL=$(echo "$UPLOAD_JSON" | node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(j.data.file.url)')

curl -sS -X PUT "$SIGNED_UPLOAD_URL" \
  -H "Content-Type: audio/x-m4a" \
  --data-binary @/Users/evgenij/russian-raspev/public/audio/balman-seyu_veyu/balman-seyu-veyu-01.m4a
```

## 3) Create job (task for Music.AI)

Notes:
- Exact input field names depend on your workflow schema.
- Below is common layout with `inputFileUrl`, `language`, `referenceLyrics`, `taskPrompt`.
- If your workflow uses different keys, rename them in `input`.
- Main goal is alignment (расстановка текста под звук), not free transcription.

```bash
REFERENCE_LYRICS=$(cat /Users/evgenij/russian-raspev/public/audio/balman-seyu_veyu/balman-seyu-veyu-lyrics-source.txt)

JOB_JSON=$(curl -sS -X POST "https://api.music.ai/v1/job" \
  -H "Authorization: Bearer $MUSIC_AI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"lyrics-seyu-veyu-01\",
    \"workflow\": \"$MUSIC_AI_WORKFLOW_SLUG\",
    \"input\": {
      \"inputFileUrl\": \"$INPUT_FILE_URL\",
      \"language\": \"ru\",
      \"referenceLyrics\": \"${REFERENCE_LYRICS//$'\n'/\\n}\",
      \"taskPrompt\": \"Align provided reference lyrics to the sung audio in Russian folk style. Do not rewrite text. Keep dialect and archaic forms exactly as provided. Return precise timestamps for each line and each word. If a word is unclear, keep the reference word and lower confidence. Preserve repeated lines and refrain structure.\",
      \"outputFormatHint\": \"json_with_line_and_word_timestamps\"
    }
  }")

JOB_ID=$(echo "$JOB_JSON" | node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(j.data.id)')
echo "JOB_ID=$JOB_ID"
```

## 4) Poll result

```bash
while true; do
  STATUS_JSON=$(curl -sS -X GET "https://api.music.ai/v1/job/$JOB_ID" \
    -H "Authorization: Bearer $MUSIC_AI_API_KEY")

  STATUS=$(echo "$STATUS_JSON" | node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(j.data.status)')
  echo "status=$STATUS"

  if [ "$STATUS" = "SUCCEEDED" ] || [ "$STATUS" = "FAILED" ] || [ "$STATUS" = "CANCELLED" ]; then
    echo "$STATUS_JSON" > /Users/evgenij/russian-raspev/public/audio/balman-seyu_veyu/balman-seyu-veyu-01.musicai-job.json
    break
  fi
  sleep 8
done
```

## 5) What to compare

Compare Music.AI output against:
- /Users/evgenij/russian-raspev/public/audio/balman-seyu_veyu/balman-seyu-veyu-lyrics-source.txt

Primary checks:
- repeated line preservation
- dialect forms (no over-normalization)
- refrain boundaries
- low-confidence markers only where needed
- line/word timestamps are monotonic and non-overlapping

## 6) Required output shape (alignment)

If your workflow supports schema hints, request this structure:

```json
{
  "language": "ru",
  "source": "reference_lyrics_alignment",
  "lines": [
    {
      "line_index": 0,
      "text": "Сею-вею, сею-вею,",
      "start_sec": 0.0,
      "end_sec": 2.45,
      "confidence": 0.93,
      "words": [
        { "word": "Сею-вею,", "start_sec": 0.0, "end_sec": 1.2, "confidence": 0.91 },
        { "word": "сею-вею,", "start_sec": 1.2, "end_sec": 2.45, "confidence": 0.95 }
      ]
    }
  ]
}
```
