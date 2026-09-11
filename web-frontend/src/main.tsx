import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { EventBus } from './events/bus';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo?: React.ErrorInfo | null;
}

// 附帶自動取消定時器的超時保護器
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
};

/**
 * 臨床與電競級全域錯誤守護邊界 (Global Panic Boundary)
 */
class GlobalErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[LogiCore Panic Guard]', error, errorInfo);
  }

  handleSoftReload = () => {
    try {
      sessionStorage.clear();
      localStorage.removeItem('logicore_active_board_state');
      localStorage.removeItem('lawgic_active_board_state');
    } catch (e) {
      console.warn('[SoftReload] Storage eviction partially failed:', e);
    }
    window.location.reload();
  };

  handleFactoryReset = async () => {
    const isConfirmed = window.confirm(
      '確定執行深度修復重置？\n這將註銷快取、清理本機暫存並重新載入基礎引擎。\n\nAre you sure you want to perform a factory reset?'
    );
    if (!isConfirmed) return;

    try {
      sessionStorage.clear();
      localStorage.clear();

      if ('caches' in window) {
        const cacheKeys = await withTimeout(caches.keys(), 2000).catch(() => [] as string[]);
        await withTimeout(
          Promise.all(cacheKeys.map((key) => caches.delete(key))),
          3000
        ).catch((err) => console.warn('[FactoryReset] Cache purge timed out:', err));
      }

      if ('serviceWorker' in navigator) {
        const registrations = await withTimeout(
          navigator.serviceWorker.getRegistrations(),
          2000
        ).catch(() => [] as ServiceWorkerRegistration[]);
        await withTimeout(
          Promise.all(registrations.map((r) => r.unregister())),
          3000
        ).catch((err) => console.warn('[FactoryReset] SW unregister timed out:', err));
      }
    } catch (e) {
      console.warn('[FactoryReset] Deep purge encountered warnings:', e);
    }

    window.location.href = window.location.origin + window.location.pathname;
  };

  handleCopyDiagnostic = async () => {
    const report = {
      timestamp: new Date().toISOString(),
      build: {
        hash: __BUILD_HASH__,
        time: __BUILD_TIME__,
      },
      url: window.location.href,
      hash: window.location.hash,
      userAgent: navigator.userAgent,
      language: navigator.language,
      isSecureContext: window.isSecureContext,
      serviceWorkerActive: !!navigator.serviceWorker?.controller,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
      error: {
        name: this.state.error?.name,
        message: this.state.error?.message,
        stack: this.state.error?.stack,
      },
      componentStack: this.state.errorInfo?.componentStack,
    };

    const payload = JSON.stringify(report, null, 2);
    let copySucceeded = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        copySucceeded = true;
      }
    } catch (e) {
      console.warn('[Diagnostic] Clipboard API execution failed:', e);
    }

    if (copySucceeded) {
      alert('診斷報告已複製至剪貼簿 / Diagnostic payload copied to clipboard.');
    } else {
      console.warn('[LogiCore Diagnostic Payload Fallback]:\n', payload);
      alert('無法直接寫入剪貼簿，診斷數據已同步輸出至 DevTools Console。');
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#070a0f] text-slate-200 flex flex-col items-center justify-center p-4 font-mono select-none">
          <div className="max-w-lg w-full bg-slate-900/95 border border-rose-800/60 rounded-2xl p-6 shadow-2xl backdrop-blur-md text-center">
            <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto mb-4 text-2xl">
              ⚠️
            </div>

            <h1 className="text-base font-bold text-rose-400 mb-1 tracking-wide uppercase">
              Engine Initialization Fault
            </h1>
            <p className="text-xs text-slate-400 mb-1 leading-relaxed">
              核心計算引擎在初始化或渲染過程中遭遇異常中斷。
            </p>
            <p className="text-[10px] text-slate-500 mb-4 leading-relaxed font-sans">
              The core engine encountered an unhandled exception during lifecycle mount.
            </p>

            <div className="bg-slate-950 p-3 rounded-lg text-[10px] text-rose-300 font-mono text-left mb-5 break-all border border-rose-950/80 max-h-36 overflow-y-auto">
              <span className="font-semibold text-rose-200">
                {this.state.error?.name || 'RuntimeError'}:
              </span>{' '}
              {this.state.error?.message || 'Unknown panic condition dispatched.'}
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 justify-center mb-4">
              <button
                onClick={this.handleSoftReload}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-xs rounded-lg transition cursor-pointer shadow-lg shadow-indigo-600/20"
              >
                安全重載 (Safe Reload)
              </button>
              <button
                onClick={this.handleFactoryReset}
                className="px-4 py-2.5 bg-rose-900/60 hover:bg-rose-800/80 text-rose-200 font-semibold text-xs rounded-lg border border-rose-700/50 transition cursor-pointer"
              >
                深度重置 (Factory Reset)
              </button>
            </div>

            <button
              onClick={this.handleCopyDiagnostic}
              className="text-[10px] text-slate-500 hover:text-slate-300 underline transition cursor-pointer"
            >
              複製除錯診斷數據 (Copy Diagnostic Report)
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// 1. 全域非同步守護
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[LogiCore Global Unhandled Rejection]:', event.reason);
  });

  window.addEventListener('error', (event) => {
    console.error('[LogiCore Window Error]:', event.error || event.message);
  });
}

// 2. 現代 PWA 註冊與生命週期監聽
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.info('[PWA] New controller active. Ready for explicit reload.');
  });

  window.addEventListener('load', () => {
    const swPath = `${import.meta.env.BASE_URL}sw.js`;

    navigator.serviceWorker
      .register(swPath, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.addEventListener('statechange', () => {
              if (
                installingWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                console.info('[PWA] New engine build installed and waiting.');
                EventBus.emit('update-available', {
                  version: __BUILD_HASH__,
                });
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn('[PWA] Service Worker registration bypassed:', err);
      });
  });
}

// 3. 根節點裝載
const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <GlobalErrorBoundary>
        <App />
      </GlobalErrorBoundary>
    </React.StrictMode>
  );
}
