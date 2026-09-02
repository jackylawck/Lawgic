// web-frontend/src/components/SudokuBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity } from '../generated';
import { useLearnerProfile, TierKey } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
}

export const SudokuBoard: React.FC<Props> = ({ puzzleData, puzzle }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { recordAttempt, getBenchmarkTime, profile } = useLearnerProfile();
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const metrics = (actualPuzzle?.metrics as any) || {};
  const highestTech = metrics.highest_technique || 'NakedSingle';
  const theoryTime = metrics.estimated_time_sec || 120;

  // 個人化動態校準基準時間
  const personalBenchmark = useMemo(() => {
    return getBenchmarkTime(highestTech, theoryTime);
  }, [getBenchmarkTime, highestTech, theoryTime]);

  const initialGrid = useMemo(() => {
    const raw =
      actualPuzzle?.puzzle ||
      (actualPuzzle as any)?.spec?.grid ||
      (actualPuzzle as any)?.grid;

    if (!raw) return Array(81).fill(0);
    if (Array.isArray(raw)) {
      return Array.isArray(raw[0]) ? raw.flat() : raw;
    }
    return Array(81).fill(0);
  }, [actualPuzzle]);

  const [grid, setGrid] = useState<number[]>(initialGrid);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [conflictCell, setConflictCell] = useState<number | null>(null);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  useEffect(() => {
    setGrid(initialGrid);
    setSelectedCell(null);
    setConflictCell(null);
    setIsCompleted(false);
    setElapsedSec(0);
    startTimeRef.current = Date.now();
    conflictCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [initialGrid, actualPuzzle?.id]);

  useEffect(() => {
    if (isCompleted) return;
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isCompleted]);

  const checkVictory = useCallback(
    (currentGrid: number[]) => {
      const sol = actualPuzzle?.solution;
      if (!sol || !Array.isArray(sol)) return;
      const flatSol = Array.isArray(sol[0]) ? sol.flat() : sol;

      if (flatSol.length === 81 && currentGrid.every((v, i) => v === flatSol[i])) {
        setIsCompleted(true);
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: actualPuzzle.engine_type || 'sudoku',
            tier: (actualPuzzle.tier as TierKey) || 'kids',
            cognitiveLoad: actualPuzzle.cognitiveLoad || {
              spatial: 0.3,
              numeric: 0.7,
              workingMemory: 0.8,
              inhibition: 0.6,
            },
            isSuccess: true,
            timeSpentSec: timeSpent,
            conflictsCount: conflictCountRef.current,
            technique: highestTech,
          });
        }
      }
    },
    [actualPuzzle, recordAttempt, highestTech]
  );

  const handleCellClick = (index: number) => {
    if (initialGrid[index] !== 0 || isCompleted) return;
    setSelectedCell(index);
  };

  const handleNumberInput = (num: number) => {
    if (selectedCell === null || initialGrid[selectedCell] !== 0 || isCompleted) return;

    const sol = actualPuzzle?.solution;
    const flatSol = sol ? (Array.isArray(sol[0]) ? sol.flat() : sol) : [];
    const expectedValue = flatSol[selectedCell];

    if (num !== 0 && expectedValue !== undefined && num !== expectedValue) {
      if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
      conflictCountRef.current += 1;
      setConflictCell(selectedCell);
      setTimeout(() => setConflictCell(null), 500);
      return;
    }

    const nextGrid = [...grid];
    nextGrid[selectedCell] = num;
    setGrid(nextGrid);
    checkVictory(nextGrid);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || selectedCell === null) return;
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        handleNumberInput(num);
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        handleNumberInput(0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, isCompleted, grid]);

  // 個人精熟度指標 (Technique Mastery Profile)
  const userStat = profile.techniqueStats?.[highestTech];
  const solvingPath: string[] = metrics.solving_path || ['Standard Derivation'];

  return (
    <div className="flex flex-col items-center w-full select-none py-1 font-mono">
      {/* 頂部即時心理測量與基準小標 */}
      <div className="w-[min(90vw,46vh)] flex items-center justify-between text-[8px] text-slate-500 mb-1 px-1">
        <span>
          IRT: <strong className="text-cyan-400">{metrics.irt_logit_difficulty ?? '0.0'}</strong>
        </span>
        <span>
          Tech: <strong className="text-indigo-400">{highestTech}</strong>
        </span>
        <span>
          Target: <strong className="text-amber-300">{personalBenchmark}s</strong>
          {personalBenchmark !== theoryTime && <span className="text-[7px] opacity-60"> (Calib)</span>}
        </span>
      </div>

      {/* 自適應棋盤 */}
      <div className="grid grid-cols-9 gap-[1px] bg-slate-750 border-2 border-slate-700 p-1 rounded-xl shadow-2xl w-[min(90vw,46vh)] h-[min(90vw,46vh)] mx-auto">
        {grid.map((val, idx) => {
          const isGiven = initialGrid[idx] !== 0;
          const isSelected = selectedCell === idx;
          const isConflict = conflictCell === idx;

          const row = Math.floor(idx / 9);
          const col = idx % 9;
          const borderRight = (col + 1) % 3 === 0 && col !== 8 ? 'border-r-2 border-r-slate-600' : '';
          const borderBottom = (row + 1) % 3 === 0 && row !== 8 ? 'border-b-2 border-b-slate-600' : '';

          return (
            <button
              key={idx}
              onClick={() => handleCellClick(idx)}
              className={`w-full h-full flex items-center justify-center text-xs sm:text-base font-bold transition-colors rounded-xs ${borderRight} ${borderBottom} ${
                isConflict
                  ? 'bg-rose-600 text-white animate-pulse'
                  : isSelected
                  ? 'bg-indigo-600 text-white ring-1 ring-indigo-300'
                  : isGiven
                  ? 'bg-slate-900/90 text-slate-300'
                  : val !== 0
                  ? 'bg-slate-950 text-cyan-400 font-semibold'
                  : 'bg-slate-950 hover:bg-slate-900 text-transparent'
              }`}
            >
              {val !== 0 ? val : ''}
            </button>
          );
        })}
      </div>

      {/* 數字鍵盤 */}
      {!isCompleted && (
        <div className="grid grid-cols-10 gap-1 mt-3 w-[min(90vw,46vh)]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handleNumberInput(num)}
              disabled={selectedCell === null}
              className="py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 active:scale-95 text-slate-200 border border-slate-700 rounded-lg text-xs font-mono font-bold transition shadow"
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => handleNumberInput(0)}
            disabled={selectedCell === null}
            className="py-2 bg-rose-950/60 hover:bg-rose-900/60 disabled:opacity-30 active:scale-95 text-rose-300 border border-rose-800 rounded-lg text-xs font-mono font-bold transition shadow"
          >
            ⌫
          </button>
        </div>
      )}

      {/* 賽後深度策略反思與能力診斷面板 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(90vw,46vh)] shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
            <div className="text-left">
              <div className="text-[8px] text-slate-500 tracking-wider">STRATEGIC REFLECTION</div>
              <div className="text-xs text-indigo-300 font-bold">
                {elapsedSec <= personalBenchmark ? '⚡ Master Pace' : '🔍 Deep Exploration'}
              </div>
            </div>
            <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[11px] font-bold text-cyan-300">
              {elapsedSec <= personalBenchmark ? `${personalBenchmark - elapsedSec}s FASTER` : `${elapsedSec - personalBenchmark}s OVER`}
            </div>
          </div>

          {/* 3 欄指標 */}
          <div className="grid grid-cols-3 gap-1 text-[8px] text-slate-400 mb-2">
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>{isEn ? 'Time' : '耗時 / 基準'}</div>
              <div className="text-slate-200 font-bold text-xs">
                {elapsedSec}s <span className="text-[8px] text-slate-500">/ {personalBenchmark}s</span>
              </div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>IRT 難度</div>
              <div className="text-cyan-300 font-bold text-xs">{metrics.irt_logit_difficulty ?? 0.0}</div>
              <div className="text-[7px] text-slate-500">Clues: {metrics.clues_count ?? 36}</div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>個人精熟度</div>
              <div className="text-amber-300 font-bold text-xs">
                {userStat ? `${Math.round(userStat.accuracy * 100)}%` : '100%'}
              </div>
              <div className="text-[7px] text-slate-500">Hist: {userStat?.attempts || 1} clears</div>
            </div>
          </div>

          {/* 推理技巧鏈 (Solving Path) */}
          <div className="bg-slate-900/60 p-2 rounded text-left border border-slate-800/80 mb-2">
            <div className="text-[7px] text-slate-500 mb-1 font-bold uppercase tracking-wider">
              {isEn ? 'Deduction Chain (Solving Path)' : '推導技巧鏈條 (Solving Path)'}
            </div>
            <div className="flex flex-wrap gap-1">
              {solvingPath.map((step, sIdx) => (
                <span
                  key={sIdx}
                  className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 text-slate-300 text-[8px] rounded"
                >
                  {sIdx + 1}. {step}
                </span>
              ))}
            </div>
          </div>

          <div className="text-[8px] text-slate-500 border-t border-slate-800/80 pt-1.5 flex justify-between">
            <span>Symmetry: {metrics.symmetry_type ?? 'rotational_180'}</span>
            <span>Conflicts: {conflictCountRef.current}</span>
          </div>
        </div>
      )}
    </div>
  );
};
