// web-frontend/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import path from 'path';

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    // 1. 核心外掛鏈
    plugins: [
      react(),
      wasm(),
    ],

    base: './',

    // 2. 簡潔路徑別名，杜絕相對路徑深淵
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },

    // 3. 隔離安全環境配置（解鎖 SharedArrayBuffer、高精度計時與 Worker 性能）
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

    // 4. 生產級構建與代碼分塊架構
    build: {
      target: 'esnext',
      outDir: 'dist',
      assetsDir: 'assets',
      cssCodeSplit: true,
      sourcemap: !isProd,
      chunkSizeWarningLimit: 1500, // 放寬大題庫 chunk 的警告邊界

      rollupOptions: {
        output: {
          // 神級拆包策略：將框架、靜態題庫、計算引擎三權分立
          manualChunks(id) {
            // A. 核心 React 基礎設施（更新頻率極低，長期命中 HTTP 快取）
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'vendor-react';
            }
            // B. 靜態大型題庫數據（與業務邏輯分離，避免修改代碼重新下載龐大 JSON）
            if (id.includes('/src/generated/') && id.endsWith('.json')) {
              return 'puzzle-catalog-data';
            }
            // C. 18 款核心求解與推導引擎模組聚集
            if (id.includes('/src/engines/')) {
              return 'puzzle-engines-core';
            }
            // D. 第三方圖表或工具庫（如有）
            if (id.includes('node_modules')) {
              return 'vendor-libs';
            }
          },
          // 結構化目錄輸出，資源指紋乾淨清晰
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
        },
      },

      minify: 'esbuild',
    },

    // 5. 生產環境除錯安全與語法特性
    esbuild: {
      // 生產環境自動抹除日誌輸出，防止賽事指紋或核心推導演算法被 DevTools 逆向
      drop: isProd ? ['console', 'debugger'] : [],
      supported: {
        'top-level-await': true,
      },
    },

    // 6. Web Worker 與獨立推導線程原生支援
    worker: {
      format: 'es',
      plugins: () => [wasm()],
    },
  };
});
