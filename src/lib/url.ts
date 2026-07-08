// Base-path handling for GitHub Pages. Every internal href/src goes through
// withBase(); scraped HTML goes through resolveHtml() to swap the #APP#/#IMG#
// placeholders the pipeline emits.

const BASE = (import.meta.env.BASE_URL.replace(/\/$/, '') + '/') as string;

export function withBase(path: string): string {
  return BASE + path.replace(/^\//, '');
}

export function imageUrl(file: string): string {
  return withBase(`images/${file}`);
}

export function resolveHtml(html: string): string {
  return html
    .replaceAll('href="#APP#/', `href="${BASE}`)
    .replaceAll('src="#IMG#/', `src="${BASE}`)
    .replaceAll('<img ', '<img loading="lazy" decoding="async" ');
}
