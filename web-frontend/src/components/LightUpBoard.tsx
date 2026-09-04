// web-frontend/src/components/LightUpBoard.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  LightUpSpec,
  WebLightUpGenerator,
  LightUpStep,
  ExtendedTierKey,
  generateAkariSignature,
} from '../engines/lightupGenerator';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';
import { VaultManager } from '../utils/vaultStorage';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

type CellState = 0 | 1 | 2 | 3;

export const LightUpBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const {
    recordAttempt,
    profile,
    getCompositeCognitiveIndex,
    getSpatialCompositeIndex,
    exportLongitudinalDataset,
  } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as LightUpSpec;
  const rows = spec?.rows || 5;
  const cols = spec?.cols || 5;
  const blackBlocks = spec?.blackBlocks || [];
  const solvingSteps = spec?.solvingSteps || [];
  const tier = (spec?.tier || actualPuzzle?.tier || 'kids') as ExtendedTierKey;

  const [board, setBoard] = useState<CellState[][]>(() => {
    const b: CellState[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const blk of blackBlocks) b[blk.r][blk.c] = 2;
    return b;
  });

  const [pencilNotes, setPencilNotes] = useState<boolean[][]>(() =>
    Array.from({ length: rows }, () => Array(cols).fill(false))
  );

  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [remainingSec, setRemainingSec] = useState<number>(
    actualPuzzle?.metrics?.estimated_time_sec || 90
  );
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);
  const [isFav, setIsFav] = useState<boolean>(false);

  // 模式控制
  const [isNoGuessMode, setIsNoGuessMode] = useState<boolean>(!tournamentMode);
  const [isNoteMode, setIsNoteMode] = useState<boolean>(false);
  const [isFocusDarkness, setIsFocusDarkness] = useState<boolean>(false);
  const [guessWarning, setGuessWarning] = useState<string | null>(null);
  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHintStep, setActiveHintStep] = useState<LightUpStep | null>(null);
  const [boardScale, setBoardScale] = useState<number>(1.0);

  const [totalActions, setTotalActions] = useState<number>(0);
  const [corrections, setCorrections] = useState<number>(0);

  const startTimeRef = useRef<number>(Date.now());
  const hasRecordedRef = useRef<boolean>(false);

  const timeLimitSec = actualPuzzle?.metrics?.estimated_time_sec || 90;

  useEffect(() => {
    const b: CellState[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const blk of blackBlocks) b[blk.r][blk.c] = 2;
    setBoard(b);
    setPencilNotes(Array.from({ length: rows }, () => Array(cols).fill(false)));
    setIsCompleted(false);
    setElapsedMs(0);
    setRemainingSec(timeLimitSec);
    setTotalActions(0);
    setCorrections(0);
    setProofSignature(null);
    setGuessWarning(null);
    setHintLevel(0);
    setActiveHintStep(null);
    setIsFocusDarkness(false);
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
    startTimeRef.current = Date.now();
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id, rows, cols, timeLimitSec]);

  useEffect(() => {
    if (isCompleted) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const spent = now - startTimeRef.current;
      setElapsedMs(spent);

      if (tournamentMode) {
        const left = Math.max(0, timeLimitSec - Math.floor(spent / 1000));
        setRemainingSec(left);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted, tournamentMode, timeLimitSec]);

  const litMatrix = useMemo(() => {
    const lit: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
    const isBlock = (r: number, c: number) => board[r][c] === 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          const cells = WebLightUpGenerator.getIlluminatedCells(r, c, rows, cols, isBlock);
          for (const [ir, ic] of cells) lit[ir][ic] = true;
        }
      }
    }
    return lit;
  }, [board, rows, cols]);

  const blockStatusMap = useMemo(() => {
    const map = new Map<string, { current: number; target: number; state: 'under' | 'exact' | 'over' }>();
    const orth = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const blk of blackBlocks) {
      if (blk.clue !== null && blk.clue !== undefined) {
        let count = 0;
        for (const [dr, dc] of orth) {
          const nr = blk.r + dr;
          const nc = blk.c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === 1) count++;
        }
        const state = count === blk.clue ? 'exact' : count < blk.clue ? 'under' : 'over';
        map.set(`${blk.r},${blk.c}`, { current: count, target: blk.clue, state });
      }
    }
    return map;
  }, [board, blackBlocks, rows, cols]);

  const cellSize = Math.min(300 / Math.max(rows, cols), 42);

  const rayLines = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const isBlock = (r: number, c: number) => board[r][c] === 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          const cx = c * (cellSize + 4) + cellSize / 2 + 6;
          const cy = r * (cellSize + 4) + cellSize / 2 + 6;

          let tr = r - 1;
          while (tr >= 0 && !isBlock(tr, c)) tr--;
          lines.push({ x1: cx, y1: cy, x2: cx, y2: (tr + 1) * (cellSize + 4) + 6 });

          let br = r + 1;
          while (br < rows && !isBlock(br, c)) br++;
          lines.push({ x1: cx, y1: cy, x2: cx, y2: br * (cellSize + 4) + cellSize + 6 });

          let lc = c - 1;
          while (lc >= 0 && !isBlock(r, lc)) lc--;
          lines.push({ x1: cx, y1: cy, x2: (lc + 1) * (cellSize + 4) + 6, y2: cy });

          let rc = c + 1;
          while (rc < cols && !isBlock(r, rc)) rc++;
          lines.push({ x1: cx, y1: cy, x2: rc * (cellSize + 4) + cellSize + 6, y2: cy });
        }
      }
    }
    return lines;
  }, [board, rows, cols, cellSize]);

  const checkVictory = useCallback(
    (curBoard: CellState[][]): boolean => {
      const isBlock = (r: number, c: number) => curBoard[r][c] === 2;
      const lit: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (curBoard[r][c] === 1) {
            const cells = WebLightUpGenerator.getIlluminatedCells(r, c, rows, cols, isBlock);
            for (const [ir, ic] of cells) {
              if (!(ir === r && ic === c) && curBoard[ir][ic] === 1) return false;
              lit[ir][ic] = true;
            }
          }
        }
      }

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (curBoard[r][c] !== 2 && !lit[r][c]) return false;
        }
      }

      for (const blk of blackBlocks) {
        if (blk.clue !== null && blk.clue !== undefined) {
          let count = 0;
          const orth = [[-1, 0], [1, 0], [0, -1], [0, 1]];
          for (const [dr, dc] of orth) {
            const nr = blk.r + dr;
            const nc = blk.c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && curBoard[nr][nc] === 1) count++;
          }
          if (count !== blk.clue) return false;
        }
      }

      return true;
    },
    [rows, cols, blackBlocks]
  );

  const triggerVictory = useCallback(async () => {
    setIsCompleted(true);
    const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

    if (!hasRecordedRef.current && actualPuzzle) {
      hasRecordedRef.current = true;
      recordAttempt({
        puzzleId: actualPuzzle.id,
        engineType: 'lightup',
        tier: (actualPuzzle.tier as TierKey) || 'kids',
        cognitiveLoad: actualPuzzle.cognitiveLoad || {
          spatial: 0.98,
          numeric: 0.45,
          workingMemory: 0.8,
          inhibition: 0.92,
        },
        isSuccess: true,
        timeSpentSec: timeSpent,
        conflictsCount: corrections,
        technique: 'RayCastingIlluminance',
        isPureClear: corrections === 0 && hintLevel === 0,
      });

      const signature = await generateAkariSignature(
        `AKARI-${actualPuzzle.id}-${timeSpent}-${tier.toUpperCase()}`
      );
      setProofSignature(signature);

      if (timeSpent <= profile.personalBest.fastestTime) {
        setShowPBModal(true);
      }
    }
  }, [actualPuzzle, corrections, tier, recordAttempt, profile.personalBest.fastestTime, hintLevel]);

  const handleRequestHint = useCallback(() => {
    if (isCompleted || tournamentMode) return;

    const deductions = WebLightUpGenerator.getStrictDeductions(rows, cols, blackBlocks, board);
    if (deductions.size === 0) {
      setGuessWarning(isEn ? 'Observe corridor ray alignments!' : '請觀察光束走廊的交叉對齊！');
      return;
    }

    const item = deductions.values().next().value;
    if (!item) return;
    const { r, c, state, type, rationale, humanReadable } = item;

    if (!activeHintStep || activeHintStep.r !== r || activeHintStep.c !== c) {
      setActiveHintStep({
        step: 1,
        type,
        r, c, state,
        rationale,
        humanReadable,
      });
      setHintLevel(1);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, tournamentMode, rows, cols, blackBlocks, board, isEn, activeHintStep]);

  const toggleCell = (r: number, c: number) => {
    if (isCompleted || board[r][c] === 2) return;

    setTotalActions((prev) => prev + 1);

    if (isNoteMode) {
      if (board[r][c] === 0) {
        setPencilNotes((prev) => {
          const next = prev.map((row) => [...row]);
          next[r][c] = !next[r][c];
          return next;
        });
        if (navigator.vibrate) navigator.vibrate(5);
      }
      return;
    }

    if (pencilNotes[r][c]) {
      setPencilNotes((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = false;
        return next;
      });
    }

    const isHintExempt = activeHintStep && activeHintStep.r === r && activeHintStep.c === c;

    if (isNoGuessMode && !tournamentMode && board[r][c] === 0 && !isHintExempt) {
      const deductions = WebLightUpGenerator.getStrictDeductions(rows, cols, blackBlocks, board);
      const deduction = deductions.get(`${r},${c}`);

      if (!deduction) {
        setGuessWarning(
          isEn
            ? '🤔 Not a forced move yet! Check black clues or beam coverage first.'
            : '🤔 這格還不是必然定式喔！先觀察線索黑塊或射線交叉吧。'
        );
        setTimeout(() => setGuessWarning(null), 3000);
        return;
      }
    }

    setGuessWarning(null);
    setHintLevel(0);
    setActiveHintStep(null);

    setBoard((prev) => {
      const next = prev.map((row) => [...row]);
      const cur = next[r][c];

      if (cur === 1) setCorrections((cPrev) => cPrev + 1);

      if (cur === 0) next[r][c] = 1;
      else if (cur === 1) next[r][c] = 3;
      else next[r][c] = 0;

      if (checkVictory(next)) triggerVictory();
      return next;
    });

    if (navigator.vibrate) navigator.vibrate(8);
  };

  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const nextFav = VaultManager.toggleFavorite({
      id: actualPuzzle.id,
      engine: 'lightup',
      tier: String(tier),
      seed: 12345,
      steps: totalActions,
      timeSpentSec: Math.round(elapsedMs / 1000),
      date: new Date().toLocaleDateString(),
    });
    setIsFav(nextFav);
  };

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);
  const sci = useMemo(() => getSpatialCompositeIndex(), [getSpatialCompositeIndex, isCompleted]);

  const eleganceIndex = useMemo(() => {
    if (totalActions === 0) return 100;
    return Math.max(0, Math.round(((totalActions - corrections * 1.5) / totalActions) * 100));
  }, [totalActions, corrections]);

  const techniqueCounts = useMemo(() => {
    const counts: Record<string, number> = {
      zero: 0,
      saturated: 0,
      forced: 0,
      xor: 0,
      diagonal: 0,
      isolated: 0,
    };
    for (const s of solvingSteps) {
      if (s.type === 'zero_black_cross') counts.zero++;
      else if (s.type === 'clue_saturated_dot') counts.saturated++;
      else if (s.type === 'clue_forced_light') counts.forced++;
      else if (s.type === 'adjacent_clue_xor') counts.xor++;
      else if (s.type === 'diagonal_exclusion') counts.diagonal++;
      else if (s.type === 'isolated_illuminance') counts.isolated++;
    }
    return counts;
  }, [solvingSteps]);

  const deductionStats = useMemo(() => {
    const blockCount = solvingSteps.filter((s) => s.type.includes('clue') || s.type.includes('zero') || s.type.includes('diagonal')).length;
    const rayCount = solvingSteps.filter((s) => s.type === 'isolated_illuminance' || s.type === 'ray_no_clash').length;
    const total = blockCount + rayCount || 1;
    const blockPercent = Math.round((blockCount / total) * 100);
    const rayPercent = 100 - blockPercent;
    return { blockCount, rayCount, blockPercent, rayPercent };
  }, [solvingSteps]);

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono">
      {/* 頂部數據列 */}
      <div className="w-full grid grid-cols-3 gap-1 mb-1.5 text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">
            {tournamentMode ? (isEn ? '⏱️ Countdown' : '⏱️ 倒數計時') : (isEn ? '⏱️ Speed' : '⏱️ 競速')}
          </div>
          <div className={`font-bold ${tournamentMode && remainingSec <= 20 ? 'text-rose-400 animate-pulse' : 'text-slate-200'}`}>
            {tournamentMode ? `${remainingSec}s` : `${(elapsedMs / 1000).toFixed(1)}s`}
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? '🎯 Elegance' : '🎯 優雅指數'}</div>
          <div className="text-emerald-400 font-bold">{eleganceIndex}%</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? '💡 Illumination' : '💡 光照覆蓋'}</div>
          <div className="text-amber-400 font-bold">
            {Math.round(
              (litMatrix.flat().filter(Boolean).length /
                (rows * cols - blackBlocks.length || 1)) *
                100
            )}%
          </div>
        </div>
      </div>

      {/* 難度階梯、傳奇收藏與縮放控制列 */}
      <div className="w-full flex items-center justify-between px-1 mb-1.5">
        <div className="flex items-center gap-1.5">
          {tournamentMode ? (
            <span className="px-2 py-0.5 rounded-full bg-amber-950 border border-amber-500 text-amber-300 text-[7.5px] font-extrabold flex items-center gap-1">
              🏆 {isEn ? 'WPF Tournament Mode' : 'WPF 賽事鎖定'}
            </span>
          ) : (
            <button
              onClick={handleToggleFavorite}
              className={`px-1.5 py-0.5 rounded text-[7.5px] border font-bold ${
                isFav ? 'bg-amber-950 border-amber-500 text-amber-300' : 'bg-slate-900 border-slate-800 text-slate-500'
              }`}
            >
              {isFav ? '★ 傳奇' : '☆ 收藏'}
            </button>
          )}

          {tier === 'ultimate' ? (
            <span className="px-2 py-0.5 rounded-full bg-purple-950 border border-purple-500 text-purple-300 text-[7.5px] font-extrabold flex items-center gap-1">
              ⚡ {isEn ? 'Ultimate 10×10' : '極限級 10×10'}
            </span>
          ) : tier === 'legendary' ? (
            <span className="px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-500 text-rose-300 text-[7.5px] font-extrabold flex items-center gap-1 shadow-[0_0_8px_rgba(244,63,94,0.3)]">
              👑 {isEn ? 'Legendary 9×9' : '傳奇級 9×9'}
            </span>
          ) : spec?.isSymmetric180 ? (
            <span className="px-2 py-0.5 rounded-full bg-indigo-950/70 border border-indigo-500/40 text-indigo-300 text-[7.5px] font-bold flex items-center gap-1 shadow-[0_0_8px_rgba(99,102,241,0.2)]">
              ✨ {isEn ? '180° Balanced' : '180° 對稱'}
            </span>
          ) : null}

          <button
            onClick={() => setIsFocusDarkness((prev) => !prev)}
            className={`px-1.5 py-0.5 rounded text-[7px] border transition ${
              isFocusDarkness
                ? 'bg-amber-400 text-slate-950 font-bold border-amber-300 shadow-[0_0_6px_rgba(251,191,36,0.5)]'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            🌑 {isEn ? 'Dark Focus' : '聚焦暗區'}
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setBoardScale((s) => Math.max(0.75, Number((s - 0.05).toFixed(2))))}
            className="w-5 h-5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs flex items-center justify-center active:scale-95"
            title={isEn ? 'Zoom Out' : '縮小'}
          >
            -
          </button>
          <span className="text-[7.5px] text-slate-500 font-mono w-7 text-center">
            {Math.round(boardScale * 100)}%
          </span>
          <button
            onClick={() => setBoardScale((s) => Math.min(1.25, Number((s + 0.05).toFixed(2))))}
            className="w-5 h-5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs flex items-center justify-center active:scale-95"
            title={isEn ? 'Zoom In' : '放大'}
          >
            +
          </button>
        </div>
      </div>

      {/* 盤面主畫布 */}
      <div
        className="relative p-3 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl transition-transform duration-150 flex flex-col items-center"
        style={{ transform: `scale(${boardScale})`, transformOrigin: 'top center' }}
      >
        <div className="relative">
          {/* SVG 漸層射線 */}
          <svg
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              width: cols * (cellSize + 4) + 8,
              height: rows * (cellSize + 4) + 8,
            }}
          >
            <defs>
              <linearGradient id="rayGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.15" />
              </linearGradient>
            </defs>
            {rayLines.map((line, idx) => (
              <line
                key={`ray-${idx}`}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke="url(#rayGradient)"
                strokeWidth="3"
                strokeDasharray="5 3"
                className="animate-pulse"
              />
            ))}
          </svg>

          {/* 網格 */}
          <div
            className="grid gap-1 bg-slate-900/90 p-1.5 rounded-lg border border-slate-800"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`
            }}
          >
            {board.map((row, r) =>
              row.map((cell, c) => {
                const isHintTarget = activeHintStep?.r === r && activeHintStep?.c === c;
                const isLit = litMatrix[r][c];
                const blockInfo = blackBlocks.find((b) => b.r === r && b.c === c);
                const blockStatus = blockStatusMap.get(`${r},${c}`);
                const hasPencilX = pencilNotes[r][c];

                const isDimmed = isFocusDarkness && cell !== 2 && isLit && cell !== 1;

                return (
                  <div
                    key={`${r}-${c}`}
                    onClick={() => toggleCell(r, c)}
                    className={`relative flex items-center justify-center rounded-md font-black transition select-none ${
                      isHintTarget && hintLevel >= 1
                        ? 'bg-amber-500/40 ring-2 ring-amber-400 animate-pulse z-20'
                        : cell === 2
                        ? blockStatus?.state === 'exact'
                          ? 'bg-slate-950 border-2 border-emerald-500 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)] z-20 cursor-default'
                          : blockStatus?.state === 'over'
                          ? 'bg-slate-950 border-2 border-rose-500 text-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.4)] z-20 cursor-default'
                          : 'bg-slate-950 border border-slate-700 text-slate-200 cursor-default shadow-inner z-20'
                        : cell === 1
                        ? 'bg-amber-400/90 text-amber-950 shadow-[0_0_14px_rgba(251,191,36,0.9)] z-20 cursor-pointer'
                        : isDimmed
                        ? 'bg-slate-950/40 border border-slate-900/40 opacity-30 cursor-pointer'
                        : isLit
                        ? 'bg-amber-300/20 border border-amber-500/30 cursor-pointer'
                        : 'bg-slate-950/90 hover:bg-slate-900 border border-amber-500/30 cursor-pointer'
                    }`}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      fontSize: cellSize < 36 ? '12px' : '15px',
                    }}
                  >
                    {cell === 2 && blockInfo?.clue !== null && blockInfo?.clue !== undefined && (
                      <div className="relative flex items-center justify-center w-full h-full">
                        <span>{blockInfo.clue}</span>
                        {blockStatus?.state === 'under' && (
                          <span className="absolute bottom-0.5 right-1 text-[6.5px] font-mono text-amber-400/90 font-bold">
                            +{blockStatus.target - blockStatus.current}
                          </span>
                        )}
                        {blockStatus?.state === 'exact' && (
                          <span className="absolute top-0.5 right-1 text-[6px] text-emerald-400">✓</span>
                        )}
                      </div>
                    )}

                    {cell === 1 && '💡'}
                    {cell === 3 && <span className="w-1.5 h-1.5 rounded-full bg-slate-400/80" />}
                    {cell === 0 && hasPencilX && (
                      <span className="text-[10px] text-slate-500 font-bold leading-none select-none">✕</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 3 階提示階梯訊息卡片 */}
      {!tournamentMode && hintLevel > 0 && activeHintStep && (
        <div className="mt-2.5 p-2 bg-amber-950/70 border border-amber-500/60 rounded-lg text-[8px] text-amber-200 text-center max-w-xs animate-fade-in">
          <div className="font-bold flex items-center justify-center gap-1 mb-0.5">
            <span>💡 {isEn ? 'Hint Ladder' : '因果思考提示'}</span>
            <span className="text-amber-400">Level {hintLevel}/3</span>
          </div>
          {hintLevel === 1 && (
            <div>
              {isEn
                ? `Focus on Cell (${activeHintStep.r + 1}, ${activeHintStep.c + 1}). Check adjacent clue or unlit corridor!`
                : `請觀察座標格 (${activeHintStep.r + 1}, ${activeHintStep.c + 1}) 與周圍黑塊或未照亮走廊！`}
            </div>
          )}
          {hintLevel === 2 && <div>{activeHintStep.humanReadable[isEn ? 'en' : 'zh']}</div>}
          {hintLevel === 3 && (
            <div className="text-amber-300 font-bold">
              {isEn
                ? `Decisive deduction: Must place a ${activeHintStep.state === 1 ? 'Light 💡' : 'Dot •'}!`
                : `射線唯一收斂：此格必然為「${activeHintStep.state === 1 ? '燈泡 💡' : '防護點 •'}」，請親手點入！`}
            </div>
          )}
        </div>
      )}

      {/* 無猜測模式警告浮動條 */}
      {guessWarning && (
        <div className="mt-2 px-3 py-1 bg-amber-950/90 border border-amber-500/70 text-amber-300 text-[8px] rounded-lg animate-bounce text-center max-w-xs">
          {guessWarning}
        </div>
      )}

      {/* 控制列 */}
      <div className="flex items-center justify-between w-full max-w-xs mt-2 px-1">
        <div className="flex gap-1.5">
          {!tournamentMode && (
            <button
              onClick={() => setIsNoGuessMode((prev) => !prev)}
              className={`px-2 py-1 text-[8px] font-bold rounded-md border transition ${
                isNoGuessMode
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              🧠 {isNoGuessMode ? '無猜測 ON' : '無猜測'}
            </button>
          )}

          <button
            onClick={() => setIsNoteMode((prev) => !prev)}
            className={`px-2 py-1 text-[8px] font-bold rounded-md border transition ${
              isNoteMode
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            ✏️ {isNoteMode ? '草稿 ✕ ON' : '草稿 ✕'}
          </button>

          {!tournamentMode && (
            <button
              onClick={handleRequestHint}
              className="px-2 py-1 text-[8px] font-bold rounded-md border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition flex items-center gap-0.5"
            >
              💡 {isEn ? 'Hint' : '提示'}
            </button>
          )}
        </div>
        <span className="text-[7px] text-slate-400">
          {isNoteMode
            ? (isEn ? 'Click to mark ✕' : '點擊標記草稿 ✕')
            : (isEn ? 'Light ➔ Dot ➔ Clear' : '燈泡 ➔ 防護 ➔ 清空')}
        </span>
      </div>

      {/* 結算面板 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-amber-500/60 rounded-xl text-center w-full max-w-xs shadow-2xl animate-fade-in font-mono">
          <div className="text-amber-300 font-bold text-xs mb-0.5">✨ MUSEUM ILLUMINATED</div>
          {tier === 'ultimate' && (
            <div className="text-[8px] text-purple-400 font-extrabold mb-0.5">
              ⚡ {isEn ? 'ULTIMATE 10×10 CONQUERED' : '極限級 10×10 完美通關'}
            </div>
          )}
          {tier === 'legendary' && (
            <div className="text-[8px] text-rose-400 font-extrabold mb-0.5">
              👑 {isEn ? 'LEGENDARY 9×9 CONQUERED' : '傳奇級 9×9 完美通關'}
            </div>
          )}
          {isNoGuessMode && (
            <div className="text-[8px] text-amber-400 font-bold mb-1">
              🏆 {isEn ? 'Pure Ray Casting Mastery (Zero Guessing)' : '傳奇純射線覆蓋（零猜測認證）'}
            </div>
          )}
          <div className="text-[9px] text-slate-400 mb-2">
            {isEn ? 'Time' : '耗時'}: {(elapsedMs / 1000).toFixed(2)}s | Gf: IQ {cci.standardIQ} | 空間量尺: {sci.standardScore}/19
          </div>

          {/* 定式推理診斷清單 */}
          <div className="bg-slate-900/80 border border-slate-800 p-2 rounded-lg mb-2 text-left text-[7px]">
            <div className="text-amber-300 font-bold mb-1">
              🔬 {isEn ? 'Deduction Pattern Breakdown' : '因果定式診斷清單'}
            </div>
            <div className="grid grid-cols-2 gap-1 text-slate-300">
              <div>⬛ 0 禁絕定式: {techniqueCounts.zero} 次</div>
              <div>📐 缺額必放定式: {techniqueCounts.forced} 次</div>
              <div>🔒 滿額防護定式: {techniqueCounts.saturated} 次</div>
              <div>⚡ 1-2 XOR 複合: {techniqueCounts.xor} 次</div>
              <div>🔀 對角互斥定式: {techniqueCounts.diagonal} 次</div>
              <div>🔦 孤立光源收斂: {techniqueCounts.isolated} 次</div>
            </div>
          </div>

          {/* 空間推理綜合指數 (SCI) 卡片 */}
          <div className="bg-slate-900/90 border border-cyan-800/80 p-2 rounded-lg mb-2 text-left text-[7.5px]">
            <div className="text-cyan-300 font-bold mb-1 flex justify-between">
              <span>🧭 空間綜合能力指數 (SCI)</span>
              <span className="text-emerald-400">PR {sci.spatialPercentile}%</span>
            </div>
            <div className="grid grid-cols-3 gap-1 text-center py-1 bg-slate-950/80 rounded mb-1 text-[7px]">
              <div>迴路控制: <strong className="text-cyan-300">{sci.eulerianLoopControl}</strong></div>
              <div>黑海分割: <strong className="text-cyan-300">{sci.planarPartitioning}</strong></div>
              <div>射線投射: <strong className="text-amber-300">{sci.rayTracingControl}</strong></div>
            </div>
            <div className="text-[6.5px] text-slate-400 mt-1">
              💡 {sci.recommendedDrill}
            </div>
          </div>

          {/* 思維風格進度條 */}
          <div className="bg-slate-900/60 border border-slate-800 p-2 rounded-lg mb-2 text-left">
            <div className="text-[8px] text-indigo-300 font-bold mb-1 flex justify-between">
              <span>💡 {isEn ? 'Thinking Profile' : '幾何光學推導風格'}</span>
              <span>{deductionStats.blockPercent}% {isEn ? 'Clue Driven' : '黑塊約束'}</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex">
              <div
                className="bg-amber-500 h-full transition-all duration-500"
                style={{ width: `${deductionStats.blockPercent}%` }}
              />
              <div
                className="bg-cyan-500 h-full transition-all duration-500"
                style={{ width: `${deductionStats.rayPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-[7px] text-slate-400 mt-1">
              <span>⬛ {isEn ? 'Block Clues' : '黑塊定式'}: {deductionStats.blockCount} 步</span>
              <span>🔦 {isEn ? 'Ray Coverage' : '射線覆蓋'}: {deductionStats.rayCount} 步</span>
            </div>

            <div className="mt-2 pt-1.5 border-t border-slate-800 flex justify-between items-center text-[7.5px]">
              <span className="text-slate-400">🎯 {isEn ? 'Max Forced Chain' : '最長連續定式鏈'}:</span>
              <span className="text-cyan-300 font-bold">
                {spec?.maxForcedChain || deductionStats.blockCount} {isEn ? 'steps' : '步連鎖推導'}
              </span>
            </div>
          </div>

          <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800 flex flex-col items-center mb-2">
            <CognitiveRadarChart dimensions={profile.cognitiveDimensions} size={130} />
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={exportLongitudinalDataset}
              className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 border border-cyan-600/50 text-cyan-300 text-[8px] font-bold rounded-lg transition"
            >
              📊 {isEn ? 'Export Data' : '匯出數據'}
            </button>
          </div>

          {proofSignature && (
            <div className="mt-2 p-1.5 bg-slate-900 border border-slate-800 rounded text-left">
              <div className="text-[6.5px] font-mono text-cyan-400/80 break-all select-all">
                🛡️ SHA-256 賽事認證: {proofSignature}
              </div>
            </div>
          )}
        </div>
      )}

      {showPBModal && (
        <PBCelebrationModal pb={profile.personalBest} onClose={() => setShowPBModal(false)} isEn={isEn} />
      )}
    </div>
  );
};
