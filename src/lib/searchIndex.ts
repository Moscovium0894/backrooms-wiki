// Build-time search index: compact records for the client-side fuzzy search.

import { entities, guides, items, levels } from './data';

export interface SearchRecord {
  t: string; // title
  s: string; // subtitle / summary head
  u: string; // app-relative url (no base)
  k: 'level' | 'entity' | 'item' | 'guide';
}

function head(text: string, n = 90): string {
  return text.length > n ? text.slice(0, n - 1) + '…' : text;
}

export function buildSearchIndex(): SearchRecord[] {
  const recs: SearchRecord[] = [];
  for (const l of levels) {
    recs.push({
      t: l.subtitle ? `${l.name} — ${l.subtitle}` : l.name,
      s: head(l.summary),
      u: `levels/${l.id}/`,
      k: 'level',
    });
  }
  for (const e of entities) {
    recs.push({ t: e.name, s: head(e.summary), u: `entities/${e.id}/`, k: 'entity' });
  }
  for (const i of items) {
    recs.push({ t: i.name, s: head(i.summary), u: `items/${i.id}/`, k: 'item' });
  }
  for (const g of guides) {
    recs.push({ t: g.title, s: head(g.summary), u: `guides/${g.id}/`, k: 'guide' });
  }
  return recs;
}
