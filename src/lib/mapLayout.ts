// Build-time layout for the vertical route map: main path down lane 0,
// secret levels branching to side lanes beside their parent row, subway-style
// orthogonal elbows, and divider rules at the game's two endings.

import type { Level } from '../types';
import { mainPath, secretLevels } from './data';

export const ROW_H = 96;
export const TOP_PAD = 44;
export const VIEW_W = 390;
const LANE_X = [64, 246, 330];
const NODE_R = 17;

export interface MapNode {
  id: string;
  name: string;
  subtitle: string | null;
  code: string; // short label inside the circle
  difficultyLabel: string;
  kind: 'main' | 'secret';
  x: number;
  y: number;
  order: number | null;
  parentId?: string;
}

export interface MapEdge {
  d: string;
  kind: 'spine' | 'branch' | 'return';
}

export interface MapDivider {
  y: number;
  label: string;
}

export interface MapLayout {
  width: number;
  height: number;
  nodes: MapNode[];
  edges: MapEdge[];
  dividers: MapDivider[];
  detached: Level[]; // secrets we couldn't attach to the spine
}

const CODE_OVERRIDES: Record<string, string> = {
  'the-hub': 'HUB',
  'the-end': 'END',
  'the-snackrooms': 'SNK',
  'the-bunker': 'BKR',
  'the-grassrooms': 'GRS',
  overgrowth: 'OVG',
  'level-9223372036854775807': '∞',
  'level-you-cheated': '!?',
};

function shortCode(l: Level): string {
  const o = CODE_OVERRIDES[l.id];
  if (o) return o;
  const stripped = l.name.replace(/^Level\s+/i, '').trim();
  if (stripped.length <= 4) return stripped.toUpperCase();
  return stripped.slice(0, 3).toUpperCase();
}

// dividers under the levels that end a story arc
const ENDING_AFTER: Record<string, string> = {
  'the-end': 'ENDING REACHED — THE END',
  'level-3999': 'TRUE ENDING — ESCAPED?',
};

export function buildMapLayout(): MapLayout {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const dividers: MapDivider[] = [];
  const detached: Level[] = [];

  // extra vertical room is inserted after rows that host a divider
  let y = TOP_PAD;
  const rowY = new Map<string, number>();
  mainPath.forEach((l, i) => {
    nodes.push({
      id: l.id,
      name: l.name,
      subtitle: l.subtitle,
      code: shortCode(l),
      difficultyLabel: l.difficultyLabel,
      kind: 'main',
      x: LANE_X[0]!,
      y,
      order: i,
    });
    rowY.set(l.id, y);
    const ending = ENDING_AFTER[l.id];
    if (ending) {
      dividers.push({ y: y + ROW_H * 0.62, label: ending });
      y += ROW_H * 1.35;
    } else {
      y += ROW_H;
    }
  });

  // spine: one straight line through lane 0
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (first && last) {
    edges.push({
      d: `M ${LANE_X[0]} ${first.y + NODE_R} L ${LANE_X[0]} ${last.y - NODE_R}`,
      kind: 'spine',
    });
  }

  // secret branches; chained secrets (secret -> secret) attach to the placed
  // parent one lane further out, so we resolve in passes
  const laneUsed: Record<number, number[]> = { 1: [], 2: [] };
  const placed = new Map<string, { y: number; lane: number; x: number }>();
  const queue = [...secretLevels];
  let progressed = true;
  while (progressed && queue.length) {
    progressed = false;
    for (let qi = queue.length - 1; qi >= 0; qi--) {
      const s = queue[qi]!;
      const parentId = s.secretParentId ?? s.entrances[0] ?? null;
      if (!parentId) continue;
      const mainY = rowY.get(parentId);
      const parentSecret = placed.get(parentId);
      if (mainY === undefined && !parentSecret) continue;

      const py = mainY ?? parentSecret!.y;
      const minLane = parentSecret ? parentSecret.lane + 1 : 1;
      const sy = py + ROW_H * 0.5;
      let lane = minLane;
      while (lane <= 2 && laneUsed[lane]!.some((used) => Math.abs(used - sy) < ROW_H)) {
        lane++;
      }
      if (lane > 2) continue;
      laneUsed[lane]!.push(sy);
      queue.splice(qi, 1);
      progressed = true;

      const sx = LANE_X[lane]!;
      const px = parentSecret ? parentSecret.x : LANE_X[0]!;
      placed.set(s.id, { y: sy, lane, x: sx });

      nodes.push({
        id: s.id,
        name: s.name,
        subtitle: s.subtitle,
        code: shortCode(s),
        difficultyLabel: s.difficultyLabel,
        kind: 'secret',
        x: sx,
        y: sy,
        order: null,
        parentId,
      });

      // parent -> secret elbow (down, corner, across)
      edges.push({
        d: `M ${px} ${py + NODE_R} L ${px} ${sy - 14} Q ${px} ${sy} ${px + 14} ${sy} L ${sx - NODE_R - 3} ${sy}`,
        kind: 'branch',
      });

      // return edge if the secret exits back onto the spine
      const back = s.exits.find((x) => rowY.has(x) && x !== parentId);
      if (back) {
        const by = rowY.get(back)!;
        const midX = px + (sx - px) * 0.55;
        edges.push({
          d: `M ${sx - NODE_R - 3} ${sy + 10} L ${midX} ${sy + 10} Q ${midX - 14} ${sy + 10} ${midX - 14} ${sy + 24} L ${midX - 14} ${by - 14} Q ${midX - 14} ${by} ${midX - 28} ${by} L ${px + NODE_R + 3} ${by}`,
          kind: 'return',
        });
      }
    }
  }
  detached.push(...queue);

  const maxY = Math.max(y, ...nodes.map((n) => n.y + ROW_H * 0.6));

  return {
    width: VIEW_W,
    height: maxY + 30,
    nodes,
    edges,
    dividers,
    detached,
  };
}
