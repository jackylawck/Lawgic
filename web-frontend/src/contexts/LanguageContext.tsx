// web-frontend/src/contexts/LanguageContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'zh' | 'en';

export interface TranslationDictionary {
  difficulty: Record<string, string>;
  common: {
    speed: string;
    steps: string;
    backtrack: string;
    wallHits: string;
    vision: string;
    hint: string;
    hintLadder: string;
    tournamentMode: string;
    exportDataset: string;
    submitResult: string;
    ghostReplay: string;
    replaying: string;
    fullView: string;
    locked: string;
    cleared: string;
  };
}

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: TranslationDictionary;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    return (localStorage.getItem('logicore_lang') as Language) || 'zh';
  });

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem('logicore_lang', newLang);
  };

  const toggleLang = () => {
    setLangState((prev) => {
      const next = prev === 'zh' ? 'en' : 'zh';
      localStorage.setItem('logicore_lang', next);
      return next;
    });
  };

  const t: TranslationDictionary = {
    difficulty: {
      kids: lang === 'en' ? 'Basics' : '兒童奠基',
      intermediate: lang === 'en' ? 'Intermediate' : '進階突破',
      expert: lang === 'en' ? 'Expert' : '專家精通',
      master: lang === 'en' ? 'Master' : '大師魔王',
      legendary: lang === 'en' ? 'Legendary' : '傳奇巔峰',
      ultimate: lang === 'en' ? 'Ultimate' : '極限深淵',
    },
    common: {
      speed: lang === 'en' ? 'Speed' : '競速',
      steps: lang === 'en' ? 'Steps' : '步數',
      backtrack: lang === 'en' ? 'Backtrack' : '回溯',
      wallHits: lang === 'en' ? 'Wall Hits' : '觸壁',
      vision: lang === 'en' ? 'Vision' : '視野',
      hint: lang === 'en' ? 'Hint' : '提示',
      hintLadder: lang === 'en' ? 'Hint Ladder' : '因果提示階梯',
      tournamentMode: lang === 'en' ? 'WPF Tournament' : 'WPF 賽事鎖定',
      exportDataset: lang === 'en' ? 'Export Dataset' : '匯出數據',
      submitResult: lang === 'en' ? 'Submit Result' : '賽事提交',
      ghostReplay: lang === 'en' ? 'Ghost Replay' : '幽靈重播',
      replaying: lang === 'en' ? 'Replaying...' : '重播中...',
      fullView: lang === 'en' ? 'Full View' : '全見視野',
      locked: lang === 'en' ? 'Locked' : '鎖定',
      cleared: lang === 'en' ? 'CLEARED!' : '挑戰成功！',
    },
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
