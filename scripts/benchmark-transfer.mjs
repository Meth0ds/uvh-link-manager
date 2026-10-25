#!/usr/bin/env node
/** Bounded-memory transfer probe with a sparse file and streaming destination. */
import assert from 'node:assert/strict';
import { mkdtemp, realpath, open, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { copyToS3 } from './recovery/destinations.mjs';
import { digestFile } from './recovery/backup-format.mjs';

const mib = Number(process.argv[2] ?? 64);
assert.ok(Number.isSafeInteger(mib) && mib >= 1 && mib <= 1024);
const folder = await realpath(await mkdtemp(join(tmpdir(), 'uvh-transfer-benchmark-')));
const source = join(folder, 'source.enc'), bytes = mib * 1024 * 1024;
try {
  const handle = await open(source, 'wx', 0o600);
  try { await handle.truncate(bytes); } finally { await handle.close(); }
  const digest = await digestFile(source);
  let uploaded = 0, parts = 0;
  const fetcher = async (url, options) => {
    new Request(url, options);
    const query = new URL(url).searchParams;
    if (options.method === 'POST' && query.has('uploads')) return new Response('<UploadId>fixture</UploadId>');
    if (options.method === 'PUT') { uploaded += options.body.length; parts++; return new Response('', { headers: { etag: `"part-${parts}"` } }); }
    if (options.method === 'POST') return new Response('<CompleteMultipartUploadResult/>');
    if (options.method === 'GET') return new Response(Readable.toWeb(createReadStream(source)), { headers: { 'content-length': String(bytes) } });
    return new Response('');
  };
  const start = performance.now();
  const result = await copyToS3(source, { endpoint: 'https://objects.example.test', bucket: 'uvh', region: 'fixture-1', accessKey: 'fixture', secretKey: 'fixture', multipartThreshold: 1 }, randomUUID(), fetcher, { digest });
  assert.equal(uploaded, bytes); assert.equal(result.digest, digest);
  process.stdout.write(JSON.stringify({ mib, bytes, parts, milliseconds: performance.now() - start, peakRssKiB: process.resourceUsage().maxRSS }) + '\n');
} finally { await rm(folder, { recursive: true, force: true }); }
