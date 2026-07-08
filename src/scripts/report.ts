// Canvas-drawn "expedition report" share card — the thing you paste in the
// group chat. 1080×1080, field-manual styling, drawn from the progress store.

import { load, totalDeaths } from './progress';

interface Row {
  id: string;
  part: number | null;
}

export interface ReportData {
  main: Row[];
  secret: Row[];
  siteUrl: string;
}

const C = {
  dark: '#14120c',
  dark2: '#1e1b12',
  paper: '#e8e2ce',
  paperDim: 'rgba(232,226,206,0.72)',
  wall: '#b8a248',
  wallBright: '#d8c25e',
  safe: '#6fa06f',
  hazard: '#e0563c',
  line: 'rgba(232,226,206,0.25)',
};

const mono = (weight: number, size: number) =>
  `${weight} ${size}px "IBM Plex Mono", Menlo, monospace`;

export async function drawReport(data: ReportData): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  const store = load();
  const doneMain = data.main.filter((l) => store.levels[l.id]?.done);
  const doneSecret = data.secret.filter((l) => store.levels[l.id]?.done);
  const deaths = totalDeaths();

  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;

  // wall + frame
  ctx.fillStyle = C.dark;
  ctx.fillRect(0, 0, 1080, 1080);
  ctx.fillStyle = C.wall;
  ctx.fillRect(0, 0, 1080, 16);
  ctx.fillRect(0, 1064, 1080, 16);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 56, 1000, 968);

  ctx.textAlign = 'center';
  ctx.fillStyle = C.wallBright;
  ctx.font = mono(600, 46);
  ctx.fillText('BACKROOMS FIELD MANUAL', 540, 140);
  ctx.fillStyle = C.paperDim;
  ctx.font = mono(400, 30);
  ctx.fillText('· EXPEDITION REPORT ·', 540, 188);

  // headline count
  ctx.fillStyle = C.paper;
  ctx.font = mono(600, 170);
  ctx.fillText(`${doneMain.length} / ${data.main.length}`, 540, 400);
  ctx.font = mono(600, 34);
  ctx.fillStyle = C.paperDim;
  ctx.fillText('MAIN ROUTE LEVELS CLEARED', 540, 456);

  // route dots: main path 9 per row
  const cols = 9;
  const startY = 540;
  const gap = 92;
  const startX = 540 - ((cols - 1) * gap) / 2;
  data.main.forEach((l, i) => {
    const x = startX + (i % cols) * gap;
    const y = startY + Math.floor(i / cols) * 78;
    const done = Boolean(store.levels[l.id]?.done);
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    if (done) {
      ctx.fillStyle = C.safe;
      ctx.fill();
      ctx.strokeStyle = C.dark;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x - 9, y + 1);
      ctx.lineTo(x - 2, y + 8);
      ctx.lineTo(x + 10, y - 7);
      ctx.stroke();
    } else {
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  });

  // stats row
  ctx.font = mono(600, 34);
  ctx.fillStyle = C.wallBright;
  ctx.fillText(`${doneSecret.length}/${data.secret.length} SECRET FILES`, 300, 860);
  ctx.fillStyle = deaths > 0 ? C.hazard : C.paperDim;
  ctx.fillText(`${deaths} DEATHS`, 760, 860);
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(540, 828);
  ctx.lineTo(540, 872);
  ctx.stroke();

  // footer
  ctx.fillStyle = C.paperDim;
  ctx.font = mono(400, 26);
  const date = new Date().toISOString().slice(0, 10);
  ctx.fillText(`${data.siteUrl}  ·  FILED ${date}`, 540, 975);

  return canvas;
}
