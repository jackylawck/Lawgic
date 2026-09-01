// web-frontend/src/components/SudokuBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity } from '../generated';
import { useLearnerProfile, TierKey } from '../hooks/useLearnerProfile';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
}

export const SudokuBoard: React.FC<Props> = ({ puzzleData, puzzle }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { recordAttempt } = useLearnerProfile();

  const initialGrid = useMemo(() => {
    if (!actualPuzzle?.puzzle || !Array.isArray(actualPuzzle.puzzle)) return Array(81).fill(0);
    return actualPuzzle.puzzle.flat();
  }, [actualPuzzle]);

  const [grid, setGrid] = useState<number[]>(initialGrid);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [conflictCell, setConflictCell] = useState<number | null>(null);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  useEffect(() => {
    setGrid(initialGrid);
    setSelectedCell(null);
    setConflictCell(null);
    setIsCompleted(false);
    startTimeRef.current = Date.now();
    conflictCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [initialGrid, actualPuzzle?.id]);

  const checkVictory = useCallback(
    (currentGrid: number[]) => {
      if (!actualPuzzle?.solution || !Array.isArray(actualPuzzle.solution)) return;
      const flatSol = actualPuzzle.solution.flat();
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
              numeric: 0.4,
              workingMemory: 0.8,
              inhibition: 0.6,
            },
            isSuccess: true,
            timeSpentSec: timeSpent,
            conflictsCount: conflictCountRef.current,
          });
        }
      }
    },
    [actualPuzzle, recordAttempt]
  );

  const handleCellClick = (index: number) => {
    if (initialGrid[index] !== 0 || isCompleted) return;
    setSelectedCell(index);
  };

  const handleNumberInput = (num: number) => {
    if (selectedCell === null || initialGrid[selectedCell] !== 0 || isCompleted) return;

    const flatSol = actualPuzzle?.solution ? actualPuzzle.solution.flat() : [];
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

  return (
    <div className="flex flex-col items-center w-full select-none">
      <div className="grid grid-cols-9 gap-[1px] bg-slate-800 border-2 border-slate-700 p-[1px] rounded-lg shadow-inner">
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
              className={`w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center text-sm sm:text-base font-bold transition-colors ${borderRight} ${borderBottom} ${
                isConflict
                  ? 'bg-rose-600 text-white animate-pulse'
                  : isSelected
                  ? 'bg-indigo-600 text-white'
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

      <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5 mt-4 w-full max-w-sm">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <button
            key={num}
            onClick={() => handleNumberInput(num)}
            disabled={isCompleted || selectedCell === null}
            className="py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 active:scale-95 text-slate-200 border border-slate-700 rounded-lg text-xs font-mono font-bold transition shadow"
          >
            {num}
          </button>
        ))}
        <button
          onClick={() => handleNumberInput(0)}
          disabled={isCompleted || selectedCell === null}
          className="py-2.5 bg-rose-950/60 hover:bg-rose-900/60 disabled:opacity-40 active:scale-95 text-rose-300 border border-rose-800 rounded-lg text-xs font-mono font-bold transition shadow"
        >
          ⌫
        </button>
      </div>
    </div>
  );
};
