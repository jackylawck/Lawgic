import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import path from 'path';
import { readFileSync, writeFileSync } from 'fs';

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';
  // 單一事實來源：CI/CD 取 Git Commit SHA 前 7 碼，本機開發取當前時間戳 Base36
  const buildHash = process.env.GITHUB_SHA?.slice(0, 7) || Date.now().toString(36);

  return {
    // 1. 核心外掛鏈（移除未安裝的 topLevelAwait 外部依賴，es2022 原生支援）
    plugins: [
      react(),
      wasm(),
      // 機制保證：在 build 完成後自動替換 dist/sw.js 的版本佔位符
      {
        name: 'inject-sw-version',
        apply: 'build', // 僅在生產打包 (vite build) 執行，dev/preview 模式不觸發
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

    // 2. 適配 GitHub Pages 子路徑部署
    base: './',

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },

    // 3. 注入全域編譯版本元數據供前端 React 代碼直讀
    define: {
      __BUILD_HASH__: JSON.stringify(buildHash),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },

    // 4. 本地開發與預覽環境隔離標頭
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

    // 5. 生產級構建與防禦型分包策略
    build: {
      target: 'es2022', // 原生支援 Top-level await，不需要任何額外 plugin
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

    // 6. 配置服從意圖：僅抹除純除錯 trace 與 log，保留 info 追蹤生命週期，保留 warn/error 供故障審計
    esbuild: {
      pure: isProd ? ['console.log', 'console.debug', 'console.trace'] : [],
      drop: isProd ? ['debugger'] : [],
    },

    // 7. Web Worker 與獨立線程原生支援
    worker: {
      format: 'es',
      plugins: () => [wasm()],
    },
  };
});
