import { mountPuzzle } from './puzzle.v1.mjs';
const cleanups = [...document.querySelectorAll('[data-route-puzzle]')].map(mountPuzzle);
window.addEventListener('pagehide', event => { if (!event.persisted) cleanups.forEach(cleanup => cleanup()); });
