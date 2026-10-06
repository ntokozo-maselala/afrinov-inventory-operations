/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FRONTEND_ONLY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}