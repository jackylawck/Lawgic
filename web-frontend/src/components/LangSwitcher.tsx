// web-frontend/src/components/LangSwitcher.tsx
import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

export const LangSwitcher: React.FC = () => {
  const { lang, setLang } = useLanguage();

  return (
    <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded p-0.5 text-[9px] font-mono select-none">
      <button
        type="button"
        onClick={() => {
          if (navigator.vibrate) navigator.vibrate(5);
          setLang('zh');
        }}
        className={`px-1.5 py-0.5 rounded-sm transition-all ${
          lang === 'zh'
            ? 'bg-indigo-600 text-white font-bold shadow'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        繁中
      </button>
      <button
        type="button"
        onClick={() => {
          if (navigator.vibrate) navigator.vibrate(5);
          setLang('en');
        }}
        className={`px-1.5 py-0.5 rounded-sm transition-all ${
          lang === 'en'
            ? 'bg-indigo-600 text-white font-bold shadow'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        EN
      </button>
    </div>
  );
};
