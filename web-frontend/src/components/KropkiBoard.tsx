// web-frontend/src/components/KropkiBoard.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { KropkiSpec, WebKropkiGenerator, SolvingStep, KropkiDot } from '../engines/kropkiGenerator';
import { CognitiveRadarChart } from './CognitiveRadarChart';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

export function KropkiBoard(props: Props) {
  const { puzzle, puzzleData } = props;
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, profile, getCompositeCognitiveIndex, exportLongitudinalDataset } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as KropkiSpec;
  const n = spec?.size || 4;
  const initialGrid = spec?.initialGrid || Array.from({ length: n }, () => Array(n).fill(0));
  const dots: KropkiDot[] = spec?.dots || [];
  const solvingSteps = spec?.solvingSteps || [];

  const [grid, setGrid] = useState<number[][]>(() => initialGrid.map((r) => [...r]));
  const [notes, setNotes] = useState<Set<number>[][]>(() =>
    Array.from({ length: n }, () => Array.from({ length: n }, () => new Set<number>()))
  );
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>([0, 0]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [conflictsCount, setConflictsCount] = useState<number>(0);
  const [proofSignature, setProofSignature] = useState<string | null>(null);

  const [isNoteMode, setIsNoteMode] = useState<boolean>(false);
  const [isNoGuessMode, setIsNoGuessMode] = useState<boolean>(true);
  const [guessWarning, setGuessWarning] = useState<string | null>(null);

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHintStep, setActiveHintStep] = useState<SolvingStep | null>(null);
  const [boardScale, setBoardScale] = useState<number>(1.0);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const hasRecordedRef = useRef<boolean>(false);

  useEffect(() => {
    setGrid(initialGrid.map((r) => [...r]));
    setNotes(Array.from({ length: n }, () => Array.from({ length: n }, () => new Set<number>())));
    setSelectedCell([0, 0]);
    setIsCompleted(false);
    setElapsedMs(0);
    setConflictsCount(0);
    setProofSignature(null);
    setGuessWarning(null);
    setHintLevel(0);
    setActiveHintStep(null);
    startTimeRef.current = Date.now();
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id]);

  useEffect(() => {
    if (isCompleted) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted]);

  const rightDotMap = useMemo(() => {
    const map = new Map<string, KropkiDot>();
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      if (d.r1 === d.r2 && d.c2 === d.c1 + 1) {
        map.set(`${d.r1},${d.c1}`, d);
      }
    }
    return map;
  }, [dots]);

  const bottomDotMap = useMemo(() => {
    const map = new Map<string, KropkiDot>();
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      if (d.c1 === d.c2 && d.r2 === d.r1 + 1) {
        map.set(`${d.r1},${d.c1}`, d);
      }
    }
    return map;
  }, [dots]);

  const checkCompletion = useCallback((currentGrid: number[][]) => {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (currentGrid[r][c] === 0) return false;
      }
    }

    for (let i = 0; i < n; i++) {
      const rowVals = new Set<number>();
      const colVals = new Set<number>();
      for (let j = 0; j < n; j++) {
        rowVals.add(currentGrid[i][j]);
        colVals.add(currentGrid[j][i]);
      }
      if (rowVals.size !== n || colVals.size !== n) return false;
    }

    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      const v1 = currentGrid[dot.r1][dot.c1];
      const v2 = currentGrid[dot.r2][dot.c2];
      if (dot.type === 'white') {
        if (Math.abs(v1 - v2) !== 1) return false;
      } else if (dot.type === 'black') {
        if (v1 !== v2 * 2 && v2 !== v1 * 2) return false;
      }
    }

    return true;
  }, [n, dots]);

  const toggleNote = useCallback((num: number) => {
    if (isCompleted || !selectedCell) return;
    const [r, c] = selectedCell;
    if (initialGrid[r][c] !== 0 || grid[r][c] !== 0) return;

    setNotes((prev) => {
      const next = prev.map((row) => row.map((s) => new Set(s)));
      const targetSet = next[r][c];
      if (targetSet.has(num)) {
        targetSet.delete(num);
      } else {
        targetSet.add(num);
      }
      return next;
    });
  }, [isCompleted, selectedCell, initialGrid, grid]);

  const handleRequestHint = useCallback(() => {
    if (isCompleted) return;

    const deductions = WebKropkiGenerator.getStrictDeductions(grid, dots, n);
    if (deductions.size === 0) {
      setGuessWarning(isEn ? 'Current grid requires global cross-check!' : '目前需要全局交叉比對！');
      return;
    }

    const firstEntry = deductions.entries().next().value;
    if (!firstEntry) return;
    const [coord, info] = firstEntry;
    const parts = coord.split(',');
    const r = parseInt(parts[0], 10);
    const c = parseInt(parts[1], 10);

    setSelectedCell([r, c]);

    if (!activeHintStep || activeHintStep.row !== r || activeHintStep.col !== c) {
      setActiveHintStep({
        step: 1,
        type: info.type,
        row: r,
        col: c,
        value: info.value,
        rationale: info.rationale,
      });
      setHintLevel(1);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, grid, dots, n, isEn, activeHintStep]);

  const handleInputNumber = useCallback((num: number) => {
    if (isCompleted || !selectedCell) return;
    const [r, c] = selectedCell;
    if (initialGrid[r][c] !== 0) return;

    if (isNoteMode && num !== 0) {
      toggleNote(num);
      return;
    }

    if (isNoGuessMode && num !== 0) {
      const deductions = WebKropkiGenerator.getStrictDeductions(grid, dots, n);
      const deduction = deductions.get(`${r},${c}`);

      if (!deduction || deduction.value !== num) {
        setGuessWarning(
          isEn
            ? 'Not a forced deduction yet! Check adjacent dots or row/col eliminations first.'
            : '這步還不是必然定式喔！先觀察相鄰圓點或行列唯餘吧。'
        );
        setTimeout(() => setGuessWarning(null), 3000);
        return;
      }
    }

    setGuessWarning(null);
    setHintLevel(0);
    setActiveHintStep(null);

    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = next[r][c] === num ? 0 : num;

      if (num !== 0) {
        setNotes((prevNotes) => {
          const updated = prevNotes.map((row) => row.map((s) => new Set(s)));
          updated[r][c].clear();
          return updated;
        });
      }

      if (checkCompletion(next)) {
        setIsCompleted(true);
        const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

        if (!hasRecordedRef.current && actualPuzzle) {
          hasRecordedRef.current = true;
          const tierVal = (actualPuzzle.tier as TierKey) || 'kids';
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: 'kropki',
            tier: tierVal,
            cognitiveLoad: actualPuzzle.cognitiveLoad || {
              spatial: 0.6,
              numeric: 0.9,
              workingMemory: 0.8,
              inhibition: 0.7,
            },
            isSuccess: true,
            timeSpentSec: timeSpent,
            conflictsCount,
            technique: 'ConstraintSatisfaction',
            isPureClear: conflictsCount === 0,
          });

          setProofSignature(`VERIFIED_${Date.now()}`);
        }
      }
      return next;
    });
  }, [isCompleted, selectedCell, initialGrid, isNoteMode, toggleNote, isNoGuessMode, grid, dots, n, isEn, checkCompletion, actualPuzzle, conflictsCount, recordAttempt]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || !selectedCell) return;
      const [r, c] = selectedCell;

      if (e.code === 'ArrowUp' || e.code === 'KeyW') setSelectedCell([Math.max(0, r - 1), c]);
      if (e.code === 'ArrowDown' || e.code === 'KeyS') setSelectedCell([Math.min(n - 1, r + 1), c]);
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') setSelectedCell([r, Math.max(0, c - 1)]);
      if (e.code === 'ArrowRight' || e.code === 'KeyD') setSelectedCell([r, Math.min(n - 1, c + 1)]);
      if (e.code === 'KeyN') setIsNoteMode((prev) => !prev);
      if (e.code === 'KeyH') handleRequestHint();

      const parsed = parseInt(e.key, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= n) {
        if (e.shiftKey) {
          toggleNote(parsed);
        } else {
          handleInputNumber(parsed);
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        handleInputNumber(0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompleted, selectedCell, n, toggleNote, handleInputNumber, handleRequestHint]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono">
      <div className="w-full grid grid-cols-3 gap-1 mb-1.5 text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? 'Speed' : '競速'}</div>
          <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? 'Dimension' : '階數'}</div>
          <div className="text-cyan-300 font-bold">{n} &times; {n}</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? 'Clues' : '提示'}</div>
          <div className="text-amber-400 font-bold">{dots.length}</div>
        </div>
      </div>

      <div
        className="relative p-2 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl transition-transform duration-150"
        style={{ transform: `scale(${boardScale})`, transformOrigin: 'top center' }}
      >
        <div
          className="grid gap-1 bg-slate-900/80 p-1 rounded-lg"
          style={{
            gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
            width: 'min(88vw, 44vh)',
            height: 'min(88vw, 44vh)',
          }}
        >
          {grid.map((row, r) =>
            row.map((val, c) => {
              const key = `${r},${c}`;
              const isSelected = selectedCell !== null && selectedCell[0] === r && selectedCell[1] === c;
              const isInitial = initialGrid[r][c] !== 0;
              const cellNotes = notes[r][c];
              const isHintTarget = activeHintStep !== null && activeHintStep.row === r && activeHintStep.col === c;

              let cellStyle = 'bg-slate-950/70 text-transparent hover:bg-slate-900/50';
              if (isHintTarget && hintLevel >= 1) {
                cellStyle = 'bg-amber-500/40 text-amber-200 ring-2 ring-amber-400 animate-pulse z-10';
              } else if (isSelected) {
                cellStyle = 'bg-indigo-600/50 text-white ring-2 ring-indigo-400 z-10';
              } else if (isInitial) {
                cellStyle = 'bg-slate-800/90 text-cyan-300 font-extrabold';
              } else if (val !== 0) {
                cellStyle = 'bg-slate-900/90 text-slate-100';
              }

              const rightDot = rightDotMap.get(key);
              const bottomDot = bottomDotMap.get(key);

              return (
                <div
                  key={key}
                  onClick={() => setSelectedCell([r, c])}
                  className={`relative flex items-center justify-center font-black text-sm sm:text-base rounded-md cursor-pointer transition ${cellStyle}`}
                >
                  {val !== 0 && <span>{val}</span>}
                  {val === 0 && cellNotes.size > 0 && (
                    <div className="absolute inset-0 p-0.5 grid grid-cols-3 gap-0 text-[7px] sm:text-[9px] text-amber-400/90 font-mono items-center justify-items-center">
                      {Array.from({ length: n }, (_, i) => i + 1).map((num) => (
                        <span key={num} className="leading-none">
                          {cellNotes.has(num) ? num : ''}
                        </span>
                      ))}
                    </div>
                  )}

                  {rightDot && (
                    <span
                      className={`absolute -right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full z-20 border-2 ${
                        rightDot.type === 'white'
                          ? 'bg-white border-slate-900 shadow-[0_0_8px_rgba(255,255,255,0.9)]'
                          : 'bg-black border-slate-400 shadow-[0_0_8px_rgba(0,0,0,0.9)]'
                      }`}
                    />
                  )}

                  {bottomDot && (
                    <span
                      className={`absolute left-1/2 -bottom-2 -translate-x-1/2 w-3.5 h-3.5 rounded-full z-20 border-2 ${
                        bottomDot.type === 'white'
                          ? 'bg-white border-slate-900 shadow-[0_0_8px_rgba(255,255,255,0.9)]'
                          : 'bg-black border-slate-400 shadow-[0_0_8px_rgba(0,0,0,0.9)]'
                      }`}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 mt-2.5 w-full max-w-[min(88vw,44vh)]">
        <div className="flex gap-1.5">
          {Array.from({ length: n }, (_, i) => i + 1).map((num) => (
            <button
              key={num}
              onClick={() => handleInputNumber(num)}
              className={`flex-1 py-2 border font-bold text-xs sm:text-sm rounded-lg transition active:scale-95 ${
                isNoteMode
                  ? 'bg-amber-950/40 border-amber-600/70 text-amber-300'
                  : 'bg-slate-900 border-slate-700 hover:bg-slate-800 text-cyan-300'
              }`}
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => handleInputNumber(0)}
            className="px-2.5 py-2 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 font-bold text-xs rounded-lg transition active:scale-95"
          >
            DEL
          </button>
        </div>
      </div>

      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,44vh)] shadow-2xl font-mono">
          <div className="text-emerald-400 font-bold text-xs mb-0.5">KROPKI RESOLVED</div>
          <div className="text-[9px] text-slate-400 mb-2">
            IQ {cci.standardIQ} | {(elapsedMs / 1000).toFixed(2)}s
          </div>
          <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800 flex flex-col items-center mb-2">
            <CognitiveRadarChart dimensions={profile.cognitiveDimensions} size={130} />
          </div>
        </div>
      )}
    </div>
  );
}
