// The share card: Social Board's poster (share-poster.tsx) carried over to agent sessions and tokens. Inline styles at
// the picture's own pixel size, so the preview and the exported PNG are the same element. Provider inks are Social
// Board's validated set: Claude takes the amber, Codex the blue, anything else the magenta.
import type { CSSProperties } from "react";
import type { ProviderStats, Stats } from "./server";
import { MARKS } from "./lib/marks";
import { SHADER_THEMES, ShaderBackground, isShaderTheme, type ShaderInk, type ShaderTheme } from "./shaders";

export type Format = "story" | "portrait" | "square";
export type Theme = "light" | "dark" | ShaderTheme;
type ProviderId = ProviderStats["id"];
type Palette = Record<"bg" | "fg" | "muted" | "line" | "faint" | ProviderId, string> & { fill: number };

export const FONT = '"Geist Stats", Geist, ui-sans-serif, system-ui, sans-serif';

const PALETTES: Record<"light" | "dark", Palette> = {
  dark: {
    bg: "#0a0a0a", fg: "#fafafa", muted: "#a1a1a1", line: "rgba(255,255,255,0.1)", faint: "rgba(255,255,255,0.07)",
    claude: "#d07a12", codex: "#3987e5", other: "#e0559f", fill: 0.62,
  },
  light: {
    bg: "#ffffff", fg: "#0a0a0a", muted: "#737373", line: "rgba(0,0,0,0.1)", faint: "rgba(0,0,0,0.08)",
    claude: "#d97706", codex: "#2a8bd8", other: "#d6409f", fill: 0.42,
  },
};

export const SIZES: Record<Format, Record<string, number>> = {
  story: {
    width: 1080, height: 1920, pad: 88, top: 200, bottom: 200, brand: 40, hero: 300, label: 50, chip: 36, chartH: 440,
    cellName: 32, cellValue: 76, cellSub: 32, axis: 30, heroTop: 110, labelGap: 28, chipGap: 52, axisGap: 18, cellsTop: 64, cellsPad: 44,
  },
  portrait: {
    width: 1080, height: 1350, pad: 80, top: 80, bottom: 72, brand: 34, hero: 250, label: 42, chip: 30, chartH: 330,
    cellName: 28, cellValue: 62, cellSub: 27, axis: 26, heroTop: 64, labelGap: 22, chipGap: 38, axisGap: 14, cellsTop: 44, cellsPad: 32,
  },
  square: {
    width: 1080, height: 1080, pad: 72, top: 72, bottom: 64, brand: 32, hero: 210, label: 38, chip: 28, chartH: 250,
    cellName: 26, cellValue: 54, cellSub: 25, axis: 24, heroTop: 44, labelGap: 18, chipGap: 30, axisGap: 12, cellsTop: 34, cellsPad: 26,
  },
};

export const NAMES: Record<ProviderId, string> = { claude: "Claude Code", codex: "Codex", other: "Другие" };

// ---- Russian numbers and words ----

const nf = new Intl.NumberFormat("ru-RU");
export const fmt = (n: number) => nf.format(Math.round(n));
export function plural(n: number, forms: readonly [string, string, string]) {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? forms[2] : b > 1 && b < 5 ? forms[1] : b === 1 ? forms[0] : forms[2];
}
const TOKENS = ["токен", "токена", "токенов"] as const;
const SESSIONS = ["сессия", "сессии", "сессий"] as const;
const DAYS = ["день", "дня", "дней"] as const;
const HOURS = ["час", "часа", "часов"] as const;
const SCALES = [
  { at: 1e12, short: "трлн", forms: ["триллион", "триллиона", "триллионов"] },
  { at: 1e9, short: "млрд", forms: ["миллиард", "миллиарда", "миллиардов"] },
  { at: 1e6, short: "млн", forms: ["миллион", "миллиона", "миллионов"] },
] as const;

/**
 * The number on its scale's unit. The big number keeps a decimal below a hundred (29,4 · 7,4 · 254); the figures
 * under it keep one below ten only (7 · 4 · 25 · 353), so the row reads as round numbers.
 */
export function scaled(n: number, hero = false) {
  const s = SCALES.find((x) => n >= x.at);
  if (!s) return null;
  const v = n / s.at;
  const digits = v >= (hero ? 100 : 10) ? 0 : 1;
  const text = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(v);
  const whole = Number.isInteger(Number(v.toFixed(digits)));
  return { s, text, word: whole ? plural(Number(v.toFixed(0)), s.forms) : s.forms[1] };
}
/** A cell's value: every digit below a million, "25 млрд" above. */
export const short = (n: number) => {
  const x = scaled(n);
  return x ? `${x.text} ${x.s.short}` : fmt(n);
};
const sessions = (n: number) => `${fmt(n)} ${plural(n, SESSIONS)}`;
const usd = (n: number) => `$${fmt(n)}`;

const MONTHS = ["янв.", "февр.", "марта", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."];
export const fmtDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
/** An hour bucket (YYYY-MM-DDTHH) as "14:00". */
const fmtHour = (h: string) => `${h.slice(11, 13)}:00`;

// ---- Marks ----

function Mark({ id, size, color }: { id: ProviderId; size: number; color: string }) {
  if (id === "other") return <div style={{ width: size * 0.6, height: size * 0.6, margin: size * 0.2, borderRadius: size, background: color, flexShrink: 0 }} />;
  return <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path d={MARKS[id]} fill={color} /></svg>;
}

// ---- Chart: Social Board's stacked running totals ----

function curve(pts: [number, number][]) {
  const n = pts.length;
  if (n < 15) return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const dx = pts.slice(1).map(([x], i) => x - pts[i][0]);
  const s = pts.slice(1).map(([, y], i) => (y - pts[i][1]) / dx[i]);
  const m = pts.map((_, i) => (i === 0 ? s[0] : i === n - 1 ? s[n - 2]
    : s[i - 1] * s[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / s[i - 1] + (dx[i] + 2 * dx[i - 1]) / s[i])));
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = dx[i] / 3;
    d += `C${(x0 + h).toFixed(1)},${(y0 + m[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - m[i + 1] * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

function Chart({ providers, C, width, height, stroke, uid }: { providers: ProviderStats[]; C: Palette; width: number; height: number; stroke: number; uid: string }) {
  const running = providers.map((p) => p.series.reduce<number[]>((acc, v, i) => (acc.push((i ? acc[i - 1] : 0) + v), acc), []));
  const n = running[0]?.length ?? 0;
  const layers = providers.map((p, k) => ({
    id: p.id,
    top: running[0].map((_, i) => running.slice(0, k + 1).reduce((a, r) => a + r[i], 0)),
    low: running[0].map((_, i) => running.slice(0, k).reduce((a, r) => a + r[i], 0)),
  }));
  const hi = Math.max(1, ...layers.flatMap((l) => l.top));
  const right = width - 40, headroom = stroke * 4;
  const x = (i: number) => (n === 1 ? right : (i / (n - 1)) * right);
  const y = (v: number) => headroom + (1 - v / hi) * (height - headroom);
  const last = layers.at(-1);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <defs>
        {layers.map((l) => (
          <linearGradient key={l.id} id={`${uid}-${l.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C[l.id]} stopOpacity={C.fill} />
            <stop offset="1" stopColor={C[l.id]} stopOpacity={0.04} />
          </linearGradient>
        ))}
      </defs>
      {[0.33, 0.66].map((f) => <line key={f} x1="0" x2={width} y1={headroom + f * (height - headroom)} y2={headroom + f * (height - headroom)} stroke={C.faint} strokeWidth="2" strokeDasharray="4 12" />)}
      <line x1="0" x2={width} y1={y(0)} y2={y(0)} stroke={C.line} strokeWidth="2" />
      {layers.map((l) => {
        const top = l.top.map((v, i) => [x(i), y(v)] as [number, number]);
        const low = l.low.map((v, i) => [x(i), y(v)] as [number, number]).reverse();
        return (
          <g key={l.id}>
            <path d={`${curve(top)}L${curve(low).slice(1)}Z`} fill={`url(#${uid}-${l.id})`} />
            <path d={curve(top)} fill="none" stroke={C[l.id]} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })}
      {last && <circle cx={x(n - 1)} cy={y(last.top[n - 1])} r={stroke * 2.4} fill={C.bg} stroke={C[last.id]} strokeWidth={stroke} />}
    </svg>
  );
}

// ---- The card ----

type Cell = { key: string; mark?: ProviderId; name: string; value: string; sub?: string; note?: string };
const flex = (extra: CSSProperties = {}): CSSProperties => ({ display: "flex", ...extra });

export function StatsCard({ stats, format, theme, uid = "card", animated = false, recording = false }: { stats: Stats; format: Format; theme: Theme; uid?: string; animated?: boolean; recording?: boolean }) {
  const C = PALETTES[isShaderTheme(theme) ? "dark" : theme];
  const z = SIZES[format];
  const inner = z.width - z.pad * 2;
  const { buckets, tokens, providers } = stats;
  const hourly = stats.unit === "hour";
  const from = buckets[0], to = buckets.at(-1)!;
  const n = buckets.length;
  // Dates only, the last 24 hours included: "17 окт. — 18 окт.".
  const fromDay = from.slice(0, 10), toDay = to.slice(0, 10);
  const range = fromDay === toDay ? fmtDay(toDay) : `${fmtDay(fromDay)} — ${fmtDay(toDay)}`;

  // The big number is the token count on its scale ("28,8"); the scale's word opens the line under it.
  const big = scaled(tokens, true);
  const heroText = tokens === 0 ? "0" : big ? big.text : fmt(tokens);
  const hero = Math.min(z.hero, Math.floor(inner / (heroText.length * 0.56)));
  const tokenWords = big ? `${big.word} токенов` : plural(tokens, TOKENS);
  const label = `${tokenWords} за ${n} ${plural(n, hourly ? HOURS : DAYS)}`;

  const totals = buckets.map((_, i) => providers.reduce((a, p) => a + p.series[i], 0));
  const bestAt = totals.indexOf(Math.max(...totals));
  const chips = [
    stats.sessions > 0 ? sessions(stats.sessions) : null,
    stats.costUSD != null && stats.costUSD >= 1 ? `≈ ${usd(stats.costUSD)} по ценам API` : tokens > 0 ? `${short(tokens / n)} ${hourly ? "в час" : "в день"}` : null,
  ].filter((c): c is string => c != null);

  const cells: Cell[] = providers.length >= 2
    ? providers.map((p) => ({
      key: p.id, mark: p.id, name: NAMES[p.id], value: short(p.tokens),
      sub: p.sessions > 0 ? sessions(p.sessions) : undefined,
      note: p.costUSD != null && p.costUSD >= 1 && format !== "square" ? `≈ ${usd(p.costUSD)}` : undefined,
    }))
    : [
      { key: "sessions", name: "Сессий", value: fmt(stats.sessions), note: "за период" },
      { key: "avg", name: "В среднем", value: short(tokens / n), note: hourly ? "токенов в час" : "токенов в день" },
      ...(totals[bestAt] > 0 ? [{
        key: "best", name: hourly ? "Самый плотный час" : "Самый плотный день", value: short(totals[bestAt]),
        note: hourly ? fmtHour(buckets[bestAt]) : fmtDay(buckets[bestAt]),
      }] : []),
    ];
  const cellW = (inner - (cells.length - 1) * z.pad * 0.8) / cells.length;
  const cellValue = Math.min(z.cellValue, ...cells.map((c) => Math.floor(cellW / (c.value.length * 0.58))));

  const inks = providers.length ? providers.map((p) => p.id) : (["claude", "codex"] as ProviderId[]);

  if (isShaderTheme(theme)) {
    return <ShaderCard recording={recording} animated={animated} theme={theme} z={z} handle={stats.handle} range={range} heroText={heroText} tokenWords={tokenWords}
      period={label.slice(tokenWords.length + 1)} chips={chips} cells={cells} />;
  }

  return (
    <div style={flex({ width: z.width, height: z.height, flexDirection: "column", background: C.bg, color: C.fg, fontFamily: FONT, boxSizing: "border-box", overflow: "hidden" })}>
      <div style={flex({ alignItems: "center", padding: `${z.top}px ${z.pad}px 0`, fontSize: z.brand })}>
        <div style={flex({ marginRight: z.brand * 0.45 })}>
          {inks.map((id, i) => (
            <div key={id} style={{ width: z.brand * 0.62, height: z.brand * 0.62, borderRadius: z.brand, background: C[id], marginLeft: i ? -z.brand * 0.16 : 0, border: `${Math.round(z.brand / 12)}px solid ${C.bg}` }} />
          ))}
        </div>
        <div style={{ fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>{stats.handle || "Agent Stats"}</div>
        <div style={{ marginLeft: "auto", color: C.muted, whiteSpace: "nowrap" }}>{range}</div>
      </div>

      <div style={flex({ flexDirection: "column", padding: `${z.heroTop}px ${z.pad}px 0` })}>
        <div style={{ fontSize: hero, fontWeight: 600, letterSpacing: "-0.055em", lineHeight: 0.9, marginLeft: -hero * 0.04, whiteSpace: "nowrap" }}>{heroText}</div>
        <div style={{ fontSize: z.label, color: C.muted, marginTop: z.labelGap, letterSpacing: "-0.01em" }}>{label}</div>
        {chips.length > 0 && (
          <div style={flex({ flexWrap: "wrap", gap: z.chip * 0.45, marginTop: z.chipGap })}>
            {chips.map((c) => (
              <div key={c} style={flex({ alignItems: "center", padding: `${z.chip * 0.36}px ${z.chip * 0.7}px`, borderRadius: 999, border: `2px solid ${C.line}`, fontSize: z.chip, fontWeight: 500, color: C.fg, whiteSpace: "nowrap" })}>{c}</div>
            ))}
          </div>
        )}
      </div>

      {n >= 2 && tokens > 0 && (
        <div style={flex({ flexDirection: "column", marginTop: "auto" })}>
          <Chart providers={providers.filter((p) => p.tokens > 0).sort((a, b) => a.tokens - b.tokens)} C={C} width={z.width} height={z.chartH} stroke={format === "square" ? 4 : 5} uid={uid} />
          <div style={flex({ justifyContent: "space-between", padding: `${z.axisGap}px ${z.pad}px 0`, fontSize: z.axis, color: C.muted })}>
            <div>{fmtDay(fromDay)}</div><div>{fmtDay(toDay)}</div>
          </div>
        </div>
      )}

      <div style={flex({ margin: `${z.cellsTop}px ${z.pad}px 0`, borderTop: `2px solid ${C.line}`, paddingTop: z.cellsPad, ...(n < 2 || tokens === 0 ? { marginTop: "auto" } : {}) })}>
        {cells.map((c, i) => (
          <div key={c.key} style={flex({ flexDirection: "column", flex: 1, minWidth: 0, paddingLeft: i ? z.pad * 0.4 : 0, borderLeft: i ? `2px solid ${C.line}` : "none", marginLeft: i ? z.pad * 0.4 : 0 })}>
            <div style={flex({ alignItems: "center", gap: z.cellName * 0.35, fontSize: z.cellName, color: C.muted, whiteSpace: "nowrap" })}>
              {c.mark && <Mark id={c.mark} size={z.cellName * 0.95} color={C[c.mark]} />}{c.name}
            </div>
            <div style={{ fontSize: cellValue, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.1, marginTop: z.cellName * 0.35, whiteSpace: "nowrap" }}>{c.value}</div>
            {c.sub && <div style={{ fontSize: z.cellSub, fontWeight: 500, color: C.fg, marginTop: 6, whiteSpace: "nowrap" }}>{c.sub}</div>}
            {c.note && <div style={{ fontSize: z.cellSub, color: C.muted, marginTop: 4, whiteSpace: "nowrap" }}>{c.note}</div>}
          </div>
        ))}
      </div>

      <div style={{ height: z.bottom }} />
    </div>
  );
}

// ---- Shader themes: one layout for all six ----
//
// The number grows to fill the width, the scale's word under it in weight, then the period, the chips, and the
// figures as translucent panels at the foot. The shader lives under everything; panels keep the type legible on it.
function ShaderCard({ recording, animated, theme, z, handle, range, heroText, tokenWords, period, chips, cells }: {
  recording: boolean; animated: boolean; theme: ShaderTheme; z: Record<string, number>; handle: string; range: string; heroText: string; tokenWords: string;
  period: string; chips: string[]; cells: Cell[];
}) {
  const { ink } = SHADER_THEMES[theme];
  const I: ShaderInk = ink;
  const inner = z.width - z.pad * 2;
  const k = z.hero / 300;
  const hero = Math.min(Math.round(z.hero * 1.75), Math.floor(inner / (heroText.length * 0.55)));
  const gap = Math.round(20 * k);
  const cellW = (inner - gap * (cells.length - 1)) / cells.length - 72 * k;
  const cellValue = Math.min(Math.round(z.cellValue * 1.2), ...cells.map((c) => Math.floor(cellW / (c.value.length * 0.6))));
  const panel: CSSProperties = { background: I.glass, border: `2px solid ${I.line}` };
  return (
    <div style={{ position: "relative", width: z.width, height: z.height, overflow: "hidden", fontFamily: FONT, color: I.fg }}>
      <ShaderBackground theme={theme} width={z.width} height={z.height} animated={animated} recording={recording} />
      <div style={flex({ position: "absolute", inset: 0, flexDirection: "column", padding: `${z.top}px ${z.pad}px ${z.bottom}px` })}>
        <div style={flex({ justifyContent: "space-between", fontSize: z.brand, whiteSpace: "nowrap" })}>
          <div style={{ fontWeight: 600 }}>{handle || "Agent Stats"}</div>
          <div style={{ color: I.muted }}>{range}</div>
        </div>
        <div style={{ fontSize: hero, fontWeight: 600, letterSpacing: "-0.06em", lineHeight: 0.82, marginTop: z.heroTop, marginLeft: -hero * 0.045, whiteSpace: "nowrap" }}>{heroText}</div>
        <div style={{ fontSize: Math.round(z.label * 1.5), fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.1, marginTop: z.labelGap * 1.3 }}>{tokenWords}</div>
        <div style={{ fontSize: z.label, color: I.muted, marginTop: 8 * k }}>{period}</div>
        {chips.length > 0 && (
          <div style={flex({ flexWrap: "wrap", gap: z.chip * 0.45, marginTop: z.chipGap })}>
            {chips.map((c) => (
              <div key={c} style={{ ...panel, padding: `${z.chip * 0.38}px ${z.chip * 0.72}px`, borderRadius: 999, fontSize: z.chip, fontWeight: 500, whiteSpace: "nowrap" }}>{c}</div>
            ))}
          </div>
        )}
        <div style={flex({ gap, marginTop: "auto" })}>
          {cells.map((c) => (
            <div key={c.key} style={flex({ ...panel, flex: 1, minWidth: 0, flexDirection: "column", padding: `${34 * k}px ${36 * k}px`, borderRadius: 36 * k })}>
              <div style={flex({ alignItems: "center", gap: z.cellName * 0.35, fontSize: z.cellName, color: I.muted, whiteSpace: "nowrap" })}>
                {c.mark && <Mark id={c.mark} size={z.cellName * 0.95} color={I.fg} />}{c.name}
              </div>
              <div style={{ fontSize: cellValue, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.05, marginTop: 10 * k, whiteSpace: "nowrap" }}>{c.value}</div>
              {c.sub && <div style={{ fontSize: z.cellSub, fontWeight: 500, marginTop: 8 * k, whiteSpace: "nowrap" }}>{c.sub}</div>}
              {c.note && <div style={{ fontSize: z.cellSub, color: I.muted, marginTop: 4 * k, whiteSpace: "nowrap" }}>{c.note}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
