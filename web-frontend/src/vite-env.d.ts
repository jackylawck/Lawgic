/// <reference types="vite/client" />

import type { EventMap, EventPrefix } from './events/bus';

// U1 修復：透過模板字面量型別自動同步 'logicore:xxx'，徹底消滅手動維護
type PrefixedWindowEvents = {
  [K in keyof EventMap as `${EventPrefix}${K}`]: CustomEvent<EventMap[K]>;
};

declare global {
  // 1. Vite define 注入之編譯期巨集
  const __BUILD_HASH__: string;
  const __BUILD_TIME__: string;

  // 2. 嚴格環境變數宣告 (M1: 收緊型別)
  interface ImportMetaEnv {
    readonly VITE_APP_TITLE?: string;
    readonly VITE_API_ENDPOINT?: string;
    readonly VITE_DEV_MODE?: 'true' | 'false';
    readonly VITE_TOURNAMENT_MODE?: 'strict' | 'casual';
    readonly VITE_STORAGE_PEPPER?: string;
    readonly VITE_WASM_MAX_MEMORY_PAGES?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  // 3. 全域 WindowEventMap 自動繼承 EventBus 所有前綴事件
  interface WindowEventMap extends PrefixedWindowEvents {}
}

// 4. WebAssembly 與特殊資產宣告
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

declare module '*.svg?react' {
  import type React from 'react';
  const SVG: React.FC<React.SVGProps<SVGSVGElement>>;
  export default SVG;
}

export {};
