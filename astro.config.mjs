// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // TODO: Re-enable Astro dev toolbar after investigating dev-mode layout jump.
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
    server: {
      watch: {
        ignored: ['**/ROADMAP.md']
      }
    }
  }
});