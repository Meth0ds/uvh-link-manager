// Pure game state: no DOM, URLs, storage, randomness or network.
export const CELLS = [3, 4, 1, 2, 5];
const TYPES = ['straight', 'corner', 'corner', 'corner', 'corner'];
const STARTS = [[1, 0, 2, 3, 2], [0, 2, 1, 0, 3], [1, 1, 3, 1, 1]];
const DELTAS = [-3, 1, 3, -1]; // north, east, south, west
export function createPuzzle(round = 0) {
  return { round: ((round % STARTS.length) + STARTS.length) % STARTS.length, turns: [...STARTS[((round % STARTS.length) + STARTS.length) % STARTS.length]] };
}
export function connections(state, piece) {
  const ports = TYPES[piece] === 'straight' ? [1, 3] : [0, 1];
  return ports.map(port => (port + state.turns[piece]) % 4);
}
export function rotatePiece(state, piece) {
  if (!Number.isInteger(piece) || piece < 0 || piece >= CELLS.length || isConnected(state)) return state;
  return { ...state, turns: state.turns.map((turn, index) => index === piece ? turn + 1 : turn) };
}
export function isConnected(state) {
  let cell = 3, entering = 3;
  const visited = new Set();
  while (!visited.has(cell)) {
    visited.add(cell);
    const piece = CELLS.indexOf(cell);
    if (piece < 0) return false;
    const ports = connections(state, piece);
    if (!ports.includes(entering)) return false;
    const leaving = ports.find(port => port !== entering);
    if (cell === 5 && leaving === 1) return true;
    const next = cell + DELTAS[leaving];
    if (next < 0 || next > 8 || (leaving === 1 && cell % 3 === 2) || (leaving === 3 && cell % 3 === 0)) return false;
    cell = next;
    entering = (leaving + 2) % 4;
  }
  return false;
}
export function pieceType(piece) { return TYPES[piece]; }
