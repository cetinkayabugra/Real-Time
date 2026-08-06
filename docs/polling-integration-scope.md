# Scope: real polling/probing integration

Replaces the mocked `PROVIDERS` object in `build/template.html` with real data. Split into two phases so the free, no-keys-needed part ships first.

Decisions locked in: poller runs as a **GitHub Actions cron** (no new infra), Phase 1 is **status pages only**, cadence is **every 15 minutes**.

## Phase 1 — status-page polling (free, no API keys)

### What it can and can't give us

Status pages are categorical (operational / degraded / outage) plus an incident feed — they are not a metrics API. Mapped onto the current dashboard's four stats:

| Stat tile | Phase 1 source | Honest? |
|---|---|---|
| Status pill | Provider's status page | Yes, real |
| Uptime % | `operational` samples ÷ total samples in window, computed from our own polling history (not the provider's own SLA number) | Yes, but labeled as "observed," not vendor-reported |
| Incidents | Provider's incident feed | Yes, real |
| TTFT p50/p95 | **Not available from status pages.** Stays mocked/blank until Phase 2 | No — needs a caveat in the UI |
| Error rate | **Not available from status pages.** Same as above | No — needs a caveat in the UI |

So Phase 1 makes the status pill, uptime, and incident log real; latency and error-rate tiles need to be visibly marked "pending active probing" rather than quietly staying fake numbers.

### Open risk: not every provider's status page is uniform

Most likely candidates run on Atlassian Statuspage.io, which exposes a standard `GET /api/v2/summary.json`. That needs confirming per provider before this is buildable as one generic poller — it's the first task, not an assumption:

- OpenAI — status.openai.com
- Anthropic — status.anthropic.com
- Mistral — status.mistral.ai
- Cohere — status.cohere.com
- Google (Gemini/Vertex) — Google Cloud's status dashboard has its own JSON feed, different shape from Statuspage.io
- Amazon Bedrock — AWS Health Dashboard is per-service/per-region, no single clean feed; likely the messiest of the six and may need RSS parsing or a narrower scope (e.g. just the Bedrock service line)

Expect one shared parser for the Statuspage.io-based providers and two bespoke ones (Google, AWS).

### Architecture

```
.github/workflows/poll.yml   → cron '*/15 * * * *' + workflow_dispatch, concurrency-guarded
poll/providers.js            → per-provider endpoint + parser config
poll/run.js                  → fetch all → normalize → append to history → write data/latest.json
data/latest.json             → committed, fetched by the dashboard at runtime
data/history/<provider>.jsonl→ rolling samples, trimmed to ~30 days, used to compute uptime %
```

Workflow authenticates as `github-actions[bot]`, commits only `data/`, and force-pushes to a dedicated `data` branch rather than `main` — keeps 96 commits/day out of the real commit history. `index.html` fetches the JSON via `raw.githubusercontent.com/.../data/latest.json` (5-ish min CDN cache, fine at a 15-min poll cadence).

### Dashboard changes

- `PROVIDERS` becomes a `fetch()` on load instead of a literal, with the current mock object kept as an offline/first-run fallback (with the existing "Sample data" badge) rather than deleted.
- Add "last polled" timestamp sourced from the real payload.
- Latency and error-rate tiles get a visible "awaiting live probing" state instead of silently showing mock numbers once the rest of the card is real — otherwise the page becomes half-honest, which is worse than the current all-mock version.
- Footnote changes from "nothing here is fetched live yet" to something accurate about the status-page source and Phase 2 gap.

### Estimate

- Confirm real endpoint + shape for all six providers: 0.5–1 day (this is research, not coding — Bedrock in particular may cut scope)
- Poll script + Actions workflow + history/rollup logic: 0.5 day
- Dashboard wiring (fetch, fallback, relabeled tiles): 0.5 day
- Shakeout (first scheduled runs, race conditions between overlapping runs, a provider's feed being malformed): 0.5 day

**~2 days.**

## Phase 2 — active probing (deferred)

Adds real TTFT p50/p95 and error rate by making a minimal live completion call per provider on a schedule.

- One API key per provider as a GitHub Actions secret — you'll need to obtain/fund these; out of scope for me to acquire.
- Cheapest/smallest model per provider, capped output tokens, to keep probe cost down.
- Separate, likely coarser cadence than the 15-min status poll (e.g. hourly) to bound API spend — probing 6 providers every 15 min is 4x the request volume of hourly for not much signal gain on a dashboard, not a latency SLA tool.
- Same `data/latest.json` gets a `probe` block merged in alongside the `statuspage` block; dashboard drops the "awaiting live probing" state once both are present for a provider.
- Not estimated in detail here since it depends on which providers you actually want to spend probe budget on — worth a short follow-up scoping pass once Phase 1 is live and you've seen what the status-page-only version is missing.

## Sequencing

Ship Phase 1 end-to-end (real status/uptime/incidents, honestly-labeled placeholder latency/error tiles) before touching Phase 2 — it's free, derisks the Actions-cron-writing-to-git mechanism, and gives a real basis for deciding which providers are worth spending probe budget on.
