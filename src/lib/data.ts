// Typed access to the scraped JSON. Imported at build time only.

import type { DataMeta, Entity, Guide, Item, Level, WikiImage } from '../types';
import levelsJson from '../data/levels.json';
import entitiesJson from '../data/entities.json';
import itemsJson from '../data/items.json';
import guidesJson from '../data/guides.json';
import metaJson from '../data/meta.json';

export const levels = (levelsJson as { items: unknown }).items as Level[];
export const entities = (entitiesJson as { items: unknown }).items as Entity[];
export const items = (itemsJson as { items: unknown }).items as Item[];
export const guides = (guidesJson as { items: unknown }).items as Guide[];
export const meta = metaJson as DataMeta;

export const mainPath: Level[] = levels
  .filter((l) => l.kind === 'main')
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

export const secretLevels: Level[] = levels.filter((l) => l.kind === 'secret');
export const bonusLevels: Level[] = levels.filter(
  (l) => l.kind !== 'main' && l.kind !== 'secret',
);

export const levelById = new Map(levels.map((l) => [l.id, l]));
export const entityById = new Map(entities.map((e) => [e.id, e]));
export const itemById = new Map(items.map((i) => [i.id, i]));
export const guideById = new Map(guides.map((g) => [g.id, g]));

export function prevNext(id: string): { prev: Level | null; next: Level | null } {
  const idx = mainPath.findIndex((l) => l.id === id);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? mainPath[idx - 1]! : null,
    next: idx < mainPath.length - 1 ? mainPath[idx + 1]! : null,
  };
}

export function heroOf(rec: { images: WikiImage[] }): WikiImage | undefined {
  return rec.images.find((i) => i.role === 'hero');
}

export function thumbOf(rec: { images: WikiImage[] }): WikiImage | undefined {
  return rec.images.find((i) => i.role === 'thumb') ?? heroOf(rec);
}

export function mapsOf(rec: { images: WikiImage[] }): WikiImage[] {
  return rec.images.filter((i) => i.role === 'map');
}

/** Full display name, `LEVEL 4 // "ABANDONED OFFICE"` style parts. */
export function caseTitle(l: Level): { code: string; sub: string | null } {
  return { code: l.name, sub: l.subtitle };
}

/** CSS color var for a difficulty label. */
export function difficultyColorVar(label: string): string {
  const m = label.match(/^Class (\d)$/);
  if (m) return `var(--class-${m[1]})`;
  const known = ['variable', 'habitable', 'deadzone', 'unknown'];
  const key = label.toLowerCase();
  return known.includes(key) ? `var(--class-${key})` : 'var(--class-unknown)';
}

const DANGER_COLORS: Record<string, string> = {
  harmless: 'var(--class-0)',
  friendly: 'var(--class-0)',
  'cannot harm you': 'var(--class-0)',
  low: 'var(--class-1)',
  moderate: 'var(--class-3)',
  dangerous: 'var(--class-4)',
  high: 'var(--class-4)',
  deadly: 'var(--class-5)',
  'very deadly': 'var(--class-5)',
  extreme: 'var(--class-5)',
};

export function dangerColorVar(label: string): string {
  return DANGER_COLORS[label.toLowerCase()] ?? 'var(--class-unknown)';
}
