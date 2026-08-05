# RELAY — Provider Observability

A static design mockup for an internal dashboard: latency (time-to-first-token), uptime, and error rate across LLM API providers (OpenAI, Anthropic, Google, Mistral, Cohere, Amazon Bedrock), with a live-recomputed failover ranking.

**This is sample data for design review, not a live monitoring tool.** The ranking logic (weighted, normalized scoring across latency/uptime/error-rate, with an incident-based override) runs for real in the browser — only the metrics feeding it are mocked.

## View it

Open [`index.html`](index.html) directly in a browser, or serve the folder statically (e.g. GitHub Pages).

## Rebuild

`index.html` is generated from `build/template.html` with the fonts (Big Shoulders Display, IBM Plex Sans, IBM Plex Mono — all SIL OFL) inlined as data URIs:

```bash
node build/build.js
```

Edit `build/template.html`, then rerun the build.

## Next steps toward "live"

- Poll provider status pages (status.openai.com, status.anthropic.com, ...) for uptime/incident signals.
- Add scheduled lightweight completion calls per provider to measure real latency/error rate.
- Persist history somewhere queryable instead of the in-memory mock series here.
