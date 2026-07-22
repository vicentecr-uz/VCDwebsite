/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_TEASER_PASSWORD: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
