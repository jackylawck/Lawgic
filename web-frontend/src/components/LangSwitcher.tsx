import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

export const LangSwitcher: React.FC = () => {
  const { lang, setLang } = useLanguage();
  return (
    <div className="flex gap-1 p-1 bg-slate-900/80 rounded-lg border border-slate-800">
      <button
        onClick={() => setLang('zh')}
        className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
          lang === 'zh' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        繁中
      </button>
      <button
        onClick={() => setLang('en')}
        className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
          lang === 'en' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        EN
      </button>
    </div>
  );
};
