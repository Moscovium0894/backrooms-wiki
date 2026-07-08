// Client-side fuzzy search: hand-rolled subsequence scorer over a small
// build-time index, presented in a full-screen overlay.

interface SearchRecord {
  t: string;
  s: string;
  u: string;
  k: 'level' | 'entity' | 'item' | 'guide';
  a?: string;
}

const RECENT_KEY = 'etb.recent';

function recentQueries(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

function rememberQuery(q: string): void {
  const trimmed = q.trim();
  if (trimmed.length < 2) return;
  const next = [trimmed, ...recentQueries().filter((r) => r !== trimmed)].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
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
  const q = query.trim().toLowerCase();
  const numeric = /^[\d.!~]+$/.test(q);
  return recs
    .map((r) => {
      const st = score(query, r.t);
      const sa = r.a ? score(query, r.a) : -1;
      const ss = score(query, r.s);
      let sc = Math.max(st, sa, ss > 0 ? ss - 25 : -1);
      // level-code queries like "37.2" pin the exact level to the top
      if (numeric && sc > 0) {
        const tokens = r.t.toLowerCase().split(/[\s—-]+/);
        if (tokens.includes(q)) sc += 80;
        else if (tokens.some((tok) => tok.startsWith(q))) sc += 30;
      }
      return { r, sc };
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
    const recent = recentQueries();
    resultsEl.innerHTML = recent.length
      ? '<p class="search-hint">RECENT SEARCHES</p>' +
        recent
          .map(
            (r) =>
              `<button type="button" class="search-hit search-recent" data-recent="${esc(r)}">
                <span class="hit-kind">↻</span>
                <span class="hit-title">${esc(r)}</span>
              </button>`,
          )
          .join('')
      : '<p class="search-hint">TYPE TO SEARCH THE MANUAL</p>';
    return;
  }
  if (!results.length) {
    resultsEl.innerHTML = '<p class="search-hint">NO FILES MATCH</p>';
    return;
  }
  resultsEl.innerHTML = results
    .map(
      (r, i) => `
      <a class="search-hit" href="${BASE}${r.u}" role="option" data-hit="${i}">
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

  // recent-search rows re-run the query; real hits remember it
  resultsEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const recent = target.closest<HTMLElement>('[data-recent]');
    if (recent) {
      input.value = recent.dataset.recent ?? '';
      input.focus();
      void ensureIndex(resultsEl).then((recs) =>
        render(search(input.value, recs), resultsEl, input.value),
      );
      return;
    }
    if (target.closest('.search-hit')) rememberQuery(input.value);
  });

  // keyboard: arrows move the selection, Enter opens it
  const moveSelection = (dir: 1 | -1) => {
    const hits = [...resultsEl.querySelectorAll<HTMLAnchorElement>('a.search-hit')];
    if (!hits.length) return;
    const cur = hits.findIndex((h) => h.classList.contains('selected'));
    const next = Math.min(hits.length - 1, Math.max(0, cur + dir));
    hits.forEach((h, i) => h.classList.toggle('selected', i === next));
    hits[next]!.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === 'Enter') {
      const sel = resultsEl.querySelector<HTMLAnchorElement>('a.search-hit.selected')
        ?? resultsEl.querySelector<HTMLAnchorElement>('a.search-hit');
      if (sel) {
        rememberQuery(input.value);
        window.location.href = sel.href;
      }
    }
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
