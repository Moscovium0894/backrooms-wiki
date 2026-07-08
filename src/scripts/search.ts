// Client-side fuzzy search: hand-rolled subsequence scorer over a small
// build-time index, presented in a full-screen overlay.

interface SearchRecord {
  t: string;
  s: string;
  u: string;
  k: 'level' | 'entity' | 'item' | 'guide';
}

const KIND_LABEL: Record<string, string> = {
  level: 'LEVEL FILE',
  entity: 'ENTITY',
  item: 'ITEM',
  guide: 'GUIDE',
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/';

let index: SearchRecord[] | null = null;
let loading = false;

/** Subsequence match score; higher is better, -1 = no match. */
export function score(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return -1;
  const sub = t.indexOf(q);
  if (sub !== -1) {
    // contiguous substring: strong, better when earlier / at a word boundary
    let s = 100 - Math.min(40, sub);
    if (sub === 0) s += 20;
    else if (/[\s\-—/]/.test(t[sub - 1]!)) s += 10;
    return s;
  }
  let ti = 0;
  let s = 60;
  let lastHit = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
      ti++;
    }
    if (found === -1) return -1;
    if (found === lastHit + 1) s += 2; // consecutive
    else s -= Math.min(6, found - lastHit); // gaps cost
    if (found === 0 || /[\s\-—/]/.test(t[found - 1]!)) s += 3; // word boundary
    lastHit = found;
    ti = found + 1;
  }
  return Math.max(1, s);
}

function search(query: string, recs: SearchRecord[]): SearchRecord[] {
  return recs
    .map((r) => {
      const st = score(query, r.t);
      const ss = score(query, r.s);
      return { r, sc: Math.max(st, ss > 0 ? ss - 25 : -1) };
    })
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc)
    .slice(0, 20)
    .map((x) => x.r);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function render(results: SearchRecord[], resultsEl: HTMLElement, query: string): void {
  if (!query.trim()) {
    resultsEl.innerHTML = '<p class="search-hint">TYPE TO SEARCH THE MANUAL</p>';
    return;
  }
  if (!results.length) {
    resultsEl.innerHTML = '<p class="search-hint">NO FILES MATCH</p>';
    return;
  }
  resultsEl.innerHTML = results
    .map(
      (r) => `
      <a class="search-hit" href="${BASE}${r.u}" role="option">
        <span class="hit-kind hit-kind--${r.k}">${KIND_LABEL[r.k]}</span>
        <span class="hit-title">${esc(r.t)}</span>
        <span class="hit-sub">${esc(r.s)}</span>
      </a>`,
    )
    .join('');
}

async function ensureIndex(resultsEl: HTMLElement): Promise<SearchRecord[]> {
  if (index) return index;
  if (!loading) {
    loading = true;
    try {
      const res = await fetch(`${BASE}search-index.json`);
      index = (await res.json()) as SearchRecord[];
    } catch {
      resultsEl.innerHTML = '<p class="search-hint">INDEX UNAVAILABLE (OFFLINE?)</p>';
      loading = false;
      return [];
    }
  }
  return index ?? [];
}

export function initSearch(): void {
  const overlay = document.getElementById('search-overlay');
  const input = document.getElementById('search-input') as HTMLInputElement | null;
  const resultsEl = document.getElementById('search-results');
  const openBtn = document.getElementById('tab-search');
  const closeBtn = document.getElementById('search-close');
  if (!overlay || !input || !resultsEl) return;

  let lastFocus: Element | null = null;

  const open = () => {
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    input.focus();
    void ensureIndex(resultsEl).then(() => render(search(input.value, index ?? []), resultsEl, input.value));
  };

  const close = () => {
    overlay.hidden = true;
    document.body.style.overflow = '';
    input.blur();
    if (lastFocus instanceof HTMLElement) lastFocus.focus();
  };

  openBtn?.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);

  input.addEventListener('input', () => {
    void ensureIndex(resultsEl).then((recs) => render(search(input.value, recs), resultsEl, input.value));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && overlay.hidden) {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag !== 'input' && tag !== 'textarea') {
        e.preventDefault();
        open();
      }
    } else if (e.key === 'Escape' && !overlay.hidden) {
      close();
    }
  });
}
