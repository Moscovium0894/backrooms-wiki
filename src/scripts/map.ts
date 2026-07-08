// Route-map behaviour: progress states, the "you are here" marker, node ->
// bottom-sheet preview, and arrow-key navigation along the spine.

import { isDone, isSeen, load, setDone, subscribe } from './progress';
import { createSheet } from './sheet';

interface SheetInfo {
  name: string;
  subtitle: string | null;
  difficultyLabel: string;
  summary: string;
  href: string;
  thumb: string | null;
  kind: 'main' | 'secret';
  parentId: string | null;
  x: number;
  y: number;
}

interface MapData {
  sheet: Record<string, SheetInfo>;
  mainIds: string[];
  spineX: number;
}

const NODE_R = 17;

export function initMap(): void {
  const dataEl = document.getElementById('map-data');
  if (!dataEl) return;
  const data = JSON.parse(dataEl.textContent ?? '{}') as MapData;
  const nodes = [...document.querySelectorAll<SVGGElement>('[data-map-node]')];
  const byId = new Map(nodes.map((n) => [n.dataset.mapNode!, n]));
  const sheet = createSheet();

  const progressPath = document.querySelector<SVGPathElement>('[data-spine-progress]');
  const objectivePath = document.querySelector<SVGPathElement>('[data-spine-objective]');

  const paint = () => {
    const store = load();
    const spoilersLight = document.documentElement.dataset.spoilers !== 'full';
    let here: string | null = null;
    for (const id of data.mainIds) {
      if (!store.levels[id]?.done) {
        here = id;
        break;
      }
    }
    for (const node of nodes) {
      const id = node.dataset.mapNode!;
      const info = data.sheet[id];
      node.classList.toggle('is-done', Boolean(store.levels[id]?.done));
      node.classList.toggle('is-here', id === here);
      // secrets stay UNIDENTIFIED in redacted mode until their file is opened
      const mystery =
        info?.kind === 'secret' && spoilersLight && !isSeen(id) && !store.levels[id]?.done;
      node.classList.toggle('is-unknown', Boolean(mystery));
    }

    // paint the traveled spine green up to "you are here" and run marching
    // ants on the current leg
    const x = data.spineX;
    const firstY = data.sheet[data.mainIds[0]!]?.y ?? 0;
    const hereIdx = here ? data.mainIds.indexOf(here) : data.mainIds.length;
    const hereY = here
      ? data.sheet[here]!.y
      : data.sheet[data.mainIds[data.mainIds.length - 1]!]?.y ?? firstY;
    if (progressPath) {
      progressPath.setAttribute(
        'd',
        hereY - NODE_R > firstY + NODE_R
          ? `M ${x} ${firstY + NODE_R} L ${x} ${hereY - NODE_R}`
          : '',
      );
    }
    if (objectivePath) {
      const prevId = hereIdx > 0 ? data.mainIds[hereIdx - 1] : null;
      const prevY = prevId ? data.sheet[prevId]!.y : null;
      objectivePath.setAttribute(
        'd',
        here && prevY !== null ? `M ${x} ${prevY + NODE_R} L ${x} ${hereY - NODE_R}` : '',
      );
    }
  };

  paint();
  subscribe(paint);

  // CONTINUE pill: shown when the you-are-here marker leaves the viewport
  const pill = document.getElementById('map-continue');
  if (pill) {
    let hereEl: Element | null = null;
    const watch = new IntersectionObserver(([entry]) => {
      const off = entry && !entry.isIntersecting;
      pill.hidden = !off;
      if (off && hereEl) {
        const above = hereEl.getBoundingClientRect().top < 0;
        pill.textContent = above ? 'CONTINUE ↑' : 'CONTINUE ↓';
      }
    });
    const rewatch = () => {
      watch.disconnect();
      hereEl = document.querySelector('.map-node.is-here');
      if (hereEl) watch.observe(hereEl);
      else pill.hidden = true;
    };
    rewatch();
    subscribe(rewatch);
    pill.addEventListener('click', () => {
      hereEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  // centre "you are here" on first paint
  const here = document.querySelector('.map-node.is-here');
  here?.scrollIntoView({ block: 'center' });

  const openSheet = (id: string) => {
    const info = data.sheet[id];
    if (!info || !sheet) return;
    const mystery = byId.get(id)?.classList.contains('is-unknown') ?? false;
    sheet.open((el) => {
      const thumb = el.querySelector<HTMLImageElement>('#sheet-thumb')!;
      if (info.thumb && !mystery) {
        thumb.src = info.thumb;
        thumb.hidden = false;
      } else {
        thumb.hidden = true;
      }
      el.querySelector('#sheet-kind')!.textContent =
        info.kind === 'secret' ? 'SECRET LEVEL FILE' : 'LEVEL FILE';
      el.querySelector('#sheet-title')!.textContent = mystery
        ? 'UNIDENTIFIED'
        : info.subtitle
          ? `${info.name} — ${info.subtitle}`
          : info.name;
      el.querySelector('#sheet-summary')!.textContent = mystery
        ? 'An unconfirmed branch off the main route. Open the file to identify it — or find the entrance in the field.'
        : info.summary;
      const badge = el.querySelector<HTMLElement>('#sheet-badge')!;
      badge.textContent = info.difficultyLabel;
      el.querySelector<HTMLAnchorElement>('#sheet-open')!.href = info.href;
      const doneBtn = el.querySelector<HTMLButtonElement>('#sheet-done')!;
      const syncDone = () => {
        doneBtn.textContent = isDone(id) ? 'Reopen file' : 'Mark cleared';
      };
      doneBtn.onclick = () => {
        setDone(id, !isDone(id));
        syncDone();
      };
      syncDone();
    });
  };

  for (const node of nodes) {
    // long-press toggles cleared directly (with the node's own stamp pop)
    let pressTimer = 0;
    let longPressed = false;
    node.addEventListener('pointerdown', () => {
      longPressed = false;
      pressTimer = window.setTimeout(() => {
        longPressed = true;
        const id = node.dataset.mapNode!;
        setDone(id, !isDone(id));
        node.classList.add('node-pop');
        window.setTimeout(() => node.classList.remove('node-pop'), 350);
      }, 480);
    });
    const cancelPress = () => window.clearTimeout(pressTimer);
    node.addEventListener('pointerup', cancelPress);
    node.addEventListener('pointerleave', cancelPress);
    node.addEventListener('pointercancel', cancelPress);
    node.addEventListener('contextmenu', (e) => e.preventDefault());

    node.addEventListener('click', () => {
      if (longPressed) return;
      openSheet(node.dataset.mapNode!);
    });
    node.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      const id = node.dataset.mapNode!;
      if (ke.key === 'Enter' || ke.key === ' ') {
        ke.preventDefault();
        openSheet(id);
        return;
      }
      const idx = data.mainIds.indexOf(id);
      if (ke.key === 'ArrowDown' && idx !== -1 && idx < data.mainIds.length - 1) {
        ke.preventDefault();
        focusNode(data.mainIds[idx + 1]!);
      } else if (ke.key === 'ArrowUp' && idx !== -1 && idx > 0) {
        ke.preventDefault();
        focusNode(data.mainIds[idx - 1]!);
      } else if (ke.key === 'ArrowRight' && idx !== -1) {
        // into an attached branch, if any
        const branch = Object.entries(data.sheet).find(
          ([, v]) => v.kind === 'secret' && v.parentId === id,
        );
        if (branch) {
          ke.preventDefault();
          focusNode(branch[0]);
        }
      } else if (ke.key === 'ArrowLeft') {
        const info = data.sheet[id];
        if (info?.kind === 'secret' && info.parentId) {
          ke.preventDefault();
          focusNode(info.parentId);
        }
      }
    });
  }

  function focusNode(id: string): void {
    const n = byId.get(id);
    if (n) {
      n.focus();
      n.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}
