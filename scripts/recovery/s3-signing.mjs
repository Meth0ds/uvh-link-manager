import { createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { fail } from './store.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

export function signedRequest(config, method, key, body, query = {}, clock = new Date()) {
  const endpoint = new URL(config.endpoint);
  const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ip = isIP(hostname);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || hostname === 'localhost'
      || ip === 4 && hostname.startsWith('127.') || ip === 6 && (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1')) {
    fail('invalid_destination', 'El destino externo debe usar HTTPS, un host dedicado y no incluir credenciales en la URL.');
  }
  const path = `${endpoint.pathname.replace(/\/$/, '')}/${config.bucket}/${key}`.split('/').map(encode).join('/');
  const queryString = Object.entries(query).map(([name, value]) => [encode(name), encode(value ?? '')])
    .sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
    .map(([name, value]) => `${name}=${value}`).join('&');
  const payloadHash = sha256(body);
  const amzDate = clock.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const short = amzDate.slice(0, 8);
  const signed = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = `host:${endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonical = `${method}\n${path}\n${queryString}\n${canonicalHeaders}\n${signed}\n${payloadHash}`;
  const scope = `${short}/${config.region}/s3/aws4_request`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretKey}`, short), config.region), 's3'), 'aws4_request');
  const signature = hmac(signingKey, `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`).toString('hex');
  return {
    url: `${endpoint.origin}${path}${queryString ? `?${queryString}` : ''}`,
    headers: { Host: endpoint.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}` },
  };
}
