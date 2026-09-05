/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#090d14',     // 平台極夜黑底色
          surface: '#111827',  // 面板容器底色
          border: '#1f2937',   // 邊框與分割線
          accent: '#38bdf8',   // 核心聚焦與選取高亮 (Sky 400)
          success: '#10b981',  // 正確/閉環/草地 (Emerald 500)
          warning: '#f59e0b',  // 推理警示/抽屜原理提示 (Amber 500)
          danger: '#ef4444',   // 規則衝突/無效落子 (Red 500)
        },
      },
      fontFamily: {
        // 競技解題專屬：等寬數字防止計時器跳動
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      // 🌟 iOS 動態島與底部 Home Indicator 安全邊界自適應擴展
      spacing: {
        safe: 'env(safe-area-inset-bottom, 0px)',
        'safe-top': 'env(safe-area-inset-top, 0px)',
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
        'safe-left': 'env(safe-area-inset-left, 0px)',
        'safe-right': 'env(safe-area-inset-right, 0px)',
      },
      gridTemplateColumns: {
        // 快速適配各類棋盤大小
        9: 'repeat(9, minmax(0, 1fr))',
        10: 'repeat(10, minmax(0, 1fr))',
        12: 'repeat(12, minmax(0, 1fr))',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'pulse-subtle': 'pulseSubtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pop-in': 'popIn 0.18s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'shake-err': 'shakeErr 0.35s cubic-bezier(0.36, 0.07, 0.19, 0.97) both',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        popIn: {
          from: { opacity: '0', transform: 'scale(0.85)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        shakeErr: {
          '10%, 90%': { transform: 'translate3d(-1px, 0, 0)' },
          '20%, 80%': { transform: 'translate3d(2px, 0, 0)' },
          '30%, 50%, 70%': { transform: 'translate3d(-3px, 0, 0)' },
          '40%, 60%': { transform: 'translate3d(3px, 0, 0)' },
        },
      },
    },
  },
  plugins: [],
};
