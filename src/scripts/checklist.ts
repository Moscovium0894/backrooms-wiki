// Wires the per-level checklist: restore state, persist changes, fill the
// ring, and fire the CLEARED stamp when everything is checked.

import { levelState, setChecks, setDone } from './progress';

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initChecklist(): void {
  const panel = document.querySelector<HTMLElement>('[data-checklist]');
  if (!panel) return;
  const levelId = panel.dataset.checklist!;
  const total = Number(panel.dataset.total ?? '0');
  const boxes = [...panel.querySelectorAll<HTMLInputElement>('input[data-check]')];
  const countEl = panel.querySelector<HTMLElement>('[data-check-count]');
  const stamp = panel.querySelector<HTMLElement>('[data-stamp]');
  const ring = panel.querySelector<HTMLElement>('[data-ring]');
  const markAll = panel.querySelector<HTMLButtonElement>('[data-mark-all]');

  let wasDone = levelState(levelId).done;

  const render = () => {
    const st = levelState(levelId);
    for (const box of boxes) box.checked = st.checks.includes(box.dataset.check!);
    const n = boxes.filter((b) => b.checked).length;
    if (countEl) countEl.textContent = `${n} / ${total}`;
    ring?.style.setProperty('--frac', total ? String(n / total) : '0');
    if (stamp) {
      stamp.hidden = !st.done;
      if (st.done && !wasDone && !reducedMotion()) {
        stamp.classList.remove('stamp-in');
        void stamp.offsetWidth; // restart animation
        stamp.classList.add('stamp-in');
      }
    }
    if (markAll) {
      markAll.textContent = st.done ? 'Reopen level file' : 'Mark level cleared';
    }
    wasDone = st.done;
  };

  for (const box of boxes) {
    box.addEventListener('change', () => {
      const checked = boxes.filter((b) => b.checked).map((b) => b.dataset.check!);
      setChecks(levelId, checked, total);
      render();
    });
  }

  markAll?.addEventListener('click', () => {
    const st = levelState(levelId);
    setDone(levelId, !st.done, boxes.map((b) => b.dataset.check!));
    render();
  });

  render();
}
