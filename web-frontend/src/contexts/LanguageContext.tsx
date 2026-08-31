import React, { createContext, useContext, useState, ReactNode } from 'react';

export type Language = 'zh' | 'en';

interface Translations {
  difficulty: {
    kids: string;
    intermediate: string;
    expert: string;
    master: string;
  };
  errors: {
    securityAlert: string;
    conflict: string;
    immutable: string;
    engineCrash: string;
  };
  ui: {
    tier: string;
    verified: string;
    loading: string;
    noPuzzles: string;
    noPuzzlesSub: string;
    nextPuzzle: string;
    retry: string;
  };
}

const translationsMap: Record<Language, Translations> = {
  zh: {
    difficulty: {
      kids: '🧒 兒童 / 初階',
      intermediate: '📘 中階',
      expert: '🧠 專家',
      master: '👹 魔王',
    },
    errors: {
      securityAlert: '🔒 安全性警示：謎題完整性驗證失敗！',
      conflict: '⚠️ 衝突：此步會導致矛盾，已自動回滾。',
      immutable: '🔒 此為初始提示，不可編輯。',
      engineCrash: '⚠️ 核心引擎載入或執行異常',
    },
    ui: {
      tier: '難度分級',
      verified: 'SHA-256 驗證通過',
      loading: '載入中...',
      noPuzzles: '此難度暫無題庫',
      noPuzzlesSub: '請切換其他難度以繼續挑戰',
      nextPuzzle: '換一題',
      retry: '重新載入引擎',
    },
  },
  en: {
    difficulty: {
      kids: '🧒 Kids / Beginner',
      intermediate: '📘 Intermediate',
      expert: '🧠 Expert',
      master: '👹 Master',
    },
    errors: {
      securityAlert: '🔒 Security Alert: Puzzle integrity check failed!',
      conflict: '⚠️ Conflict: Move would cause contradiction. Rolled back.',
      immutable: '🔒 This is a starting clue and cannot be edited.',
      engineCrash: '⚠️ Core engine runtime exception',
    },
    ui: {
      tier: 'Difficulty Tier',
      verified: 'SHA-256 Verified',
      loading: 'Loading...',
      noPuzzles: 'No puzzles available for this tier',
      noPuzzlesSub: 'Please select another tier to continue',
      nextPuzzle: 'Next Puzzle',
      retry: 'Reload Engine',
    },
  },
};

interface LangContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: Translations;
}

const LangContext = createContext<LangContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [lang, setLang] = useState<Language>('zh');
  return (
    <LangContext.Provider value={{ lang, setLang, t: translationsMap[lang] }}>
      {children}
    </LangContext.Provider>
  );
};

export const useLanguage = () => {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
};
