export const VIDEO_SECONDS = 15;

export function videoType() {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
  return ["video/mp4;codecs=avc1.424028", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
    .find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export async function recordCard(background: HTMLCanvasElement, overlay: HTMLCanvasElement, width: number, height: number,
  signal: AbortSignal, onProgress: (seconds: number) => void) {
  const mimeType = videoType();
  if (!mimeType) throw new Error("Этот браузер не поддерживает запись видео. Сохрани PNG или открой страницу в Chrome/Safari.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось создать видео");
  const draw = () => {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(background, 0, 0, width, height);
    ctx.drawImage(overlay, 0, 0, width, height);
  };
  draw();
  const stream = canvas.captureStream(30);
  let recorder: MediaRecorder | undefined;
  let timer = 0;
  let deadline = 0;
  const hidden = () => { if (document.hidden) fail(new Error("Запись прервана: вкладка скрыта. Оставь её открытой и скачай видео ещё раз.")); };
  let fail: (error: Error) => void = () => {};
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const result = await new Promise<Blob>((resolve, reject) => {
      const chunks: Blob[] = [];
      fail = reject;
      const abort = () => reject(new DOMException("Отменено", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      recorder!.addEventListener("stop", () => {
        signal.removeEventListener("abort", abort);
        const blob = new Blob(chunks, { type: recorder!.mimeType });
        if (blob.size) resolve(blob); else reject(new Error("Браузер записал пустое видео"));
      }, { once: true });
      recorder!.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder!.onerror = () => reject(new Error("Браузер не смог записать видео"));
      if (signal.aborted) { abort(); return; }
      document.addEventListener("visibilitychange", hidden);
      recorder!.start(250);
      const start = performance.now();
      const tick = () => {
        try {
          draw();
          const elapsed = performance.now() - start;
          onProgress(Math.min(VIDEO_SECONDS, Math.floor(elapsed / 1000)));
          if (elapsed >= VIDEO_SECONDS * 1000) { recorder!.stop(); return; }
          timer = window.setTimeout(tick, 1000 / 30);
        } catch (error) { reject(error); }
      };
      tick();
      deadline = window.setTimeout(() => reject(new Error("Запись заняла слишком много времени. Попробуй ещё раз.")), (VIDEO_SECONDS + 12) * 1000);
    });
    return result;
  } finally {
    clearTimeout(timer);
    clearTimeout(deadline);
    document.removeEventListener("visibilitychange", hidden);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
  }
}
