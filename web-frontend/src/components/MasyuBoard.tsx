// web-frontend/src/components/MasyuBoard.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  MasyuSpec,
  MasyuHintStep,
  WebMasyuGenerator,
  generateMasyuSignature,
} from '../engines/masyuGenerator';
import { VaultManager } from '../utils/vaultStorage';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

export const MasyuBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as MasyuSpec;
  const size = spec?.size || 5;
  const grid = spec?.grid || [];
  const seed = (actualPuzzle?.metrics as any)?.seed || 12345;
  const turnDensity = (actualPuzzle?.metrics as any)?.turnDensity || spec?.turnDensity || 0.35;

  const boardRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Set<string>>(new Set());
  const [blockedEdges, setBlockedEdges] = useState<Set<string>>(new Set());
  const [dragStart, setDragStart] = useState<[number, number] | null>(null);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isTimeOut, setIsTimeOut] = useState<boolean>(false);
  const [isFav, setIsFav] = useState<boolean>(false);
  const [sanctionedSig, setSanctionedSig] = useState<string>('');

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<MasyuHintStep | null>(null);

  const timeLimit = actualPuzzle?.metrics?.estimated_time_sec || 150;
  const [remainingSec, setRemainingSec] = useState<number>(timeLimit);
  const [accumulatedMs, setAccumulatedMs] = useState<number>(0);
  const lastActiveTimestamp = useRef<number>(performance.now());

  useEffect(() => {
    setEdges(new Set());
    setBlockedEdges(new Set());
    setDragStart(null);
    setIsCompleted(false);
    setIsTimeOut(false);
    setRemainingSec(timeLimit);
    setAccumulatedMs(0);
    setHintLevel(0);
    setActiveHint(null);
    setSanctionedSig('');
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
    lastActiveTimestamp.current = performance.now();
    requestAnimationFrame(() => boardRef.current?.focus());
  }, [actualPuzzle?.id, size, timeLimit]);

  useEffect(() => {
    if (isCompleted || isTimeOut) return;
    const timer = setInterval(() => {
      const now = performance.now();
      const delta = now - lastActiveTimestamp.current;
      lastActiveTimestamp.current = now;

      setAccumulatedMs((prev) => {
        const next = prev + delta;
        if (tournamentMode) {
          const spent = Math.floor(next / 1000);
          const left = Math.max(0, timeLimit - spent);
          setRemainingSec(left);
          if (left === 0) setIsTimeOut(true);
        }
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [isCompleted, isTimeOut, tournamentMode, timeLimit]);

  // 格點度數分析（防止 > 2 產生分叉歧路）
  const nodeDegrees = useMemo(() => {
    const degMap = new Map<string, number>();
    edges.forEach((key) => {
      const [r1, c1, r2, c2] = key.split(',').map(Number);
      const k1 = `${r1},${c1}`;
      const k2 = `${r2},${c2}`;
      degMap.set(k1, (degMap.get(k1) || 0) + 1);
      degMap.set(k2, (degMap.get(k2) || 0) + 1);
    });
    return degMap;
  }, [edges]);

  const toggleEdge = useCallback(
    (r1: number, c1: number, r2: number, c2: number, isRightClick: boolean = false) => {
      if (isCompleted || isTimeOut) return;
      const key = WebMasyuGenerator.makeEdgeKey(r1, c1, r2, c2);

      if (isRightClick) {
        setBlockedEdges((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
        setEdges((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        return;
      }

      setHintLevel(0);
      setActiveHint(null);

      setEdges((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);

        setBlockedEdges((bPrev) => {
          const bNext = new Set(bPrev);
          bNext.delete(key);
          return bNext;
        });

        if (WebMasyuGenerator.validateSolution(grid, next, size)) {
          setIsCompleted(true);
          const spent = Math.max(1, Math.round(accumulatedMs / 1000));
          generateMasyuSignature(`MASYU-${actualPuzzle?.id}-${spent}-${seed}`).then(setSanctionedSig);

          if (actualPuzzle) {
            recordAttempt({
              puzzleId: actualPuzzle.id,
              engineType: 'masyu',
              tier: (actualPuzzle.tier as TierKey) || 'kids',
              cognitiveLoad: { spatial: 0.98, numeric: 0.1, workingMemory: 0.75, inhibition: 0.92 },
              isSuccess: true,
              timeSpentSec: spent,
              conflictsCount: 0,
              technique: 'EulerianLoopClosure',
              isPureClear: hintLevel === 0,
            });
          }
        }
        return next;
      });
    },
    [isCompleted, isTimeOut, grid, size, accumulatedMs, actualPuzzle, recordAttempt, hintLevel, seed]
  );

  const handlePointerDown = (r: number, c: number, e: React.PointerEvent) => {
    if (e.button === 2) return;
    setDragStart([r, c]);
  };

  const handlePointerEnter = (r: number, c: number) => {
    if (!dragStart) return;
    const [sr, sc] = dragStart;
    if (Math.abs(sr - r) + Math.abs(sc - c) === 1) {
      toggleEdge(sr, sc, r, c, false);
      setDragStart([r, c]);
    }
  };

  const handlePointerUp = () => {
    setDragStart(null);
  };

  const handleRequestHint = useCallback(() => {
    if (isCompleted || isTimeOut || tournamentMode) return;
    const step = WebMasyuGenerator.getNextForcedDeduction(grid, edges, size);
    if (!step) return;

    if (!activeHint || activeHint.r !== step.r || activeHint.c !== step.c) {
      setActiveHint(step);
      setHintLevel(1);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, isTimeOut, tournamentMode, grid, edges, size, activeHint]);

  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const nextFav = VaultManager.toggleFavorite({
      id: actualPuzzle.id,
      engine: 'masyu',
      tier: String(actualPuzzle.tier || 'kids'),
      seed: Number(seed),
      steps: edges.size,
      timeSpentSec: Math.round(accumulatedMs / 1000),
      date: new Date().toLocaleDateString(),
    });
    setIsFav(nextFav);
  };

  const cellSize = Math.min(270 / size, size >= 9 ? 30 : 44);
  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  return (
    <div
      ref={boardRef}
      onPointerUp={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
      tabIndex={0}
      className="relative flex flex-col items-center justify-center p-2 select-none font-mono outline-none w-full max-w-[380px] mx-auto"
    >
      {/* 頂部看板 */}
      <div className="w-full flex items-center justify-between gap-1 mb-2 px-1 text-[7.5px]">
        <div className="flex items-center gap-1.5">
          <div className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-center">
            <span className="text-slate-500">{tournamentMode ? (isEn ? 'Countdown' : '倒數') : (isEn ? 'Time' : '耗時')}: </span>
            <span className={`font-bold ${tournamentMode && remainingSec <= 30 ? 'text-rose-400 animate-pulse' : 'text-slate-200'}`}>
              {tournamentMode ? `${remainingSec}s` : `${(accumulatedMs / 1000).toFixed(1)}s`}
            </span>
          </div>
          <div className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-cyan-300 font-bold">
            {isEn ? 'Edges' : '線段'}: {edges.size}
          </div>
        </div>

        <div className="flex items-center gap-1 text-slate-400 font-semibold">
          {tournamentMode ? (
            <span className="text-amber-400 font-bold">
              🏆 {isEn ? 'WPF Sanctioned' : 'WPF 賽事鎖定'}
            </span>
          ) : (
            <button
              onClick={handleToggleFavorite}
              className={`px-1.5 py-0.5 rounded border transition cursor-pointer ${
                isFav ? 'border-amber-500 text-amber-300 bg-amber-950' : 'border-slate-700 text-slate-500'
              }`}
            >
              {isFav ? (isEn ? '★ Vault' : '★ 傳奇') : (isEn ? '☆ Star' : '☆ 收藏')}
            </button>
          )}
          <span className="text-slate-600">|</span>
          <span className="text-purple-300 font-bold">
            {isEn ? 'Turn Density' : '折角密度'}: {turnDensity}
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-cyan-400 font-bold">{size}&times;{size}</span>
        </div>
      </div>

      {/* 棋盤主體 */}
      <div className="p-3 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl flex flex-col items-center">
        <div
          className="relative grid gap-0 bg-slate-900/90 border border-slate-800 select-none touch-none"
          style={{
            gridTemplateColumns: `repeat(${size}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${size}, ${cellSize}px)`,
          }}
        >
          {Array.from({ length: size }).map((_, r) =>
            Array.from({ length: size }).map((__, c) => {
              const cellCoordKey = `${r},${c}`;
              const deg = nodeDegrees.get(cellCoordKey) || 0;
              const hasBranchError = deg > 2;
              const pearl = grid[r]?.[c] || 'none';
              const rightKey = WebMasyuGenerator.makeEdgeKey(r, c, r, c + 1);
              const bottomKey = WebMasyuGenerator.makeEdgeKey(r, c, r + 1, c);
              const hasRightEdge = edges.has(rightKey);
              const hasBottomEdge = edges.has(bottomKey);
              const isRightBlocked = blockedEdges.has(rightKey);
              const isBottomBlocked = blockedEdges.has(bottomKey);
              const isHintTarget = activeHint?.r === r && activeHint?.c === c && hintLevel > 0;

              return (
                <div
                  key={`cell-${r}-${c}`}
                  onPointerDown={(e) => handlePointerDown(r, c, e)}
                  onPointerEnter={() => handlePointerEnter(r, c)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (c + 1 < size) toggleEdge(r, c, r, c + 1, true);
                  }}
                  className={`relative flex items-center justify-center border border-slate-800/40 cursor-crosshair ${
                    isHintTarget ? 'ring-2 ring-amber-400 animate-pulse bg-amber-950/20' : ''
                  }`}
                  style={{ width: cellSize, height: cellSize }}
                >
                  <div className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    hasBranchError ? 'bg-rose-500 scale-150 ring-2 ring-rose-400' : 'bg-slate-700/50'
                  }`} />

                  {pearl === 'white' && (
                    <div
                      className="absolute rounded-full border-2 border-slate-200 bg-white shadow-[0_0_10px_rgba(255,255,255,0.85)] z-10 pointer-events-none"
                      style={{ width: cellSize * 0.55, height: cellSize * 0.55 }}
                    />
                  )}
                  {pearl === 'black' && (
                    <div
                      className="absolute rounded-full border-2 border-slate-500 bg-slate-950 shadow-[0_0_10px_rgba(0,0,0,0.95)] z-10 pointer-events-none"
                      style={{ width: cellSize * 0.55, height: cellSize * 0.55 }}
                    />
                  )}

                  {hasRightEdge && (
                    <div
                      className="absolute left-1/2 top-1/2 -translate-y-1/2 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)] z-0 pointer-events-none"
                      style={{ width: cellSize, height: 3.5 }}
                    />
                  )}
                  {isRightBlocked && (
                    <div className="absolute left-full top-1/2 -translate-x-1/2 -translate-y-1/2 text-rose-500 font-bold text-xs pointer-events-none z-10">
                      ✕
                    </div>
                  )}

                  {hasBottomEdge && (
                    <div
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)] z-0 pointer-events-none"
                      style={{ height: cellSize, width: 3.5 }}
                    />
                  )}
                  {isBottomBlocked && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 -translate-y-1/2 text-rose-500 font-bold text-xs pointer-events-none z-10">
                      ✕
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 控制與手勢指引 */}
      <div className="w-full max-w-[280px] flex items-center justify-between px-1 mt-2 text-[7px] text-slate-500 font-mono">
        <span>{isEn ? 'Left-click/Drag: Draw' : '左鍵/拖曳: 連線'}</span>
        <span>{isEn ? 'Right-click: Cross ✕' : '右鍵: 標記 ✕'}</span>
        <span>{isEn ? '⚪ Straight+Turn' : '⚪ 直穿+轉角'}</span>
        <span>{isEn ? '⚫ Turn+Straight' : '⚫ 轉折+直行'}</span>
      </div>

      {/* 三階因果提示階梯 */}
      {!tournamentMode && (
        <div className="flex items-center justify-between w-full max-w-[280px] mt-2 gap-1.5">
          <button
            onClick={handleRequestHint}
            disabled={isCompleted || isTimeOut}
            className="w-full py-1.5 text-xs font-bold rounded-lg border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition flex items-center justify-center gap-1 shadow disabled:opacity-40 cursor-pointer"
          >
            💡 {isEn ? 'Hint Ladder [H]' : '因果提示階梯 [H]'}
          </button>
        </div>
      )}

      {hintLevel > 0 && activeHint && (
        <div className="mt-2 p-2 rounded-xl text-center w-full max-w-[280px] font-mono border bg-slate-900/90 border-amber-500/60 text-slate-200 text-[8px]">
          <div className="text-[7.5px] font-bold text-amber-300 mb-0.5">
            🔮 {isEn ? 'MASYU DEDUCTIVE CHAIN' : '珍珠迴路・因果推導'}
          </div>
          <div>
            {hintLevel === 1 && (
              <span>
                {isEn
                  ? `🔍 Inspect pearl parity at [${activeHint.r + 1}, ${activeHint.c + 1}]`
                  : `🔍 審視珍珠坐標 [${activeHint.r + 1}, ${activeHint.c + 1}] 的幾何定式`}
              </span>
            )}
            {hintLevel === 2 && (
              <span className="text-cyan-300 font-bold">
                ⚡ {isEn ? (activeHint.humanReadable.en || activeHint.rationale) : activeHint.humanReadable.zh}
              </span>
            )}
            {hintLevel === 3 && (
              <span className="text-rose-400 font-extrabold">
                {isEn
                  ? `🎯 Forced segment deduction: ${activeHint.forcedEdge || 'Cell requires an orthogonal turn!'}`
                  : `🎯 定式強制線段：${activeHint.forcedEdge || '該格必須直角轉折！'}`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 通關成就面板 */}
      {isCompleted && (
        <div className="mt-2.5 p-3 bg-slate-950 border border-emerald-500/80 rounded-xl text-center w-full max-w-[320px] shadow-2xl font-mono animate-fade-in">
          <div className="text-emerald-400 font-bold text-xs mb-0.5 uppercase tracking-wider">
            {isEn ? 'EULERIAN LOOP CLOSED!' : '歐拉單一閉環完全收斂！'}
          </div>

          {sanctionedSig && (
            <div className="my-1.5 py-1 px-2 bg-slate-900 border border-indigo-700/60 rounded text-[7px] text-indigo-300 flex items-center justify-between">
              <span>🛡️ {isEn ? 'SHA-256 Sanctioned Hash:' : 'SHA-256 賽事認證:'}</span>
              <span className="font-bold text-cyan-300">{sanctionedSig}</span>
            </div>
          )}

          <div className="text-[8.5px] text-slate-300 mb-1">
            {isEn
              ? `Time: ${(accumulatedMs / 1000).toFixed(2)}s | Single Loop Unbroken | Gf: IQ ${cci.standardIQ}`
              : `耗時: ${(accumulatedMs / 1000).toFixed(2)}s | 歐拉單一閉環無割裂 | Gf: IQ ${cci.standardIQ}`}
          </div>
          <div className="text-[8px] text-cyan-400 font-bold">
            {isEn
              ? '✨ White/Black pearl orthogonality & arm lengths strictly converged.'
              : '✨ 白珍珠直穿轉角、黑珍珠轉折直伸幾何約束完全收斂'}
          </div>
        </div>
      )}
    </div>
  );
};
