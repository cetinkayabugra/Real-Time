// AWS's public Health Dashboard feed (health.aws.amazon.com/public/currentevents)
// is served as UTF-16 BIG-endian with a BE BOM (FE FF) — unusual for a JSON API.
// Node's Buffer only has a built-in LE decoder, so byte-swap first.
'use strict';

function decodeAwsUtf16(buf) {
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const body = buf.slice(2);
    const swapped = Buffer.alloc(body.length);
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    return swapped.toString('utf16le');
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le');
  }
  return buf.toString('utf8');
}

module.exports = { decodeAwsUtf16 };
