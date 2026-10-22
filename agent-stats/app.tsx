// bb-plugin-agent-stats — the Agent Stats page: pick a source, a period, a format and a theme, see the card at its real
// proportions, take it out as a PNG (download, clipboard, or the phone's share sheet straight into a story).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { toCanvas } from "html-to-image";
import type { rpcContract, Stats } from "./server";
import { FONT, SIZES, StatsCard, type Format, type Theme } from "./card";
import { SHADER_THEMES, isShaderTheme, type ShaderTheme } from "./shaders";
import { recordCard, videoType, VIDEO_SECONDS } from "./lib/video";
import { GEIST_CSS } from "./lib/fonts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Source = Stats["source"];
const SOURCES: Record<Source, string> = { bb: "BB", all: "Все сессии" };
const SOURCE_HINTS: Record<Source, string> = {
  bb: "Треды BB как сессии; токены из логов их сессий Claude Code и Codex",
  all: "Все сессии Claude Code и Codex на этом Mac, включая BB. Токены и цена по прайсу API из CodexBar, за 24 часа токены из логов без цены",
};
const PERIODS = { "24h": "24 часа", "7d": "7 дней", "14d": "14 дней", "30d": "30 дней", "90d": "90 дней" } as const;
type PeriodKey = keyof typeof PERIODS;
const FORMATS: Record<Format, string> = { story: "Сторис", portrait: "Пост 4:5", square: "Квадрат" };
const FORMAT_HINTS: Record<Format, string> = {
  story: "1080 × 1920, для сторис в Instagram и Telegram",
  portrait: "1080 × 1350, для поста в Telegram или Instagram",
  square: "1080 × 1080, для поста в ленту",
};
const THEMES = {
  light: "Светлая", dark: "Тёмная",
  ...Object.fromEntries(Object.entries(SHADER_THEMES).map(([k, t]) => [k, t.name])) as Record<ShaderTheme, string>,
} as Record<Theme, string>;

/** A choice kept across visits in this browser. */
function useStored<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(`agent-stats:${key}`);
    return allowed.includes(saved as T) ? (saved as T) : fallback;
  });
  const set = useCallback((next: T) => {
    setValue(next);
    try { localStorage.setItem(`agent-stats:${key}`, next); } catch { /* private mode */ }
  }, [key]);
  return [value, set] as const;
}

// The card's face is Geist; the same @font-face text goes into the PNG.
function useCardFont() {
  useEffect(() => {
    if (document.getElementById("agent-stats-geist")) return;
    const style = document.createElement("style");
    style.id = "agent-stats-geist";
    style.textContent = GEIST_CSS;
    document.head.appendChild(style);
  }, []);
}

// Lucide glyphs (ISC) the host icon set lacks, drawn in the host icons' stroke.
const GLYPHS = {
  share: ["M12 2v13", "m16 6-4-4-4 4", "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"],
  refresh: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"],
  loader: ["M21 12a9 9 0 1 1-6.219-8.56"],
} as const;
function Glyph({ name, className }: { name: keyof typeof GLYPHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("size-4 shrink-0", className)}>
      {GLYPHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Record<T, string>; onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap justify-center rounded-lg bg-muted p-0.5">
      {(Object.keys(options) as T[]).map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className={cn(
            "h-7 cursor-pointer rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            value === k && "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
          )}
        >
          {options[k]}
        </button>
      ))}
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Record<T, string>; onChange: (v: T) => void;
}) {
  return <>
    <label className="flex min-w-0 flex-col gap-1.5 md:hidden">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}
        className="h-11 w-full min-w-0 cursor-pointer rounded-lg border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        {(Object.keys(options) as T[]).map((key) => <option key={key} value={key}>{options[key]}</option>)}
      </select>
    </label>
    <div className="hidden md:block"><Segmented label={label} value={value} options={options} onChange={onChange} /></div>
  </>;
}

/** The card drawn at full size and scaled to fit its frame; `node` is the full-size element the PNG is taken from. */
function Preview({ stats, format, theme, busy, nodeRef, animated, recording }: {
  stats: Stats; format: Format; theme: Theme; animated: boolean; recording: boolean; busy: boolean; nodeRef: React.RefObject<HTMLDivElement | null>;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const { width, height } = SIZES[format];
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / width);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div
      ref={frame}
      className="relative overflow-hidden rounded-2xl ring-1 ring-foreground/10"
      style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc((100dvh - 15rem) * ${width / height}), ${format === "story" ? 30 : 36}rem)` }}
    >
      <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width, height, opacity: busy ? 0.45 : 1, transition: "opacity 200ms ease-out" }}>
        <div ref={nodeRef}><StatsCard stats={stats} format={format} theme={theme} animated={animated} recording={recording} uid="preview" /></div>
      </div>
      {busy && <span role="status" aria-label="Считаю" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-muted-foreground"><Glyph name="loader" className="size-6 animate-spin" /></span>}
    </div>
  );
}

function Notice({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn(
      "flex aspect-[9/16] w-[min(100%,30rem)] items-center justify-center rounded-2xl border border-dashed border-border p-8 text-center text-sm",
      tone === "error" ? "text-destructive" : "text-muted-foreground",
    )}>
      {children}
    </div>
  );
}

const canShareFiles = () => {
  try {
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] });
  } catch {
    return false;
  }
};

function StatsPage() {
  useCardFont();
  const rpc = useRpc<typeof rpcContract>();
  const [source, setSource] = useStored<Source>("source", ["bb", "all"], "bb");
  const [periodKey, setPeriodKey] = useStored<PeriodKey>("period", ["24h", "7d", "14d", "30d", "90d"], "30d");
  const [format, setFormat] = useStored<Format>("format", ["story", "portrait", "square"], "story");
  const [theme, setTheme] = useStored<Theme>("theme", Object.keys(THEMES) as Theme[], "light");
  const period = periodKey === "24h" ? "24h" as const : parseInt(periodKey, 10);

  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [motion, setMotion] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const videoAbort = useRef<AbortController | null>(null);
  useEffect(() => () => videoAbort.current?.abort(), []);
  const node = useRef<HTMLDivElement>(null);
  const request = useRef(0);

  const load = useCallback((refresh = false) => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    rpc.call("stats_get", { source, period, refresh }).then(
      (s) => { if (id === request.current) { setStats(s); setLoading(false); } },
      (e: unknown) => {
        if (id !== request.current) return;
        setLoading(false);
        const message = e instanceof Error ? e.message : String(e);
        setError(source === "all" && /ENOENT|not found|codexbar/i.test(message)
          ? "CodexBar CLI не найден. Установи его из CodexBar.app (Settings → Install CLI) или укажи путь в настройках плагина."
          : `Не получилось посчитать: ${message}`);
      },
    );
  }, [rpc, source, period]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => setNotice(null), [source, period, format, theme]);

  const fileName = stats ? `agent-stats-${stats.source}-${stats.buckets.at(-1)!.slice(0, 10)}-${periodKey}-${format}` : "agent-stats";
  const render = useCallback(async (type: "image/png" | "image/jpeg") => {
    const el = node.current;
    if (!el) throw new Error("Карточка ещё не нарисовалась");
    await Promise.all([400, 500, 600].map((w) => document.fonts.load(`${w} 40px ${FONT}`)));
    const { width, height } = SIZES[format];
    const shader = el.querySelector("canvas");
    const type_ = await toCanvas(el, { width, height, pixelRatio: 2, fontEmbedCSS: GEIST_CSS, cacheBust: false,
      filter: (node) => !(node instanceof HTMLCanvasElement) });
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d")!;
    if (shader) ctx.drawImage(shader, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(type_, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, 0.92));
    if (!blob) throw new Error("Пустая картинка");
    return blob;
  }, [format]);

  const act = async (what: "png" | "jpeg" | "copy" | "share") => {
    setExporting(true);
    setNotice(null);
    try {
      const blob = await render(what === "jpeg" ? "image/jpeg" : "image/png");
      if (what === "png" || what === "jpeg") {
        const name = `${fileName}.${what === "jpeg" ? "jpg" : "png"}`;
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: url, download: name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setNotice(`Сохранено: ${name}`);
      } else if (what === "copy") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setNotice("Картинка в буфере обмена");
      } else {
        await navigator.share({ files: [new File([blob], `${fileName}.png`, { type: "image/png" })] });
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setNotice(`Не вышло: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };
  const saveVideo = async () => {
    if (!node.current) return;
    const controller = new AbortController();
    videoAbort.current = controller;
    setExporting(true);
    setVideoProgress(0);
    setNotice(null);
    try {
      await Promise.all([400, 500, 600].map((w) => document.fonts.load(`${w} 40px ${FONT}`)));
      const { width, height } = SIZES[format];
      const shader = node.current.querySelector("canvas");
      if (!shader) throw new Error("Выбери тему с шейдером для видео");
      const overlay = await toCanvas(node.current, { width, height, pixelRatio: 1, fontEmbedCSS: GEIST_CSS,
        filter: (node) => !(node instanceof HTMLCanvasElement) });
      controller.signal.throwIfAborted();
      const blob = await recordCard(shader, overlay, width, height, controller.signal, setVideoProgress);
      const name = `${fileName}.${blob.type.includes("mp4") ? "mp4" : "webm"}`;
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNotice(`Сохранено: ${name}`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setNotice("Запись отменена");
      else setNotice(`Не вышло: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      videoAbort.current = null;
      setExporting(false);
      setVideoProgress(null);
    }
  };
  const share = canShareFiles();
  const ready = stats != null && !loading;

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border flex w-full max-w-5xl flex-col items-center gap-4 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 md:gap-5 md:px-5 md:pb-8">
        <fieldset disabled={exporting} className="grid min-w-0 w-full max-w-lg grid-cols-2 gap-x-3 gap-y-3 md:flex md:max-w-none md:flex-wrap md:items-center md:justify-center md:gap-2">
          <Choice label="Источник" value={source} options={SOURCES} onChange={setSource} />
          <Choice label="Период" value={periodKey} options={PERIODS} onChange={setPeriodKey} />
          <Choice label="Формат" value={format} options={FORMATS} onChange={setFormat} />
          <Choice label="Тема" value={theme} options={THEMES} onChange={setTheme} />
        </fieldset>

        {stats ? (
          <Preview stats={stats} format={format} theme={theme} busy={loading} nodeRef={node} animated={motion || videoProgress !== null} recording={videoProgress !== null} />
        ) : error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <Notice>
            <span className="flex items-center gap-2">
              <Glyph name="loader" className="animate-spin" />
              {source === "all" ? "CodexBar читает логи Claude Code и Codex, до полминуты" : "Считаю треды и токены BB"}
            </span>
          </Notice>
        )}
        {stats && error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <div className="flex w-full max-w-lg flex-col gap-3 md:max-w-none md:items-center md:gap-2">
          {isShaderTheme(theme) && <div className="flex items-center justify-between gap-3 md:justify-center">
            <span className="text-sm text-muted-foreground md:hidden">Анимация фона</span>
            <Button className="h-11 px-3 md:h-9" variant="ghost" aria-pressed={motion} disabled={exporting} onClick={() => setMotion(!motion)}>
              <span className="md:hidden">{motion ? "Пауза" : "Включить"}</span>
              <span className="hidden md:inline">{motion ? "Приостановить фон" : "Оживить фон"}</span>
            </Button>
          </div>}
          <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:justify-center [&>button]:h-11 [&>button]:min-w-0 [&>button]:px-3 md:[&>button]:h-9 md:[&>button]:px-4">
            {share && (
              <Button className="col-span-2 md:col-span-1" disabled={!ready || exporting} onClick={() => act("share")}>
                <Glyph name="share" /> Поделиться
              </Button>
            )}
            <Button variant={share ? "outline" : "default"} disabled={!ready || exporting} onClick={() => act("png")}>
              <Icon name="Download" className="size-4" /> <span className="md:hidden">PNG</span><span className="hidden md:inline">Скачать PNG</span>
            </Button>
            {isShaderTheme(theme) && <Button variant="outline" disabled={!ready || exporting || !videoType()} onClick={saveVideo}>
              <Icon name="Download" className="size-4" /> <span className="md:hidden">Видео · {VIDEO_SECONDS} с</span><span className="hidden md:inline">Скачать видео · {VIDEO_SECONDS} сек</span>
            </Button>}
            {videoProgress !== null && <Button className="col-span-2 md:col-span-1" variant="ghost" onClick={() => videoAbort.current?.abort()}>Отменить запись</Button>}
            <Button variant="outline" disabled={!ready || exporting} onClick={() => act("jpeg")}>
              <Icon name="Download" className="size-4" /> <span className="md:hidden">JPEG</span><span className="hidden md:inline">Скачать JPEG</span>
            </Button>
            <Button variant="outline" disabled={!ready || exporting} onClick={() => act("copy")}>
              <Icon name="Copy" className="size-4" /> Скопировать
            </Button>
            <Button className="col-span-2 mt-1 md:col-span-1 md:mt-0" variant="ghost" disabled={loading || exporting} onClick={() => load(true)}>
              <Glyph name="refresh" className={loading ? "animate-spin" : undefined} /> Пересчитать
            </Button>
          </div>
          <p className="text-left text-xs leading-relaxed text-muted-foreground md:max-w-2xl md:text-center md:text-sm" aria-live="polite">
            {videoProgress !== null ? `Записываю видео: ${videoProgress} из ${VIDEO_SECONDS} сек. Оставь вкладку открытой.` : notice ?? `${FORMAT_HINTS[format]}. ${SOURCE_HINTS[source]}.`}
          </p>
        </div>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "stats",
    title: "Agent Stats",
    icon: "ChartColumn",
    path: "stats",
    component: StatsPage,
  });
});
