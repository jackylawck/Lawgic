// web-frontend/src/components/LangSwitcher.tsx
import React, { useCallback, useRef, useMemo } from 'react';
import { useLanguage, Language, SUPPORTED_LANGUAGES } from '../contexts/LanguageContext';
import { useAccessibilitySettings, useAccessibilityActions } from '../contexts/AccessibilityContext';

interface LangLabelMeta {
  readonly native: string;
  readonly desc: Record<Language, string>;
  readonly currentDesc: Record<Language, string>;
  readonly announced: Record<Language, string>;
}

const CONTAINER_PADDING_PX = 2; // 對應容器 p-0.5 (2px)

const RADIOGROUP_LABEL: Record<Language, string> = {
  zh: '語言切換選項',
  en: 'Language selection',
};

const LANG_LABELS: Record<Language, LangLabelMeta> = {
  zh: {
    native: '繁中',
    desc: {
      en: 'Switch to Traditional Chinese',
      zh: '切換至繁體中文',
    },
    currentDesc: {
      en: 'Traditional Chinese, current language',
      zh: '繁體中文，當前語言',
    },
    announced: {
      en: 'Language switched to Traditional Chinese',
      zh: '語言已切換至繁體中文',
    },
  },
  en: {
    native: 'EN',
    desc: {
      en: 'Switch to English',
      zh: '切換至英文',
    },
    currentDesc: {
      en: 'English, current language',
      zh: '英文，當前語言',
    },
    announced: {
      en: 'Language switched to English',
      zh: '語言已切換至英文',
    },
  },
};

export const LangSwitcher: React.FC = () => {
  const { lang, setLang } = useLanguage();

  // 深度整合全域無障礙生態：前庭保護、觸覺偏好與語音播報
  const { reducedMotion, hapticFeedback } = useAccessibilitySettings();
  const { announce } = useAccessibilityActions();

  // 泛化動態 Ref 字典
  const buttonRefs = useRef<Partial<Record<Language, HTMLButtonElement | null>>>({});

  // 參照絕對穩定的 Ref Callbacks：消除每次渲染因箭頭函式重建引起的 DOM detach/reattach
  // 註：Object.fromEntries 原生回傳型別為 string key，此處依賴 SUPPORTED_LANGUAGES 作為單一事實來源進行安全斷言
  const setButtonRef = useMemo(
    () =>
      Object.fromEntries(
        SUPPORTED_LANGUAGES.map((code) => [
          code,
          (el: HTMLButtonElement | null) => {
            buttonRefs.current[code] = el;
          },
        ])
      ) as Record<Language, (el: HTMLButtonElement | null) => void>,
    []
  );

  const triggerHaptic = useCallback(() => {
    // 設計決策：前庭敏感使用者通常對突發感官刺激同樣敏感，
    // 因此在 reducedMotion 啟用時，一併壓制實體觸覺震動
    if (!hapticFeedback || reducedMotion) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(10);
      } catch {}
    }
  }, [hapticFeedback, reducedMotion]);

  const handleSelect = useCallback(
    (target: Language) => {
      if (lang === target) return;

      triggerHaptic();
      setLang(target);

      // 設計決策：播報採用「切換前」的 UI 語言（以當前 lang 索引），
      // 因為視障使用者在此刻仍處於舊語言的認知脈絡中，理解成本最低
      const announcement = LANG_LABELS[target].announced[lang];
      announce(announcement, 'assertive');
    },
    [lang, triggerHaptic, setLang, announce]
  );

  // WAI-ARIA Radio Group 標準漫遊焦點：以全域 SUPPORTED_LANGUAGES 為單一事實來源
  // 完整遵循 WAI-ARIA APG 規範：
  // 1. 方向鍵環形步進
  // 2. Home / End 鍵支援直達首尾
  // 3. 不攔截 Escape 避免將焦點拋至 body，允許鍵盤使用者以原生 Tab 順暢移轉
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = SUPPORTED_LANGUAGES.indexOf(lang);
      if (currentIndex === -1) return;

      let targetIndex: number | null = null;
      const total = SUPPORTED_LANGUAGES.length;

      if (e.key === 'Home') {
        e.preventDefault();
        targetIndex = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        targetIndex = total - 1;
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        targetIndex = (currentIndex + 1) % total;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        targetIndex = (currentIndex - 1 + total) % total;
      }

      if (targetIndex !== null) {
        const nextLang = SUPPORTED_LANGUAGES[targetIndex];
        handleSelect(nextLang);
        buttonRefs.current[nextLang]?.focus();
      }
    },
    [lang, handleSelect]
  );

  // 滑動膠囊幾何全量動態派生（支援 2 到 N 種語言，與 flex-1 嚴格等寬完全貼合）
  const pillStyle = useMemo(() => {
    const total = SUPPORTED_LANGUAGES.length;
    const currentIndex = Math.max(0, SUPPORTED_LANGUAGES.indexOf(lang));
    // 嚴格代數推導：可用寬度為 (100% - 雙側 padding)，每個按鈕平分 1/total
    const width = `calc((100% - ${CONTAINER_PADDING_PX * 2}px) / ${total})`;
    // 當膠囊寬度精確等於單一按鈕寬度時，位移直接為自身寬度之倍數，零幾何漂移
    const transform = `translate3d(${currentIndex * 100}%, 0, 0)`;

    return {
      width,
      transform,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- SUPPORTED_LANGUAGES 為模組頂層常數
  }, [lang]);

  return (
    <div
      role="radiogroup"
      aria-label={RADIOGROUP_LABEL[lang]}
      className="relative flex items-center bg-slate-950/90 border border-slate-800/90 rounded-lg p-0.5 text-[8.5px] font-mono select-none backdrop-blur-xs shadow-inner"
    >
      {/* 物理滑動底色膠囊
          設計決策：若啟用 reducedMotion 則立即跳轉（無 transition 與 will-change），
          維持前庭無障礙「瞬移而非動畫」的標準行為；顯式 left-0.5 鎖定定位起點；aria-hidden 杜絕讀屏干擾 */}
      <div
        className={`absolute top-0.5 bottom-0.5 left-0.5 bg-gradient-to-r from-indigo-600 to-indigo-500 rounded-md shadow-xs pointer-events-none ${
          reducedMotion ? '' : 'transition-transform duration-200 ease-out will-change-transform'
        }`}
        style={pillStyle}
        aria-hidden="true"
      />

      {/* 遍歷 SUPPORTED_LANGUAGES 動態渲染，符合標準 Roving Tabindex 語意 */}
      {SUPPORTED_LANGUAGES.map((code) => {
        const isSelected = lang === code;
        const meta = LANG_LABELS[code];

        /* 語意誠實化：未選中時為動作指引（切換至…），已選中時為狀態回報（…，當前語言）
           註：與 aria-checked 輕微冗餘為保守設計，確保不同螢幕閱讀器均能正確播報 */
        const accessibleDesc = isSelected ? meta.currentDesc[lang] : meta.desc[lang];

        return (
          <button
            key={code}
            ref={setButtonRef[code]}
            type="button"
            /* 採用 <button role="radio"> 混合模式：由 button 原生保證鍵盤與點擊行為，
               role="radio" 傳達單選語意，完全符合 WAI-ARIA APG 實踐標準 */
            role="radio"
            aria-checked={isSelected}
            /* aria-label 完整覆蓋按鈕文字：螢幕閱讀器讀完整語意句而非「繁中/EN」縮寫 */
            aria-label={accessibleDesc}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => handleSelect(code)}
            onKeyDown={handleKeyDown}
            /* 使用 flex-1 強制所有語系選項平分容器寬度 (1/N)，
               徹底杜絕 CJK 全形與 ASCII 半形自然寬度不一致引發的膠囊錯位 */
            className={`relative z-10 flex-1 px-2 py-0.5 rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 flex items-center justify-center font-bold tracking-wider cursor-pointer ${
              reducedMotion ? '' : 'transition-colors duration-150 active:scale-95'
            } ${isSelected ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {meta.native}
          </button>
        );
      })}
    </div>
  );
};
