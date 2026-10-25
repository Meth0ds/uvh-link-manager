import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, symlinkSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createImageSelection } from './image-selection.mjs';
import { createRecoveryIO } from './io.mjs';

const roots = [], IMAGE = 'sha256:' + 'a'.repeat(64);
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'uvh-image-test-'))); roots.push(root);
  const home = join(root, '.uvh-runtime/recovery');
  return { root, home };
}

test('default selection has no side effects and restored images survive restart', () => {
  const { home } = fixture();
  const images = createImageSelection({ home });
  assert.equal(images.selected(), null); assert.deepEqual(images.files(), []);
  assert.equal(existsSync(home), false);
  images.select(IMAGE);
  const restarted = createImageSelection({ home });
  assert.equal(restarted.selected(), IMAGE);
  const flags = restarted.files();
  const output = JSON.parse(readFileSync(flags[1], 'utf8'));
  for (const name of ['php', 'app', 'queue', 'queue-destinations', 'schedule']) assert.deepEqual(output.services[name], { image: IMAGE, pull_policy: 'never' });
});

test('an explicit reset overrides legacy environment selection across restart', () => {
  const { home } = fixture();
  const images = createImageSelection({ home, legacy: () => IMAGE });
  assert.equal(images.selected(), IMAGE);
  images.select(null);
  const restarted = createImageSelection({ home, legacy: () => IMAGE });
  assert.equal(restarted.selected(), null); assert.deepEqual(restarted.files(), []);
});

test('mutable image references, malformed metadata and linked outputs are rejected', () => {
  const { home, root } = fixture(), images = createImageSelection({ home });
  for (const image of ['registry.example/php:latest', 'php:8.4', 'sha256:no', {}, undefined]) assert.throws(() => images.select(image), { code: 'invalid_image_selection' });
  images.select(IMAGE);
  const file = images.files()[1]; unlinkSync(file);
  symlinkSync(join(root, 'missing'), file);
  assert.throws(() => images.files(), { code: 'unsafe_file' });
  writeFileSync(join(home, 'selected-image.json'), JSON.stringify({ schema: 1, image: IMAGE, command: 'unexpected' }));
  assert.throws(() => images.selected(), { code: 'invalid_image_selection' });
});

test('recovery startup uses the image selected by an earlier controller', async () => {
  const { home, root } = fixture(), calls = [];
  createImageSelection({ home }).select(IMAGE);
  writeFileSync(join(root, '.env.docker.local'), 'POSTGRES_DB=uvh_image_test\n');
  const io = createRecoveryIO({ root, home, key: 'a'.repeat(64),
    run: async (file, args) => { calls.push({ file, args }); return { code: 0, output: '' }; },
    compose: (args, files = []) => ['compose', '-f', join(root, 'docker-compose.local.yml'), ...files, ...args],
    startFrontend: async () => {}, stopFrontend: async () => {}, externalNode: () => process.execPath,
  });
  await io.start();
  const call = calls.find(call => call.args.includes('up'));
  const file = createImageSelection({ home }).files()[1];
  assert.ok(call.args.includes(file));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).services.app.image, IMAGE);
});

test('configuration of an earlier image is not replaced when the selection changes', () => {
  const { home } = fixture(), images = createImageSelection({ home });
  images.select(IMAGE); const first = images.files()[1], body = readFileSync(first, 'utf8');
  images.select('sha256:' + 'b'.repeat(64)); const second = images.files()[1];
  assert.notEqual(first, second); assert.equal(readFileSync(first, 'utf8'), body);
});

test('a failed clean-check cannot clear a restored image', async () => {
  const { home, root } = fixture(), images = createImageSelection({ home }); images.select(IMAGE);
  const io = createRecoveryIO({ root, home, images, compose: args => args,
    run: async () => ({ code: 0, output: '?? local-file.txt' }),
  });
  await assert.rejects(() => io.apply('b'.repeat(40), 'a'.repeat(40)), { code: 'dirty_checkout' });
  assert.equal(createImageSelection({ home }).selected(), IMAGE);
});
