/// <reference types="vite/client" />

// 1. 嚴格環境變數型別宣告
interface ImportMetaEnv {
  readonly VITE_APP_TITLE?: string;
  readonly VITE_API_ENDPOINT?: string;
  readonly VITE_DEV_MODE?: 'true' | 'false' | string;
  readonly VITE_TOURNAMENT_MODE?: 'strict' | 'casual';
  readonly VITE_STORAGE_PEPPER?: string;
  readonly VITE_WASM_MAX_MEMORY_PAGES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// 2. WebAssembly 模組載入宣告 (對齊 vite-plugin-wasm 與瀏覽器原生物件)
declare module '*.wasm' {
  const initWasm: (options?: WebAssembly.Imports) => Promise<WebAssembly.Instance>;
  export default initWasm;
}

declare module '*.wasm?url' {
  const wasmUrl: string;
  export default wasmUrl;
}

declare module '*.wasm?init' {
  const init: (imports?: WebAssembly.Imports) => Promise<{
    instance: WebAssembly.Instance;
    module: WebAssembly.Module;
  }>;
  export default init;
}

// 3. Web Worker 查詢參數宣告 (背景推導與 SMT/CSP 求解器)
declare module '*?worker' {
  const workerConstructor: {
    new (options?: WorkerOptions): Worker;
  };
  export default workerConstructor;
}

declare module '*?worker&inline' {
  const workerConstructor: {
    new (options?: WorkerOptions): Worker;
  };
  export default workerConstructor;
}

// 4. 原生字串與資源查詢支援
declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*.svg?react' {
  import type React from 'react';
  const SVG: React.FC<React.SVGProps<SVGSVGElement>>;
  export default SVG;
}

// 5. 全域 LogiCore 自訂事件總線型別宣告 (強化跨模組通信安全)
interface LogiCoreLangChangedDetail {
  lang: 'zh' | 'en';
}

interface LogiCoreLeaderboardDetail {
  checksum: string;
  entry: Record<string, any>;
}

interface CustomEventMap {
  'logicore:lang-changed': CustomEvent<LogiCoreLangChangedDetail>;
  'logicore:vault-updated': CustomEvent<void>;
  'logicore:leaderboard-updated': CustomEvent<LogiCoreLeaderboardDetail>;
}

declare global {
  interface WindowEventMap extends CustomEventMap {}
}

export {};
