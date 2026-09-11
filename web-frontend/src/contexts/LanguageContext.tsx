// web-frontend/src/contexts/LanguageContext.tsx
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';

export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const;
export type Language = typeof SUPPORTED_LANGUAGES[number];

const STORAGE_KEY = 'LOGICORE_LANG_V1';
const LEGACY_STORAGE_KEY = 'logicore_lang';

const IS_DEV = Boolean(import.meta.env.DEV);
const IS_TEST = Boolean(import.meta.env.MODE === 'test');

const HTML_LANG_MAP: Record<Language, string> = {
  zh: 'zh-Hant-HK',
  en: 'en',
};

const DICTIONARY = {
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
} as const;

export type TranslationSchema = typeof DICTIONARY.en;

// 編譯期雙向完整性校驗：若 zh 漏填 en 的任何 Key，編譯器直接報錯
type DeepKeysMatch<A, B> = {
  [K in keyof A]: K extends keyof B
    ? A[K] extends Record<string, unknown>
      ? B[K] extends Record<string, unknown>
        ? DeepKeysMatch<A[K], B[K]>
        : never
      : true
    : never;
};

// 此行型別斷言在編譯期靜態校驗兩語系鍵集合是否完全相等
type _AssertTranslationSymmetry = DeepKeysMatch<typeof DICTIONARY.en, typeof DICTIONARY.zh> extends DeepKeysMatch<
  typeof DICTIONARY.zh,
  typeof DICTIONARY.en
>
  ? true
  : never;
const _symmetryToken: _AssertTranslationSymmetry = true;
void _symmetryToken;

type NestedKeyOf<T> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? `${K}.${keyof T[K] & string}`
    : K;
}[keyof T & string];

export type ExactTranslationKey = NestedKeyOf<TranslationSchema>;
export type TranslationKey = ExactTranslationKey | (string & {});

export interface TranslateFunction {
  (key: TranslationKey, params?: Record<string, string | number>): string;
  readonly difficulty: Record<keyof TranslationSchema['difficulty'], string>;
  readonly common: Record<keyof TranslationSchema['common'], string>;
  readonly psychometrics: Record<keyof TranslationSchema['psychometrics'], string>;
  readonly engines: Record<keyof TranslationSchema['engines'], string>;
}

interface LanguageContextType {
  readonly lang: Language;
  readonly isEn: boolean;
  readonly setLang: (lang: Language) => void;
  readonly toggleLang: () => void;
  readonly t: TranslateFunction;
}

declare global {
  interface WindowEventMap {
    'logicore:lang-changed': CustomEvent<{ lang: Language }>;
  }
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function isValidLanguage(val: unknown): val is Language {
  return typeof val === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(val);
}

function resolvePath(obj: unknown, parts: readonly string[]): string | null {
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in cur) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return typeof cur === 'string' ? cur : null;
}

/**
 * 探測並初始化語言環境（純函數，零副作用）
 * ⚠️ 架構假設：目前為純前端 Vite SPA 架構。
 * 若未來遷移至 SSR（Next.js / Remix），為杜絕 Hydration Mismatch，
 * 請改用 `useState<Language>('zh')` + `useEffect(() => setLangState(detectInitialLanguage()), [])`。
 */
function detectInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'zh';

  try {
    for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
      const saved = localStorage.getItem(key);
      if (isValidLanguage(saved)) return saved;
    }
  } catch {}

  const navLangs = navigator.languages ?? [navigator.language || ''];
  for (const l of navLangs) {
    const lower = l.toLowerCase();
    if (lower.startsWith('zh')) return 'zh';
    if (lower.startsWith('en')) return 'en';
  }

  return 'zh';
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(detectInitialLanguage);
  const warnedKeysRef = useRef<Set<string>>(new Set());

  // Mount 時執行 Legacy Storage Key 遷移清理（副作用與狀態初始化徹底解耦）
  useEffect(() => {
    try {
      if (localStorage.getItem(LEGACY_STORAGE_KEY)) {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch {}
  }, []);

  // 同步 HTML BCP 47 標籤與外部廣播事件
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = HTML_LANG_MAP[lang];
    }
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {}

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('logicore:lang-changed', { detail: { lang } })
      );
    }
  }, [lang]);

  // 跨分頁即時同步
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isValidLanguage(e.newValue)) {
        setLangState(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setLang = useCallback((newLang: Language) => {
    if (!isValidLanguage(newLang)) return;
    setLangState(newLang);
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => (prev === 'zh' ? 'en' : 'zh'));
  }, []);

  const t = useMemo<TranslateFunction>(() => {
    const currentDict = DICTIONARY[lang];
    const fallbackDict = DICTIONARY.en;

    const translateCallable = (
      key: TranslationKey,
      params?: Record<string, string | number>
    ): string => {
      const parts = key.split('.');
      let text = resolvePath(currentDict, parts) ?? resolvePath(fallbackDict, parts);

      if (text === null) {
        if (IS_DEV && !IS_TEST && !warnedKeysRef.current.has(key)) {
          warnedKeysRef.current.add(key);
          console.warn(`[i18n] Missing translation key: "${key}" for language "${lang}"`);
        }
        text = key;
      }

      if (params) {
        for (const [pKey, pVal] of Object.entries(params)) {
          text = text.split(`{${pKey}}`).join(String(pVal));
        }
      }

      return text;
    };

    const fullTranslate: TranslateFunction = Object.assign(translateCallable, {
      difficulty: currentDict.difficulty,
      common: currentDict.common,
      psychometrics: currentDict.psychometrics,
      engines: currentDict.engines,
    } satisfies {
      difficulty: Record<keyof TranslationSchema['difficulty'], string>;
      common: Record<keyof TranslationSchema['common'], string>;
      psychometrics: Record<keyof TranslationSchema['psychometrics'], string>;
      engines: Record<keyof TranslationSchema['engines'], string>;
    });

    return fullTranslate;
  }, [lang]);

  const value = useMemo<LanguageContextType>(
    () => ({
      lang,
      isEn: lang === 'en',
      setLang,
      toggleLang,
      t,
    }),
    [lang, setLang, toggleLang, t]
  );

  return (
    <LanguageContext.Provider value={value}>
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
