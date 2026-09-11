// web-frontend/src/components/TournamentSubmissionModal.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { useLanguage, Language } from '../contexts/LanguageContext';
import {
  useAccessibilitySettings,
  useAccessibilityActions,
} from '../contexts/AccessibilityContext';

export interface TournamentSubmissionPayload {
  readonly submissionId: string;
  readonly tournamentId: string;
  readonly playerId: string;
  readonly division: string;
  readonly puzzleId: string;
  readonly engineType: string;
  readonly tier: string;
  readonly timeSpentSec: number;
  readonly conflictsCount: number;
  readonly infractionScore: number;
  readonly environment: Readonly<Record<string, string | number | boolean | null>>;
  readonly timestamp: string;
}

export interface TournamentSubmissionModalProps {
  readonly payload: TournamentSubmissionPayload;
  readonly onClose: () => void;
  /** 現代化語言參數，優先級高於 Context */
  readonly forceLang?: Language;
  /** @deprecated 向下相容舊版調用端傳參，建議改用 forceLang 或交由 Context 自動派發 */
  readonly isEn?: boolean;
}

interface ModalTextBundle {
  readonly dialogLabel: string;
  readonly title: string;
  readonly verifiedBadge: string;
  readonly submissionIdLabel: string;
  readonly tierLabel: string;
  readonly durationLabel: string;
  readonly infractionsLabel: string;
  readonly copyBtn: string;
  readonly copiedBtn: string;
  readonly copySuccessAnnounce: string;
  readonly copyFailAnnounce: string;
  readonly downloadAria: string;
  readonly confirmBtn: string;
  readonly codeContainerAria: string;
}

const MODAL_TEXT = {
  en: {
    dialogLabel: 'Tournament Submission Receipt',
    title: 'Tournament Submission Receipt',
    verifiedBadge: 'VERIFIED',
    submissionIdLabel: 'ID',
    tierLabel: 'Tier',
    durationLabel: 'Duration',
    infractionsLabel: 'Infractions',
    copyBtn: 'Copy JSON',
    copiedBtn: '✓ Copied',
    copySuccessAnnounce: 'Submission JSON bundle copied to clipboard',
    copyFailAnnounce: 'Failed to copy JSON to clipboard',
    downloadAria: 'Download submission receipt JSON file',
    confirmBtn: 'Confirm',
    codeContainerAria: 'Tournament submission JSON data contents',
  },
  zh: {
    dialogLabel: '賽事認證存證單',
    title: '賽事認證存證單',
    verifiedBadge: '已驗證存證',
    submissionIdLabel: '存證編號',
    tierLabel: '題目難度',
    durationLabel: '作答時間',
    infractionsLabel: '違規評分',
    copyBtn: '複製 JSON',
    copiedBtn: '✓ 已複製',
    copySuccessAnnounce: '存證 JSON 數據包已複製至剪貼簿',
    copyFailAnnounce: '複製 JSON 至剪貼簿失敗',
    downloadAria: '下載存證 JSON 檔案',
    confirmBtn: '確認完成',
    codeContainerAria: '賽事存證 JSON 數據內容',
  },
} as const satisfies Record<Language, ModalTextBundle>;

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function sanitizeNumber(val: unknown, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

export const TournamentSubmissionModal: React.FC<TournamentSubmissionModalProps> = ({
  payload,
  onClose,
  forceLang,
  isEn: propIsEn,
}) => {
  const { lang: contextLang } = useLanguage();
  const currentLang: Language =
    forceLang || (propIsEn !== undefined ? (propIsEn ? 'en' : 'zh') : contextLang);
  const isEn = currentLang === 'en';
  const t = MODAL_TEXT[currentLang];

  const { hapticFeedback, reducedMotion } = useAccessibilitySettings();
  const { announce, playSound } = useAccessibilityActions();

  const [copied, setCopied] = useState<boolean>(false);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const uniqueId = useId();
  const titleId = `receipt-title-${uniqueId}`;
  const statsId = `receipt-stats-${uniqueId}`;

  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  // 1. 記憶焦點並在卸載時精確還原 (WCAG 2.4.3)
  useEffect(() => {
    const prev = document.activeElement;
    previouslyFocusedElementRef.current =
      prev instanceof HTMLElement && prev !== document.body ? prev : null;
    primaryButtonRef.current?.focus();

    return () => {
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      previouslyFocusedElementRef.current?.focus();
    };
  }, []);

  // 2. 數值防禦清洗與序列化記憶化
  const safeSubmissionId = useMemo(
    () => (typeof payload.submissionId === 'string' ? payload.submissionId : 'UNKNOWN'),
    [payload.submissionId]
  );
  const safeTimeSpent = useMemo(
    () => sanitizeNumber(payload.timeSpentSec, 0),
    [payload.timeSpentSec]
  );
  const safeInfractionScore = useMemo(
    () => sanitizeNumber(payload.infractionScore, 0),
    [payload.infractionScore]
  );

  const jsonBundle = useMemo(() => {
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return '{}';
    }
  }, [payload]);

  // 3. 異步複製處理：資料誠實性 + 屏幕閱讀器播報 + 觸覺反饋
  const handleCopy = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      announce(t.copyFailAnnounce, 'assertive');
      return;
    }

    try {
      await navigator.clipboard.writeText(jsonBundle);
      setCopied(true);
      playSound('click');

      // 設計決策：前庭敏感使用者通常對突發感官刺激同樣敏感，因此在 reducedMotion 啟用時一併壓制實體觸覺震動
      if (hapticFeedback && !reducedMotion && navigator.vibrate) {
        try {
          navigator.vibrate(15);
        } catch {}
      }

      announce(t.copySuccessAnnounce, 'polite');

      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[TournamentSubmissionModal] Clipboard write rejected:', err);
      }
      announce(t.copyFailAnnounce, 'assertive');
    }
  }, [jsonBundle, hapticFeedback, reducedMotion, playSound, announce, t.copySuccessAnnounce, t.copyFailAnnounce]);

  // 4. 檔案下載：延遲撤銷 URL 防競態 + 檔名特殊字元過濾 + Firefox DOM 掛載修復
  const handleDownloadJson = useCallback(() => {
    try {
      const blob = new Blob([jsonBundle], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safePrefix = safeSubmissionId.slice(0, 12).replace(/[/\\:*?"<>|]/g, '_');

      link.href = url;
      link.download = `Submission_${safePrefix || 'receipt'}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      playSound('step');

      // 設計決策：前庭敏感使用者通常對突發感官刺激同樣敏感，因此在 reducedMotion 啟用時一併壓制實體觸覺震動
      if (hapticFeedback && !reducedMotion && navigator.vibrate) {
        try {
          navigator.vibrate(20);
        } catch {}
      }

      // 延遲 1000ms 釋放，防範 WebKit / Gecko 異步讀取 Blob 前 URL 即失效
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[TournamentSubmissionModal] JSON download failed:', err);
      }
    }
  }, [jsonBundle, safeSubmissionId, hapticFeedback, reducedMotion, playSound]);

  // 5. 泛化 WAI-ARIA Focus Trap 與 Escape 監聽
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
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

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

  // 6. 遮罩點擊拉回焦點
  /* 設計決策：點擊遮罩僅拉回焦點，不關閉存證單。
     存證收據為重要審計資產，應由使用者主動按「確認完成」或 Escape 退出，避免誤觸遺失畫面。 */
  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      primaryButtonRef.current?.focus();
    }
  }, []);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      /* 設計決策：aria-describedby 指向統計群組，讓使用者一次聽完所有認證指標。
         存證單資訊密度緊湊適中，符合單次閱讀預期。 */
      aria-describedby={statsId}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-3 font-mono select-none"
    >
      <div
        className={`w-full max-w-sm bg-slate-950 border border-amber-500/80 rounded-xl p-4 shadow-2xl text-left ${
          reducedMotion ? '' : 'animate-fade-in'
        }`}
      >
        {/* 頂部標題列 */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
          <div className="text-xs font-black text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
            <span aria-hidden="true">🏆</span>
            <h2 id={titleId} className="text-xs font-black m-0 p-0 inline">
              {t.title}
            </h2>
          </div>
          <span className="text-[7px] px-1.5 py-0.5 bg-emerald-950 border border-emerald-500 text-emerald-300 font-bold rounded">
            {t.verifiedBadge}
          </span>
        </div>

        {/* 核心認證指標欄 */}
        <div id={statsId} role="group" aria-label={t.title} className="grid grid-cols-2 gap-1.5 text-[8px] text-slate-400 mb-2">
          <div>
            {t.submissionIdLabel}:{' '}
            <strong className="text-slate-200">
              {safeSubmissionId.slice(0, 14)}
              {safeSubmissionId.length > 14 ? '...' : ''}
            </strong>
          </div>
          <div>
            {t.tierLabel}: <strong className="text-cyan-300 uppercase">{payload.tier || '--'}</strong>
          </div>
          <div>
            {t.durationLabel}: <strong className="text-slate-200">{safeTimeSpent}s</strong>
          </div>
          <div>
            {t.infractionsLabel}:{' '}
            <strong className={safeInfractionScore > 0 ? 'text-rose-400' : 'text-emerald-400'}>
              {safeInfractionScore}
            </strong>
          </div>
        </div>

        {/* JSON 存證代碼容器 (降級為 role="group" 避免 Landmark 泛濫，文字直觀化) */}
        <div
          role="group"
          aria-label={t.codeContainerAria}
          tabIndex={0}
          className="relative bg-slate-900 border border-slate-800 rounded-lg p-2 text-[6.5px] text-cyan-400/80 max-h-32 overflow-y-auto mb-3 break-all select-all font-mono focus:outline-none focus:ring-1 focus:ring-amber-400/50"
        >
          <pre className="m-0">{jsonBundle}</pre>
        </div>

        {/* 操作按鈕組 */}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className={`flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[8px] font-bold rounded-lg cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
              reducedMotion ? '' : 'transition active:scale-95'
            }`}
          >
            {copied ? t.copiedBtn : t.copyBtn}
          </button>
          <button
            type="button"
            onClick={handleDownloadJson}
            aria-label={t.downloadAria}
            className={`px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-cyan-700/60 text-cyan-300 text-[8px] font-bold rounded-lg cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
              reducedMotion ? '' : 'transition active:scale-95'
            }`}
          >
            <span aria-hidden="true">📥</span>
          </button>
          <button
            ref={primaryButtonRef}
            type="button"
            onClick={onClose}
            className={`flex-1 py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-400 text-slate-950 text-[8px] font-black rounded-lg shadow cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
              reducedMotion ? '' : 'transition active:scale-95'
            }`}
          >
            {t.confirmBtn}
          </button>
        </div>
      </div>
    </div>
  );
};
