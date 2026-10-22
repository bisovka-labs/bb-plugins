# Yandex SpeechKit voice input for BB

A headless BB plugin for Russian dictation through SpeechKit API v3. Audio is
sent to Yandex Cloud. The current BB voice selection is not changed on install.

## Install

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
bb plugin build .
bb plugin install . --yes
```

FFmpeg must be available on PATH or at `/opt/homebrew/bin/ffmpeg`.

Add a service account API key in **Settings → Installed plugins → Yandex
SpeechKit → Yandex SpeechKit API key**. BB stores it as a secret. The account
needs `ai.speechkit-stt.user` and an active billing account. A folder ID is
optional for a service account key and can be supplied in plugin settings.

Alternatively pass a key from a private file over stdin:

```sh
bb speechkit configure --api-key-stdin < /private/path/speechkit-key
bb speechkit status
```

Then select **Yandex SpeechKit v3** in Settings → AI services → Voice, or run
`bb settings ai-services set voice speechkit`. Until the key is supplied the
service reports `ready: false`; no transcript or accuracy result is fabricated.
Readiness means configured locally, not that API permissions or billing have
been validated. The first transcription verifies those.

## Behavior

- SpeechKit `general`, API v3, Russian by default; English and automatic language
  selection are optional.
- Punctuation and text normalization enabled; profanity filtering and literary
  rewriting disabled. BB vocabulary hints are not applied.
- Up to 20 MB uploaded audio and 5 minutes decoded speech. BB's own voice request
  deadline can be shorter; a timeout is reported as failure.
- Uploaded M4A/WebM/WAV is decoded to 16 kHz mono PCM through a seekable temporary
  file. That file is removed after decoding, including on decoder failure.
- Credentials travel to the local worker over stdin and to Yandex over TLS, never
  in process arguments. Neither recordings nor transcripts are logged by the
  plugin. `x-data-logging-enabled: false` is sent to Yandex.
- The worker runs on the BB server's machine. CLI status does not read files from
  the invoking host. No recording is read through a CLI path argument.

## Reproduce the comparison

The optional benchmark requires the dependencies in `benchmark/requirements.txt`.
It uses only the public `bond005/podlodka_speech` test split, not personal audio.

```sh
uv pip install --python .venv/bin/python -r benchmark/requirements.txt
.venv/bin/python benchmark/run.py --parquet /path/to/test.parquet
```

Models: the existing full Whisper large-v3 MLX service on a home server; the active
GigaAM v3 E2E RNNT server; Nemotron 3.5 ASR via MLX; SpeechKit v3 `general`.
Use `--gigaam-url` if its ephemeral port changes. SpeechKit benchmark credentials
are read only from `YC_API_KEY` and optional `YC_FOLDER_ID`; no secret store is
scraped. Missing credentials mark that engine blocked. The benchmark does not
change the live microphone provider.

Every engine gets the same resampled WAV bytes. Corpus WER and CER use NFKC,
lowercase, `ё→е`, punctuation/symbol removal and whitespace normalization. Digits
and English transliterations are not harmonized: formatting differences can
raise WER. Raw references, outputs, WAV hashes, elapsed request times and failures
are retained under `benchmark/results/`. Failure runs do not receive a WER on a
smaller surviving subset. This is a small one-domain test, not a universal model
ranking or a benchmark of the author's own voice. Latency compares actual deployed
systems, not equal hardware: Whisper runs on a home server over Tailscale; GigaAM runs
locally on CPU; Nemotron runs locally via MLX. Model download/load is excluded.

API reference: https://aistudio.yandex.ru/en/docs/speechkit/stt/api/streaming-examples-v3
