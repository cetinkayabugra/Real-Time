// Runs every provider's probe, appends a status sample to that provider's
// rolling history, recomputes uptime % for 24h/7d/30d windows from that
// history, and writes the whole thing to data/latest.json for the dashboard
// to fetch. Meant to run under the GitHub Actions cron in
// .github/workflows/poll.yml — see docs/polling-integration-scope.md.
//
// A single provider's probe failing does not fail the run: it's recorded
// under `errors` and that provider's card should show its last-known state
// as stale rather than the whole dashboard going blank.
'use strict';

const fs = require('fs');
const path = require('path');
const { PROVIDERS } = require('./providers');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const INCIDENTS_FILE = path.join(DATA_DIR, 'incidents.jsonl');
const LATEST_FILE = path.join(DATA_DIR, 'latest.json');

const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const WINDOWS_MS = { '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 };

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

function uptimeForWindow(samples, now, windowMs) {
  const cutoff = now - windowMs;
  const inWindow = samples.filter((s) => new Date(s.t).getTime() >= cutoff);
  if (inWindow.length === 0) return null;
  const good = inWindow.filter((s) => s.status === 'good').length;
  return { pct: Math.round((good / inWindow.length) * 10000) / 100, sampleCount: inWindow.length };
}

async function main() {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const providersOut = {};
  const errors = {};
  let incidentLog = readJsonl(INCIDENTS_FILE);

  for (const provider of PROVIDERS) {
    const historyFile = path.join(HISTORY_DIR, `${provider.id}.jsonl`);
    let history = readJsonl(historyFile);

    let result;
    try {
      result = await provider.probe();
    } catch (err) {
      errors[provider.id] = String(err && err.message ? err.message : err);
      console.error(`[poll] ${provider.id} failed: ${errors[provider.id]}`);
    }

    if (result) {
      history.push({ t: nowIso, status: result.status });
      history = history.filter((s) => now - new Date(s.t).getTime() <= RETENTION_MS);
      writeJsonl(historyFile, history);

      for (const inc of result.incidents || []) {
        const key = `${provider.id}|${inc.title}|${inc.startedAt}`;
        if (!incidentLog.some((e) => e._key === key)) {
          incidentLog.push({ _key: key, providerId: provider.id, providerName: provider.name, ...inc, seenAt: nowIso });
        } else {
          const existing = incidentLog.find((e) => e._key === key);
          if (inc.resolvedAt) existing.resolvedAt = inc.resolvedAt;
        }
      }
    }

    const uptime = {};
    for (const [label, ms] of Object.entries(WINDOWS_MS)) {
      uptime[label] = uptimeForWindow(history, now, ms);
    }

    providersOut[provider.id] = {
      name: provider.name,
      model: provider.model,
      status: result ? result.status : history.length ? history[history.length - 1].status : 'unknown',
      stale: !result,
      note: result ? result.note ?? null : null,
      uptime,
      lastPolled: result ? nowIso : history.length ? history[history.length - 1].t : null,
    };
  }

  const cutoffIncidents = now - RETENTION_MS;
  incidentLog = incidentLog.filter((e) => {
    const anchor = e.resolvedAt || e.seenAt;
    return new Date(anchor).getTime() >= cutoffIncidents;
  });
  writeJsonl(INCIDENTS_FILE, incidentLog);

  const recentIncidents = [...incidentLog]
    .sort((a, b) => new Date(b.startedAt || b.seenAt) - new Date(a.startedAt || a.seenAt))
    .slice(0, 10)
    .map(({ _key, ...rest }) => rest);

  const latest = {
    generatedAt: nowIso,
    source: 'status-page-polling-phase-1',
    note: 'Status, uptime %, and incidents are real (polled every 15 min). Latency and error-rate are not available from status pages — see docs/polling-integration-scope.md Phase 2.',
    providers: providersOut,
    incidents: recentIncidents,
    errors,
  };

  fs.writeFileSync(LATEST_FILE, JSON.stringify(latest, null, 2) + '\n');
  console.log(`[poll] wrote ${LATEST_FILE}`);
  if (Object.keys(errors).length) {
    console.log(`[poll] ${Object.keys(errors).length} provider(s) failed this run:`, errors);
  }
}

main().catch((err) => {
  console.error('[poll] fatal:', err);
  process.exit(1);
});
