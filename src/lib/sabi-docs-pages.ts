import type { PageDocumentKey } from './projects';

export const sabiDocsPages: ReadonlyArray<{
  slug: string;
  key: PageDocumentKey;
  label: string;
  group: string;
  optional?: boolean;
}> = [
  { slug: 'getting-started', key: 'sabi-getting-started', label: 'Introduction', group: 'Basics' },
  { slug: 'installation', key: 'sabi-installation', label: 'Installation', group: 'Basics', optional: true },
  { slug: 'web-components', key: 'sabi-web-components', label: 'Web Components', group: 'Framework Guides', optional: true },
  { slug: 'react-nextjs', key: 'sabi-react-nextjs', label: 'React and Next.js', group: 'Framework Guides', optional: true },
  { slug: 'api', key: 'sabi-api', label: 'Sabi', group: 'API' },
  { slug: 'email-and-number-fields', key: 'sabi-email-and-number-fields', label: 'Email and number fields', group: 'Guides' },
  { slug: 'styling', key: 'sabi-styling', label: 'Styling', group: 'Guides' },
];
