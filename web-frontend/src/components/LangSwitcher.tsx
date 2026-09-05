// web-frontend/src/components/LangSwitcher.tsx
import React, { useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

export const LangSwitcher: React.FC = () => {
  const { lang, setLang } = useLanguage();
  const isEn = lang === 'en';

  // 1. 同步全域 HTML 標籤、字體排版與 class (Typography & Locales Sync)
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.lang = isEn ? 'en' : 'zh-Hant';

      // 注入全域語系標籤以利 CSS 精準微調 CJK / Latin 字間距
      document.body.classList.remove('lang-zh', 'lang-en');
      document.body.classList.add(isEn ? 'lang-en' : 'lang-zh');
    }
  }, [isEn]);

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

  // 3. 鍵盤左右方向鍵切換支援 (WAI-ARIA Radio Pattern)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      handleSelect('en');
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      handleSelect('zh');
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={isEn ? 'Language selection' : '語言切換選項'}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="relative flex items-center bg-slate-950/90 border border-slate-800/90 rounded-lg p-0.5 text-[8.5px] font-mono select-none backdrop-blur-xs shadow-inner focus:outline-none focus:ring-1 focus:ring-indigo-500/50 cursor-pointer"
    >
      {/* 物理滑動底色膠囊 (Sliding Pill Indicator) */}
      <div
        className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] bg-gradient-to-r from-indigo-600 to-indigo-500 rounded-md shadow-xs transition-transform duration-200 ease-out pointer-events-none will-change-transform"
        style={{
          transform: isEn ? 'translate3d(calc(100% + 2px), 0, 0)' : 'translate3d(0, 0, 0)',
        }}
      />

      {/* 繁中切換鈕 */}
      <button
        type="button"
        role="radio"
        aria-checked={!isEn}
        aria-label={isEn ? 'Switch to Traditional Chinese' : '切換至繁體中文'}
        tabIndex={-1}
        onClick={() => handleSelect('zh')}
        className={`relative z-10 px-2 py-0.5 rounded-md transition-colors duration-150 active:scale-95 flex items-center justify-center font-bold tracking-wider cursor-pointer ${
          !isEn ? 'text-white' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        繁中
      </button>

      {/* 英文切換鈕 */}
      <button
        type="button"
        role="radio"
        aria-checked={isEn}
        aria-label={isEn ? 'Switch to English' : '切換至英文'}
        tabIndex={-1}
        onClick={() => handleSelect('en')}
        className={`relative z-10 px-2 py-0.5 rounded-md transition-colors duration-150 active:scale-95 flex items-center justify-center font-bold tracking-wider cursor-pointer ${
          isEn ? 'text-white' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        EN
      </button>
    </div>
  );
};
