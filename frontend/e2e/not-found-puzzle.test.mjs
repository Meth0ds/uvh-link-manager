import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPuzzle, rotatePiece, isConnected } from '../public/visitor-assets/puzzle-core.v1.mjs';
const solution = [0, 3, 1, 2, 0];
test('all three starts are distinct, unsolved, and reachable by quarter turns', () => {
  const starts = new Set();
  for (let round = 0; round < 3; round++) {
    let state = createPuzzle(round);
    starts.add(JSON.stringify(state.turns));
    assert.equal(isConnected(state), false);
    for (let piece = 0; piece < 5; piece++) {
      for (let n = 0, count = (solution[piece] - state.turns[piece] + 4) % 4; n < count; n++) state = rotatePiece(state, piece);
    }
    assert.equal(isConnected(state), true);
    assert.equal(rotatePiece(state, 2), state, 'solved board remains stable');
  }
  assert.equal(starts.size, 3);
  assert.deepEqual(createPuzzle(3), createPuzzle(0));
});
test('exhaustive continuity: only the complete route reaches the exit', () => {
  for (let encoded = 0; encoded < 1024; encoded++) {
    const turns = Array.from({ length: 5 }, (_, piece) => (encoded >> (piece * 2)) & 3);
    const expected = turns[0] % 2 === 0 && turns.slice(1).every((turn, i) => turn === solution[i + 1]);
    assert.equal(isConnected({ round: 0, turns }), expected, `ports ${turns}`);
  }
});
test('rapid rotations do not mutate previous snapshots; replay starts clean', () => {
  const initial = createPuzzle();
  let state = initial;
  for (let i = 0; i < 400; i++) state = rotatePiece(state, 0);
  assert.equal(isConnected(state), false);
  assert.equal(state.turns[0] % 4, initial.turns[0]);
  assert.deepEqual(initial, createPuzzle());
  assert.equal(rotatePiece(state, -1), state);
  assert.equal(rotatePiece(state, 5), state);
});
