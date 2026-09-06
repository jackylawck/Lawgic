// web-frontend/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo?: React.ErrorInfo | null;
}

/**
 * 臨床與電競級全域錯誤守護邊界 (Global Panic Boundary)
 * - 捕獲渲染期錯誤、支援一鍵複製 Diagnostic Report
 * - 具備快取自癒 (Self-Healing Cache Eviction) 與安全重啟雙模式
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
      // 清除各類即時局態與暫存，保留核心認證與成績金庫
      localStorage.removeItem('logicore_active_board_state');
      localStorage.removeItem('lawgic_active_board_state');
    } catch {}
    window.location.reload();
  };

  handleFactoryReset = () => {
    if (window.confirm('確定執行深度重置？這將清理損壞的暫存狀態並重新加載。')) {
      try {
        sessionStorage.clear();
        localStorage.clear();
        // 清理所有 Service Worker 快取
        if ('caches' in window) {
          caches.keys().then((keys) => {
            keys.forEach((key) => caches.delete(key));
          });
        }
      } catch {}
      window.location.href = window.location.origin + window.location.pathname;
    }
  };

  handleCopyDiagnostic = () => {
    const report = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      errorName: this.state.error?.name,
      errorMessage: this.state.error?.message,
      stack: this.state.error?.stack,
      componentStack: this.state.errorInfo?.componentStack,
    };
    navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => {
      alert('診斷報告已複製至剪貼簿 (Diagnostic payload copied)');
    });
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
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              核心計算引擎在初始化或渲染過程中遭遇異常中斷。
            </p>

            <div className="bg-slate-950 p-3 rounded-lg text-[10px] text-rose-300 font-mono text-left mb-5 break-all border border-rose-950/80 max-h-36 overflow-y-auto">
              <span className="font-semibold text-rose-200">
                {this.state.error?.name || 'Error'}:
              </span>{' '}
              {this.state.error?.message || 'Unknown runtime condition occurred.'}
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
                深度修復重置 (Reset)
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

// 1. 全域非同步錯誤監聽器 (捕獲 Worker, WASM, Promise Unhandled Rejection)
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[LogiCore Global Unhandled Rejection]:', event.reason);
  });

  window.addEventListener('error', (event) => {
    console.error('[LogiCore Window Error]:', event.error || event.message);
  });
}

// 2. 現代 PWA 註冊與熱更新監聽 (Service Worker Lifecycle)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => {
        // 監聽是否有新版本發布並待命
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.addEventListener('statechange', () => {
              if (
                installingWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                console.info('[PWA] New engine build available. Ready to reload.');
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
