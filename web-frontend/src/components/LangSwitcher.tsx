// web-frontend/src/components/LangSwitcher.tsx
import React, { useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

export const LangSwitcher: React.FC = () => {
  const { lang, setLang } = useLanguage();

  // 1. 同步全域 HTML 標籤與字體排版渲染引擎 (Typography Sync)
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
    }
  }, [lang]);

  // 2. 觸覺微回饋 (Haptic Tick)
  const triggerHaptic = useCallback(() => {
    if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
      navigator.vibrate(10);
    }
  }, []);

  const handleSelect = (target: 'zh' | 'en') => {
    if (lang === target) return;
    triggerHaptic();
    setLang(target);
  };

  return (
    <div
      role="group"
      aria-label="Language selection"
      className="relative flex items-center bg-slate-950/80 border border-slate-800 rounded-lg p-0.5 text-[8.5px] font-mono select-none backdrop-blur-xs shadow-inner"
    >
      {/* 物理滑動底色膠囊 (Sliding Pill Indicator) */}
      <div
        className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] bg-gradient-to-r from-indigo-600 to-indigo-500 rounded-md shadow-sm transition-transform duration-200 ease-out pointer-events-none"
        style={{
          transform: lang === 'en' ? 'translateX(calc(100% + 2px))' : 'translateX(0)',
        }}
      />

      {/* 繁中切換鈕 */}
      <button
        type="button"
        role="button"
        aria-pressed={lang === 'zh'}
        aria-label="切換至繁體中文"
        onClick={() => handleSelect('zh')}
        className={`relative z-10 px-2 py-0.5 rounded-md transition-colors duration-150 active:scale-95 flex items-center justify-center font-bold tracking-wider ${
          lang === 'zh' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        繁中
      </button>

      {/* 英文切換鈕 */}
      <button
        type="button"
        role="button"
        aria-pressed={lang === 'en'}
        aria-label="Switch to English"
        onClick={() => handleSelect('en')}
        className={`relative z-10 px-2 py-0.5 rounded-md transition-colors duration-150 active:scale-95 flex items-center justify-center font-bold tracking-wider ${
          lang === 'en' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        EN
      </button>
    </div>
  );
};
