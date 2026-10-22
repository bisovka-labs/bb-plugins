// The desktop widget's face: the shader card's world (a Paper Shaders background, ink type, glass panels) laid out at
// macOS widget sizes. The native shell (AgentStatsWidget.swift) owns the window, the settings menu and the data; it
// pushes everything here through window.widget.set().
import { useEffect, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import type { ProviderStats, Stats } from "../server";
import { FONT, NAMES, fmt, fmtDay, plural, scaled, short } from "../card";
import { SHADER_THEMES, type ShaderTheme } from "../shaders";
import { MARKS } from "../lib/marks";
import { GEIST_CSS } from "../lib/fonts";

export type Size = "small" | "medium" | "large";
export const SIZES: Record<Size, { width: number; height: number }> = {
  small: { width: 170, height: 170 },
  medium: { width: 364, height: 170 },
  large: { width: 364, height: 382 },
};

type State = {
  theme: ShaderTheme;
  size: Size;
  animated: boolean;
  stats: Stats | null;
  loading: boolean;
  error: string | null;
};

const initial: State = { theme: "sunset", size: "medium", animated: true, stats: null, loading: true, error: null };
let push: (s: Partial<State>) => void = () => {};
let pending: Partial<State> = {};
declare global { interface Window { widget: { set: (s: Partial<State>) => void } } }
window.widget = { set: (s) => { pending = { ...pending, ...s }; push(s); } };

const flex = (extra: CSSProperties = {}): CSSProperties => ({ display: "flex", ...extra });
const SESSIONS = ["сессия", "сессии", "сессий"] as const;
const DAYS = ["день", "дня", "дней"] as const;
const HOURS = ["час", "часа", "часов"] as const;

function period(stats: Stats) {
  const n = stats.buckets.length;
  return `за ${n} ${plural(n, stats.unit === "hour" ? HOURS : DAYS)}`;
}

function Mark({ id, size, color }: { id: ProviderStats["id"]; size: number; color: string }) {
  if (id === "other") return <div style={{ width: size * 0.6, height: size * 0.6, margin: size * 0.2, borderRadius: size, background: color, flexShrink: 0 }} />;
  return <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path d={MARKS[id]} fill={color} /></svg>;
}

/** Tokens per bucket as bars, the latest at the right edge. */
function Bars({ stats, width, height, fg, muted }: { stats: Stats; width: number; height: number; fg: string; muted: string }) {
  const totals = stats.buckets.map((_, i) => stats.providers.reduce((a, p) => a + p.series[i], 0));
  const hi = Math.max(1, ...totals);
  const gap = totals.length > 40 ? 1 : 3;
  const w = (width - gap * (totals.length - 1)) / totals.length;
  const first = stats.buckets[0], last = stats.buckets.at(-1)!;
  const label = (b: string) => (stats.unit === "hour" ? `${b.slice(11, 13)}:00` : fmtDay(b));
  return (
    <div style={flex({ flexDirection: "column", gap: 6 })}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
        {totals.map((v, i) => {
          const h = v > 0 ? Math.max(3, (v / hi) * height) : 1.5;
          return <rect key={i} x={i * (w + gap)} y={height - h} width={w} height={h} rx={Math.min(w / 2, 3)} fill={fg} opacity={i === totals.length - 1 ? 1 : 0.55} />;
        })}
      </svg>
      <div style={flex({ justifyContent: "space-between", fontSize: 11, color: muted, fontVariantNumeric: "tabular-nums" })}>
        <div>{label(first)}</div><div>{label(last)}</div>
      </div>
    </div>
  );
}

function Face({ s }: { s: State }) {
  const { width, height } = SIZES[s.size];
  const { ink } = SHADER_THEMES[s.theme];
  const pad = s.size === "small" ? 16 : 18;
  const inner = width - pad * 2;
  const panel: CSSProperties = { background: ink.glass, border: `1px solid ${ink.line}`, borderRadius: 14 };
  const stats = s.stats;

  let body;
  if (!stats) {
    body = (
      <div style={flex({ flexDirection: "column", justifyContent: "flex-end", height: "100%", gap: 4 })}>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>{s.error ? "Статистика недоступна" : "Считаю токены…"}</div>
        {s.error && <div style={{ fontSize: 12, color: ink.muted, lineHeight: 1.3 }}>{s.error}</div>}
      </div>
    );
  } else {
    const big = scaled(stats.tokens, true);
    const heroText = stats.tokens === 0 ? "0" : big ? big.text : fmt(stats.tokens);
    const words = big ? `${big.word} токенов` : plural(stats.tokens, ["токен", "токена", "токенов"]);
    const heroW = s.size === "medium" ? inner * 0.5 : inner;
    const hero = Math.min(s.size === "small" ? 64 : 84, Math.floor(heroW / (heroText.length * 0.56)));
    const sessions = `${fmt(stats.sessions)} ${plural(stats.sessions, SESSIONS)}`;
    const providers = stats.providers.filter((p) => p.tokens > 0).sort((a, b) => b.tokens - a.tokens);

    const heroBlock = (
      <div style={flex({ flexDirection: "column", minWidth: 0 })}>
        <div style={{ fontSize: hero, fontWeight: 600, letterSpacing: "-0.05em", lineHeight: 0.86, marginLeft: -hero * 0.04, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{heroText}</div>
        <div style={{ fontSize: s.size === "small" ? 14 : 16, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.15, marginTop: 8 }}>{words}</div>
        <div style={{ fontSize: s.size === "small" ? 12 : 13, color: ink.muted, marginTop: 2 }}>{period(stats)}</div>
      </div>
    );

    const providerRows = (compact: boolean) => providers.map((p) => (
      <div key={p.id} style={flex({ ...panel, flexDirection: "column", flex: compact ? undefined : 1, minWidth: 0, padding: compact ? "8px 10px" : "10px 12px" })}>
        <div style={flex({ alignItems: "center", gap: 5, fontSize: 11, color: ink.muted, whiteSpace: "nowrap" })}>
          <Mark id={p.id} size={12} color={ink.fg} />{NAMES[p.id]}
        </div>
        <div style={flex({ flexDirection: compact ? "row" : "column", alignItems: compact ? "baseline" : "flex-start", justifyContent: "space-between", gap: compact ? 8 : 1, marginTop: 3 })}>
          <div style={{ fontSize: compact ? 17 : 20, fontWeight: 600, letterSpacing: "-0.03em", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{short(p.tokens)}</div>
          {p.sessions > 0 && <div style={{ fontSize: 11, color: ink.muted, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmt(p.sessions)} {plural(p.sessions, SESSIONS)}</div>}
        </div>
      </div>
    ));

    if (s.size === "small") {
      body = (
        <div style={flex({ flexDirection: "column", height: "100%" })}>
          <div style={flex({ gap: 4, alignItems: "center" })}>
            {providers.map((p) => <Mark key={p.id} id={p.id} size={14} color={ink.fg} />)}
          </div>
          <div style={{ marginTop: "auto" }}>{heroBlock}</div>
          <div style={{ fontSize: 12, fontWeight: 500, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{sessions}</div>
        </div>
      );
    } else if (s.size === "medium") {
      body = (
        <div style={flex({ height: "100%", gap: 14 })}>
          <div style={flex({ flexDirection: "column", justifyContent: "space-between", flex: 1, minWidth: 0 })}>
            <div style={{ fontSize: 12, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{sessions}</div>
            {heroBlock}
          </div>
          <div style={flex({ flexDirection: "column", justifyContent: "flex-end", gap: 6, width: inner * 0.46 })}>{providerRows(true)}</div>
        </div>
      );
    } else {
      const from = stats.buckets[0].slice(0, 10), to = stats.buckets.at(-1)!.slice(0, 10);
      body = (
        <div style={flex({ flexDirection: "column", height: "100%" })}>
          <div style={flex({ justifyContent: "space-between", fontSize: 12, whiteSpace: "nowrap" })}>
            <div style={{ fontWeight: 600 }}>{stats.handle || "Agent Stats"}</div>
            <div style={{ color: ink.muted }}>{from === to ? fmtDay(to) : `${fmtDay(from)} — ${fmtDay(to)}`}</div>
          </div>
          <div style={{ marginTop: 18 }}>{heroBlock}</div>
          <div style={{ fontSize: 12, fontWeight: 500, marginTop: 10, fontVariantNumeric: "tabular-nums" }}>{sessions}</div>
          {stats.buckets.length >= 2 && stats.tokens > 0 && (
            <div style={{ marginTop: "auto" }}><Bars stats={stats} width={inner} height={64} fg={ink.fg} muted={ink.muted} /></div>
          )}
          <div style={flex({ gap: 8, marginTop: 12 })}>{providerRows(false)}</div>
        </div>
      );
    }
  }

  return (
    <div style={{ position: "relative", width, height, overflow: "hidden", borderRadius: 22, fontFamily: FONT, color: ink.fg, boxShadow: `inset 0 0 0 1px ${ink.line}` }}>
      <div aria-hidden style={{ position: "absolute", inset: 0 }}>{SHADER_THEMES[s.theme].draw(width, height, s.animated)}</div>
      <div style={{ position: "absolute", inset: 0, padding: pad, opacity: s.loading && stats ? 0.7 : 1, transition: "opacity 300ms cubic-bezier(0.16, 1, 0.3, 1)" }}>{body}</div>
    </div>
  );
}

function App() {
  const [s, set] = useState<State>({ ...initial, ...pending });
  useEffect(() => {
    push = (p) => set((prev) => ({ ...prev, ...p }));
    set((prev) => ({ ...prev, ...pending }));
    return () => { push = () => {}; };
  }, []);
  return <Face s={s} />;
}

// The background drifts slowly, so 30 frames a second look the same as 60 at half the cost on an always-on desktop.
const FRAME_MS = 1000 / 30;
const nextFrame = window.requestAnimationFrame.bind(window);
let lastFrame = 0;
window.requestAnimationFrame = (cb) => nextFrame(function tick(t) {
  if (t - lastFrame < FRAME_MS - 2) return void nextFrame(tick);
  lastFrame = t;
  cb(t);
});

const style = document.createElement("style");
style.textContent = GEIST_CSS;
document.head.appendChild(style);
createRoot(document.getElementById("root")!).render(<App />);
