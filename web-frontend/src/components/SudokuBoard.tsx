import React, { useState, useEffect, useCallback, useRef } from 'react';
import init, { SudokuEngine } from '../wasm/sudoku_wasm';
import { verifyPuzzleChecksum } from '../utils/integrity';
import { useLanguage } from '../contexts/LanguageContext';
import { useLearnerProfile, TierKey } from '../hooks/useLearnerProfile';

interface Props {
  puzzleData: {
    id: string;
    engine_type?: string;
    tier?: string;
    puzzle: number[][];
    solution: number[][];
    checksum: string;
    metrics: { decision_depth: number; difficulty_tier?: string };
  };
}

export const SudokuBoard: React.FC<Props> = ({ puzzleData }) => {
  const { t } = useLanguage();
  const { recordAttempt } = useLearnerProfile();

  const [engine, setEngine] = useState<SudokuEngine | null>(null);
  const [gridValues, setGridValues] = useState<number[]>([]);
  const [candidates, setCandidates] = useState<number[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  // 認知追蹤：計時與衝突記錄
  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  // 重置題目狀態與計時器
  useEffect(() => {
    startTimeRef.current = Date.now();
    conflictCountRef.current = 0;
    hasRecordedRef.current = false;
    setIsCompleted(false);

    if (!verifyPuzzleChecksum(puzzleData)) {
      setErrorMessage(t.errors.securityAlert);
      return;
    }

    const flatClues = puzzleData.puzzle.flat();
    setGridValues([...flatClues]);

    init()
      .then(() => {
        try {
          const wasmInstance = new SudokuEngine(new Uint8Array(flatClues));
          setEngine(wasmInstance);
          setCandidates(Array.from(wasmInstance.get_candidates()));
          setErrorMessage(null);
        } catch (err: any) {
          setErrorMessage(`Init Error: ${err}`);
        }
      })
      .catch((err: any) => {
        setErrorMessage(`WASM Load Error: ${err}`);
      });
  }, [puzzleData, t]);

  // 驗證是否通關
  const checkVictory = useCallback((currentGrid: number[]) => {
    const flatSol = puzzleData.solution.flat();
    if (flatSol.length === 81 && currentGrid.every((v, i) => v === flatSol[i])) {
      setIsCompleted(true);
      if (!hasRecordedRef.current) {
        hasRecordedRef.current = true;
        const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        recordAttempt({
          puzzleId: puzzleData.id,
          engineType: puzzleData.engine_type || 'sudoku',
          tier: (puzzleData.tier as TierKey) || 'kids',
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
        });
      }
    }
  }, [puzzleData, recordAttempt]);

  const handleInput = useCallback((idx: number, val: number) => {
    if (!engine || isCompleted || puzzleData.puzzle.flat()[idx] !== 0) return;

    try {
      const isValid = engine.set_cell_value(idx, val);
      if (!isValid) {
        conflictCountRef.current += 1;
        setErrorMessage(t.errors.conflict);
        setTimeout(() => setErrorMessage(null), 1500);
        return;
      }

      const nextGrid = [...gridValues];
      nextGrid[idx] = val;
      setGridValues(nextGrid);
      setCandidates(Array.from(engine.get_candidates()));
      setErrorMessage(null);

      // 檢查是否完成整張盤面
      checkVictory(nextGrid);
    } catch (err: any) {
      setErrorMessage(err.toString());
    }
  }, [engine, gridValues, isCompleted, puzzleData, t, checkVictory]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (selectedIdx === null || isCompleted) return;

      if (e.key >= '1' && e.key <= '9') {
        handleInput(selectedIdx, parseInt(e.key, 10));
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        handleInput(selectedIdx, 0);
      } else if (e.key === 'ArrowUp' && selectedIdx >= 9) {
        setSelectedIdx(selectedIdx - 9);
      } else if (e.key === 'ArrowDown' && selectedIdx <= 71) {
        setSelectedIdx(selectedIdx + 9);
      } else if (e.key === 'ArrowLeft' && selectedIdx % 9 !== 0) {
        setSelectedIdx(selectedIdx - 1);
      } else if (e.key === 'ArrowRight' && selectedIdx % 9 !== 8) {
        setSelectedIdx(selectedIdx + 1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedIdx, handleInput, isCompleted]);

  const initialFlat = puzzleData.puzzle.flat();

  return (
    <div className="flex flex-col items-center select-none w-full max-w-sm sm:max-w-md mx-auto">
      {/* 警示與勝利提示條 */}
      {isCompleted ? (
        <div className="mb-3 w-full px-4 py-2.5 bg-emerald-950/80 text-emerald-300 text-sm font-bold rounded-xl border border-emerald-500 text-center animate-bounce shadow-lg shadow-emerald-900/40">
          🎉 挑戰成功！已記入認知大腦歷程
        </div>
      ) : errorMessage ? (
        <div className="mb-3 w-full px-3 py-2 bg-red-950/80 text-red-200 text-xs sm:text-sm rounded-lg border border-red-700 text-center animate-pulse">
          {errorMessage}
        </div>
      ) : null}

      {/* 9x9 盤面 */}
      <div className="w-full aspect-square grid grid-cols-9 border-2 border-slate-700 bg-slate-900 shadow-2xl rounded-xl overflow-hidden p-1 gap-0.5">
        {Array.from({ length: 81 }).map((_, idx) => {
          const r = Math.floor(idx / 9);
          const c = idx % 9;
          const isInitial = initialFlat[idx] !== 0;
          const isSelected = selectedIdx === idx;
          const cellVal = gridValues[idx];
          const mask = candidates[idx] || 0;

          const borderBottom = r % 3 === 2 && r !== 8 ? 'border-b-2 border-slate-600' : 'border-b border-slate-800/80';
          const borderRight = c % 3 === 2 && c !== 8 ? 'border-r-2 border-slate-600' : 'border-r border-slate-800/80';

          return (
            <div
              key={idx}
              onClick={() => setSelectedIdx(idx)}
              className={`flex items-center justify-center cursor-pointer transition-colors relative rounded-sm
                ${borderBottom} ${borderRight}
                ${isSelected ? 'bg-indigo-950 ring-2 ring-indigo-400 z-10' : 'hover:bg-slate-800/70'}
                ${isInitial ? 'font-bold text-slate-100 bg-slate-800/60' : 'text-indigo-400 font-semibold'}
              `}
            >
              {cellVal !== 0 ? (
                <span className="text-base sm:text-xl">{cellVal}</span>
              ) : (
                <div className="grid grid-cols-3 gap-0 w-full h-full p-0.5 text-[7px] sm:text-[9px] text-slate-500 font-mono leading-none">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <span key={n} className="flex items-center justify-center">
                      {(mask & (1 << n)) !== 0 ? n : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 數字鍵盤 */}
      <div className="grid grid-cols-5 gap-1.5 w-full mt-4">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <button
            key={num}
            disabled={isCompleted}
            onClick={() => selectedIdx !== null && handleInput(selectedIdx, num)}
            className="py-2.5 bg-slate-800 hover:bg-slate-700 active:bg-indigo-600 text-slate-200 hover:text-white rounded-lg font-mono text-sm font-bold border border-slate-700 shadow-sm transition-all disabled:opacity-50"
          >
            {num}
          </button>
        ))}
        <button
          disabled={isCompleted}
          onClick={() => selectedIdx !== null && handleInput(selectedIdx, 0)}
          className="py-2.5 bg-red-950/40 hover:bg-red-900 active:bg-red-800 text-red-300 rounded-lg font-mono text-xs font-bold border border-red-800 shadow-sm transition-all disabled:opacity-50"
        >
          DEL
        </button>
      </div>

      {/* 狀態監控列 */}
      <div className="mt-4 flex items-center justify-between w-full px-2 text-xs font-mono text-slate-400">
        <span className="text-emerald-400 font-medium">✓ {t.ui.verified}</span>
        <span>Decision Depth: {puzzleData.metrics.decision_depth}</span>
      </div>
    </div>
  );
};
