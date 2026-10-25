import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { copyToS3 } from './destinations.mjs';
import { signedRequest } from './s3-signing.mjs';
import { PART_SIZE, readExactly, uploadMultipart } from './s3-multipart.mjs';
import { createS3Transport } from './s3-transport.mjs';

const config = { endpoint: 'https://objects.example.test', bucket: 'uvh', region: 'test-1', accessKey: 'fixture', secretKey: 'fixture', multipartThreshold: 1 };

test('signing has one UTC suffix and GET/DELETE obey the Fetch request contract', async () => {
  const request = signedRequest(config, 'GET', 'fixture', Buffer.alloc(0), {}, new Date('2026-10-24T12:00:00Z'));
  assert.equal(request.headers['x-amz-date'], '20261024T120000Z');
  assert.match(request.headers.Authorization, /20261024\/test-1\/s3\/aws4_request/);
  const transport = createS3Transport(config, async (url, options) => {
    const built = new Request(url, options);
    assert.equal(built.body, null);
    return new Response('', { status: 200 });
  });
  await transport('GET', 'fixture');
  await transport('DELETE', 'fixture', undefined, { uploadId: 'fixture' });
});

test('a truncated local part is rejected before upload', async () => {
  const handle = { read: async () => ({ bytesRead: 0 }) };
  await assert.rejects(() => readExactly(handle, 0, 32), { code: 'destination_source_changed' });
});

async function fixture(callback) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'uvh-s3-test-')));
  const source = join(folder, 'source.enc'), statePath = join(folder, 'state.json'), id = randomUUID();
  const payload = Buffer.alloc(PART_SIZE + 12, 0x61);
  await writeFile(source, payload);
  const calls = [], stored = new Map(); let object = null, failPart = 0, embeddedError = false, corrupt = false, loseCompletion = false;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks); calls.push({ method: request.method, path: request.url, bytes: body.length });
    if (request.method === 'POST' && url.searchParams.has('uploads')) { response.end('<InitiateMultipartUploadResult><UploadId>fixture</UploadId></InitiateMultipartUploadResult>'); return; }
    if (request.method === 'GET' && url.searchParams.has('uploadId')) {
      response.end(`<ListPartsResult><IsTruncated>false</IsTruncated>${[...stored.entries()].map(([number, part]) => `<Part><PartNumber>${number}</PartNumber><LastModified>now</LastModified><ETag>"part-${number}"</ETag><Size>${part.length}</Size></Part>`).join('')}</ListPartsResult>`); return;
    }
    if (request.method === 'PUT' && url.searchParams.has('partNumber')) {
      const number = Number(url.searchParams.get('partNumber'));
      if (number === failPart) { response.writeHead(503); response.end(); return; }
      stored.set(number, body); response.setHeader('etag', `"part-${number}"`); response.end(); return;
    }
    if (request.method === 'POST') {
      if (embeddedError) { response.end('<Error><Code>InternalError</Code></Error>'); return; }
      object = Buffer.concat([...stored.entries()].sort(([a], [b]) => a - b).map(([, part]) => part));
      if (loseCompletion) { loseCompletion = false; request.socket.destroy(); return; }
      response.end('<CompleteMultipartUploadResult><ETag>fixture</ETag></CompleteMultipartUploadResult>'); return;
    }
    if (request.method === 'PUT') { object = body; response.end(); return; }
    if (request.method === 'DELETE') { if (object !== null) response.writeHead(404); stored.clear(); response.end(); return; }
    if (request.method === 'GET') { if (object === null) { response.writeHead(404); response.end(); return; } response.end(corrupt ? Buffer.alloc(object.length) : object); return; }
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fetcher = async (url, options) => {
    // Construct the production request first: unlike a permissive mock, this
    // rejects GET bodies and invalid headers using the real Fetch grammar.
    new Request(url, options);
    const incoming = new URL(url);
    return fetch(`http://127.0.0.1:${server.address().port}${incoming.pathname}${incoming.search}`, options);
  };
  try { await callback({ source, statePath, id, calls, payload, fetcher, folder,
    setFail: value => { failPart = value; }, setEmbeddedError: () => { embeddedError = true; }, setCorrupt: () => { corrupt = true; }, setLoseCompletion: () => { loseCompletion = true; } }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(folder, { recursive: true, force: true }); }
}

test('multipart resumes confirmed remote parts through actual HTTP and verifies the object', async () => fixture(async f => {
  f.setFail(2);
  await assert.rejects(() => copyToS3(f.source, config, f.id, f.fetcher, { statePath: f.statePath }));
  const persisted = JSON.parse(await readFile(f.statePath, 'utf8'));
  persisted.parts = []; await writeFile(f.statePath, JSON.stringify(persisted));
  f.setFail(0);
  const result = await copyToS3(f.source, config, f.id, f.fetcher, { statePath: f.statePath });
  assert.equal(result.bytes, f.payload.length);
  assert.equal(f.calls.filter(call => call.method === 'PUT' && call.path.includes('partNumber=1')).length, 1);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.includes('uploads=')).length, 1);
  assert.ok(f.calls.filter(call => call.method === 'GET').every(call => call.bytes === 0));
  await assert.rejects(() => readFile(f.statePath), { code: 'ENOENT' });
}));

test('HTTP 200 containing a completion error never reports a successful transfer', async () => fixture(async f => {
  f.setEmbeddedError();
  await assert.rejects(() => copyToS3(f.source, config, f.id, f.fetcher, { statePath: f.statePath }), { code: 'destination_protocol' });
  assert.ok(await readFile(f.statePath));
}));

test('a lost completion response is reconciled by reading the completed object', async () => fixture(async f => {
  f.setLoseCompletion();
  await assert.rejects(() => copyToS3(f.source, config, f.id, f.fetcher, { statePath: f.statePath }));
  const result = await copyToS3(f.source, config, f.id, f.fetcher, { statePath: f.statePath });
  assert.equal(result.bytes, f.payload.length);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.includes('uploadId=')).length, 1);
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 2);
  assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 1);
  await assert.rejects(() => readFile(f.statePath), { code: 'ENOENT' });
}));

test('an unreadable source is rejected before opening a multipart session', async () => fixture(async f => {
  const calls = [];
  await assert.rejects(() => uploadMultipart(join(f.folder, 'missing'), config, 'fixture', f.payload.length, 'a'.repeat(64), async method => {
    calls.push(method); return new Response('<UploadId>fixture</UploadId>');
  }), { code: 'ENOENT' });
  assert.deepEqual(calls, []);
}));

test('a transfer without durable state aborts its owned upload on failure', async () => fixture(async f => {
  f.setFail(2);
  await assert.rejects(() => copyToS3(f.source, config, f.id, f.fetcher));
  assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 1);
}));

test('a newly initiated upload is aborted if its first checkpoint cannot be saved', async () => fixture(async f => {
  const parent = join(f.folder, 'not-a-directory'); await writeFile(parent, 'fixture');
  await assert.rejects(() => copyToS3(f.source, config, f.id, f.fetcher, { statePath: join(parent, 'state.json') }));
  assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
}));

test('a corrupt remote object fails checksum verification even when its length matches', async () => fixture(async f => {
  f.setCorrupt();
  await assert.rejects(() => copyToS3(f.source, { ...config, multipartThreshold: PART_SIZE }, f.id, f.fetcher), { code: 'destination_integrity' });
}));
