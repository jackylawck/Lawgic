// web-frontend/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// 頂層極簡錯誤邊界：防止隨機演算法崩潰造成整個應用白屏
class GlobalErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[Lawgic Engine Panic]', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#090d14] text-slate-200 flex flex-col items-center justify-center p-4 font-mono select-none">
          <div className="max-w-md w-full bg-slate-900/90 border border-rose-800/60 rounded-xl p-5 shadow-2xl text-center">
            <div className="text-2xl mb-2">⚠️</div>
            <h1 className="text-sm font-bold text-rose-400 mb-2 uppercase tracking-wider">
              Engine Initialization Error
            </h1>
            <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">
              邏輯引擎在初始化或渲染過程中遭遇異常。快取狀態已被重置。
            </p>
            <div className="bg-slate-950 p-2.5 rounded text-[9px] text-rose-300 font-mono text-left mb-4 break-all border border-rose-950/80">
              {this.state.error?.message || 'Unknown runtime error'}
            </div>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-xs rounded transition"
            >
              重新整理平台 (Reload)
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
