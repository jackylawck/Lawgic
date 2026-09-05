// web-frontend/src/contexts/LanguageContext.tsx
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';

export type Language = 'zh' | 'en';

export interface TranslationDictionary {
  difficulty: Record<string, string>;
  common: {
    speed: string;
    moves: string;
    steps: string;
    backtrack: string;
    wallHits: string;
    vision: string;
    conflicts: string;
    hint: string;
    hintLadder: string;
    tournamentMode: string;
    tournamentOff: string;
    exportDataset: string;
    submitResult: string;
    ghostReplay: string;
    replaying: string;
    restoreMine: string;
    fullView: string;
    locked: string;
    cleared: string;
    duelLink: string;
    duelCopied: string;
    undo: string;
    redo: string;
    time: string;
    acc: string;
    penalty: string;
    exam: string;
    strict: string;
    off: string;
    generate: string;
    tierJump: string;
    close: string;
    confirm: string;
    cancel: string;
  };
}

interface LanguageContextType {
  lang: Language;
  isEn: boolean;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: TranslationDictionary;
}

const STORAGE_KEY = 'logicore_lang';

const DICTIONARY: Record<Language, TranslationDictionary> = {
  en: {
    difficulty: {
      kids: 'Kids',
      intermediate: 'Intermediate',
      expert: 'Expert',
      master: 'Master',
      legendary: 'Legendary',
      ultimate: 'Ultimate',
    },
    common: {
      speed: 'Speed',
      moves: 'Moves',
      steps: 'Steps',
      backtrack: 'Backtrack',
      wallHits: 'Wall Hits',
      vision: 'Vision',
      conflicts: 'Conflicts',
      hint: 'Hint',
      hintLadder: 'Hint Ladder',
      tournamentMode: '🏆 TOURNAMENT SANCTIONED',
      tournamentOff: '○ TOURNAMENT OFF',
      exportDataset: 'Export Dataset',
      submitResult: 'Submit Result',
      ghostReplay: 'Ghost Replay',
      replaying: 'Replaying...',
      restoreMine: 'Restore Mine',
      fullView: 'Full View',
      locked: 'Locked',
      cleared: 'CLEARED!',
      duelLink: 'Duel Link',
      duelCopied: '🔗 Direct duel link copied!',
      undo: 'Undo',
      redo: 'Redo',
      time: 'Time',
      acc: 'Acc',
      penalty: 'Penalty',
      exam: 'Exam',
      strict: 'Strict',
      off: 'OFF',
      generate: 'Generate',
      tierJump: 'Tier Jump (+1)',
      close: 'Close',
      confirm: 'Confirm',
      cancel: 'Cancel',
    },
  },
  zh: {
    difficulty: {
      kids: '兒童奠基',
      intermediate: '進階突破',
      expert: '專家精通',
      master: '大師魔王',
      legendary: '傳奇巔峰',
      ultimate: '極限深淵',
    },
    common: {
      speed: '競速',
      moves: '步數',
      steps: '步進',
      backtrack: '回溯',
      wallHits: '觸壁',
      vision: '視野',
      conflicts: '衝突累加',
      hint: '提示',
      hintLadder: '因果提示階梯',
      tournamentMode: '🏆 賽事認證模式',
      tournamentOff: '○ 自由訓練模式',
      exportDataset: '匯出數據',
      submitResult: '賽事提交',
      ghostReplay: '幽靈重播',
      replaying: '重播中...',
      restoreMine: '還原我的盤面',
      fullView: '全見視野',
      locked: '鎖定',
      cleared: '挑戰成功！',
      duelLink: '對決連結',
      duelCopied: '🔗 一鍵對決連結已複製！',
      undo: '撤銷',
      redo: '重做',
      time: '耗時',
      acc: '勝率',
      penalty: '衝突懲罰',
      exam: '測驗',
      strict: '嚴謹',
      off: '關閉',
      generate: '現場生成',
      tierJump: '升階挑戰 (+1)',
      close: '關閉',
      confirm: '確認完成',
      cancel: '取消',
    },
  },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    if (typeof window === 'undefined') return 'zh';
    const saved = localStorage.getItem(STORAGE_KEY) as Language | null;
    if (saved === 'zh' || saved === 'en') return saved;
    // 預設偵測系統/瀏覽器語系
    const navLang = navigator.language?.toLowerCase() || '';
    return navLang.startsWith('zh') ? 'zh' : 'en';
  });

  // 保持 HTML lang 屬性同步
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang === 'zh' ? 'zh-TW' : 'en';
    }
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {}
  }, [lang]);

  // 跨視窗/分頁同步切換
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'zh' || e.newValue === 'en')) {
        setLangState(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang);
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => (prev === 'zh' ? 'en' : 'zh'));
  }, []);

  const t = useMemo(() => DICTIONARY[lang], [lang]);
  const isEn = lang === 'en';

  return (
    <LanguageContext.Provider value={{ lang, isEn, setLang, toggleLang, t }}>
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
