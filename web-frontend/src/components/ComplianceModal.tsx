// web-frontend/src/components/ComplianceModal.tsx
import React, {
  memo,
  useEffect,
  useRef,
  useCallback,
  useId,
} from 'react';
import { useLanguage, Language } from '../contexts/LanguageContext';
import {
  useAccessibilitySettings,
  useAccessibilityActions,
} from '../contexts/AccessibilityContext';

interface Props {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly forceLang?: Language;
}

interface ComplianceSection {
  readonly id: string;
  readonly icon: string;
  readonly title: Record<Language, string>;
  readonly body: Record<Language, string>;
  readonly isWarning?: boolean;
}

interface ModalTextBundle {
  readonly modalTitle: string;
  readonly modalSubtitle: string;
  readonly closeAria: string;
  readonly confirmBtn: string;
  readonly announceOpened: string;
  readonly announceClosed: string;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const MODAL_TEXT: Record<Language, ModalTextBundle> = {
  en: {
    modalTitle: 'Architecture Governance & Legal Notice',
    modalSubtitle: 'EU AI Act, GDPR, HK PDPO & Algorithmic Disclosure',
    closeAria: 'Close compliance notice',
    confirmBtn: 'I Understand and Acknowledge',
    announceOpened: 'Architecture governance and legal compliance notice opened.',
    announceClosed: 'Compliance notice dismissed.',
  },
  zh: {
    modalTitle: '系統架構治理與法律合規聲明',
    modalSubtitle: 'EU AI Act、GDPR、香港法例第486章及演算法定性聲明',
    closeAria: '關閉合規聲明',
    confirmBtn: '我已知悉並確認上述聲明',
    announceOpened: '系統架構治理與法律合規聲明已開啟。',
    announceClosed: '已關閉合規聲明。',
  },
};

const COMPLIANCE_SECTIONS: readonly ComplianceSection[] = [
  {
    id: 'algo-nature',
    icon: '🛡️',
    title: {
      en: '1. Algorithmic Nature (No Black-Box AI)',
      zh: '1. 演算法定性（排除黑箱神經網絡）',
    },
    body: {
      en: 'Lawgic operates exclusively on deterministic pseudo-random procedural algorithms (Mulberry32) and Constraint Satisfaction Problem (CSP) solvers. It does not invoke Large Language Models (LLMs) or autonomous black-box neural networks, exempting it from High-Risk classification under the EU AI Act (Regulation (EU) 2024/1689).',
      zh: 'Lawgic 平台所有 18 款謎題引擎均採用確定性程式化演算法（Mulberry32）與符號約束滿足問題（CSP）求解器。系統未搭載大型語言模型（LLM）或自主黑箱神經網絡，依據歐盟《人工智慧法案》（EU AI Act）規定，排除於高風險 AI 管轄範疇之外。',
    },
  },
  {
    id: 'privacy-design',
    icon: '🔒',
    title: {
      en: '2. Privacy by Design (GDPR & HK PDPO Cap. 486)',
      zh: '2. 架構隱私設計（GDPR 與香港個人資料私隱條例）',
    },
    body: {
      en: 'All puzzle computations and psychometric metrics execute 100% client-side. Zero Personally Identifiable Information (PII) is captured, tracked, or sent to external servers, fully adhering to GDPR Privacy-by-Design and Hong Kong Personal Data (Privacy) Ordinance principles.',
      zh: '平台所有推導與認知數據均 100% 於使用者本地客戶端執行。系統不收集、不回傳任何個人身分資料（PII）或生物遙測數據至中央伺服器，嚴格恪守 GDPR「設計即隱私」（Privacy by Design）及香港法例第 486 章個人資料私隱原則。',
    },
  },
  {
    id: 'psychometric-disclaimer',
    icon: '⚠️',
    isWarning: true,
    title: {
      en: '3. Psychometric Simulation Disclaimer',
      zh: '3. 認知心理計量模擬免責聲明',
    },
    body: {
      en: 'The Estimated IQ, CSEM, and IRT parameters provided are scientific simulations calibrated for mental training and entertainment. They DO NOT constitute formal clinical psychiatric diagnostic reports or certified neuropsychological credentials.',
      zh: '本平台呈現之流體智力估計（IQ）、測量標準誤（CSEM）與項目反應理論（IRT）數值，僅作為演算法自我挑戰之參考模擬，絕不構成任何臨床精神醫學診斷、神經心理學檢驗或法定資格評定。',
    },
  },
  {
    id: 'limitation-liability',
    icon: '📜',
    title: {
      en: '4. "AS-IS" Limitation of Liability',
      zh: '4. 原樣交付與責任限制',
    },
    body: {
      en: 'Lawgic is provided "AS-IS" without warranties of any kind. Under no circumstances shall the author be liable for any direct or indirect liabilities arising from its operation or local data retention.',
      zh: '本平台依「現狀/原樣」（AS-IS）提供，不附帶任何明示或默示擔保。開發者毋須對任何因使用本系統或本機數據存儲所引致之衍生責任或損失負責。',
    },
  },
] as const;

export const ComplianceModal = memo(function ComplianceModal({
  isOpen,
  onClose,
  forceLang,
}: Props) {
  const { lang: contextLang } = useLanguage();
  const currentLang = forceLang || contextLang;
  const text = MODAL_TEXT[currentLang] || MODAL_TEXT.en;

  const { reducedMotion } = useAccessibilitySettings();
  const { playSound, announce } = useAccessibilityActions();

  const modalId = useId();
  const titleId = `${modalId}-title`;
  const subtitleId = `${modalId}-subtitle`;

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  // 統一關閉邏輯
  const handleDismiss = useCallback(() => {
    playSound('click');
    announce(text.announceClosed, 'polite');
    onClose();
  }, [onClose, playSound, announce, text.announceClosed]);

  // 1. Ref 依賴錨定：鎖定最新函式與文字引用，杜絕語言切換時重啟 Effect 造成焦點彈跳
  const dismissRef = useRef(handleDismiss);
  useEffect(() => {
    dismissRef.current = handleDismiss;
  }, [handleDismiss]);

  const announceOpenedRef = useRef(text.announceOpened);
  useEffect(() => {
    announceOpenedRef.current = text.announceOpened;
  }, [text.announceOpened]);

  // 2. 嚴格防誤觸背景點擊：MouseDown 與 MouseUp 均須落在覆蓋層自身
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    mouseDownTargetRef.current = e.target;
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) {
        dismissRef.current();
      }
      mouseDownTargetRef.current = null;
    },
    []
  );

  // 3. 模態核心生命週期（只受 isOpen 啟閉驅動）
  useEffect(() => {
    if (!isOpen) return;

    // 記憶開啟前的觸發點
    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;

    playSound('step');
    announce(announceOpenedRef.current, 'polite');

    // 同步聚焦首個可互動元素（DOM 已於 commit 階段就緒，消滅無謂的 setTimeout 延遲）
    if (dialogRef.current) {
      const firstFocusable = dialogRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      firstFocusable?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissRef.current();
        return;
      }

      // 環形 Focus Trap
      if (e.key === 'Tab') {
        if (!dialogRef.current) return;
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        );
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
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const prev = previouslyFocusedElementRef.current;
      // 深度防禦：確認節點未被父層熱重載卸載才歸還焦點
      if (prev?.isConnected) {
        prev.focus();
      }
    };
  }, [isOpen, playSound, announce]);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={subtitleId}
      onMouseDown={handleMouseDown}
      onClick={handleBackdropClick}
      className={`fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-6 overflow-y-auto backdrop-blur-sm ${
        reducedMotion ? '' : 'animate-fade-in'
      }`}
    >
      <div
        role="document"
        className="relative w-full max-w-2xl bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl p-5 sm:p-7 text-slate-300 font-mono text-xs max-h-[85vh] overflow-y-auto"
      >
        {/* 頂部關閉按鈕 */}
        <button
          type="button"
          onClick={handleDismiss}
          className={`absolute top-4 right-4 w-7 h-7 flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-full font-bold cursor-pointer border border-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
            reducedMotion ? '' : 'transition'
          }`}
          aria-label={text.closeAria}
        >
          ✕
        </button>

        {/* 標題欄 */}
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-800 pr-8">
          <span aria-hidden="true" className="text-xl">⚖️</span>
          <div>
            <h2 id={titleId} className="text-sm font-black text-indigo-400 uppercase tracking-wider m-0">
              {text.modalTitle}
            </h2>
            <p id={subtitleId} className="text-[10px] text-slate-500 m-0 mt-0.5">
              {text.modalSubtitle}
            </p>
          </div>
        </div>

        {/* 結構化合規條款 */}
        <div className="space-y-3 text-[11px] leading-relaxed">
          {COMPLIANCE_SECTIONS.map((sec) => (
            <section
              key={sec.id}
              className="bg-slate-900/60 border border-slate-800/80 p-3 rounded-xl"
            >
              <h3
                className={`font-bold mb-1 flex items-center gap-1.5 m-0 text-xs ${
                  sec.isWarning ? 'text-amber-400' : 'text-slate-200'
                }`}
              >
                <span aria-hidden="true">{sec.icon}</span>
                <span>{sec.title[currentLang]}</span>
              </h3>
              <p className="text-slate-400 m-0 mt-1">
                {sec.body[currentLang]}
              </p>
            </section>
          ))}
        </div>

        {/* 底部確認按鈕 */}
        <div className="mt-5 pt-3 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={handleDismiss}
            className={`px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg cursor-pointer shadow-lg shadow-indigo-600/20 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              reducedMotion ? '' : 'transition active:scale-95'
            }`}
          >
            {text.confirmBtn}
          </button>
        </div>
      </div>
    </div>
  );
});
