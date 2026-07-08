// Personal record panel on level pages: death tally + autosaved field notes.

import { getDeaths, getNote, setDeaths, setNote } from './progress';

export function initPersonal(): void {
  const panel = document.querySelector<HTMLElement>('[data-personal]');
  if (!panel) return;
  const id = panel.dataset.personal!;

  const countEl = panel.querySelector<HTMLElement>('[data-death-count]');
  const paint = () => {
    if (countEl) countEl.textContent = String(getDeaths(id));
  };
  panel.querySelector('[data-death-plus]')?.addEventListener('click', () => {
    setDeaths(id, getDeaths(id) + 1);
    paint();
  });
  panel.querySelector('[data-death-minus]')?.addEventListener('click', () => {
    setDeaths(id, Math.max(0, getDeaths(id) - 1));
    paint();
  });
  paint();

  const notes = panel.querySelector<HTMLTextAreaElement>('[data-field-notes]');
  if (notes) {
    notes.value = getNote(id);
    let timer = 0;
    notes.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setNote(id, notes.value), 400);
    });
    notes.addEventListener('blur', () => setNote(id, notes.value));
  }
}
