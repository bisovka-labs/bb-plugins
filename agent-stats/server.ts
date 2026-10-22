// bb-plugin-agent-stats — sessions and tokens for a shareable story card.
//
// Two sources. "bb": BB's own threads (each is a session) and the tokens of
// their provider sessions, read from the harness logs. "all": every Claude Code
// and Codex session on this Mac, BB's included — tokens and list-price cost
// from CodexBar's local log scan (`codexbar cost`), sessions counted from the
// harnesses' session files.
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const run = promisify(execFile);

const providerSchema = z.object({
  id: z.enum(["claude", "codex", "other"]),
  tokens: z.number(),
  sessions: z.number(),
  costUSD: z.number().nullable(),
  /** Tokens per bucket, aligned with Stats.buckets. */
  series: z.array(z.number()),
});
const statsSchema = z.object({
  source: z.enum(["bb", "all"]),
  /** Days (YYYY-MM-DD) or, for the last 24 hours, hours (YYYY-MM-DDTHH), oldest first, all local time. */
  unit: z.enum(["day", "hour"]),
  buckets: z.array(z.string()),
  tokens: z.number(),
  sessions: z.number(),
  costUSD: z.number().nullable(),
  providers: z.array(providerSchema),
  generatedAt: z.string(),
  /** The card's header line, from the plugin settings. */
  handle: z.string(),
});
export type Stats = z.infer<typeof statsSchema>;
export type ProviderStats = z.infer<typeof providerSchema>;
type ProviderId = ProviderStats["id"];
type Period = z.infer<typeof querySchema>["period"];

const querySchema = z.object({
  source: z.enum(["bb", "all"]),
  /** Calendar days ending today, or the last 24 hours. */
  period: z.union([z.literal("24h"), z.number().int().min(1).max(365)]),
  refresh: z.boolean().optional(),
});

export const rpcContract = defineRpcContract({
  stats_get: { input: querySchema, output: statsSchema },
});

const PROVIDERS: ProviderId[] = ["claude", "codex", "other"];

/** Local calendar day (the machine's time zone), YYYY-MM-DD. */
function day(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const hourKey = (ms: number) => `${day(ms)}T${String(new Date(ms).getHours()).padStart(2, "0")}`;

/** The period's buckets, where it starts, and which bucket a moment falls in (null outside the period). */
function buckets(period: Period) {
  const start = new Date();
  const keys: string[] = [];
  if (period === "24h") {
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() - 23);
    const startMs = start.getTime();
    for (let i = 0; i < 24; i++) keys.push(hourKey(startMs + i * 3_600_000));
    const at = (ms: number) => {
      const i = Math.floor((ms - startMs) / 3_600_000);
      return i >= 0 && i < 24 ? i : null;
    };
    return { unit: "hour" as const, keys, startMs, at };
  }
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (period - 1));
  for (let i = 0; i < period; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    keys.push(day(d.getTime()));
  }
  const index = new Map(keys.map((k, i) => [k, i]));
  const startMs = start.getTime();
  return { unit: "day" as const, keys, startMs, at: (ms: number) => (ms >= startMs ? index.get(day(ms)) ?? null : null) };
}
type Buckets = ReturnType<typeof buckets>;

function emptyProviders(n: number) {
  return Object.fromEntries(
    PROVIDERS.map((id) => [id, { id, tokens: 0, sessions: 0, costUSD: null as number | null, series: Array(n).fill(0) as number[] }]),
  ) as Record<ProviderId, ProviderStats>;
}

function finish(source: Stats["source"], b: Buckets, byId: Record<ProviderId, ProviderStats>): Stats {
  for (const p of Object.values(byId)) p.tokens = p.series.reduce((a, v) => a + v, 0);
  const providers = PROVIDERS.map((id) => byId[id]).filter((p) => p.tokens > 0 || p.sessions > 0);
  const costs = providers.map((p) => p.costUSD).filter((c): c is number => c != null);
  return {
    source,
    unit: b.unit,
    buckets: b.keys,
    tokens: providers.reduce((a, p) => a + p.tokens, 0),
    sessions: providers.reduce((a, p) => a + p.sessions, 0),
    costUSD: costs.length ? costs.reduce((a, c) => a + c, 0) : null,
    providers,
    generatedAt: new Date().toISOString(),
    handle: "",
  };
}

const bbProvider = (providerId: string): ProviderId =>
  providerId === "claude-code" ? "claude" : providerId === "codex" ? "codex" : "other";

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

// ---- Harness logs ----
//
// One usage record per model call: a dedupe key (a forked session copies its
// parent's history, so the same call can sit in two files), its moment, and
// the tokens counted the way CodexBar counts them (cache reads included).
type Usage = { key: string; ts: number; tokens: number };
const fileCache = new Map<string, { size: number; mtimeMs: number; usage: Usage[] }>();

async function readUsage(path: string, kind: "claude" | "codex"): Promise<Usage[]> {
  const s = await stat(path).catch(() => null);
  if (!s) return [];
  const hit = fileCache.get(path);
  if (hit && hit.size === s.size && hit.mtimeMs === s.mtimeMs) return hit.usage;
  const usage: Usage[] = [];
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let prev: number | null = null;
  for await (const line of lines) {
    if (kind === "claude") {
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
      let o: { type?: string; timestamp?: string; requestId?: string; message?: { id?: string; usage?: Record<string, number | null> } };
      try { o = JSON.parse(line); } catch { continue; }
      const u = o.message?.usage;
      if (o.type !== "assistant" || !u || !o.timestamp) continue;
      const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      usage.push({ key: `${o.message?.id}:${o.requestId}`, ts: Date.parse(o.timestamp), tokens });
    } else {
      if (!line.includes('"token_count"')) continue;
      let o: { timestamp?: string; payload?: { type?: string; info?: { total_token_usage?: { total_tokens: number }; last_token_usage?: { total_tokens: number } } | null } };
      try { o = JSON.parse(line); } catch { continue; }
      const info = o.payload?.info;
      if (o.payload?.type !== "token_count" || !info?.total_token_usage || !o.timestamp) continue;
      const total = info.total_token_usage.total_tokens, last = info.last_token_usage?.total_tokens ?? 0;
      // A running total: the first report (a resumed or forked session starts high) and a reset count their own call.
      const tokens = prev == null || total < prev ? last : total - prev;
      prev = total;
      if (tokens > 0) usage.push({ key: `${o.timestamp}:${total}`, ts: Date.parse(o.timestamp), tokens });
    }
  }
  // Claude writes one line per content block of a message, each with the same usage: keep the last.
  const deduped = kind === "claude" ? [...new Map(usage.map((u) => [u.key, u])).values()] : usage;
  fileCache.set(path, { size: s.size, mtimeMs: s.mtimeMs, usage: deduped });
  return deduped;
}

/** Session id → its log files: Claude's transcript and subagent transcripts, Codex's rollout. */
async function indexLogs() {
  const home = homedir();
  const files = new Map<string, { kind: "claude" | "codex"; paths: string[] }>();
  const projects = join(home, ".claude", "projects");
  const dirs = await readdir(projects, { withFileTypes: true }).catch(() => []);
  await pool(dirs.filter((d) => d.isDirectory()), 16, async (d) => {
    const dir = join(projects, d.name);
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isFile() && e.name.endsWith(".jsonl")) {
        const id = e.name.slice(0, -6);
        const subagents = await readdir(join(dir, id, "subagents")).catch(() => [] as string[]);
        files.set(id, { kind: "claude", paths: [join(dir, e.name), ...subagents.filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, id, "subagents", f))] });
      }
    }
  });
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) await walk(join(dir, e.name));
      else if (e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) files.set(e.name.slice(-42, -6), { kind: "codex", paths: [join(dir, e.name)] });
    }
  };
  await walk(join(home, ".codex", "sessions"));
  await walk(join(home, ".codex", "archived_sessions"));
  return files;
}

async function bbStats(bb: BbPluginApi, period: Period): Promise<Stats> {
  const b = buckets(period);
  const { startMs } = b;
  const byId = emptyProviders(b.keys.length);

  type Thread = Awaited<ReturnType<typeof bb.sdk.threads.list>>[number];
  const threads: Thread[] = [];
  for (const archived of [false, true]) {
    for (let offset = 0; ; offset += 500) {
      const page = await bb.sdk.threads.list({ archived, includeHidden: true, limit: 500, offset });
      threads.push(...page);
      if (page.length < 500) break;
    }
  }
  for (const t of threads) if (t.createdAt >= startMs) byId[bbProvider(t.providerId)].sessions++;

  // A thread's provider sessions come from its identity and usage events. Each
  // session's tokens come from the harness log when it is still on disk; BB's
  // own usage events (kept since 2026-10-10, and not for every turn) stand in
  // for a session whose log is gone, so archived threads still count.
  const logs = await indexLogs();
  const seenSessions = new Set<string>();
  const seenCalls = new Set<string>();
  const add = (p: ProviderStats, ms: number, tokens: number) => {
    const i = b.at(ms);
    if (i != null) p.series[i] += tokens;
  };
  await pool(threads.filter((t) => t.updatedAt >= startMs), 6, async (t) => {
    const provider = byId[bbProvider(t.providerId)];
    type UsageRow = { providerThreadId: string; createdAt: number; total: number; last: number };
    const sessions = new Set<string>();
    const fromEvents: UsageRow[] = [];
    let afterSeq: string | undefined;
    for (;;) {
      const rows = await bb.sdk.threads.events.list({
        threadId: t.id, types: ["thread/identity", "thread/tokenUsage/updated"], order: "asc", limit: "100", ...(afterSeq ? { afterSeq } : {}),
      });
      for (const row of rows) {
        if (row.type === "thread/identity") sessions.add(row.data.providerThreadId);
        else if (row.type === "thread/tokenUsage/updated") {
          sessions.add(row.data.providerThreadId);
          const u = row.data.tokenUsage;
          fromEvents.push({ providerThreadId: row.data.providerThreadId, createdAt: row.createdAt, total: u.total.totalTokens, last: u.last.totalTokens });
        }
      }
      if (rows.length < 100) break;
      afterSeq = String(rows[rows.length - 1].seq);
    }
    for (const session of sessions) {
      if (seenSessions.has(session)) continue;
      seenSessions.add(session);
      const log = logs.get(session);
      if (log) {
        for (const path of log.paths) {
          for (const u of await readUsage(path, log.kind)) {
            if (seenCalls.has(u.key)) continue;
            seenCalls.add(u.key);
            add(provider, u.ts, u.tokens);
          }
        }
        continue;
      }
      let before: number | undefined;
      for (const e of fromEvents.filter((r) => r.providerThreadId === session)) {
        const tokens = before == null || e.total < before ? e.last : Math.min(e.last, e.total - before);
        before = e.total;
        add(provider, e.createdAt, tokens);
      }
    }
  });

  return finish("bb", b, byId);
}

// CodexBar's `cost` JSON: one entry per provider with per-day totals.
const codexbarSchema = z.array(z.object({
  provider: z.string(),
  daily: z.array(z.object({ date: z.string(), totalTokens: z.number().optional(), totalCost: z.number().optional() })),
}));

async function codexbarCost(binary: string, days: number) {
  const { stdout } = await run(binary, ["cost", "--provider", "both", "--format", "json", "--days", String(days)], {
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin` },
  });
  return codexbarSchema.parse(JSON.parse(stdout));
}

/** Session files started inside the period, by the timestamp in their name or their birth time. */
async function countSessions(startMs: number) {
  const home = homedir();
  const sessions = { claude: 0, codex: 0 };

  // Claude Code: one JSONL per session directly in each project folder (subagents live deeper).
  const projects = join(home, ".claude", "projects");
  const dirs = await readdir(projects, { withFileTypes: true }).catch(() => []);
  await pool(dirs.filter((d) => d.isDirectory()), 16, async (d) => {
    const files = await readdir(join(projects, d.name)).catch(() => [] as string[]);
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const s = await stat(join(projects, d.name, f)).catch(() => null);
      if (s && (s.birthtimeMs || s.mtimeMs) >= startMs) sessions.claude++;
    }
  });

  // Codex: rollout-YYYY-MM-DDThh-mm-ss-<id>.jsonl (local time) under sessions/YYYY/MM/DD and archived_sessions.
  const rollout = /^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/;
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isDirectory()) { await walk(join(dir, e.name)); continue; }
      const m = rollout.exec(e.name);
      if (m && new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() >= startMs) sessions.codex++;
    }
  };
  await walk(join(home, ".codex", "sessions"));
  await walk(join(home, ".codex", "archived_sessions"));
  return sessions;
}

async function allStats(binary: string, period: Period): Promise<Stats> {
  const b = buckets(period);
  const byId = emptyProviders(b.keys.length);
  const [, sessions] = await Promise.all([
    period === "24h" ? hourlyFromLogs(b, byId) : dailyFromCodexbar(binary, period, b, byId),
    countSessions(b.startMs),
  ]);
  byId.claude.sessions = sessions.claude;
  byId.codex.sessions = sessions.codex;
  return finish("all", b, byId);
}

async function dailyFromCodexbar(binary: string, days: number, b: Buckets, byId: Record<ProviderId, ProviderStats>) {
  const index = new Map(b.keys.map((k, i) => [k, i]));
  for (const entry of await codexbarCost(binary, days)) {
    const p = byId[entry.provider === "claude" ? "claude" : entry.provider === "codex" ? "codex" : "other"];
    for (const d of entry.daily) {
      const i = index.get(d.date);
      if (i == null) continue;
      p.series[i] += d.totalTokens ?? 0;
      if (d.totalCost != null) p.costUSD = (p.costUSD ?? 0) + d.totalCost;
    }
  }
}

// CodexBar reports whole days, so the last 24 hours come from the logs written in them (no price).
async function hourlyFromLogs(b: Buckets, byId: Record<ProviderId, ProviderStats>) {
  const seen = new Set<string>();
  const logs = [...(await indexLogs()).values()];
  await pool(logs, 8, async (log) => {
    for (const path of log.paths) {
      const s = await stat(path).catch(() => null);
      if (!s || s.mtimeMs < b.startMs) continue;
      for (const u of await readUsage(path, log.kind)) {
        const i = b.at(u.ts);
        if (i == null || seen.has(u.key)) continue;
        seen.add(u.key);
        byId[log.kind].series[i] += u.tokens;
      }
    }
  });
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    handle: {
      type: "string",
      label: "Подпись на карточке",
      description: "Ник или имя в шапке карточки, например @yourname.",
      default: "",
    },
    codexbarPath: {
      type: "string",
      label: "CodexBar CLI",
      description: "Путь к codexbar для режима «Все сессии» (из CodexBar.app → Install CLI).",
      default: "codexbar",
    },
  });

  // CodexBar's scan takes up to half a minute; a card redrawn with another
  // format or theme reuses the last numbers for a few minutes.
  const cache = new Map<string, { at: number; stats: Promise<Stats> }>();
  async function getStats(source: Stats["source"], period: Period, refresh = false): Promise<Stats> {
    const key = `${source}:${period}`;
    const hit = cache.get(key);
    if (!refresh && hit && Date.now() - hit.at < 5 * 60_000) return hit.stats;
    const { codexbarPath } = await settings.get();
    const stats = source === "bb" ? bbStats(bb, period) : allStats(codexbarPath || "codexbar", period);
    cache.set(key, { at: Date.now(), stats });
    stats.catch(() => cache.delete(key));
    return stats;
  }

  bb.rpc.register(rpcContract, {
    stats_get: async ({ source, period, refresh }) => ({
      ...(await getStats(source, period, refresh)),
      handle: (await settings.get()).handle.trim(),
    }),
  });

  const usage = [
    "Usage:",
    "  bb agent-stats show [--source bb|all] [--days N | --hours 24] [--json]",
    "",
    "  --source bb   BB threads and the tokens BB recorded on them (default)",
    "  --source all  every Claude Code and Codex session on this Mac, via CodexBar",
    "  --days N      calendar days ending today, 1-365 (default 30)",
    "  --hours 24    the last 24 hours, hour by hour (no price for --source all)",
  ].join("\n");
  const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
  const NAMES: Record<ProviderId, string> = { claude: "Claude Code", codex: "Codex", other: "Другие" };

  bb.cli.register({
    name: "agent-stats",
    summary: "Sessions and tokens for the period, as on the Agent Stats card",
    commands: [{ name: "show", summary: "Print the period's sessions, tokens and cost", usage: "bb agent-stats show [--source bb|all] [--days N | --hours 24] [--json]" }],
    async run(argv) {
      if (argv.includes("--help") || argv.includes("help")) return { exitCode: 0, stdout: usage };
      const opt = (name: string) => {
        const i = argv.indexOf(name);
        return i >= 0 ? argv[i + 1] : undefined;
      };
      const hours = opt("--hours");
      if (hours !== undefined && hours !== "24") return { exitCode: 1, stderr: usage };
      const parsed = querySchema.safeParse({ source: opt("--source") ?? "bb", period: hours ? "24h" : Number(opt("--days") ?? 30) });
      if (!parsed.success) return { exitCode: 1, stderr: usage };
      const s = await getStats(parsed.data.source, parsed.data.period);
      if (argv.includes("--json")) return { exitCode: 0, stdout: JSON.stringify(s) };
      const lines = [
        `${s.buckets[0]} — ${s.buckets.at(-1)} (${s.source === "bb" ? "BB" : "все сессии"})`,
        `Токенов: ${compact.format(s.tokens)}  Сессий: ${s.sessions}${s.costUSD != null ? `  ≈ $${Math.round(s.costUSD)} по прайсу API` : ""}`,
        ...s.providers.map((p) => `  ${NAMES[p.id]}: ${compact.format(p.tokens)} токенов, сессий: ${p.sessions}${p.costUSD != null ? `, ≈ $${Math.round(p.costUSD)}` : ""}`),
      ];
      return { exitCode: 0, stdout: lines.join("\n") };
    },
  });
}
