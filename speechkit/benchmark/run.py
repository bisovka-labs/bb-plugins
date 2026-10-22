"""Paired, reproducible evaluation. No credential or personal audio discovery."""
import argparse
import hashlib
import json
import os
import random
from pathlib import Path
import re
import statistics
import subprocess
import sys
import time
import unicodedata
import wave

import requests

ROOT = Path(__file__).resolve().parent


def normalize(text):
    text = unicodedata.normalize("NFKC", text).lower().replace("ё", "е")
    text = "".join(" " if unicodedata.category(c)[0] in "PS" else c for c in text)
    return " ".join(text.split())


def prepare(parquet):
    import pyarrow.parquet as pq
    samples = []
    for index, row in enumerate(pq.read_table(parquet).to_pylist()):
        source = ROOT / "data" / f"{index:03d}.source"
        target = ROOT / "data" / f"{index:03d}.wav"
        source.write_bytes(row["audio"]["bytes"])
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(target)], check=True)
        with wave.open(str(target)) as audio:
            duration = audio.getnframes() / audio.getframerate()
        reference = row.get("transcription") or row.get("text") or row.get("sentence")
        if not reference:
            raise ValueError(f"No reference in columns {list(row)}")
        samples.append(dict(id=index, path=str(target), reference=reference, duration=duration,
                            sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
    (ROOT / "data/manifest.json").write_text(json.dumps(samples, ensure_ascii=False, indent=2))
    return samples


def prepare_rows(filename):
    payload = json.loads(Path(filename).read_text())
    samples = []
    for item in payload["rows"]:
        index, row = item["row_idx"], item["row"]
        source = ROOT / "data" / f"{index:03d}.source"
        target = ROOT / "data" / f"{index:03d}.wav"
        response = requests.get(row["audio"][0]["src"], timeout=60)
        response.raise_for_status()
        source.write_bytes(response.content)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(target)], check=True)
        with wave.open(str(target)) as audio:
            duration = audio.getnframes() / audio.getframerate()
        samples.append(dict(id=index, path=str(target), reference=row["transcription"], duration=duration,
                            sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
        print(f"Prepared public sample {len(samples)}/{len(payload['rows'])}", flush=True)
    (ROOT / "data/manifest.json").write_text(json.dumps(samples, ensure_ascii=False, indent=2))
    return samples


def evaluate(name, samples, infer):
    rows = []
    path = ROOT / "results" / f"{name}.jsonl"
    with path.open("w") as output:
        for sample in samples:
            start = time.perf_counter()
            try:
                text = infer(sample["path"])
                row = dict(sample, model=name, hypothesis=text, elapsed=time.perf_counter()-start)
            except Exception as error:
                row = dict(sample, model=name, error=type(error).__name__, elapsed=time.perf_counter()-start)
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
            output.flush()
            rows.append(row)
            print(f"{name}: {len(rows)}/{len(samples)} {'ERROR' if 'error' in row else 'ok'}", flush=True)
    return rows


def summarize():
    try:
        import jiwer
    except ImportError:
        print("Transcripts saved. Install benchmark requirements to calculate metrics.", flush=True)
        return
    summary = {}
    for path in sorted((ROOT / "results").glob("*.jsonl")):
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        good = [row for row in rows if "error" not in row]
        item = dict(samples=len(rows), failed=len(rows)-len(good))
        if good and len(good) == len(rows):
            refs = [normalize(row["reference"]) for row in rows]
            hyps = [normalize(row["hypothesis"]) for row in rows]
            words = jiwer.process_words(refs, hyps)
            chars = jiwer.process_characters(refs, hyps)
            item.update(wer=words.wer, cer=chars.cer, reference_words=words.hits+words.substitutions+words.deletions,
                        substitutions=words.substitutions, deletions=words.deletions, insertions=words.insertions,
                        median_seconds=statistics.median(row["elapsed"] for row in rows),
                        total_seconds=sum(row["elapsed"] for row in rows),
                        audio_seconds=sum(row["duration"] for row in rows))
        summary[path.stem] = item
    if "speechkit" not in summary:
        summary["speechkit"] = {"status": "blocked_missing_api_key" if not os.getenv("YC_API_KEY") else "not_run"}
    left = ROOT / "results/gigaam.jsonl"
    right = ROOT / "results/whisper.jsonl"
    if left.exists() and right.exists():
        a = [json.loads(line) for line in left.read_text().splitlines()]
        b = [json.loads(line) for line in right.read_text().splitlines()]
        if len(a) == len(b) and all("error" not in x and "error" not in y and x["sha256"] == y["sha256"] and x["reference"] == y["reference"] for x, y in zip(a, b)):
            scores = []
            for x, y in zip(a, b):
                sx = jiwer.process_words(normalize(x["reference"]), normalize(x["hypothesis"]))
                sy = jiwer.process_words(normalize(y["reference"]), normalize(y["hypothesis"]))
                scores.append((sx.substitutions + sx.deletions + sx.insertions - sy.substitutions - sy.deletions - sy.insertions,
                               sx.hits + sx.substitutions + sx.deletions))
            rng = random.Random(20261017)
            differences = []
            for _ in range(20000):
                indexes = rng.choices(range(len(scores)), k=len(scores))
                differences.append(sum(scores[i][0] for i in indexes) / sum(scores[i][1] for i in indexes))
            differences.sort()
            confidence = {"method": "paired utterance bootstrap; 20000 draws; seed=20261017",
                          "gigaam_minus_whisper_95_percentile_pp": [100*differences[500], 100*differences[19499]]}
            (ROOT / "results/confidence.json").write_text(json.dumps(confidence, indent=2))
    (ROOT / "results/summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--parquet")
    parser.add_argument("--rows")
    parser.add_argument("--models", nargs="+", choices=["whisper", "gigaam", "nemotron", "speechkit", "summary"], default=["whisper", "gigaam", "nemotron", "speechkit"])
    parser.add_argument("--gigaam-url", default="http://127.0.0.1:58087")
    parser.add_argument("--whisper-url", default="http://127.0.0.1:8124")
    args = parser.parse_args()
    samples = prepare(args.parquet) if args.parquet else prepare_rows(args.rows) if args.rows else json.loads((ROOT / "data/manifest.json").read_text())
    session = requests.Session()

    def remote(url):
        def infer(path):
            with open(path, "rb") as stream:
                response = session.post(url, files={"file": ("sample.wav", stream, "audio/wav")}, timeout=120)
            response.raise_for_status()
            return response.json()["text"]
        return infer

    if "whisper" in args.models:
        infer = remote(args.whisper_url + "/v1/audio/transcriptions")
        infer(samples[0]["path"])
        evaluate("whisper", samples, infer)
    if "gigaam" in args.models:
        infer = remote(args.gigaam_url + "/v1/audio/transcriptions")
        infer(samples[0]["path"])
        evaluate("gigaam", samples, infer)
    if "nemotron" in args.models:
        from mlx_audio.stt import load
        start = time.perf_counter()
        from huggingface_hub import snapshot_download
        model_path = snapshot_download("mlx-community/nemotron-3.5-asr-streaming-0.6b",
                                       revision="e550040c0478027ed679b2b6b0d055502c103663",
                                       allow_patterns=["*.json", "*.safetensors", "*.model", "*.txt"])
        model = load(model_path)
        (ROOT / "results/nemotron-load.json").write_text(json.dumps({"load_seconds": time.perf_counter()-start}))
        # Warm up all MLX kernels before measuring interactive inference.
        model.generate(samples[0]["path"], language="ru-RU")
        evaluate("nemotron", samples, lambda path: model.generate(path, language="ru-RU").text)
    if "speechkit" in args.models and os.getenv("YC_API_KEY"):
        sys.path.insert(0, str(ROOT.parent))
        from speechkit import transcribe
        evaluate("speechkit", samples, lambda path: transcribe(Path(path).read_bytes(), os.environ["YC_API_KEY"], os.getenv("YC_FOLDER_ID", ""), timeout=120))
    summarize()


if __name__ == "__main__":
    main()
