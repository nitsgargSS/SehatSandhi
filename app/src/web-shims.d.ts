// The website's shared files are type-checked from here too. Its own
// src/lib/env.ts (never bundled into the app — metro.config.js redirects it)
// reads Vite's import.meta.env, so give TypeScript that shape.
interface ImportMeta { env: Record<string, string | undefined> }
