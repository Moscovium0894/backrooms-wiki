// Horizontal swipe between prev/next level pages. Enhancement only — the
// PrevNextNav buttons are the primary affordance. A 24px dead-zone at each
// screen edge keeps Safari's back-swipe gesture in charge there.

export function initSwipeNav(): void {
  const prev = document.querySelector<HTMLAnchorElement>('[data-nav-prev]');
  const next = document.querySelector<HTMLAnchorElement>('[data-nav-next]');
  if (!prev && !next) return;

  let x0 = 0;
  let y0 = 0;
  let live = false;

  document.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      if (!t) return;
      const edge = 24;
      live = t.clientX > edge && t.clientX < window.innerWidth - edge;
      x0 = t.clientX;
      y0 = t.clientY;
    },
    { passive: true },
  );

  document.addEventListener(
    'touchend',
    (e) => {
      if (!live) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) {
        const target = dx < 0 ? next : prev;
        if (target) window.location.href = target.href;
      }
    },
    { passive: true },
  );
}
