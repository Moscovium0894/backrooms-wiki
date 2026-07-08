// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://moscovium0894.github.io',
  base: '/backrooms-wiki',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
});
