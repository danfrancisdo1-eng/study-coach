import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

// PORT and BASE_PATH are needed to run the dev server or preview. A production build
// (Render, D-300) uses neither: the server serves the app at the site root.
const isBuild = process.argv.includes('build');
const rawPort = process.env.PORT;

if (!rawPort && !isBuild) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort ?? 0);

if (!isBuild && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? (isBuild ? '/' : undefined);

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

// D-302: the phone's platform-free logic files (artifacts/study-coach-mobile/lib), read in place.
const phoneLib = path.resolve(import.meta.dirname, '..', 'study-coach-mobile', 'lib');
const phoneLibPattern = new RegExp(`^${(phoneLib + path.sep).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^?]*\\.ts$`);
const isPhoneLib = (id: string) => phoneLibPattern.test(id);

// Vite would read the phone folder's tsconfig.json for these files, and it extends
// expo/tsconfig.base, which the web/server image does not install. The files are plain
// TypeScript, so they are compiled here with fixed settings instead (vite:esbuild skips them).
function phoneLibTypeScript(): Plugin {
  return {
    name: 'study-coach:phone-lib',
    async transform(code, id) {
      if (!isPhoneLib(id)) return null;
      return transformWithEsbuild(code, id, { loader: 'ts', tsconfigRaw: '{"compilerOptions":{"verbatimModuleSyntax":false}}' });
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    phoneLibTypeScript(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  esbuild: {
    // Vite's defaults (TypeScript and JSX, not .js), minus the phone's logic files (see above).
    include: /\.(m?ts|[jt]sx)$/,
    exclude: [/\.js$/, phoneLibPattern],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // D-302: platform-free logic shared with the phone app, read in place (never edited from here).
      '@phone-lib': phoneLib,
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    // D-301: one copy of react-query. lib/api-client-react otherwise gets the copy pnpm links
    // for the phone's newer React, and its hooks then find no QueryClient ("No QueryClient set").
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
