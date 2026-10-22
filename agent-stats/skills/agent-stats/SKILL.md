---
name: agent-stats
description: Report how many agent sessions and tokens the user spent over a period (BB threads, or every Claude Code and Codex session via CodexBar), or point them to the shareable story card.
---

# Agent Stats

`bb agent-stats show [--source bb|all] [--days N | --hours 24] [--json]` prints the period's tokens, sessions and, for `--source all`, the list-price cost.

- `--source bb` (default): BB threads created in the period count as sessions; tokens are the per-turn usage BB records on threads (`thread/tokenUsage/updated`). BB began recording it on 2026-10-10; the output says so when the period starts earlier.
- `--source all`: every Claude Code and Codex session on this Mac, BB's included. Tokens and cost come from `codexbar cost` (local log scan, up to ~30 s on first call, cached 5 min); sessions are counted from `~/.claude/projects/*/*.jsonl` and `~/.codex/{sessions,archived_sessions}` rollouts.
- `--hours 24`: the last 24 hours hour by hour. For `--source all` tokens then come from the logs directly (CodexBar only has whole days), without a price.
- Token counts include cache reads, as CodexBar and the providers report them. Cost is an API list-price estimate, not a bill.

The card itself (stories 1080×1920, post 1080×1350, square 1080×1080, light or dark, PNG download/copy/share) is on the **Agent Stats** page in the BB sidebar. Settings: `bb plugin config agent-stats` (`handle` — the card's header line; `codexbarPath`).
