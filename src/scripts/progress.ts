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
}

const KEY = 'etb.v1';
const EVENT = 'etb:progress';

function fresh(): Store {
  return { version: 1, spoilers: 'light', levels: {} };
}

export function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (parsed.version !== 1 || typeof parsed.levels !== 'object' || !parsed.levels) {
      return fresh();
    }
    return {
      version: 1,
      spoilers: parsed.spoilers === 'full' ? 'full' : 'light',
      levels: parsed.levels as Record<string, LevelProgress>,
      seen: Array.isArray(parsed.seen) ? parsed.seen.filter((s) => typeof s === 'string') : [],
    };
  } catch {
    console.warn('[etb] corrupt progress store, resetting');
    return fresh();
  }
}

export function save(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota: state stays in-memory for the session */
  }
  document.dispatchEvent(new CustomEvent(EVENT));
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
