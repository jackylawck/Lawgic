import React, { useState, useEffect, useCallback } from 'react';
import init, { SudokuEngine } from '../wasm/sudoku_wasm';
import { verifyPuzzleChecksum } from '../utils/integrity';
import { useLanguage } from '../contexts/LanguageContext';

interface Props {
  puzzleData: {
    puzzle: number[][];
    solution: number[][];
    checksum: string;
    metrics: { decision_depth: number; difficulty_tier: string };
  };
}

export const SudokuBoard: React.FC<Props> = ({ puzzleData }) => {
  const { t } = useLanguage();
  const [engine, setEngine] = useState<SudokuEngine | null>(null);
  const [gridValues, setGridValues] = useState<number[]>([]);
  const [candidates, setCandidates] = useState<number[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!verifyPuzzleChecksum(puzzleData)) {
      setErrorMessage(t.errors.securityAlert);
      return;
    }

    const flatClues = puzzleData.puzzle.flat();
    setGridValues([...flatClues]);

    init().then(() => {
      try {
        const wasmInstance = new SudokuEngine(new Uint8Array(flatClues));
        setEngine(wasmInstance);
        setCandidates(Array.from(wasmInstance.get_candidates()));
        setErrorMessage(null);
      } catch (err: any) {
        setErrorMessage(`Init Error: ${err}`);
      }
    });
  }, [puzzleData, t]);

  const handleInput = useCallback((idx: number, val: number) => {
    if (!engine || puzzleData.puzzle.flat()[idx] !== 0) return;

    try {
      const isValid = engine.set_cell_value(idx, val);
      if (!isValid) {
        setErrorMessage(t.errors.conflict);
        setTimeout(() => setErrorMessage(null), 1500);
        return;
      }

      const nextGrid = [...gridValues];
      nextGrid[idx] = val;
      setGridValues(nextGrid);
      setCandidates(Array.from(engine.get_candidates()));
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(err.toString());
    }
  }, [engine, gridValues, puzzleData, t]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (selectedIdx === null) return;

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
  }, [selectedIdx, handleInput]);

  const initialFlat = puzzleData.puzzle.flat();

  return (
    <div className="flex flex-col items-center select-none">
      {errorMessage && (
        <div className="mb-3 px-4 py-2 bg-amber-900/60 text-amber-200 text-sm rounded border border-amber-600">
          {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-9 border-2 border-slate-700 bg-slate-900 shadow-2xl rounded-lg overflow-hidden">
        {Array.from({ length: 81 }).map((_, idx) => {
          const r = Math.floor(idx / 9);
          const c = idx % 9;
          const isInitial = initialFlat[idx] !== 0;
          const isSelected = selectedIdx === idx;
          const cellVal = gridValues[idx];
          const mask = candidates[idx] || 0;

          const borderBottom = r % 3 === 2 && r !== 8 ? 'border-b-2 border-slate-600' : 'border-b border-slate-800';
          const borderRight = c % 3 === 2 && c !== 8 ? 'border-r-2 border-slate-600' : 'border-r border-slate-800';

          return (
            <div
              key={idx}
              onClick={() => setSelectedIdx(idx)}
              className={`w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center cursor-pointer transition-colors relative
                ${borderBottom} ${borderRight}
                ${isSelected ? 'bg-indigo-950/80 ring-2 ring-indigo-500 z-10' : 'hover:bg-slate-800/60'}
                ${isInitial ? 'font-bold text-slate-100 bg-slate-800/40' : 'text-indigo-300 font-medium'}
              `}
            >
              {cellVal !== 0 ? (
                <span className="text-xl">{cellVal}</span>
              ) : (
                <div className="grid grid-cols-3 gap-0 w-full h-full p-0.5 text-[8px] sm:text-[9px] text-slate-500 font-mono leading-none">
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

      <div className="mt-4 flex items-center gap-4 text-xs font-mono text-slate-400">
        <span className="text-emerald-400">✓ {t.ui.verified}</span>
        <span className="w-px h-3 bg-slate-700" />
        <span>Conflicts: {puzzleData.metrics.decision_depth}</span>
      </div>
    </div>
  );
};
