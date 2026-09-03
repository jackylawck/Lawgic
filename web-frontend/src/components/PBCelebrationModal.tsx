// web-frontend/src/components/PBCelebrationModal.tsx
import React, { useEffect, useMemo } from 'react';
import { PersonalBest } from '../hooks/useLearnerProfile';

interface Props {
  pb: PersonalBest;
  onClose: () => void;
  isEn?: boolean; // 設為可選，避免呼叫端漏傳導致編譯中斷
  improvedDeltaSec?: number;
}

export const PBCelebrationModal: React.FC<Props> = ({
  pb,
  onClose,
  isEn = true,
  improvedDeltaSec,
}) => {
  // 1. 豪華音效合成器 (含 iOS Safari resume 與水晶泛音)
  useEffect(() => {
    if (navigator.vibrate) {
      navigator.vibrate([30, 40, 30, 40, 150]);
    }

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const ctx = new AudioContextClass();

        if (ctx.state === 'suspended') {
          ctx.resume();
        }

        const playChime = (freq: number, start: number, duration: number, gainVal: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + start);

          gain.gain.setValueAtTime(gainVal, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + duration);
        };

        // 大三和弦琶音升調 + 水晶泛音 (C5 -> E5 -> G5 -> C6)
        playChime(523.25, 0.00, 0.35, 0.20);
        playChime(659.25, 0.12, 0.35, 0.22);
        playChime(783.99, 0.24, 0.45, 0.25);
        playChime(1046.50, 0.38, 0.65, 0.30);
        playChime(1318.51, 0.42, 0.50, 0.12);
      }
    } catch {
      // 靜默容錯
    }
  }, []);

  // 2. 鍵盤快速關閉
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 3. 純前端動態碎紙屑粒子
  const confettiParticles = useMemo(() => {
    return Array.from({ length: 24 }).map((_, i) => ({
      id: i,
      left: `${(i * 4.2 + (i % 3) * 2)}%`,
      delay: `${(i % 5) * 0.15}s`,
      duration: `${1.8 + (i % 4) * 0.3}s`,
      color: ['#f59e0b', '#38bdf8', '#10b981', '#a855f7', '#ec4899'][i % 5],
      size: `${6 + (i % 3) * 3}px`,
    }));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4 font-mono select-none overflow-hidden">
      {/* 粒子慶祝紙屑雨 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
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
            className="absolute -top-4 rounded-xs opacity-90 animate-confetti-fall"
          />
        ))}
      </div>

      {/* 彈窗主卡片 */}
      <div className="relative w-full max-w-xs bg-slate-900 border-2 border-amber-500/90 rounded-2xl p-5 text-center shadow-[0_0_50px_rgba(245,158,11,0.35)] animate-fade-in ring-4 ring-amber-500/20">
        <div className="text-4xl mb-1 animate-bounce">🏆</div>

        <div className="inline-block px-2 py-0.5 bg-amber-950/80 border border-amber-500/60 rounded-full text-[8px] font-bold text-amber-300 uppercase tracking-widest mb-1.5">
          {isEn ? 'All-Time Personal Best' : '突破歷史極限'}
        </div>

        <div className="text-amber-300 font-black text-sm sm:text-base tracking-wider uppercase drop-shadow-sm">
          {isEn ? 'New Personal Record!' : '刷新個人最高紀錄！'}
        </div>

        <div className="text-slate-400 text-[10px] mt-1 mb-3">
          {isEn
            ? 'Exceptional cognitive breakthrough in this category.'
            : '在此認知評估類別中達成卓越突破。'}
        </div>

        {/* 數值面板 */}
        <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-[9px] mb-4 text-left">
          <div className="border-r border-slate-800/80 pr-2">
            <div className="text-slate-500">{isEn ? 'Best Pace' : '最快速度'}</div>
            <div className="text-amber-300 font-black text-base flex items-baseline gap-1">
              <span>{pb.fastestTime}s</span>
              {improvedDeltaSec && improvedDeltaSec > 0 && (
                <span className="text-[7.5px] text-emerald-400 font-bold">
                  (-{improvedDeltaSec}s)
                </span>
              )}
            </div>
            <div className="text-[7px] text-slate-500">Mensa Top {Number((100 - pb.bestPercentile).toFixed(1))}%</div>
          </div>

          <div className="pl-1">
            <div className="text-slate-500">{isEn ? 'Clear Streak' : '連勝紀錄'}</div>
            <div className="text-emerald-400 font-black text-base">
              {pb.longestStreak} <span className="text-[8px] font-normal text-slate-400">clears</span>
            </div>
            <div className="text-[7px] text-slate-500">Acc: {Math.round(pb.highestAccuracy * 100)}%</div>
          </div>
        </div>

        {/* 關閉按鈕 */}
        <button
          onClick={onClose}
          className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-900/40 transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <span>{isEn ? 'Continue Journey' : '繼續前進'}</span>
          <span className="text-[9px] opacity-75 font-mono">(↵ Enter)</span>
        </button>
      </div>

      <style>{`
        @keyframes confettiFall {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(105vh) rotate(720deg);
            opacity: 0;
          }
        }
        .animate-confetti-fall {
          animation-name: confettiFall;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
      `}</style>
    </div>
  );
};
