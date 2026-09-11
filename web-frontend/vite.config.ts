import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import path from 'path';
import { readFileSync, writeFileSync } from 'fs';

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';
  const buildHash = process.env.GITHUB_SHA?.slice(0, 7) || Date.now().toString(36);

  return {
    // 核心外掛鏈：只保留 react 和 wasm，完全不要 topLevelAwait
    plugins: [
      react(),
      wasm(),
      {
        name: 'inject-sw-version',
        apply: 'build',
        closeBundle() {
          const swPath = path.resolve(__dirname, 'dist/sw.js');
          try {
            const content = readFileSync(swPath, 'utf-8').replaceAll('__BUILD_HASH__', buildHash);
            writeFileSync(swPath, content);
            console.info(`[vite] Successfully injected SW version hash: ${buildHash}`);
          } catch (e) {
            console.warn('[vite] SW version injection skipped or failed:', e);
          }
        },
      },
    ],

    base: './',

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },

    define: {
      __BUILD_HASH__: JSON.stringify(buildHash),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },

    server: {
      port: 3000,
      host: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },

    preview: {
      port: 4173,
      host: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },

    build: {
      target: 'es2022', // 原生支援 Top-level await
      outDir: 'dist',
      assetsDir: 'assets',
      cssCodeSplit: true,
      sourcemap: !isProd,
      chunkSizeWarningLimit: 1500,

      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'vendor-react';
            }
            if (/[\\/]src[\\/]generated[\\/]/.test(id)) {
              return 'puzzle-catalog-data';
            }
            if (/[\\/]src[\\/]engines[\\/]/.test(id)) {
              return 'puzzle-engines-core';
            }
            if (id.includes('node_modules')) {
              return 'vendor-libs';
            }
          },

          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
        },
      },

      minify: 'esbuild',
    },

    esbuild: {
      pure: isProd ? ['console.log', 'console.debug', 'console.trace'] : [],
      drop: isProd ? ['debugger'] : [],
    },

    worker: {
      format: 'es',
      plugins: () => [wasm()],
    },
  };
});
