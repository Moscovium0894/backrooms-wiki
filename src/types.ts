// Content contract between the Python pipeline (src/data/*.json) and the app.

export interface WikiImage {
  file: string; // path under public/images/, e.g. "levels/level-0/hero.png"
  width: number;
  height: number;
  role: 'hero' | 'thumb' | 'map' | 'gallery' | 'body';
  sourceFile: string; // "File:..." title on the wiki, for attribution
  caption?: string;
}

export interface Section {
  title: string | null; // null = lead section
  html: string; // sanitized; #APP#/#IMG# placeholders resolved via resolveHtml()
}

export type LevelKind =
  | 'main'
  | 'secret'
  | 'area'
  | 'joke'
  | 'upcoming'
  | 'nonplayable'
  | 'other';

export interface Level {
  id: string;
  name: string; // "Level 4"
  subtitle: string | null; // "Abandoned Office"
  kind: LevelKind;
  order: number | null; // main-path index, else null
  part: number | null; // major update ("Part N") that added it
  difficulty: number | null; // Class 0-5
  difficultyLabel: string; // "Class 2" | "Habitable" | "Deadzone" | ...
  sanity: string | null;
  hazards: string[];
  entities: string[];
  items: string[];
  exits: string[];
  entrances: string[];
  exitsRaw: string | null;
  secretParentId: string | null;
  summary: string; // plain text, spoiler-light
  leadHtml: string | null;
  appearanceHtml: string | null;
  walkthroughHtml: string | null; // spoiler-gated in the UI
  extraSections: Section[];
  images: WikiImage[];
  sourceUrl: string;
}

export interface Entity {
  id: string;
  name: string;
  dangerLabel: string;
  species: string | null;
  summary: string;
  sections: Section[];
  levels: string[]; // level ids it appears in
  images: WikiImage[];
  sourceUrl: string;
}

export interface Item {
  id: string;
  name: string;
  rarity: string;
  summary: string;
  sections: Section[];
  foundInLevels: string[];
  images: WikiImage[];
  sourceUrl: string;
}

export interface Guide {
  id: string;
  title: string;
  summary: string;
  sections: Section[];
  relatedLevelIds: string[];
  images: WikiImage[];
  sourceUrl: string;
}

export interface DataMeta {
  fetchedAt: string;
  source: string;
  sourceName: string;
  license: string;
  licenseUrl: string;
  counts: Record<string, number>;
}
