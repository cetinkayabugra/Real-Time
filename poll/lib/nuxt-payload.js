// Resolves a Nuxt 3 `__NUXT_DATA__` SSR payload: a flat array where most
// entries are plain values, and object/array values reference other entries
// by index. A few wrapper arrays (`["ShallowReactive", N]` etc.) mark
// reactive refs and just need unwrapping to the value at index N.
//
// Mistral's status page (status.mistral.ai) is a Nuxt/Instatus SPA with no
// plain REST API — this is how the poller gets its data. It's the most
// fragile of the six provider integrations: it breaks if Mistral changes
// their frontend's data shape, not just if they change an API contract.
'use strict';

const WRAPPERS = new Set(['ShallowReactive', 'Reactive', 'Ref', 'ShallowRef', 'EmptyRef']);

function resolveNuxtPayload(raw, rootIndex = 1) {
  const cache = new Map();

  function resolve(idx) {
    if (cache.has(idx)) return cache.get(idx);
    const val = raw[idx];
    if (val === undefined) return undefined;

    if (Array.isArray(val)) {
      if (val.length === 2 && typeof val[0] === 'string' && WRAPPERS.has(val[0]) && typeof val[1] === 'number') {
        const placeholder = {};
        cache.set(idx, placeholder);
        const inner = resolve(val[1]);
        Object.assign(placeholder, inner && typeof inner === 'object' ? inner : { value: inner });
        return placeholder;
      }
      const out = [];
      cache.set(idx, out);
      for (const v of val) out.push(typeof v === 'number' ? resolve(v) : v);
      return out;
    }

    if (val && typeof val === 'object') {
      const out = {};
      cache.set(idx, out);
      for (const [k, v] of Object.entries(val)) {
        out[k] = typeof v === 'number' && v >= 0 && v < raw.length ? resolve(v) : v;
      }
      return out;
    }

    cache.set(idx, val);
    return val;
  }

  return resolve(rootIndex);
}

function extractNuxtData(html) {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('__NUXT_DATA__ script not found — page structure likely changed');
  return resolveNuxtPayload(JSON.parse(m[1]));
}

module.exports = { resolveNuxtPayload, extractNuxtData };
