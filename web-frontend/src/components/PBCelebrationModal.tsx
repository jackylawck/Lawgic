// web-frontend/src/components/PBCelebrationModal.tsx
import React, { useEffect, useMemo, useRef, useId, useCallback } from 'react';
import { PersonalBest } from '../hooks/useLearnerProfile';
import { useLanguage, Language } from '../contexts/LanguageContext';
import {
  useAccessibilitySettings,
  useAccessibilityActions,
  ColorBlindMode,
} from '../contexts/AccessibilityContext';

export interface PBCelebrationModalProps {
  readonly pb: PersonalBest;
  readonly onClose: () => void;
  readonly improvedDeltaSec?: number;
  /** 現代化語言參數，優先級高於 Context */
  readonly forceLang?: Language;
  /** @deprecated 向下相容舊版棋盤傳參，建議改用 forceLang 或交由 Context 自動派發 */
  readonly isEn?: boolean;
}

interface Particle {
  readonly id: number;
  readonly left: string;
  readonly delay: string;
  readonly duration: string;
  readonly color: string;
  readonly size: string;
}

interface ModalTextBundle {
  readonly dialogLabel: string;
  readonly badge: string;
  readonly heading: string;
  readonly subheading: string;
  readonly bestPace: string;
  readonly clearStreak: string;
  readonly clearsUnit: string;
  readonly topPercent: string;
  readonly accuracy: string;
  readonly continueBtn: string;
  readonly enterHint: string;
  readonly closeBtnAria: string;
  readonly statsGroupLabel: string;
}

const MODAL_TEXT = {
  en: {
    dialogLabel: 'Personal Record Breakthrough',
    badge: 'All-Time Personal Best',
    heading: 'New Personal Record!',
    subheading: 'Exceptional cognitive breakthrough in this category.',
    bestPace: 'Best Pace',
    clearStreak: 'Clear Streak',
    clearsUnit: 'clears',
    topPercent: 'Top',
    accuracy: 'Acc:',
    continueBtn: 'Continue Journey',
    enterHint: '(↵ Enter)',
    closeBtnAria: 'Continue journey and close record celebration',
    statsGroupLabel: 'Record statistics',
  },
  zh: {
    dialogLabel: '個人最佳紀錄突破',
    badge: '突破歷史極限',
    heading: '刷新個人最高紀錄！',
    subheading: '在此認知評估類別中達成卓越突破。',
    bestPace: '最快速度',
    clearStreak: '連勝紀錄',
    clearsUnit: '次',
    topPercent: '全域優於',
    accuracy: '勝率:',
    continueBtn: '繼續前進',
    enterHint: '(↵ Enter)',
    closeBtnAria: '繼續前進並關閉紀錄慶祝彈窗',
    statsGroupLabel: '紀錄統計數據',
  },
} as const satisfies Record<Language, ModalTextBundle>;

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function sanitizeNumber(val: unknown, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

/**
 * 依據色盲模式派發 Okabe-Ito 安全慶祝粒子色票
 */
function resolveConfettiPalette(mode: ColorBlindMode): readonly string[] {
  if (mode === 'achromatopsia') {
    return ['#ffffff', '#cbd5e1', '#94a3b8', '#64748b', '#334155'];
  }
  if (mode === 'protanopia' || mode === 'deuteranopia') {
    // 藍-琥珀光譜，避開長中波紅綠混淆線
    return ['#0072b2', '#e69f00', '#56b4e9', '#f0e442', '#ffffff'];
  }
  if (mode === 'tritanopia') {
    // 硃砂紅-藍綠補償，避開短波藍黃混淆線
    return ['#d55e00', '#009e73', '#cc79a7', '#56b4e9', '#ffffff'];
  }
  // 預設全色域歡慶色譜
  return ['#f59e0b', '#38bdf8', '#10b981', '#a855f7', '#ec4899'];
}

export const PBCelebrationModal: React.FC<PBCelebrationModalProps> = ({
  pb,
  onClose,
  improvedDeltaSec,
  forceLang,
  isEn: propIsEn,
}) => {
  const { lang: contextLang } = useLanguage();
  // 兼顧向前擴充與向下相容解析
  const currentLang: Language =
    forceLang || (propIsEn !== undefined ? (propIsEn ? 'en' : 'zh') : contextLang);
  const isEn = currentLang === 'en';
  const t = MODAL_TEXT[currentLang];

  // 深度整合全域無障礙體系
  const { soundFeedback, hapticFeedback, reducedMotion, colorBlindMode } =
    useAccessibilitySettings();
  const { playSound, announce } = useAccessibilityActions();

  const uniqueId = useId();
  const titleId = `pb-title-${uniqueId}`;
  const descId = `pb-desc-${uniqueId}`;
  const statsId = `pb-stats-${uniqueId}`;

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const hasTriggeredSensoryFeedback = useRef(false);

  // 1. 防禦性記憶焦點：排除不可聚焦的 document.body，並在卸載時精確還原 (WCAG 2.4.3)
  useEffect(() => {
    const prev = document.activeElement;
    previouslyFocusedElementRef.current =
      prev instanceof HTMLElement && prev !== document.body ? prev : null;
    closeButtonRef.current?.focus();

    return () => {
      previouslyFocusedElementRef.current?.focus();
    };
  }, []);

  // 2. 數值防禦清洗 (零缺陷計算)
  const safeFastestTime = useMemo(
    () => sanitizeNumber(pb.fastestTime, Number.POSITIVE_INFINITY),
    [pb.fastestTime]
  );
  const safeStreak = useMemo(
    () => Math.max(0, sanitizeNumber(pb.longestStreak, 0)),
    [pb.longestStreak]
  );
  const safeAccuracy = useMemo(() => {
    const raw = sanitizeNumber(pb.highestAccuracy, 1);
    return Math.max(0, Math.min(1, raw));
  }, [pb.highestAccuracy]);
  const safePercentile = useMemo(() => {
    const raw = sanitizeNumber(pb.bestPercentile, 50);
    return Math.max(0, Math.min(100, raw));
  }, [pb.bestPercentile]);
  const safeDelta = useMemo(
    () => (improvedDeltaSec !== undefined ? sanitizeNumber(improvedDeltaSec, 0) : undefined),
    [improvedDeltaSec]
  );

  const displayFastestTime = useMemo(() => {
    if (safeFastestTime >= 9999 || safeFastestTime <= 0) return '--';
    return `${Number(safeFastestTime.toFixed(2))}s`;
  }, [safeFastestTime]);

  const topPercentileText = useMemo(() => {
    const diff = 100 - safePercentile;
    return `${Math.max(0.1, Number(diff.toFixed(1)))}%`;
  }, [safePercentile]);

  const accuracyText = useMemo(() => `${Math.round(safeAccuracy * 100)}%`, [safeAccuracy]);

  // 3. 一次性實體反饋（音效 + 震動）：受 ref 鎖定，消除生命週期內重複觸發
  /* 設計決策：React 18 StrictMode 下 dev 環境會雙觸發音效/震動（mount → unmount → remount）。
     這是 StrictMode 用於偵測副作用的刻意行為；生產環境在單次 mount 週期內僅觸發一次。 */
  useEffect(() => {
    if (!hasTriggeredSensoryFeedback.current) {
      hasTriggeredSensoryFeedback.current = true;

      // 委託全域單例 Master Bus 播放，尊重靜音設定與型別合約
      if (soundFeedback) {
        playSound('celebration');
      }

      // 尊重觸覺偏好與前庭敏感抑制
      if (
        hapticFeedback &&
        !reducedMotion &&
        typeof navigator !== 'undefined' &&
        navigator.vibrate
      ) {
        try {
          navigator.vibrate([30, 40, 30, 40, 150]);
        } catch {}
      }
    }
  }, [soundFeedback, hapticFeedback, reducedMotion, playSound]);

  // 4. 響應式螢幕閱讀器廣播通知 (assertive 緊急插播)
  useEffect(() => {
    const summary = isEn
      ? `New Personal Record Breakthrough! Best Pace: ${displayFastestTime}, Longest Streak: ${safeStreak} clears, Accuracy: ${accuracyText}.`
      : `刷新個人最高紀錄！最快速度：${displayFastestTime}，連勝紀錄：${safeStreak}次，勝率：${accuracyText}。`;
    announce(summary, 'assertive');
  }, [announce, isEn, displayFastestTime, safeStreak, accuracyText]);

  // 5. 泛化 WAI-ARIA Focus Trap 焦點陷阱與 Escape 解鎖
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        // 防禦：若無可聚焦元素，放行原生 Tab 離開，杜絕鍵盤陷阱 (WCAG 2.1.2)
        if (focusable.length === 0) {
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        // 環形焦點循環
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose]
  );

  // 6. 點擊遮罩層焦點拉回機制
  /* 設計決策：點擊遮罩僅拉回焦點，不關閉 Modal。
     慶祝時刻應由使用者主動確認（點擊按鈕或 Escape），
     避免意外點擊丟失 PB 慶祝畫面。這與一般 Modal 的「點擊遮罩關閉」慣例不同。 */
  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      closeButtonRef.current?.focus();
    }
  }, []);

  // 7. 前庭無障礙碎紙屑粒子 (若啟用 reducedMotion 則徹底跳過計算與記憶體配置)
  const confettiPalette = useMemo(() => resolveConfettiPalette(colorBlindMode), [colorBlindMode]);

  const confettiParticles = useMemo<readonly Particle[]>(() => {
    if (reducedMotion) return [];
    return Array.from({ length: 24 }).map((_, i) => ({
      id: i,
      left: `${i * 4.2 + (i % 3) * 2}%`,
      delay: `${(i % 5) * 0.15}s`,
      duration: `${1.8 + (i % 4) * 0.3}s`,
      color: confettiPalette[i % confettiPalette.length],
      size: `${6 + (i % 3) * 3}px`,
    }));
  }, [reducedMotion, confettiPalette]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      /* 設計決策：aria-describedby 僅指向子標題 descId，避免初次聚焦時大量傾瀉統計數據引發認知過載；
         詳細數據由上述 announce 結構化播報與使用者巡航閱讀承載 */
      aria-describedby={descId}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4 font-mono select-none overflow-hidden"
    >
      {/* 粒子慶祝紙屑雨 (前庭保護：若啟用 reducedMotion 則徹底不掛載) */}
      {!reducedMotion && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          {confettiParticles.map((p) => (
            <div
              key={p.id}
              style={{
                left: p.left,
                animationDelay: p.delay,
                animationDuration: p.duration,
                backgroundColor: p.color,
                width: p.size,
                height: p.size,
              }}
              className="absolute -top-4 rounded-xs opacity-90 animate-confetti-fall will-change-transform"
            />
          ))}
        </div>
      )}

      {/* 彈窗主卡片 */}
      <div
        className={`relative w-full max-w-xs bg-slate-900 border-2 border-amber-500/90 rounded-2xl p-5 text-center shadow-[0_0_50px_rgba(245,158,11,0.35)] ring-4 ring-amber-500/20 ${
          reducedMotion ? '' : 'animate-fade-in'
        }`}
      >
        <div
          className={`text-4xl mb-1 ${reducedMotion ? '' : 'animate-bounce'}`}
          aria-hidden="true"
        >
          🏆
        </div>

        <div className="inline-block px-2 py-0.5 bg-amber-950/80 border border-amber-500/60 rounded-full text-[8px] font-bold text-amber-300 uppercase tracking-widest mb-1.5">
          {t.badge}
        </div>

        <h2
          id={titleId}
          className="text-amber-300 font-black text-sm sm:text-base tracking-wider uppercase drop-shadow-xs m-0"
        >
          {t.heading}
        </h2>

        <p id={descId} className="text-slate-400 text-[10px] mt-1 mb-3">
          {t.subheading}
        </p>

        {/* 數值面板 (提升為 role="group" 消除孤島 ID 並支援螢幕閱讀器 Landmark 導航) */}
        <div
          id={statsId}
          role="group"
          aria-label={t.statsGroupLabel}
          className="grid grid-cols-2 gap-1.5 bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-[9px] mb-4 text-left"
        >
          <div className="border-r border-slate-800/80 pr-2">
            <div className="text-slate-500">{t.bestPace}</div>
            <div className="text-amber-300 font-black text-base flex items-baseline gap-1">
              <span>{displayFastestTime}</span>
              {safeDelta !== undefined && safeDelta > 0 && (
                <span className="text-[7.5px] text-emerald-400 font-bold">
                  (-{safeDelta.toFixed(1)}s)
                </span>
              )}
            </div>
            <div className="text-[7px] text-slate-500">
              {t.topPercent} {topPercentileText}
            </div>
          </div>

          <div className="pl-1">
            <div className="text-slate-500">{t.clearStreak}</div>
            <div className="text-emerald-400 font-black text-base">
              {safeStreak}{' '}
              <span className="text-[8px] font-normal text-slate-400">{t.clearsUnit}</span>
            </div>
            <div className="text-[7px] text-slate-500">
              {t.accuracy} {accuracyText}
            </div>
          </div>
        </div>

        {/* 關閉按鈕 */}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={t.closeBtnAria}
          className={`w-full py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-900/40 flex items-center justify-center gap-1.5 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
            reducedMotion ? '' : 'transition active:scale-95'
          }`}
        >
          <span>{t.continueBtn}</span>
          <span className="text-[9px] opacity-75 font-mono" aria-hidden="true">
            {t.enterHint}
          </span>
        </button>
      </div>
    </div>
  );
};
