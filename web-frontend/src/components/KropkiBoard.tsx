// web-frontend/src/components/KropkiBoard.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { KropkiSpec, WebKropkiGenerator, SolvingStep } from '../engines/kropkiGenerator';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

export const KropkiBoard: React.FC<Props> = ({ puzzle, puzzleData }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, profile, getCompositeCognitiveIndex, exportLongitudinalDataset } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as KropkiSpec;
  const n = spec?.size || 4;
  const initialGrid = spec?.initialGrid || Array.from({ length: n }, () => Array(n).fill(0));
  const dots = spec?.dots || [];
  const solvingSteps = spec?.solvingSteps || [];

  const [grid, setGrid] = useState<number[][]>(() => initialGrid.map((r) => [...r]));
  const [notes, setNotes] = useState<Set<number>[][]>(() =>
    Array.from({ length: n }, () => Array.from({ length: n }, () => new Set<number>()))
  );
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>([0, 0]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [conflictsCount, setConflictsCount] = useState<number>(0);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);

  const [isNoteMode, setIsNoteMode] = useState<boolean>(false);
  const [isNoGuessMode, setIsNoGuessMode] = useState<boolean>(true);
  const [guessWarning, setGuessWarning] = useState<string | null>(null);

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHintStep, setActiveHintStep] = useState<SolvingStep | null>(null);
  const [boardScale, setBoardScale] = useState<number>(1.0);

  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
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

    for (const dot of dots) {
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
      if (targetSet.has(num)) targetSet.delete(num);
      else targetSet.add(num);
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

    const [coord, info] = deductions.entries().next().value;
    const [r, c] = coord.split(',').map(Number);

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
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: 'kropki',
            tier: (actualPuzzle.tier as TierKey) || 'kids',
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

          try {
            const canonical = `${actualPuzzle.id}|${timeSpent}|${conflictsCount}|KROPKI_LEGENDARY`;
            const enc = new TextEncoder();
            window.crypto.subtle.digest('SHA-256', enc.encode(canonical)).then((buf) => {
              const hex = Array.from(new Uint8Array(buf))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
              setProofSignature(`VERIFIED_${hex.slice(0, 24).toUpperCase()}`);
            });
          } catch {
            setProofSignature(`LOCAL_${Date.now()}`);
          }

          if (timeSpent <= profile.personalBest.fastestTime) {
            setShowPBModal(true);
          }
        }
      }
      return next;
    });

    if (navigator.vibrate) navigator.vibrate(10);
  }, [isCompleted, selectedCell, initialGrid, isNoteMode, toggleNote, isNoGuessMode, grid, dots, n, isEn, checkCompletion, actualPuzzle, conflictsCount, recordAttempt, profile.personalBest.fastestTime]);

  const handleTouchStart = (num: number) => {
    longPressTimerRef.current = setTimeout(() => {
      toggleNote(num);
      longPressTimerRef.current = null;
    }, 400);
  };

  const handleTouchEnd = (num: number) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      handleInputNumber(num);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || !selectedCell) return;
      const [r, c] = selectedCell;

      if (['ArrowUp', 'KeyW'].includes(e.code)) setSelectedCell([Math.max(0, r - 1), c]);
      if (['ArrowDown', 'KeyS'].includes(e.code)) setSelectedCell([Math.min(n - 1, r + 1), c]);
      if (['ArrowLeft', 'KeyA'].includes(e.code)) setSelectedCell([r, Math.max(0, c - 1)]);
      if (['ArrowRight', 'KeyD'].includes(e.code)) setSelectedCell([r, Math.min(n - 1, c + 1)]);
      if (e.code === 'KeyN') setIsNoteMode((prev) => !prev);
      if (e.code === 'KeyH') handleRequestHint();

      const parsed = parseInt(e.key, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= n) {
        if (e.shiftKey) toggleNote(parsed);
        else handleInputNumber(parsed);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        handleInputNumber(0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompleted, selectedCell, n, toggleNote, handleInputNumber, handleRequestHint]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  const deductionStats = useMemo(() => {
    const forced = solvingSteps.filter((s) => s.type.startsWith('dot_forced')).length;
    const naked = solvingSteps.filter((s) => s.type === 'naked_single').length;
    const total = forced + naked || 1;
    const forcedPercent = Math.round((forced / total) * 100);
    const nakedPercent = 100 - forcedPercent;
    return { forced, naked, forcedPercent, nakedPercent };
  }, [solvingSteps]);

  const handleClosePBModal = useCallback(() => {
    setShowPBModal(false);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono">
      {/* 頂部數據列 */}
      <div className="w-full grid grid-cols-3 gap-1 mb-1.5 text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? 'Speed' : '競速'}</div>
          <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? 'Dimension' : '階數'}</div>
          <div className="text-cyan-300 font-bold">{n} * {n}</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? 'White / Black' : '差壹 / 雙倍'}</div>
          <div className="text-amber-400 font-bold">{dots.length} {isEn ? 'clues' : '提示'}</div>
        </div>
      </div>

      {/* 180° 對稱美學標籤 & 縮放控制 */}
      <div className="w-full flex items-center justify-between px-1 mb-1.5">
        <div>
          {spec?.isSymmetric180 && (
            <span className="px-2 py-0.5 rounded-full bg-indigo-950/70 border border-indigo-500/40 text-indigo-300 text-[7.5px] font-bold flex items-center gap-1 shadow-[0_0_8px_rgba(99,102,241,0.2)]">
              {isEn ? '180° Rotational Symmetry' : '180° 中心對稱盤面'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setBoardScale((s) => Math.max(0.85, Number((s - 0.05).toFixed(2))))}
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

      {/* 盤面區域 */}
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
              const isSelected = selectedCell?.[0] === r && selectedCell?.[1] === c;
              const isInitial = initialGrid[r][c] !== 0;
              const cellNotes = notes[r][c];
              const isHintTarget = activeHintStep?.row === r && activeHintStep?.col === c;

              let cellStyle = 'bg-slate-950/70 text-transparent hover:bg-slate-900/50';
              if (isHintTarget && hintLevel >= 1) {
                cellStyle
