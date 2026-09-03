// web-frontend/src/components/TournamentSubmissionModal.tsx
import React, { useState } from 'react';

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

export const TournamentSubmissionModal: React.FC<Props> = ({ payload, onClose, isEn = false }) => {
  const [copied, setCopied] = useState<boolean>(false);

  const jsonBundle = JSON.stringify(payload, null, 2);

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(jsonBundle);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-3 font-mono select-none">
      <div className="w-full max-w-sm bg-slate-950 border border-amber-500/80 rounded-xl p-4 shadow-2xl animate-fade-in text-left">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
          <div className="text-xs font-black text-amber-300 uppercase tracking-wider flex items-center gap-1">
            <span>🏆</span>
            <span>{isEn ? 'Tournament Receipt' : '賽事認證存證單'}</span>
          </div>
          <span className="text-[7px] px-1.5 py-0.2 bg-emerald-950 border border-emerald-500 text-emerald-300 font-bold rounded">
            VERIFIED
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[8px] text-slate-400 mb-2">
          <div>ID: <strong className="text-slate-200">{payload.submissionId.slice(0, 16)}...</strong></div>
          <div>Tier: <strong className="text-cyan-300 uppercase">{payload.tier}</strong></div>
          <div>Time: <strong className="text-slate-200">{payload.timeSpentSec}s</strong></div>
          <div>Infraction: <strong className={payload.infractionScore > 0 ? 'text-rose-400' : 'text-emerald-400'}>{payload.infractionScore}</strong></div>
        </div>

        <div className="relative bg-slate-900 border border-slate-800 rounded-lg p-2 text-[6.5px] text-cyan-400/80 max-h-32 overflow-y-auto mb-3 break-all select-all font-mono">
          <pre>{jsonBundle}</pre>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[8px] font-bold rounded-lg transition"
          >
            {copied ? (isEn ? '✓ Copied' : '✓ 已複製') : (isEn ? 'Copy JSON' : '複製 JSON')}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-400 text-slate-950 text-[8px] font-black rounded-lg transition shadow"
          >
            {isEn ? 'Confirm' : '確認完成'}
          </button>
        </div>
      </div>
    </div>
  );
};
