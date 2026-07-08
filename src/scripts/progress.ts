// The shared client-side store: level completion, checklists, spoiler mode.
// localStorage-backed, versioned, broadcast via a CustomEvent so the map,
// cards, checklist ring, and /progress page all live-update together.

export interface LevelProgress {
  done: boolean;
  checks: string[];
  completedAt?: string;
}

export interface Store {
  version: 1;
  spoilers: 'light' | 'full';
  levels: Record<string, LevelProgress>;
  seen?: string[]; // level ids whose file has been opened (secret discovery)
  notes?: Record<string, string>; // per-level field notes
  deaths?: Record<string, number>; // per-level death tally
  sighted?: string[]; // entity ids marked as encountered (bestiary)
}

const KEY = 'etb.v1';
const KEY_BAK = 'etb.v1.bak'; // last-known-good copy, used if the main key corrupts
const EVENT = 'etb:progress';

function fresh(): Store {
  return { version: 1, spoilers: 'light', levels: {} };
}

function parseStore(raw: string | null): Partial<Store> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (parsed.version !== 1 || typeof parsed.levels !== 'object' || !parsed.levels) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function load(): Store {
  try {
    let parsed = parseStore(localStorage.getItem(KEY));
    if (!parsed) {
      parsed = parseStore(localStorage.getItem(KEY_BAK));
      if (parsed) console.warn('[etb] main record corrupt — restored from backup');
    }
    if (!parsed) return fresh();
    return {
      version: 1,
      spoilers: parsed.spoilers === 'full' ? 'full' : 'light',
      levels: parsed.levels as Record<string, LevelProgress>,
      seen: Array.isArray(parsed.seen) ? parsed.seen.filter((s) => typeof s === 'string') : [],
      notes: typeof parsed.notes === 'object' && parsed.notes ? parsed.notes : {},
      deaths: typeof parsed.deaths === 'object' && parsed.deaths ? parsed.deaths : {},
      sighted: Array.isArray(parsed.sighted)
        ? parsed.sighted.filter((s) => typeof s === 'string')
        : [],
    };
  } catch {
    console.warn('[etb] progress store unreadable, starting fresh');
    return fresh();
  }
}

export function save(store: Store): void {
  try {
    const json = JSON.stringify(store);
    localStorage.setItem(KEY, json);
    localStorage.setItem(KEY_BAK, json);
  } catch {
    /* private mode / quota: state stays in-memory for the session */
  }
  document.dispatchEvent(new CustomEvent(EVENT));
}

/** Ask the browser to protect our storage from eviction (best effort). */
export function requestPersistence(): void {
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {
    /* unsupported */
  }
}

export function subscribe(fn: () => void): void {
  document.addEventListener(EVENT, fn);
}

export function levelState(id: string): LevelProgress {
  return load().levels[id] ?? { done: false, checks: [] };
}

export function isDone(id: string): boolean {
  return levelState(id).done;
}

export function setChecks(id: string, checks: string[], total: number): void {
  const store = load();
  const prev = store.levels[id] ?? { done: false, checks: [] };
  const done = total > 0 && checks.length >= total;
  store.levels[id] = {
    done,
    checks,
    completedAt: done ? (prev.completedAt ?? new Date().toISOString()) : undefined,
  };
  save(store);
}

export function setDone(id: string, done: boolean, allChecks: string[] = []): void {
  const store = load();
  const prev = store.levels[id] ?? { done: false, checks: [] };
  store.levels[id] = {
    done,
    checks: done ? (allChecks.length ? allChecks : prev.checks) : [],
    completedAt: done ? (prev.completedAt ?? new Date().toISOString()) : undefined,
  };
  save(store);
}

export function completedCount(ids: string[]): number {
  const store = load();
  return ids.filter((id) => store.levels[id]?.done).length;
}

export function markSeen(id: string): void {
  const store = load();
  const seen = store.seen ?? [];
  if (seen.includes(id)) return;
  store.seen = [...seen, id];
  save(store);
}

export function isSeen(id: string): boolean {
  return (load().seen ?? []).includes(id);
}

export function getNote(id: string): string {
  return (load().notes ?? {})[id] ?? '';
}

export function setNote(id: string, text: string): void {
  const store = load();
  store.notes = { ...(store.notes ?? {}) };
  if (text.trim()) store.notes[id] = text;
  else delete store.notes[id];
  save(store);
}

export function getDeaths(id: string): number {
  return (load().deaths ?? {})[id] ?? 0;
}

export function setDeaths(id: string, n: number): void {
  const store = load();
  store.deaths = { ...(store.deaths ?? {}) };
  if (n > 0) store.deaths[id] = n;
  else delete store.deaths[id];
  save(store);
}

export function totalDeaths(): number {
  return Object.values(load().deaths ?? {}).reduce((a, b) => a + b, 0);
}

export function isSighted(id: string): boolean {
  return (load().sighted ?? []).includes(id);
}

export function toggleSighted(id: string): void {
  const store = load();
  const set = new Set(store.sighted ?? []);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  store.sighted = [...set];
  save(store);
}

export function sightedCount(): number {
  return (load().sighted ?? []).length;
}

export function setSpoilers(mode: 'light' | 'full'): void {
  const store = load();
  store.spoilers = mode;
  document.documentElement.dataset.spoilers = mode;
  save(store);
}

export function replaceStore(next: Store): void {
  save(next);
  document.documentElement.dataset.spoilers = next.spoilers;
}
