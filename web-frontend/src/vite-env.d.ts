/// <reference types="vite/client" />

// 1. WASM 模組實例化支援 (例如: import initWasm from './solver.wasm?init')
declare module '*?init' {
  const initWasm: (options?: WebAssembly.Imports) => Promise<WebAssembly.Instance>;
  export default initWasm;
}

// 2. Web Worker 原生構建支援 (例如: import PuzzleWorker from './solver.worker?worker')
declare module '*?worker' {
  const workerConstructor: {
    new (options?: WorkerOptions): Worker;
  };
  export default workerConstructor;
}

// 3. 內嵌資源字串與 URL 引用支援
declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*?url' {
  const url: string;
  export default url;
}

// 4. Vite 客製化環境變數介面擴充
interface ImportMetaEnv {
  readonly VITE_APP_TITLE?: string;
  readonly VITE_API_ENDPOINT?: string;
  readonly VITE_DEV_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
