import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [react(), wasm()],
  base: './', // 確保部署到 GitHub Pages 時相對路徑正確
  build: {
    target: 'esnext', // 讓 Rollup/Vite 原生輸出支援 WebAssembly 和 top-level await 的 modern JS
  },
  esbuild: {
    supported: {
      'top-level-await': true, // 避免 esbuild 轉譯時報錯
    },
  },
});
