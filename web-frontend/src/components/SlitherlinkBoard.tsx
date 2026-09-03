// web-frontend/src/components/SlitherlinkBoard.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';

export type EdgeState = 0 | 1 | 2; // 0: empty, 1: line, 2: cross

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

export const SlitherlinkBoard: React.FC<Props> = ({ puzzle, puzzleData }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as any;
  const rows = spec?.rows || 5;
  const cols = spec?.cols || 5;
  const clues: (number | null)[][] = spec?.clues || Array.from({ length: rows }, () => Array(cols).fill(null));

  const [hEdges, setHEdges] = useState<EdgeState[][]>(() =>
    Array.from({ length: rows + 1 }, () => Array(cols).fill(0))
  );
  const [vEdges, setVEdges] = useState<EdgeState[][]>(() =>
    Array.from({ length: rows }, () => Array(cols + 1).fill(0))
  );

  const [isCompleted, setIsCompleted] = useState(false);
  const [isNoGuessMode, setIsNoGuessMode] = useState(true);
  const [guessWarning, setGuessWarning] = useState<string | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [activeHintStep, setActiveHintStep] = useState<any | null>(null);

  useEffect(() => {
    setHEdges(Array.from({ length: rows + 1 }, () => Array(cols).fill(0)));
    setVEdges(Array.from({ length: rows }, () => Array(cols + 1).fill(0)));
    setIsCompleted(false);
    setGuessWarning(null);
    setHintLevel(0);
    setActiveHintStep(null);
  }, [actualPuzzle?.id, rows, cols]);

  const triggerVictory = useCallback(() => {
    setIsCompleted(true);
    if (actualPuzzle) {
      recordAttempt({
        puzzleId: actualPuzzle.id,
        engineType: 'slitherlink',
        tier: (actualPuzzle.tier as TierKey) || 'kids',
        cognitiveLoad: actualPuzzle.cognitiveLoad || { spatial: 0.8, numeric: 0.7, workingMemory: 0.8, inhibition: 0.8 },
        isSuccess: true,
        timeSpentSec: 30,
        conflictsCount: 0,
        isPureClear: true,
      });
    }
  }, [actualPuzzle, recordAttempt]);

  const checkVictory = useCallback((currH: EdgeState[][], currV: EdgeState[][]): boolean => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const clue = clues[r]?.[c];
        if (clue !== null && clue !== undefined) {
          const count =
            (currH[r][c] === 1 ? 1 : 0) +
            (currH[r + 1][c] === 1 ? 1 : 0) +
            (currV[r][c] === 1 ? 1 : 0) +
            (currV[r][c + 1] === 1 ? 1 : 0);
          if (count !== clue) return false;
        }
      }
    }
    return true;
  }, [rows, cols, clues]);

  const handleToggleHEdge = (r: number, c: number) => {
    if (isCompleted) return;
    setGuessWarning(null);
    setHEdges((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = ((next[r][c] + 1) % 3) as EdgeState;
      if (checkVictory(next, vEdges)) triggerVictory();
      return next;
    });
  };

  const handleToggleVEdge = (r: number, c: number) => {
    if (isCompleted) return;
    setGuessWarning(null);
    setVEdges((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = ((next[r][c] + 1) % 3) as EdgeState;
      if (checkVictory(hEdges, next)) triggerVictory();
      return next;
    });
  };

  return (
    <div className="flex flex-col items-center justify-center p-3 select-none font-mono">
      <div className="text-xs text-cyan-300 font-bold mb-2">
        {isEn ? 'Slitherlink' : '迴路封閉'} ({rows} &times; {cols})
      </div>

      {guessWarning && (
        <div className="mb-2 px-3 py-1 bg-amber-950/80 border border-amber-500 text-amber-300 text-[8px] rounded">
          {guessWarning}
        </div>
      )}

      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 shadow-2xl relative">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={`row-${r}`} className="flex flex-col">
            {/* 橫向邊緣 */}
            <div className="flex items-center">
              {Array.from({ length: cols }).map((_, c) => (
                <React.Fragment key={`h-${r}-${c}`}>
                  <div className="w-2 h-2 rounded-full bg-slate-400" />
                  <div
                    onClick={() => handleToggleHEdge(r, c)}
                    className={`w-8 h-2 cursor-pointer transition-colors ${
                      hEdges[r][c] === 1 ? 'bg-indigo-400' : hEdges[r][c] === 2 ? 'bg-rose-950/40' : 'hover:bg-slate-800'
                    }`}
                  />
                </React.Fragment>
              ))}
              <div className="w-2 h-2 rounded-full bg-slate-400" />
            </div>

            {/* 直向邊緣與線索格 */}
            <div className="flex items-center">
              {Array.from({ length: cols }).map((_, c) => (
                <React.Fragment key={`v-cell-${r}-${c}`}>
                  <div
                    onClick={() => handleToggleVEdge(r, c)}
                    className={`w-2 h-8 cursor-pointer transition-colors ${
                      vEdges[r][c] === 1 ? 'bg-indigo-400' : vEdges[r][c] === 2 ? 'bg-rose-950/40' : 'hover:bg-slate-800'
                    }`}
                  />
                  <div className="w-8 h-8 flex items-center justify-center text-xs font-black text-cyan-200">
                    {clues[r]?.[c] !== null && clues[r]?.[c] !== undefined ? clues[r][c] : ''}
                  </div>
                </React.Fragment>
              ))}
              <div
                onClick={() => handleToggleVEdge(r, cols)}
                className={`w-2 h-8 cursor-pointer transition-colors ${
                  vEdges[r][cols] === 1 ? 'bg-indigo-400' : vEdges[r][cols] === 2 ? 'bg-rose-950/40' : 'hover:bg-slate-800'
                }`}
              />
            </div>
          </div>
        ))}

        {/* 最後一行底部的橫向邊緣 */}
        <div className="flex items-center">
          {Array.from({ length: cols }).map((_, c) => (
            <React.Fragment key={`h-bottom-${c}`}>
              <div className="w-2 h-2 rounded-full bg-slate-400" />
              <div
                onClick={() => handleToggleHEdge(rows, c)}
                className={`w-8 h-2 cursor-pointer transition-colors ${
                  hEdges[rows][c] === 1 ? 'bg-indigo-400' : hEdges[rows][c] === 2 ? 'bg-rose-950/40' : 'hover:bg-slate-800'
                }`}
              />
            </React.Fragment>
          ))}
          <div className="w-2 h-2 rounded-full bg-slate-400" />
        </div>
      </div>

      {isCompleted && (
        <div className="mt-3 px-4 py-2 bg-emerald-950/80 border border-emerald-500 text-emerald-300 font-bold text-xs rounded-lg animate-fade-in">
          {isEn ? 'SLITHERLINK SOLVED!' : '迴路閉合成功！'}
        </div>
      )}
    </div>
  );
};
