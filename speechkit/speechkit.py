"""SpeechKit v3 worker. JSON in/out over stdio; credentials never enter argv."""
import base64
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile

import grpc
from yandex.cloud.ai.stt.v3 import stt_pb2 as stt
from yandex.cloud.ai.stt.v3 import stt_service_pb2_grpc as service


def assemble(events):
    segments = {}
    for response in events:
        kind = response.WhichOneof("Event")
        if kind == "final" and response.final.alternatives:
            segments[int(response.audio_cursors.final_index)] = response.final.alternatives[0].text
        elif kind == "final_refinement" and response.final_refinement.normalized_text.alternatives:
            refined = response.final_refinement
            segments[int(refined.final_index)] = refined.normalized_text.alternatives[0].text
    return " ".join(segments[i].strip() for i in sorted(segments) if segments[i].strip())


def transcribe(audio, api_key, folder_id="", language="ru-RU", timeout=8):
    if not api_key.strip():
        raise ValueError("Yandex SpeechKit API key is missing")
    if not audio or len(audio) > 20 * 1024 * 1024:
        raise ValueError("Audio must be non-empty and at most 20 MB")
    ffmpeg = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    fd, path = tempfile.mkstemp(prefix="bb-speechkit-")
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(audio)
        converted = subprocess.run(
            [ffmpeg, "-v", "error", "-i", path, "-t", "301", "-f", "s16le", "-ar", "16000", "-ac", "1", "pipe:1"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=8, check=True,
        ).stdout
    finally:
        os.unlink(path)
    if len(converted) > 16000 * 2 * 300:
        raise ValueError("SpeechKit voice recordings must be at most 5 minutes")
    restriction = None if language == "auto" else stt.LanguageRestrictionOptions(
        restriction_type=stt.LanguageRestrictionOptions.WHITELIST, language_code=[language],
    )
    options = stt.StreamingOptions(recognition_model=stt.RecognitionModelOptions(
        model="general",
        audio_format=stt.AudioFormatOptions(raw_audio=stt.RawAudio(
            audio_encoding=stt.RawAudio.LINEAR16_PCM, sample_rate_hertz=16000, audio_channel_count=1,
        )),
        text_normalization=stt.TextNormalizationOptions(
            text_normalization=stt.TextNormalizationOptions.TEXT_NORMALIZATION_ENABLED,
            profanity_filter=False, literature_text=False,
        ),
        language_restriction=restriction,
        audio_processing_type=stt.RecognitionModelOptions.FULL_DATA,
    ))

    def requests():
        yield stt.StreamingRequest(session_options=options)
        for offset in range(0, len(converted), 8000):
            yield stt.StreamingRequest(chunk=stt.AudioChunk(data=converted[offset:offset + 8000]))

    metadata = [("authorization", "Api-Key " + api_key), ("x-data-logging-enabled", "false")]
    if folder_id:
        metadata.append(("x-folder-id", folder_id))
    with grpc.secure_channel("stt.api.cloud.yandex.net:443", grpc.ssl_channel_credentials()) as channel:
        return assemble(service.RecognizerStub(channel).RecognizeStreaming(
            requests(), metadata=metadata, timeout=timeout,
        ))


def main():
    try:
        payload = json.load(sys.stdin)
        text = transcribe(base64.b64decode(payload["audio"], validate=True),
                          payload["apiKey"], payload.get("folderId", ""), payload.get("language", "ru-RU"))
        print(json.dumps({"text": text}, ensure_ascii=False))
    except grpc.RpcError as error:
        print(json.dumps({"error": "SpeechKit API: " + error.code().name}))
        sys.exit(1)
    except Exception:
        print(json.dumps({"error": "SpeechKit could not decode or process this recording"}))
        sys.exit(1)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(1))
    main()
