// One entry per provider card on the dashboard (ids match build/template.html's
// PROVIDERS list). Each `probe()` returns:
//   { status: 'good'|'warn'|'bad', incidents: [{ title, severity, startedAt, resolvedAt }] }
//
// Phase 1 only: these are status-page/incident-feed reads, not latency or
// error-rate measurements — see docs/polling-integration-scope.md. Every
// probe throws on unexpected shape rather than guessing, so a bad response
// shows up as a poll failure instead of silently wrong data.
'use strict';

const { extractNuxtData } = require('./lib/nuxt-payload');
const { decodeAwsUtf16 } = require('./lib/aws-utf16');

const UA = 'relay-observability-bot/1.0 (+https://github.com/cetinkayabugra/Real-Time)';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

function statuspageIndicatorToStatus(indicator) {
  if (indicator === 'none') return 'good';
  if (indicator === 'minor') return 'warn';
  if (indicator === 'major' || indicator === 'critical') return 'bad';
  throw new Error(`unrecognized statuspage indicator: ${indicator}`);
}

async function probeStatuspage(url) {
  const data = await getJson(url);
  return {
    status: statuspageIndicatorToStatus(data.status.indicator),
    incidents: [],
    note: data.status.description,
  };
}

async function probeMistral() {
  const res = await fetch('https://status.mistral.ai/', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GET status.mistral.ai -> HTTP ${res.status}`);
  const html = await res.text();
  const root = extractNuxtData(html);

  const pageId = root?.data?.['status-page-resolver-status.mistral.ai']?.statusPage?.id;
  if (!pageId) throw new Error('mistral: could not find statusPage.id in payload');

  const unresolved = root.data[`unresolved-incidents-${pageId}`];
  const incidents = unresolved?.incidents ?? [];
  const hasMajor = incidents.some((i) => /major|critical/i.test(i.severity || ''));
  const status = incidents.length === 0 ? 'good' : hasMajor ? 'bad' : 'warn';

  return {
    status,
    incidents: incidents.map((i) => ({
      title: i.name,
      severity: i.severity,
      startedAt: i.created_at,
      resolvedAt: i.lastUpdateStatus === 'RESOLVED' ? i.updated_at ?? null : null,
    })),
  };
}

async function probeGoogle() {
  const incidents = await getJson('https://status.cloud.google.com/incidents.json');
  const relevant = incidents.filter(
    (i) => !i.end && (i.affected_products || []).some((p) => /vertex|generative|gemini|ai platform/i.test(p.title || ''))
  );
  const hasHigh = relevant.some((i) => /high|critical|major/i.test(i.severity || i.status_impact || ''));
  const status = relevant.length === 0 ? 'good' : hasHigh ? 'bad' : 'warn';

  return {
    status,
    incidents: relevant.map((i) => ({
      title: i.external_desc,
      severity: i.severity || i.status_impact || 'unknown',
      startedAt: i.begin,
      resolvedAt: i.end || null,
    })),
  };
}

async function probeBedrock() {
  const res = await fetch('https://health.aws.amazon.com/public/currentevents', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GET health.aws.amazon.com -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const events = JSON.parse(decodeAwsUtf16(buf));
  const relevant = events.filter((e) => /bedrock/i.test(e.service_name || ''));

  // AWS's numeric `status` codes aren't mapped yet (only ever observed non-Bedrock
  // events so far) — treat any active Bedrock event as 'warn', never auto-escalate
  // to 'bad', until the code meanings are confirmed against a real incident.
  const status = relevant.length === 0 ? 'good' : 'warn';

  return {
    status,
    incidents: relevant.map((e) => ({
      title: e.summary,
      severity: `aws-status-code:${e.status}`,
      startedAt: e.timestamp ? new Date(Number(e.timestamp) * 1000).toISOString() : null,
      resolvedAt: null,
    })),
  };
}

const PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    model: 'Claude 4.5 family',
    probe: () => probeStatuspage('https://status.claude.com/api/v2/summary.json'),
  },
  {
    id: 'openai',
    name: 'OpenAI',
    model: 'GPT-5.1 family',
    probe: () => probeStatuspage('https://status.openai.com/api/v2/summary.json'),
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    model: 'Large 3 family',
    probe: probeMistral,
  },
  {
    id: 'bedrock',
    name: 'Amazon Bedrock',
    model: 'Multi-model gateway',
    probe: probeBedrock,
  },
  {
    id: 'cohere',
    name: 'Cohere',
    model: 'Command R+ family',
    probe: () => probeStatuspage('https://status.cohere.com/api/v2/summary.json'),
  },
  {
    id: 'google',
    name: 'Google',
    model: 'Gemini 2.5 family',
    probe: probeGoogle,
  },
];

module.exports = { PROVIDERS };
