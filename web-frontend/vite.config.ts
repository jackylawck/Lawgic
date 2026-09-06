// web-frontend/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    // 解決生產環境在各端 Safari / WebView 中非同步載入 WASM 的相容性問題
    topLevelAwait({
      promiseExportName: '__tla',
      promiseImportName: (i) => `__tla_${i}`,
    }),
  ],

  base: './',

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // 開發伺服器配置（支援高精度時間戳與隔離記憶體環境）
  server: {
    port: 3000,
    host: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsDir: 'assets',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1200, // 放寬大題庫 chunk 警告閾值至 1200 kB
    
    // 生產環境程式碼分塊策略 (Code Splitting)
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 1. 核心框架庫隔離
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          // 2. 圖表與視覺化依賴（若有 recharts / canvas-confetti 等）
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3') || id.includes('canvas-confetti')) {
            return 'vendor-charts';
          }
          // 3. 大型靜態題庫 JSON 獨立打包，避免阻塞核心邏輯 JS
          if (id.includes('/generated/') && id.endsWith('.json')) {
            return 'puzzle-catalog-data';
          }
          // 4. 遊戲核心生成器模組聚類
          if (id.includes('/engines/')) {
            return 'puzzle-engines-core';
          }
        },
        // 資源路徑結構化管理
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },

    // 移除生產環境的除錯日誌，提升效能並保護核心防作弊邏輯
    minify: 'esbuild',
  },

  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    supported: {
      'top-level-await': true,
    },
  },

  // 優化 WebAssembly 與 Web Worker 載入管線
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
});
