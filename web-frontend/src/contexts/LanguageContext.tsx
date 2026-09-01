// web-frontend/src/contexts/LanguageContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'zh' | 'en';

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: {
    difficulty: Record<string, string>;
  };
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
    setLang(lang === 'zh' ? 'en' : 'zh');
  };

  const t = {
    difficulty: {
      kids: lang === 'en' ? '4x4 Basics' : '4x4 奠基',
      intermediate: lang === 'en' ? '6x6 Advance' : '6x6 突破',
      expert: lang === 'en' ? '9x9 Mastery' : '9x9 精通',
      master: lang === 'en' ? 'Abyss' : '變體深淵',
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
