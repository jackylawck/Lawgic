// web-frontend/src/components/PBCelebrationModal.tsx
import React, { useEffect } from 'react';
import { PersonalBest } from '../hooks/useLearnerProfile';

interface Props {
  pb: PersonalBest;
  onClose: () => void;
  isEn: boolean;
}

export const PBCelebrationModal: React.FC<Props> = ({ pb, onClose, isEn }) => {
  useEffect(() => {
    if (navigator.vibrate) {
      navigator.vibrate([40, 30, 40, 30, 120]);
    }

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const ctx = new AudioContextClass();
        const playTone = (freq: number, start: number, duration: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
          gain.gain.setValueAtTime(0.15, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + duration);
        };
        playTone(523.25, 0.0, 0.18); // C5
        playTone(659.25, 0.15, 0.18); // E5
        playTone(783.99, 0.3, 0.35); // G5
      }
    } catch {
      // 靜默容錯
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 font-mono select-none">
      <div className="w-full max-w-xs bg-slate-900 border-2 border-amber-500/90 rounded-2xl p-5 text-center shadow-2xl animate-fade-in ring-4 ring-amber-500/20">
        <div className="text-4xl mb-2 animate-bounce">🏆</div>
        <div className="text-amber-300 font-black text-sm tracking-wider uppercase">
          {isEn ? 'New Personal Record!' : '刷新個人最高紀錄！'}
        </div>
        <div className="text-slate-400 text-[10px] mt-1 mb-3">
          {isEn ? 'You broke your best pace in this cognitive tier.' : '成功打破在此認知難度階梯的最速紀錄。'}
        </div>

        <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-2 rounded-xl border border-slate-800 text-[9px] mb-4">
          <div>
            <div className="text-slate-500">{isEn ? 'Best Pace' : '最快紀錄'}</div>
            <div className="text-amber-300 font-bold text-xs">{pb.fastestTime}s</div>
          </div>
          <div>
            <div className="text-slate-500">{isEn ? 'Streak' : '連勝紀錄'}</div>
            <div className="text-emerald-400 font-bold text-xs">{pb.longestStreak} clears</div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg transition active:scale-95"
        >
          {isEn ? 'Continue Journey' : '繼續前進'}
        </button>
      </div>
    </div>
  );
};
