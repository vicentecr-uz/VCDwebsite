/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly VIEW_ID: string;
  readonly PUBLIC_TEASER_PASSWORD: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
