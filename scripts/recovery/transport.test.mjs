import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createS3Transport, verifyRemote } from './s3-transport.mjs';

const config = { endpoint: 'https://objects.example.test', bucket: 'uvh', region: 'fixture-1', accessKey: 'fixture', secretKey: 'fixture' };
test('a rejected HTTP response closes its unread body and retains the stable error', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 });
  const request = createS3Transport(config, async () => response);
  try {
    await assert.rejects(() => request('PUT', 'fixture', Buffer.from('fixture')), { code: 'destination_upload', status: 503 });
    assert.equal(cancelled, true);
  } finally { if (!cancelled) await response.body.cancel(); }
});

test('a length mismatch closes the download before reporting failed integrity', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-length': '123' } });
  try {
    await assert.rejects(() => verifyRemote(async () => response, 'fixture', 10, 'a'.repeat(64)), { code: 'destination_integrity' });
    assert.equal(cancelled, true);
  } finally { if (!cancelled) await response.body.cancel(); }
});
