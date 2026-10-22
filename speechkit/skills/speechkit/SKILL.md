---
name: speechkit
description: Configure and check the installed Yandex SpeechKit v3 voice input in BB.
---

# Yandex SpeechKit

`bb speechkit status` reports local configuration readiness without printing secrets.
The API key belongs in Settings → Installed plugins → Yandex SpeechKit, or can be
saved via `bb speechkit configure --api-key-stdin < /private/key-file`.
The service account needs `ai.speechkit-stt.user` and active billing.
Select with `bb settings ai-services set voice speechkit` only when requested.
Do not switch away from another engine merely to inspect the plugin.

SpeechKit uses cloud API v3 `general`, Russian by default, with text normalization
and punctuation. It sends recordings to Yandex over TLS. A configured key does
not prove working API permissions or billing: transcribe an authorized sample.
Uploads are limited to 20 MB and decoded duration to 5 minutes; the BB voice
request timeout can impose a smaller practical limit. Vocabulary hints are ignored.

The Python worker lives with the plugin in its isolated `.venv`. See its README
for dependency installation and the reproducible paired four-engine benchmark.
Never request an API key in plain chat or print one in logs or command arguments.
