// Tap-to-zoom image lightbox. Dependency-free: tap any content image to view
// it full screen; tap again to toggle 2x zoom (pannable); Esc / close / tap
// outside dismisses. Built lazily on first use.

let overlay: HTMLElement | null = null;
let img: HTMLImageElement | null = null;
let caption: HTMLElement | null = null;
let lastFocus: Element | null = null;

function build(): void {
  overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Image viewer');

  img = document.createElement('img');
  img.alt = '';
  overlay.appendChild(img);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'lightbox-close';
  close.textContent = 'CLOSE ✕';
  overlay.appendChild(close);

  caption = document.createElement('p');
  caption.className = 'lightbox-caption';
  overlay.appendChild(caption);

  const dismiss = () => {
    overlay!.hidden = true;
    overlay!.classList.remove('zoomed');
    document.body.style.overflow = '';
    if (lastFocus instanceof HTMLElement) lastFocus.focus();
  };

  close.addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });
  img.addEventListener('click', () => {
    overlay!.classList.toggle('zoomed');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && !overlay.hidden) dismiss();
  });

  document.body.appendChild(overlay);
}

export function initLightbox(): void {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLImageElement)) return;
    // only content images: inside main, not card thumbs, not inside links
    if (!target.closest('main') || target.closest('a') || target.classList.contains('thumb')) {
      return;
    }
    if (target.closest('.lightbox') || target.closest('.sheet')) return;
    e.preventDefault();
    if (!overlay) build();
    lastFocus = document.activeElement;
    img!.src = target.currentSrc || target.src;
    caption!.textContent = target.alt || '';
    caption!.hidden = !target.alt;
    overlay!.classList.remove('zoomed');
    overlay!.hidden = false;
    document.body.style.overflow = 'hidden';
    overlay!.querySelector<HTMLButtonElement>('.lightbox-close')?.focus({ preventScroll: true });
  });
}
