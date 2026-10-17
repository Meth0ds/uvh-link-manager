import { CELLS, createPuzzle, connections, rotatePiece, isConnected, pieceType } from './puzzle-core.v1.mjs';
const COPY = {
  es: { directions: ['arriba', 'derecha', 'abajo', 'izquierda'], instructions: 'Conecta la entrada izquierda con la salida derecha. Gira cada tramo con Enter, Espacio o un toque.', entrance: 'Entrada', exit: 'Salida', restart: 'Empezar de nuevo', replay: 'Volver a jugar', solved: '¡Camino conectado!', prompt: 'Gira los tramos para unir los extremos.', section: 'Tramo', and: ' y ', connected: 'Camino conectado.', rotate: 'Girar 90 grados.' },
  en: { directions: ['up', 'right', 'down', 'left'], instructions: 'Connect the entrance on the left to the exit on the right. Rotate each section with Enter, Space or a tap.', entrance: 'Entrance', exit: 'Exit', restart: 'Start again', replay: 'Play again', solved: 'Path connected!', prompt: 'Turn the sections to join the ends.', section: 'Section', and: ' and ', connected: 'Path connected.', rotate: 'Rotate 90 degrees.' },
};
const SVG = 'http://www.w3.org/2000/svg';
export function mountPuzzle(root) {
  const doc = root.ownerDocument;
  const copy = COPY[doc.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'es'];
  const abort = new AbortController();
  let state = createPuzzle();
  const buttons = [], paths = [];
  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const board = element('div', 'nf-board');
  board.setAttribute('role', 'group');
  board.setAttribute('aria-label', copy.instructions);
  for (let cell = 0; cell < 9; cell++) {
    const piece = CELLS.indexOf(cell);
    if (piece < 0) {
      const blank = element('span', 'nf-cell nf-cell-empty');
      blank.setAttribute('aria-hidden', 'true');
      board.append(blank);
      continue;
    }
    const button = element('button', 'nf-cell nf-piece');
    button.type = 'button';
    button.dataset.piece = String(piece);
    const svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 80 80');
    svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', pieceType(piece) === 'straight' ? 'M0 40H80' : 'M40 0V24Q40 40 56 40H80');
    svg.append(path);
    button.append(svg);
    button.style.setProperty('--piece-order', String(piece));
    button.addEventListener('click', () => { state = rotatePiece(state, piece); render(); }, { signal: abort.signal });
    buttons[piece] = button; paths[piece] = svg;
    board.append(button);
  }
  const boardShell = element('div', 'nf-board-shell');
  const entry = element('span', 'nf-port nf-port-in', copy.entrance);
  const exit = element('span', 'nf-port nf-port-out', copy.exit);
  entry.setAttribute('aria-hidden', 'true'); exit.setAttribute('aria-hidden', 'true');
  entry.dataset.label = copy.entrance; exit.dataset.label = copy.exit;
  boardShell.append(entry, board, exit);
  const feedback = element('p', 'nf-game-feedback');
  feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
  const restart = element('button', 'nf-replay', copy.restart);
  restart.type = 'button';
  restart.addEventListener('click', () => {
    state = createPuzzle(state.round + 1);
    render();
    buttons[0].focus({ preventScroll: true });
  }, { signal: abort.signal });
  const controls = element('div', 'nf-game-controls');
  controls.append(feedback, restart);
  function render() {
    const connected = isConnected(state);
    boardShell.classList.toggle('is-connected', connected);
    root.dataset.solved = String(connected);
    buttons.forEach((button, piece) => {
      paths[piece].style.transform = `rotate(${state.turns[piece] * 90}deg)`;
      button.setAttribute('aria-label', `${copy.section} ${piece + 1}: ${connections(state, piece).map(port => copy.directions[port]).join(copy.and)}. ${connected ? copy.connected : copy.rotate}`);
      button.setAttribute('aria-disabled', String(connected));
    });
    feedback.textContent = connected ? copy.solved : copy.prompt;
    restart.textContent = connected ? copy.replay : copy.restart;
  }
  root.replaceChildren(boardShell, controls);
  render();
  return () => { abort.abort(); };
}
