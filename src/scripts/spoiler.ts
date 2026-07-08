// Global spoiler mode + per-block reveal.
// <html data-spoilers="light|full"> is set pre-paint by an inline script in
// BaseLayout; this module wires the header toggle and redaction blocks.

import { load, setSpoilers } from './progress';

export function initSpoilerToggle(): void {
  const btn = document.getElementById('spoiler-toggle');
  if (!btn) return;

  const sync = () => {
    const mode = document.documentElement.dataset.spoilers === 'full' ? 'full' : 'light';
    btn.setAttribute('aria-pressed', String(mode === 'full'));
    const label = btn.querySelector('.mode');
    if (label) label.textContent = mode === 'full' ? 'FULL' : 'REDACTED';
  };

  btn.addEventListener('click', () => {
    const cur = load().spoilers;
    setSpoilers(cur === 'full' ? 'light' : 'full');
    sync();
  });
  sync();
}

export function initSpoilerBlocks(): void {
  document.querySelectorAll<HTMLElement>('.redaction').forEach((block) => {
    const cover = block.querySelector<HTMLButtonElement>('.redaction-cover');
    cover?.addEventListener('click', () => {
      block.classList.add('revealed'); // session-scoped, not persisted
    });
  });
}
