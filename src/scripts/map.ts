// Route-map behaviour: progress states, the "you are here" marker, node ->
// bottom-sheet preview, and arrow-key navigation along the spine.

import { isDone, load, setDone, subscribe } from './progress';
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
}

interface MapData {
  sheet: Record<string, SheetInfo>;
  mainIds: string[];
}

export function initMap(): void {
  const dataEl = document.getElementById('map-data');
  if (!dataEl) return;
  const data = JSON.parse(dataEl.textContent ?? '{}') as MapData;
  const nodes = [...document.querySelectorAll<SVGGElement>('[data-map-node]')];
  const byId = new Map(nodes.map((n) => [n.dataset.mapNode!, n]));
  const sheet = createSheet();

  const paint = () => {
    const store = load();
    let here: string | null = null;
    for (const id of data.mainIds) {
      if (!store.levels[id]?.done) {
        here = id;
        break;
      }
    }
    for (const node of nodes) {
      const id = node.dataset.mapNode!;
      node.classList.toggle('is-done', Boolean(store.levels[id]?.done));
      node.classList.toggle('is-here', id === here);
    }
  };

  paint();
  subscribe(paint);

  // centre "you are here" on first paint
  const here = document.querySelector('.map-node.is-here');
  here?.scrollIntoView({ block: 'center' });

  const openSheet = (id: string) => {
    const info = data.sheet[id];
    if (!info || !sheet) return;
    sheet.open((el) => {
      const thumb = el.querySelector<HTMLImageElement>('#sheet-thumb')!;
      if (info.thumb) {
        thumb.src = info.thumb;
        thumb.hidden = false;
      } else {
        thumb.hidden = true;
      }
      el.querySelector('#sheet-kind')!.textContent =
        info.kind === 'secret' ? 'SECRET LEVEL FILE' : 'LEVEL FILE';
      el.querySelector('#sheet-title')!.textContent = info.subtitle
        ? `${info.name} — ${info.subtitle}`
        : info.name;
      el.querySelector('#sheet-summary')!.textContent = info.summary;
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
    node.addEventListener('click', () => openSheet(node.dataset.mapNode!));
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
