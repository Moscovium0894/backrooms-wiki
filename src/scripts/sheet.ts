// Dependency-free bottom sheet: slide-up transition, backdrop/Esc close,
// drag-to-dismiss on the grab handle via Pointer Events.

export interface SheetController {
  open: (fill: (sheet: HTMLElement) => void) => void;
  close: () => void;
  isOpen: () => boolean;
}

export function createSheet(): SheetController | null {
  const sheet = document.getElementById('level-sheet');
  const backdrop = document.getElementById('sheet-backdrop');
  const handle = sheet?.querySelector<HTMLButtonElement>('.sheet-handle');
  if (!sheet || !backdrop || !handle) return null;

  let openState = false;
  let lastFocus: Element | null = null;

  const close = () => {
    if (!openState) return;
    openState = false;
    sheet.classList.remove('sheet--open');
    backdrop.classList.remove('sheet-backdrop--open');
    window.setTimeout(() => {
      if (!openState) {
        sheet.hidden = true;
        backdrop.hidden = true;
      }
    }, 260);
    if (lastFocus instanceof HTMLElement) lastFocus.focus();
  };

  const open = (fill: (sheetEl: HTMLElement) => void) => {
    fill(sheet);
    lastFocus = document.activeElement;
    sheet.hidden = false;
    backdrop.hidden = false;
    sheet.style.transform = '';
    requestAnimationFrame(() => {
      sheet.classList.add('sheet--open');
      backdrop.classList.add('sheet-backdrop--open');
    });
    openState = true;
    sheet.querySelector<HTMLAnchorElement>('#sheet-open')?.focus({ preventScroll: true });
  };

  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openState) close();
  });

  // drag-to-dismiss from the handle
  let y0 = 0;
  let dragging = false;
  let dy = 0;
  let t0 = 0;

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    dy = 0;
    y0 = e.clientY;
    t0 = performance.now();
    sheet.style.transition = 'none';
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    const dt = performance.now() - t0;
    const fast = dy > 30 && dy / dt > 0.45;
    if (dy > 90 || fast) {
      sheet.style.transform = '';
      close();
    } else {
      sheet.style.transform = '';
      if (dy < 6) close(); // treat as a tap on the handle
    }
    dy = 0;
  };

  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  return { open, close, isOpen: () => openState };
}
