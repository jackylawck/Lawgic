/// <reference types="vite/client" />

// 客製化環境變數型別擴充（自動合併至 vite/client 內建的 ImportMetaEnv）
interface ImportMetaEnv {
  readonly VITE_APP_TITLE?: string;
  readonly VITE_API_ENDPOINT?: string;
  readonly VITE_DEV_MODE?: string;
}

// 支援直接引用 .wasm 靜態資源檔
declare module '*.wasm' {
  const initWasm: (options?: WebAssembly.Imports) => Promise<WebAssembly.Instance>;
  export default initWasm;
}
