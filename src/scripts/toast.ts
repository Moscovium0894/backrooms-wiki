// Tiny toast system: offline indicator + service-worker update prompt.

let el: HTMLElement | null = null;
let timer = 0;

export function showToast(msg: string, opts: { sticky?: boolean; onTap?: () => void } = {}): void {
  if (!el) {
    el = document.createElement('button');
    el.type = 'button';
    el.className = 'toast';
    el.addEventListener('click', () => {
      const fn = (el as any)._onTap as (() => void) | undefined;
      if (fn) fn();
      hideToast();
    });
    document.body.appendChild(el);
  }
  (el as any)._onTap = opts.onTap;
  el.textContent = msg;
  el.classList.add('toast--show');
  window.clearTimeout(timer);
  if (!opts.sticky) {
    timer = window.setTimeout(hideToast, 4000);
  }
}

export function hideToast(): void {
  el?.classList.remove('toast--show');
}

export function initConnectivityToasts(): void {
  window.addEventListener('offline', () =>
    showToast('OFFLINE — SERVING CACHED FILES', { sticky: true }),
  );
  window.addEventListener('online', hideToast);
  if (!navigator.onLine) showToast('OFFLINE — SERVING CACHED FILES', { sticky: true });
}

export function watchServiceWorkerUpdate(reg: ServiceWorkerRegistration): void {
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    sw?.addEventListener('statechange', () => {
      if (sw.state === 'installed' && navigator.serviceWorker.controller) {
        showToast('NEW EDITION FILED — TAP TO RELOAD', {
          sticky: true,
          onTap: () => window.location.reload(),
        });
      }
    });
  });
}
