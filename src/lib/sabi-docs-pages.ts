import type { PageDocumentKey } from './projects';

export const sabiDocsPages: ReadonlyArray<{
  slug: string;
  key: PageDocumentKey;
  label: string;
  group: string;
  optional?: boolean;
}> = [
  { slug: 'introduction', key: 'sabi-getting-started', label: 'Introduction', group: 'Basics' },
  { slug: 'installation', key: 'sabi-installation', label: 'Installation', group: 'Basics', optional: true },
  { slug: 'web-components', key: 'sabi-web-components', label: 'Web Components', group: 'Framework Guides', optional: true },
  { slug: 'react-nextjs', key: 'sabi-react-nextjs', label: 'React and Next.js', group: 'Framework Guides', optional: true },
  { slug: 'vue-nuxt', key: 'sabi-vue-nuxt', label: 'Vue and Nuxt', group: 'Framework Guides', optional: true },
  { slug: 'svelte-sveltekit', key: 'sabi-svelte-sveltekit', label: 'Svelte and SvelteKit', group: 'Framework Guides', optional: true },
  { slug: 'astro', key: 'sabi-astro', label: 'Astro', group: 'Framework Guides', optional: true },
  { slug: 'api', key: 'sabi-api', label: 'Reference', group: 'Guides' },
  { slug: 'email-and-number-fields', key: 'sabi-email-and-number-fields', label: 'Email and number fields', group: 'Guides' },
  { slug: 'styling', key: 'sabi-styling', label: 'Styling', group: 'Guides' },
];
