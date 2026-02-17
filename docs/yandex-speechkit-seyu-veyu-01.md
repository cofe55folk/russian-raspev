# Yandex SpeechKit: Сею-вею 01

Goal: get Russian speech recognition with word timestamps and align the reference lyrics to audio.

## What is implemented

- STT async request script:
  - `/Users/evgenij/russian-raspev/scripts/asr/yandex_stt_v3_async.py`
- Reference-to-audio alignment script:
  - `/Users/evgenij/russian-raspev/scripts/asr/align_reference_to_yandex_words.py`
- One-command runner for this song:
  - `/Users/evgenij/russian-raspev/scripts/asr/run_yandex_seyu_veyu_01.sh`

Output files:
- `/Users/evgenij/russian-raspev/public/audio/balman-seyu_veyu/balman-seyu-veyu-01.yandex-operation.json`
- `/Users/evgenij/russian-raspev/public/audio/balman-seyu_veyu/balman-seyu-veyu-01.yandex-recognition.json`
- `/Users/evgenij/russian-raspev/public/audio/balman-seyu_veyu/balman-seyu-veyu-01.yandex-aligned.json`

## You need once

1. Create Yandex Cloud account + billing.
2. Create API key with `speechkit-stt.user` permission.
3. Get your folder ID.
4. Upload WAV file to Yandex Object Storage and get URI:
   - `https://storage.yandexcloud.net/<bucket>/<key>.wav`

## Run

```bash
cd /Users/evgenij/russian-raspev

export YC_API_KEY='<your_yandex_api_key>'
export YC_FOLDER_ID='<your_folder_id>'
# set after upload to Object Storage:
export YC_AUDIO_URI='https://storage.yandexcloud.net/<bucket>/<key>.wav'

./scripts/asr/run_yandex_seyu_veyu_01.sh
```

Notes:
- Script converts source M4A to WAV locally via `afconvert`.
- Yandex STT v3 docs for `recognizeFileAsync` mention supported containers WAV/MP3/OGG_OPUS.
- Language used: `ru-RU`, model: `general`.

## Reference docs

- SpeechKit STT v3 recognizeFileAsync:
  - https://yandex.cloud/en/docs/speechkit/stt-v3/api-ref/RecognizerAsync/recognizeFileAsync
- Supported audio formats (WAV/MP3/OGG_OPUS):
  - https://yandex.cloud/en/docs/speechkit/formats
- Models and languages (including `ru-RU`):
  - https://yandex.cloud/en/docs/speechkit/stt-v3/models
