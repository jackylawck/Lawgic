// web-frontend/src/contexts/LanguageContext.tsx
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';

export type Language = 'zh' | 'en';

export interface TranslationDictionary {
  difficulty: Record<string, string>;
  common: Record<string, string>;
  psychometrics: Record<string, string>;
  engines: Record<string, string>;
}

export type TranslationKey =
  | `difficulty.${string}`
  | `common.${string}`
  | `psychometrics.${string}`
  | `engines.${string}`
  | string;

interface LanguageContextType {
  lang: Language;
  isEn: boolean;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  /**
   * 現代化點號路徑翻譯函數，支援動態變數插值 (e.g. t('common.timeLeft', { sec: 45 }))
   */
  t: {
    (key: TranslationKey, params?: Record<string, string | number>): string;
    // 保持對舊版巢狀物件訪問的完全相容
    difficulty: Record<string, string>;
    common: Record<string, string>;
    psychometrics: Record<string, string>;
    engines: Record<string, string>;
  };
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
      save: 'Save',
      resign: 'Resign',
      notesMode: 'Notes Mode (N)',
    },
    psychometrics: {
      iqEstimate: 'Estimated IQ',
      csem: 'Measurement Error (CSEM)',
      spatialIndex: 'Spatial Composite',
      pureStreak: 'Pure Clear Streak',
      deductionChain: 'Deduction Chain',
      workingMemoryLoad: 'Working Memory Load',
      inhibitionControl: 'Inhibition Control',
    },
    engines: {
      sudoku: 'Sudoku',
      slitherlink: 'Slitherlink',
      kropki: 'Kropki',
      futoshiki: 'Futoshiki',
      hashi: 'Bridges (Hashi)',
      skyscraper: 'Skyscrapers',
      maze: 'Topology Maze',
    },
  },
  zh: {
    difficulty: {
      kids: '兒童啟蒙',
      intermediate: '進階突破',
      expert: '專家精通',
      master: '大師魔王',
      legendary: '傳奇巔峰',
      ultimate: '極限深淵',
    },
    common: {
      speed: '解題速率',
      moves: '決策步數',
      steps: '推導階數',
      backtrack: '回溯次數',
      wallHits: '邊界阻滯',
      vision: '可見視野',
      conflicts: '約束衝突',
      hint: '因果提示',
      hintLadder: '因果推導階梯',
      tournamentMode: '🏆 賽事認證模式',
      tournamentOff: '○ 自由訓練模式',
      exportDataset: '匯出認知數據',
      submitResult: '官方賽事提交',
      ghostReplay: '幽靈軌跡重播',
      replaying: '重播軌跡中...',
      restoreMine: '還原我的盤面',
      fullView: '全視界展開',
      locked: '約束鎖定',
      cleared: '挑戰成功！',
      duelLink: '對決連結',
      duelCopied: '🔗 賽事對決連結已複製！',
      undo: '復原',
      redo: '重做',
      time: '累積耗時',
      acc: '正確率',
      penalty: '衝突懲罰',
      exam: '標準施測',
      strict: '嚴格幾何',
      off: '關閉',
      generate: '實時拓撲生成',
      tierJump: '極限越階 (+1)',
      close: '關閉',
      confirm: '確認完成',
      cancel: '取消',
      save: '暫存進度',
      resign: '優雅投降',
      notesMode: '候選筆記 (N)',
    },
    psychometrics: {
      iqEstimate: '流體智力估計',
      csem: '條件測量標準誤 (CSEM)',
      spatialIndex: '空間拓撲綜合量尺',
      pureStreak: '零失誤連勝場次',
      deductionChain: '邏輯因果推導鏈',
      workingMemoryLoad: '工作記憶負載',
      inhibitionControl: '抑制控制能力',
    },
    engines: {
      sudoku: '數獨魔陣',
      slitherlink: '單迴路謎網',
      kropki: '點陣數理',
      futoshiki: '不等式矩陣',
      hashi: '星際數橋',
      skyscraper: '摩天透視',
      maze: '空間拓撲迷宮',
    },
  },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    if (typeof window === 'undefined') return 'zh';
    const saved = localStorage.getItem(STORAGE_KEY) as Language | null;
    if (saved === 'zh' || saved === 'en') return saved;
    const navLang = navigator.language?.toLowerCase() || '';
    return navLang.startsWith('zh') ? 'zh' : 'en';
  });

  // 同步 HTML 標籤與全域廣播
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang === 'zh' ? 'zh-Hant-HK' : 'en';
    }
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {}

    // 通知所有非 React 模組（如 Canvas / Web Worker）語系已更新
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('logicore:lang-changed', { detail: { lang } }));
    }
  }, [lang]);

  // 跨視窗/分頁即時同步
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

  const isEn = lang === 'en';

  // 構造兼具物件屬性與函數呼叫能力的智慧 t 實例
  const t = useMemo(() => {
    const dict = DICTIONARY[lang];

    const translateFunc = (key: TranslationKey, params?: Record<string, string | number>): string => {
      const parts = key.split('.');
      let current: any = dict;

      for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
          current = current[part];
        } else {
          // 找不到則降級嘗試英文詞庫
          let fallback: any = DICTIONARY.en;
          for (const fbPart of parts) {
            if (fallback && typeof fallback === 'object' && fbPart in fallback) {
              fallback = fallback[fbPart];
            } else {
              return key; // 最終退回原始 key
            }
          }
          current = fallback;
          break;
        }
      }

      if (typeof current !== 'string') return key;

      // 支援參數插值替換，例如 {name} 替換
      if (params) {
        return Object.entries(params).reduce((acc, [pKey, pVal]) => {
          return acc.replace(new RegExp(`\\{${pKey}\\}`, 'g'), String(pVal));
        }, current);
      }

      return current;
    };

    // 將字典屬性直接掛載至函數上，實現完美雙向相容：既可 t('common.speed')，也可 t.common.speed
    translateFunc.difficulty = dict.difficulty;
    translateFunc.common = dict.common;
    translateFunc.psychometrics = dict.psychometrics;
    translateFunc.engines = dict.engines;

    return translateFunc as any;
  }, [lang]);

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
