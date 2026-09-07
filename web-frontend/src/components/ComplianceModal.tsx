// web-frontend/src/components/ComplianceModal.tsx
import React, { memo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface ComplianceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ComplianceModal: React.FC<ComplianceModalProps> = memo(({ isOpen, onClose }) => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-6 overflow-y-auto backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compliance-modal-title"
    >
      <div className="relative w-full max-w-2xl bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl p-5 sm:p-7 text-slate-300 font-mono text-xs max-h-[85vh] overflow-y-auto">
        {/* 關閉按鈕 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-full font-bold transition cursor-pointer border border-slate-700"
          aria-label="Close modal"
        >
          ✕
        </button>

        {/* 標題 */}
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-800">
          <span className="text-xl">⚖️</span>
          <div>
            <h2 id="compliance-modal-title" className="text-sm font-black text-indigo-400 uppercase tracking-wider">
              {isEn ? 'Architecture Governance & Legal Notice' : '系統架構治理與法律合規聲明'}
            </h2>
            <p className="text-[10px] text-slate-500">
              {isEn ? 'EU AI Act, GDPR, HK PDPO & Algorithmic Disclosure' : 'EU AI Act、GDPR、香港法例第486章及演算法定性聲明'}
            </p>
          </div>
        </div>

        {/* 內文區塊 */}
        <div className="space-y-4 text-[11px] leading-relaxed">
          {/* 1. 演算法定性 */}
          <section className="bg-slate-900/60 border border-slate-800/80 p-3 rounded-xl">
            <h3 className="font-bold text-slate-200 mb-1 flex items-center gap-1.5">
              <span>🛡️</span>
              <span>{isEn ? '1. Algorithmic Nature (No Black-Box AI)' : '1. 演算法定性（排除黑箱神經網絡）'}</span>
            </h3>
            <p className="text-slate-400">
              {isEn
                ? 'Lawgic operates exclusively on deterministic pseudo-random procedural algorithms (Mulberry32) and Constraint Satisfaction Problem (CSP) solvers. It does not invoke Large Language Models (LLMs) or autonomous black-box neural networks, exempting it from High-Risk classification under the EU AI Act (Regulation (EU) 2024/1689).'
                : 'Lawgic 平台所有 18 款謎題引擎均採用確定性程式化演算法（Mulberry32）與符號約束滿足問題（CSP）求解器。系統未搭載大型語言模型（LLM）或自主黑箱神經網絡，依據歐盟《人工智慧法案》（EU AI Act）規定，排除於高風險 AI 管轄範疇之外。'}
            </p>
          </section>

          {/* 2. 隱私與數據合規 */}
          <section className="bg-slate-900/60 border border-slate-800/80 p-3 rounded-xl">
            <h3 className="font-bold text-slate-200 mb-1 flex items-center gap-1.5">
              <span>🔒</span>
              <span>{isEn ? '2. Privacy by Design (GDPR & HK PDPO Cap. 486)' : '2. 架構隱私設計（GDPR 與香港個人資料私隱條例）'}</span>
            </h3>
            <p className="text-slate-400">
              {isEn
                ? 'All puzzle computations and psychometric metrics execute 100% client-side. Zero Personally Identifiable Information (PII) is captured, tracked, or sent to external servers, fully adhering to GDPR Privacy-by-Design and Hong Kong Personal Data (Privacy) Ordinance principles.'
                : '平台所有推導與認知數據均 100% 於使用者本地客戶端執行。系統不收集、不回傳任何個人身分資料（PII）或生物遙測數據至中央伺服器，嚴格恪守 GDPR「設計即隱私」（Privacy by Design）及香港法例第 486 章個人資料私隱原則。'}
            </p>
          </section>

          {/* 3. 心理測量免責 */}
          <section className="bg-slate-900/60 border border-slate-800/80 p-3 rounded-xl">
            <h3 className="font-bold text-amber-400 mb-1 flex items-center gap-1.5">
              <span>⚠️</span>
              <span>{isEn ? '3. Psychometric Simulation Disclaimer' : '3. 認知心理計量模擬免責聲明'}</span>
            </h3>
            <p className="text-slate-400">
              {isEn
                ? 'The Estimated IQ, CSEM, and IRT parameters provided are scientific simulations calibrated for mental training and entertainment. They DO NOT constitute formal clinical psychiatric diagnostic reports or certified neuropsychological credentials.'
                : '本平台呈現之流體智力估計（IQ）、測量標準誤（CSEM）與項目反應理論（IRT）數值，僅作為演算法自我挑戰之參考模擬，絕不構成任何臨床精神醫學診斷、神經心理學檢驗或法定資格評定。'}
            </p>
          </section>

          {/* 4. 責任限制 */}
          <section className="bg-slate-900/60 border border-slate-800/80 p-3 rounded-xl">
            <h3 className="font-bold text-slate-200 mb-1 flex items-center gap-1.5">
              <span>📜</span>
              <span>{isEn ? '4. "AS-IS" Limitation of Liability' : '4. 原樣交付與責任限制'}</span>
            </h3>
            <p className="text-slate-400">
              {isEn
                ? 'Lawgic is provided "AS-IS" without warranties of any kind. Under no circumstances shall the author be liable for any direct or indirect liabilities arising from its operation or local data retention.'
                : '本平台依「現狀/原樣」（AS-IS）提供，不附帶任何明示或默示擔保。開發者毋須對任何因使用本系統或本機數據存儲所引致之衍生責任或損失負責。'}
            </p>
          </section>
        </div>

        {/* 底部確認按鈕 */}
        <div className="mt-5 pt-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold rounded-lg transition cursor-pointer shadow-lg shadow-indigo-600/20"
          >
            {isEn ? 'I Understand and Acknowledge' : '我已知悉並確認上述聲明'}
          </button>
        </div>
      </div>
    </div>
  );
});

ComplianceModal.displayName = 'ComplianceModal';
