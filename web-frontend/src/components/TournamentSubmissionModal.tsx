// web-frontend/src/components/TournamentSubmissionModal.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

export interface TournamentSubmissionPayload {
  submissionId: string;
  tournamentId: string;
  playerId: string;
  division: string;
  puzzleId: string;
  engineType: string;
  tier: string;
  timeSpentSec: number;
  conflictsCount: number;
  infractionScore: number;
  environment: Record<string, any>;
  timestamp: string;
}

interface Props {
  payload: TournamentSubmissionPayload;
  onClose: () => void;
  isEn?: boolean;
}

export const TournamentSubmissionModal: React.FC<Props> = ({
  payload,
  onClose,
  isEn: propIsEn,
}) => {
  const { lang } = useLanguage();
  const isEn = propIsEn !== undefined ? propIsEn : lang === 'en';

  const [copied, setCopied] = useState<boolean>(false);
  const jsonBundle = JSON.stringify(payload, null, 2);

  // 鍵盤 Escape 快速關閉
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopy = useCallback(() => {
    if (typeof window !== 'undefined' && 'navigator' in window && navigator.clipboard) {
      navigator.clipboard.writeText(jsonBundle);
      setCopied(true);
      if (navigator.vibrate) navigator.vibrate(15);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [jsonBundle]);

  const handleDownloadJson = useCallback(() => {
    const blob = new Blob([jsonBundle], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Submission_${payload.submissionId.slice(0, 12)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    if (navigator.vibrate) navigator.vibrate(20);
  }, [jsonBundle, payload.submissionId]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEn ? 'Tournament Submission Receipt' : '賽事認證存證單'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-3 font-mono select-none"
    >
      <div className="w-full max-w-sm bg-slate-950 border border-amber-500/80 rounded-xl p-4 shadow-2xl animate-fade-in text-left">
        {/* 頂部標題列 */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
          <div className="text-xs font-black text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>🏆</span>
            <span>{isEn ? 'Tournament Submission Receipt' : '賽事認證存證單'}</span>
          </div>
          <span className="text-[7px] px-1.5 py-0.5 bg-emerald-950 border border-emerald-500 text-emerald-300 font-bold rounded">
            {isEn ? 'VERIFIED' : '已驗證存證'}
          </span>
        </div>

        {/* 核心認證指標欄 */}
        <div className="grid grid-cols-2 gap-1.5 text-[8px] text-slate-400 mb-2">
          <div>
            {isEn ? 'ID' : '存證編號'}:{' '}
            <strong className="text-slate-200">{payload.submissionId.slice(0, 14)}...</strong>
          </div>
          <div>
            {isEn ? 'Tier' : '題目難度'}:{' '}
            <strong className="text-cyan-300 uppercase">{payload.tier}</strong>
          </div>
          <div>
            {isEn ? 'Duration' : '作答時間'}:{' '}
            <strong className="text-slate-200">{payload.timeSpentSec}s</strong>
          </div>
          <div>
            {isEn ? 'Infractions' : '違規評分'}:{' '}
            <strong className={payload.infractionScore > 0 ? 'text-rose-400' : 'text-emerald-400'}>
              {payload.infractionScore}
            </strong>
          </div>
        </div>

        {/* JSON 存證代碼容器 */}
        <div className="relative bg-slate-900 border border-slate-800 rounded-lg p-2 text-[6.5px] text-cyan-400/80 max-h-32 overflow-y-auto mb-3 break-all select-all font-mono">
          <pre>{jsonBundle}</pre>
        </div>

        {/* 操作按鈕組 */}
        <div className="flex gap-1.5">
          <button
            onClick={handleCopy}
            className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[8px] font-bold rounded-lg transition active:scale-95 cursor-pointer"
          >
            {copied ? (isEn ? '✓ Copied' : '✓ 已複製') : (isEn ? 'Copy JSON' : '複製 JSON')}
          </button>
          <button
            onClick={handleDownloadJson}
            className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 border border-cyan-700/60 text-cyan-300 text-[8px] font-bold rounded-lg transition active:scale-95 cursor-pointer"
            title={isEn ? 'Download Receipt File' : '下載存證檔案'}
          >
            📥
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-400 text-slate-950 text-[8px] font-black rounded-lg transition shadow active:scale-95 cursor-pointer"
          >
            {isEn ? 'Confirm' : '確認完成'}
          </button>
        </div>
      </div>
    </div>
  );
};
