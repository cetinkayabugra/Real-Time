// Builds index.html from template.html, inlining the woff2 fonts as data URIs.
// Run with: node build/build.js   (from the repo root)
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const template = fs.readFileSync(path.join(DIR, 'template.html'), 'utf8');

function b64(file) {
  return fs.readFileSync(path.join(DIR, 'fonts', file)).toString('base64');
}

const out = template
  .replace('__BSD700__', b64('big-shoulders-display-700.woff2'))
  .replace('__PLEXSANS__', b64('ibm-plex-sans-var.woff2'))
  .replace('__PLEXMONO400__', b64('ibm-plex-mono-400.woff2'))
  .replace('__PLEXMONO500__', b64('ibm-plex-mono-500.woff2'));

const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RELAY — Provider Observability</title>
<meta name="description" content="Mock provider observability board: latency, uptime, and error rate across LLM API providers with live-recomputed failover ranking.">
</head>
<body>
${out}
</body>
</html>
`;

fs.writeFileSync(path.join(DIR, '..', 'index.html'), full);
console.log('wrote index.html —', Buffer.byteLength(full), 'bytes');
