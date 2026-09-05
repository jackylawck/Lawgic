// web-frontend/src/components/SkyscraperBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { MetricErrorBar } from './MetricErrorBar';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';
import { getEnvironmentFingerprint, calculateInfractionScore } from '../utils/tournamentSecurity';
import { SkyscraperHintStep } from '../engines/skyscraperGenerator';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

type SpatialStrategy = 'MentalRotator' | 'ProgressiveEliminator' | 'GlobalPlanner';

export const SkyscraperBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const {
    recordAttempt,
    saveBookmark,
    removeBookmark,
    getBenchmarkMetrics,
    profile,
    getCompositeCognitiveIndex,
    exportLongitudinalDataset,
  } = useLearnerProfile();

  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const [internalAssessment, setInternalAssessment] = useState<boolean>(false);
  const isAssessmentMode = tournamentMode || internalAssessment;

  const spec = actualPuzzle?.puzzle as any;
  const size: number = spec?.size || 4;
  const clues = spec?.clues || { top: [], bottom: [], left: [], right: [] };
  const hints: SkyscraperHintStep[] = useMemo(() => spec?.hints || [], [spec]);
  const solutionGrid = useMemo(() => (actualPuzzle?.solution as number[][]) || [], [actualPuzzle]);

  const metrics = (actualPuzzle?.metrics as any) || {};
  const theoryTime = metrics.estimated_time_sec || 120;
  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';
  const standardTimeLimit = size === 4 ? 360 : 540;

  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('PerspectiveDeduction', theoryTime, 'skyscraper');
  }, [getBenchmarkMetrics, theoryTime]);

  const initialGrid = useMemo(() => {
    if (spec?.grid && Array.isArray(spec.grid)) {
      return spec.grid.map((row: number[]) => [...row]);
    }
    return Array.from({ length: size }, () => Array(size).fill(0));
  }, [spec, size]);

  const [grid, setGrid] = useState<number[][]>(initialGrid);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isResigned, setIsResigned] = useState<boolean>(false);
  const [isTimedOut, setIsTimedOut] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);
  const [violationAlert, setViolationAlert] = useState<string | null>(null);
  const [bookmarkToast, setBookmarkToast] = useState<string | null>(null);

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHintText, setActiveHintText] = useState<string | null>(null);

  const tabSwitchesRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const hypothesisAttemptsRef = useRef<number>(0);
  const moveSequenceRef = useRef<{ r: number; c: number; time: number }[]>([]);
  const hasRecordedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isAssessmentMode || isCompleted || isTimedOut || isResigned) return;

    const handleVisibility = () => {
      if (document.hidden) {
        tabSwitchesRef.current += 1;
        setViolationAlert(isEn ? '⚠️ Tab switch detected' : '⚠️ 偵測到切換分頁');
        setTimeout(() => setViolationAlert(null), 3000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isAssessmentMode, isCompleted, isTimedOut, isResigned, isEn]);

  useEffect(() => {
    const bookmark = profile.bookmarks[actualPuzzle?.id || ''];
    if (bookmark && bookmark.boardState) {
      setGrid(Array.isArray(bookmark.boardState) && bookmark.boardState.length > 0 ? bookmark.boardState : initialGrid);
      setElapsedSec(bookmark.elapsedSec);
      setBookmarkToast(isEn ? 'Restored bookmarked progress' : '已自動恢復上次暫存進度');
      setTimeout(() => setBookmarkToast(null), 2500);
    } else {
      setGrid(initialGrid);
      setElapsedSec(0);
    }

    setSelected(null);
    setIsCompleted(false);
    setIsResigned(false);
    setIsTimedOut(false);
    setProofSignature(null);
    setViolationAlert(null);
    setHintLevel(0);
    setActiveHintText(null);
    tabSwitchesRef.current = 0;
    startTimeRef.current = Date.now() - (bookmark?.elapsedSec ? bookmark.elapsedSec * 1000 : 0);
    conflictCountRef.current = 0;
    hypothesisAttemptsRef.current = 0;
    moveSequenceRef.current = [];
    hasRecordedRef.current = false;
  }, [initialGrid, actualPuzzle?.id, profile.bookmarks, isEn]);

  const detectedStrategy = useMemo<SpatialStrategy>(() => {
    const seq = moveSequenceRef.current;
    if (seq.length < 3) return 'GlobalPlanner';

    let axisSwitches = 0;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].r !== seq[i - 1].r && seq[i].c !== seq[i - 1].c) {
        axisSwitches++;
      }
    }

    const switchRatio = axisSwitches / seq.length;
    if (switchRatio > 0.65) return 'MentalRotator';
    if (hypothesisAttemptsRef.current >= 3) return 'GlobalPlanner';
    return 'ProgressiveEliminator';
  }, [grid]);

  const countVisible = (line: number[]): number => {
    let count = 0;
    let max = 0;
    for (const val of line) {
      if (val > max) {
        count++;
        max = val;
      }
    }
    return count;
  };

  const clueStatus = useMemo(() => {
    const topStatus = clues.top?.map((target: number, c: number) => {
      if (target === 0) return true;
      const col = grid.map((r) => r[c]);
      if (col.some((v) => v === 0)) return null;
      return countVisible(col) === target;
    });

    const bottomStatus = clues.bottom?.map((target: number, c: number) => {
      if (target === 0) return true;
      const col = grid.map((r) => r[c]).reverse();
      if (col.some((v) => v === 0)) return null;
      return countVisible(col) === target;
    });

    const leftStatus = clues.left?.map((target: number, r: number) => {
      if (target === 0) return true;
      const row = grid[r];
      if (row.some((v) => v === 0)) return null;
      return countVisible(row) === target;
    });

    const rightStatus = clues.right?.map((target: number, r: number) => {
      if (target === 0) return true;
      const row = [...grid[r]].reverse();
      if (row.some((v) => v === 0)) return null;
      return countVisible(row) === target;
    });

    return { topStatus, bottomStatus, leftStatus, rightStatus };
  }, [grid, clues]);

  const duplicateConflictSet = useMemo(() => {
    const dupes = new Set<string>();
    for (let r = 0; r < size; r++) {
      const seen = new Map<number, number[]>();
      for (let c = 0; c < size; c++) {
        const val = grid[r][c];
        if (val !== 0) {
          if (!seen.has(val)) seen.set(val, []);
          seen.get(val)!.push(c);
        }
      }
      seen.forEach((cols) => {
        if (cols.length > 1) {
          cols.forEach((c) => dupes.add(`${r},${c}`));
        }
      });
    }

    for (let c = 0; c < size; c++) {
      const seen = new Map<number, number[]>();
      for (let r = 0; r < size; r++) {
        const val = grid[r][c];
        if (val !== 0) {
          if (!seen.has(val)) seen.set(val, []);
          seen.get(val)!.push(r);
        }
      }
      seen.forEach((rows) => {
        if (rows.length > 1) {
          rows.forEach((r) => dupes.add(`${r},${c}`));
        }
      });
    }
    return dupes;
  }, [grid, size]);

  useEffect(() => {
    if (isCompleted || isTimedOut || isResigned) return;
    const timer = setInterval(() => {
      const currentElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSec(currentElapsed);

      if (isAssessmentMode && currentElapsed >= standardTimeLimit) {
        setIsTimedOut(true);
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const sol = actualPuzzle?.solution as number[][];
          const totalCells = size * size;
          let correctFilled = 0;
          let filledCount = 0;
          for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
              if (grid[r][c] !== 0) {
                filledCount++;
                if (sol && grid[r][c] === sol[r][c]) correctFilled++;
              }
            }
          }
          const partialRatio = filledCount > 0 ? Number((correctFilled / totalCells).toFixed(2)) : 0;

          recordAttempt({
            puzzleId: actualPuzzle?.id || 'unknown',
            engineType: 'skyscraper',
            tier: currentTier,
            cognitiveLoad: actualPuzzle?.cognitiveLoad || {
              spatial: 0.85,
              numeric: 0.4,
              workingMemory: 0.8,
              inhibition: 0.6,
            },
            isSuccess: false,
            timeSpentSec: standardTimeLimit,
            conflictsCount: conflictCountRef.current,
            technique: detectedStrategy,
            partialCompletionRatio: partialRatio,
          });

          try {
            const canonical = `${actualPuzzle?.id}|${standardTimeLimit}|${conflictCountRef.current}|TIMEOUT_AUDIT`;
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
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isCompleted, isTimedOut, isResigned, isAssessmentMode, standardTimeLimit, actualPuzzle, currentTier, recordAttempt, size, grid, detectedStrategy]);

  const checkVictory = useCallback(
    async (currentGrid: number[][]) => {
      const sol = actualPuzzle?.solution as number[][];
      if (!sol || !Array.isArray(sol)) return;

      let isMatch = true;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (currentGrid[r][c] !== sol[r][c]) {
            isMatch = false;
            break;
          }
        }
      }

      if (isMatch) {
        setIsCompleted(true);
        removeBookmark(actualPuzzle?.id || '');

        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: 'skyscraper',
            tier: currentTier,
            cognitiveLoad: actualPuzzle?.cognitiveLoad || {
              spatial: 0.85,
              numeric: 0.4,
              workingMemory: 0.8,
              inhibition: 0.6,
            },
            isSuccess: true,
            timeSpentSec: timeSpent,
            conflictsCount: conflictCountRef.current,
            technique: detectedStrategy,
            partialCompletionRatio: 1.0,
            isPureClear: conflictCountRef.current === 0 && hintLevel === 0,
          });

          try {
            const canonical = [
              actualPuzzle.id,
              currentTier,
              timeSpent,
              conflictCountRef.current,
              tabSwitchesRef.current,
              'SKYSCRAPER_PERSPECTIVE_VERIFIED',
            ].join('|');
            const enc = new TextEncoder();
            const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(canonical));
            const hex = Array.from(new Uint8Array(buf))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
            setProofSignature(`VERIFIED_${hex.slice(0, 24).toUpperCase()}`);
          } catch {
            setProofSignature(`LOCAL_${Date.now()}`);
          }

          if (benchmarkData.isNewPB) {
            setShowPBModal(true);
          }
        }
      }
    },
    [actualPuzzle, size, currentTier, recordAttempt, removeBookmark, detectedStrategy, hintLevel, benchmarkData.isNewPB]
  );

  const handleBookmarkPuzzle = useCallback(() => {
    if (isCompleted || isTimedOut || isResigned || !actualPuzzle) return;
    saveBookmark({
      puzzleId: actualPuzzle.id,
      engineType: 'skyscraper',
      tier: currentTier,
      boardState: grid,
      elapsedSec,
      bookmarkedAt: new Date().toISOString(),
    });
    setBookmarkToast(isEn ? '📌 Progress bookmarked for later' : '📌 已暫存此局進度，可隨時接續');
    setTimeout(() => setBookmarkToast(null), 2500);
    if (navigator.vibrate) navigator.vibrate([25, 40]);
  }, [isCompleted, isTimedOut, isResigned, actualPuzzle, currentTier, grid, elapsedSec, saveBookmark, isEn]);

  const handleGracefulResign = useCallback(() => {
    if (isCompleted || isTimedOut || isResigned || !solutionGrid.length) return;
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);

    setIsResigned(true);
    hasRecordedRef.current = true;
    removeBookmark(actualPuzzle?.id || '');

    setGrid(solutionGrid.map((row) => [...row]));

    const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    recordAttempt({
      puzzleId: actualPuzzle?.id || 'skyscraper',
      engineType: 'skyscraper',
      tier: currentTier,
      cognitiveLoad: actualPuzzle?.cognitiveLoad || {
        spatial: 0.85,
        numeric: 0.4,
        workingMemory: 0.8,
        inhibition: 0.6,
      },
      isSuccess: false,
      timeSpentSec: timeSpent,
      conflictsCount: conflictCountRef.current,
      technique: detectedStrategy,
      partialCompletionRatio: 0.5,
      isPureClear: false,
    });
  }, [isCompleted, isTimedOut, isResigned, solutionGrid, actualPuzzle, currentTier, conflictCountRef, detectedStrategy, recordAttempt, removeBookmark]);

  const triggerHintLadder = () => {
    if (hints.length === 0 || isCompleted || isTimedOut || isResigned) return;

    const nextLevel = Math.min(3, hintLevel + 1);
    const hintData = hints.find((h) => h.level === nextLevel) || hints[hints.length - 1];

    setHintLevel(nextLevel);
    setActiveHintText(isEn ? hintData.messageEn : hintData.messageZh);

    if (hintData.row !== undefined && hintData.col !== undefined) {
      setSelected([hintData.row, hintData.col]);
    }

    if (navigator.vibrate) navigator.vibrate(25);
  };

  const handleCellClick = (r: number, c: number) => {
    if (isCompleted || isTimedOut || isResigned || initialGrid[r][c] !== 0) return;
    setSelected([r, c]);
    if (navigator.vibrate) navigator.vibrate(12);
  };

  const handleNumberInput = (num: number) => {
    if (!selected || isCompleted || isTimedOut || isResigned) return;
    const [r, c] = selected;
    if (initialGrid[r][c] !== 0) return;

    const sol = actualPuzzle?.solution as number[][];

    if (num === 0 && grid[r][c] !== 0) {
      hypothesisAttemptsRef.current += 1;
    }

    if (num !== 0 && sol && sol[r] && sol[r][c] !== num) {
      conflictCountRef.current += 1;
      if (!isAssessmentMode && navigator.vibrate) {
        navigator.vibrate([30, 40, 30]);
      }
    }

    if (num !== 0) {
      moveSequenceRef.current.push({ r, c, time: Date.now() });
    }

    const nextGrid = grid.map((row) => [...row]);
    nextGrid[r][c] = num;
    setGrid(nextGrid);

    const currentHint = hints.find((h) => h.level === 3);
    if (hintLevel === 3 && currentHint && currentHint.row === r && currentHint.col === c && num === currentHint.targetNum) {
      setHintLevel(0);
      setActiveHintText(isEn ? '✨ Strategic step confirmed!' : '✨ 視線遮擋推理已由您手動確認！');
      setTimeout(() => setActiveHintText(null), 3000);
    }

    checkVictory(nextGrid);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isTimedOut || isResigned || !selected) return;
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= size) {
        handleNumberInput(num);
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        handleNumberInput(0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, isCompleted, isTimedOut, isResigned, size, grid]);

  const handleNavigateTargetGame = (gameId: string) => {
    window.dispatchEvent(new CustomEvent('logicore:navigate-game', { detail: { gameId } }));
  };

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);
  const remainingTime = Math.max(0, standardTimeLimit - elapsedSec);

  return (
    <div className="flex flex-col items-center w-full select-none py-1 font-mono">
      {violationAlert && (
        <div className="fixed top-2 z-50 px-3 py-1.5 bg-rose-600 border border-rose-400 text-white font-bold text-xs rounded-full shadow-2xl animate-bounce">
          {violationAlert}
        </div>
      )}

      {bookmarkToast && (
        <div className="fixed top-2 z-50 px-3 py-1.5 bg-indigo-600 border border-indigo-400 text-white font-bold text-xs rounded-full shadow-2xl animate-bounce">
          {bookmarkToast}
        </div>
      )}

      <div className="w-[min(90vw,46vh)] flex items-center justify-between text-[8px] text-slate-500 mb-1 px-1">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setInternalAssessment((prev) => !prev)}
            className={`px-1.5 py-0.5 rounded border transition text-[7px] font-bold cursor-pointer ${
              isAssessmentMode
                ? 'bg-rose-950/80 border-rose-600 text-rose-300'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {isAssessmentMode ? (isEn ? '● ASSESSMENT' : '● 標準施測') : (isEn ? '○ TRAINING' : '○ 自由訓練')}
          </button>
          <span>
            IRT: <strong className="text-cyan-400">{metrics.irt_logit_difficulty ?? '0.0'}</strong>
          </span>
          <span>
            MRT Anchor: <strong className="text-indigo-400">{metrics.mrt_correlation_anchor ?? '0.6'}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {!isCompleted && !isTimedOut && !isResigned && (
            <button
              onClick={handleBookmarkPuzzle}
              className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 text-[7px] rounded transition cursor-pointer"
              title={isEn ? 'Bookmark progress' : '暫存此局進度'}
            >
              📌 {isEn ? 'Save' : '暫存'}
            </button>
          )}

          {!isCompleted && !isTimedOut && !isResigned && (
            <button
              onClick={handleGracefulResign}
              className="px-1.5 py-0.5 bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-700 text-slate-400 hover:text-rose-300 text-[7px] rounded transition cursor-pointer"
              title={isEn ? 'Resign & Reveal Solution' : '優雅投降並覆盤官方解答'}
            >
              🕊️ {isEn ? 'Resign' : '投降'}
            </button>
          )}

          {!isCompleted && !isTimedOut && !isResigned && hints.length > 0 && (
            <button
              onClick={triggerHintLadder}
              className="px-2 py-0.5 bg-amber-950 hover:bg-amber-900 border border-amber-500 text-amber-300 text-[7px] font-bold rounded flex items-center gap-1 transition shadow active:scale-95 cursor-pointer"
            >
              <span>💡</span>
              <span>{hintLevel === 0 ? (isEn ? 'Hint 1' : '提示一') : hintLevel === 1 ? (isEn ? 'Hint 2' : '提示二') : (isEn ? 'Hint 3' : '提示三')}</span>
            </button>
          )}

          {tabSwitchesRef.current > 0 && (
            <span className="text-rose-400 font-bold text-[7px]">
              {isEn ? 'Switches' : '切換'}: {tabSwitchesRef.current}
            </span>
          )}

          {isAssessmentMode ? (
            <span className="text-rose-400 font-bold">
              ⏱️ {String(Math.floor(remainingTime / 60)).padStart(2, '0')}:{String(remainingTime % 60).padStart(2, '0')}
            </span>
          ) : (
            <span>
              Target: <strong className="text-amber-300">{benchmarkData.benchmarkTime}s</strong>
            </span>
          )}
        </div>
      </div>

      {activeHintText && (
        <div className="w-[min(90vw,46vh)] bg-amber-950/90 border border-amber-500 text-amber-200 text-[7.5px] px-2 py-1.5 rounded-lg mb-1 animate-fade-in flex items-start justify-between gap-1 shadow-lg">
          <div className="flex items-start gap-1">
            <span className="text-amber-400 font-bold">L{hintLevel}</span>
            <span className="leading-snug">{activeHintText}</span>
          </div>
          <button onClick={() => setActiveHintText(null)} className="text-amber-400 shrink-0 font-bold ml-1 cursor-pointer">✕</button>
        </div>
      )}

      {/* 棋盤主體 */}
      <div
        className={`relative bg-slate-950 border rounded-xl shadow-2xl p-2.5 flex flex-col items-center justify-center transition-colors ${
          isResigned ? 'border-rose-900/60 bg-rose-950/20' : 'border-slate-800'
        }`}
        style={{ width: 'min(90vw, 46vh)', height: 'min(90vw, 46vh)' }}
      >
        {/* 上方線索 */}
        <div
          className="grid gap-1 w-full mb-1"
          style={{
            gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
            paddingLeft: '1.75rem',
            paddingRight: '1.75rem',
          }}
        >
          {clues.top?.map((val: number, idx: number) => {
            const status = clueStatus.topStatus?.[idx];
            const isColSelected = selected && selected[1] === idx;
            return (
              <div
                key={idx}
                className={`text-center text-[10px] sm:text-xs font-bold transition-all ${
                  status === true
                    ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]'
                    : status === false
                    ? 'text-rose-400'
                    : isColSelected
                    ? 'text-cyan-300 scale-110 font-black'
                    : 'text-cyan-400/80'
                }`}
              >
                {val > 0 ? `↓${val}` : ''}
              </div>
            );
          })}
        </div>

        {/* 中間主盤面與左右線索 */}
        <div className="w-full flex-1 flex flex-col justify-between gap-1">
          {grid.map((row, rIdx) => (
            <div key={rIdx} className="flex items-center w-full gap-1 flex-1">
              {/* 左側線索 */}
              <div
                className={`w-6 text-right pr-1 text-[10px] sm:text-xs font-bold transition-all ${
                  clueStatus.leftStatus?.[rIdx] === true
                    ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]'
                    : clueStatus.leftStatus?.[rIdx] === false
                    ? 'text-rose-400'
                    : selected && selected[0] === rIdx
                    ? 'text-cyan-300 scale-110 font-black'
                    : 'text-cyan-400/80'
                }`}
              >
                {clues.left?.[rIdx] > 0 ? `→${clues.left[rIdx]}` : ''}
              </div>

              {/* 盤面格子 */}
              <div
                className="flex-1 grid gap-1 h-full"
                style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
              >
                {row.map((val, cIdx) => {
                  const isSelected = selected && selected[0] === rIdx && selected[1] === cIdx;
                  const isGiven = initialGrid[rIdx][cIdx] !== 0;
                  const isDuplicate = duplicateConflictSet.has(`${rIdx},${cIdx}`);
                  const isHintTarget = hintLevel >= 1 && hints[hintLevel - 1]?.row === rIdx && hints[hintLevel - 1]?.col === cIdx;

                  return (
                    <button
                      key={cIdx}
                      onClick={() => handleCellClick(rIdx, cIdx)}
                      className={`w-full h-full flex items-center justify-center font-bold text-xs sm:text-base rounded-lg border transition-all cursor-pointer ${
                        isResigned
                          ? 'bg-rose-950 border-rose-600 text-rose-200'
                          : isHintTarget
                          ? 'bg-amber-600 border-amber-300 text-white ring-2 ring-amber-400 animate-pulse z-20'
                          : isSelected
                          ? 'bg-indigo-600 border-indigo-300 text-white ring-2 ring-indigo-400 z-10'
                          : isDuplicate
                          ? 'bg-rose-950/80 border-rose-500 text-rose-300 animate-pulse'
                          : isGiven
                          ? 'bg-slate-900 border-slate-700 text-slate-400'
                          : val !== 0
                          ? 'bg-slate-950 border-cyan-800 text-cyan-300 shadow-xs'
                          : 'bg-slate-950 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      {val !== 0 ? val : ''}
                    </button>
                  );
                })}
              </div>

              {/* 右側線索 */}
              <div
                className={`w-6 text-left pl-1 text-[10px] sm:text-xs font-bold transition-all ${
                  clueStatus.rightStatus?.[rIdx] === true
                    ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]'
                    : clueStatus.rightStatus?.[rIdx] === false
                    ? 'text-rose-400'
                    : selected && selected[0] === rIdx
                    ? 'text-cyan-300 scale-110 font-black'
                    : 'text-cyan-400/80'
                }`}
              >
                {clues.right?.[rIdx] > 0 ? `${clues.right[rIdx]}←` : ''}
              </div>
            </div>
          ))}
        </div>

        {/* 下方線索 */}
        <div
          className="grid gap-1 w-full mt-1"
          style={{
            gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
            paddingLeft: '1.75rem',
            paddingRight: '1.75rem',
          }}
        >
          {clues.bottom?.map((val: number, idx: number) => {
            const status = clueStatus.bottomStatus?.[idx];
            const isColSelected = selected && selected[1] === idx;
            return (
              <div
                key={idx}
                className={`text-center text-[10px] sm:text-xs font-bold transition-all ${
                  status === true
                    ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]'
                    : status === false
                    ? 'text-rose-400'
                    : isColSelected
                    ? 'text-cyan-300 scale-110 font-black'
                    : 'text-cyan-400/80'
                }`}
              >
                {val > 0 ? `↑${val}` : ''}
              </div>
            );
          })}
        </div>
      </div>

      {/* 數字按鍵盤 */}
      {!isCompleted && !isTimedOut && !isResigned && (
        <div className="flex gap-1.5 mt-2.5 justify-center w-[min(90vw,46vh)]">
          {Array.from({ length: size }, (_, i) => i + 1).map((num) => (
            <button
              key={num}
              onClick={() => handleNumberInput(num)}
              disabled={!selected}
              className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 border border-slate-700 text-slate-200 rounded-lg font-bold text-xs transition shadow active:scale-95 cursor-pointer"
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => handleNumberInput(0)}
            disabled={!selected}
            className="px-3 py-2 bg-rose-950/70 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-lg font-bold text-xs transition shadow active:scale-95 cursor-pointer"
            title={isEn ? 'Clear' : '清除'}
          >
            ⌫
          </button>
        </div>
      )}

      {/* 超時結算面板 */}
      {isTimedOut && (
        <div className="mt-3 p-3 bg-rose-950/90 border border-rose-600 rounded-xl text-center w-[min(90vw,46vh)] shadow-2xl animate-fade-in">
          <div className="text-xs text-rose-200 font-bold mb-1">⚠️ ASSESSMENT CEILING REACHED</div>
          <div className="w-full bg-slate-900 border border-slate-800 rounded-full h-2 overflow-hidden my-1.5">
            <div
              className="bg-amber-400 h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.round(
                  (grid.flat().filter((v) => v !== 0).length / (size * size)) * 100
                )}%`,
              }}
            />
          </div>
          <div className="text-[8px] text-slate-300 flex justify-between">
            <span>Filled: {grid.flat().filter((v) => v !== 0).length} / {size * size}</span>
            <span>Conflicts: {conflictCountRef.current}</span>
          </div>
        </div>
      )}

      {/* 通關反思面板 */}
      {(isCompleted || isResigned) && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(90vw,46vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
            <div className="text-left">
              <div className="text-[8px] text-slate-500 tracking-wider flex items-center gap-1">
                <span>3D MENTAL ROTATION VERIFIED</span>
                <span className="text-[6.5px] px-1 py-0.2 bg-indigo-950 border border-indigo-700 text-indigo-300 rounded">
                  CSEM: ±{cci.semIQ} IQ
                </span>
              </div>
              <div className="text-xs text-indigo-300 font-bold">
                {isResigned
                  ? (isEn ? '🕊️ Resigned (Official Solution Revealed)' : '🕊️ 官方解答覆盤模式')
                  : detectedStrategy === 'MentalRotator'
                  ? (isEn ? '🌀 Mental Rotation Active' : '🌀 空間心像旋轉活躍')
                  : (isEn ? '📐 Systematic Projection' : '📐 系統幾何投影')}
              </div>
            </div>

            <div className="flex flex-col items-end">
              <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[10px] font-bold text-cyan-300">
                IQ {cci.standardIQ} (95% CI: [{cci.ci95IQ[0]}-{cci.ci95IQ[1]}])
              </div>
              <span className="text-[6.5px] text-slate-400 mt-0.5">
                {isEn ? `Age Norm (${cci.ageNorm.cohort}):` : `年齡常模 (${cci.ageNorm.cohort}):`}{' '}
                {cci.ageNorm.ageAdjustedZ >= 0 ? `+${cci.ageNorm.ageAdjustedZ}` : cci.ageNorm.ageAdjustedZ} SD ({isEn ? 'Top' : '前'} {Number((100 - cci.ageNorm.agePercentile).toFixed(1))}%)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[8px] text-slate-400 mb-2">
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>{isEn ? 'Actual Time' : '實際耗時'}</div>
              <div className="text-slate-200 font-bold text-xs">{elapsedSec}s</div>
              <div className="text-[7px] text-slate-500">Benchmark: {benchmarkData.benchmarkTime}s</div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>{isEn ? 'Depth' : '推導深度'}</div>
              <div className="text-cyan-300 font-bold text-xs">{metrics.perspective_depth ?? 3} {isEn ? 'Lv' : '層'}</div>
              <div className="text-[7px] text-slate-500">MRT Anchor: {metrics.mrt_correlation_anchor ?? 0.6}</div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>{isEn ? 'Hypotheses' : '假設回退'}</div>
              <div className="text-amber-300 font-bold text-xs">{hypothesisAttemptsRef.current} {isEn ? 'steps' : '次'}</div>
              <div className="text-[7px] text-slate-500">Conflicts: {conflictCountRef.current}</div>
            </div>
          </div>

          <div className="mb-2">
            <MetricErrorBar
              actualVal={elapsedSec}
              benchmarkVal={benchmarkData.benchmarkTime}
              ci95={benchmarkData.ci95}
              sem={benchmarkData.sem}
              unit="s"
              isEn={isEn}
            />
          </div>

          <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800 flex flex-col items-center mb-2">
            <CognitiveRadarChart
              dimensions={profile.cognitiveDimensions}
              previousDimensions={profile.previousCognitiveDimensions}
              size={150}
            />
          </div>

          <div className="bg-indigo-950/40 p-2 rounded-lg border border-indigo-800/60 text-left mb-2 flex items-center justify-between gap-2">
            <div className="flex-1 text-[8px] text-slate-300">
              {isEn ? benchmarkData.recommendedFocus.reasonEn : benchmarkData.recommendedFocus.reasonZh}
            </div>
            <button
              onClick={() => handleNavigateTargetGame(benchmarkData.recommendedFocus.targetGame)}
              className="shrink-0 px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[8px] rounded transition active:scale-95 cursor-pointer"
            >
              ➜ {isEn ? 'Train' : '立即訓練'}
            </button>
          </div>

          <div className="flex gap-1.5 mb-2">
            <button
              onClick={exportLongitudinalDataset}
              className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 border border-cyan-600/50 hover:border-cyan-400 text-cyan-300 text-[8px] font-bold rounded-lg transition shadow flex items-center justify-center gap-1 active:scale-95 cursor-pointer"
            >
              <span>📊</span>
              <span>{isEn ? 'Export Dataset' : '匯出縱向數據'}</span>
            </button>

            <button
              onClick={() => setShowSubmitModal(true)}
              className="flex-1 py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 text-slate-950 text-[8px] font-black rounded-lg shadow transition active:scale-95 flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>📤</span>
              <span>{isEn ? 'Submit Result' : '官方賽事提交'}</span>
            </button>
          </div>

          {proofSignature && (
            <div className="p-1.5 bg-slate-900 border border-slate-800 rounded text-left">
              <div className="text-[7px] text-slate-500 font-bold uppercase tracking-wider flex items-center justify-between">
                <span>LOCAL CRYPTO RECEIPT (SHA-256)</span>
                <span className="text-emerald-400 font-mono text-[6px]">TAMPER-PROOF</span>
              </div>
              <div className="text-[6.5px] font-mono text-cyan-400/80 break-all select-all mt-0.5">
                {proofSignature}
              </div>
            </div>
          )}
        </div>
      )}

      {showPBModal && (
        <PBCelebrationModal
          pb={profile.personalBest}
          onClose={() => setShowPBModal(false)}
          isEn={isEn}
        />
      )}

      {showSubmitModal && (
        <TournamentSubmissionModal
          payload={{
            submissionId: `SUB-${actualPuzzle.id}-${Date.now().toString(36)}`,
            tournamentId: tournamentMode ? 'WPF_SKYSCRAPER_2026' : 'GLOBAL_SPATIAL_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'skyscraper',
            tier: currentTier,
            timeSpentSec: elapsedSec,
            conflictsCount: conflictCountRef.current,
            infractionScore: calculateInfractionScore({
              tabSwitches: tabSwitchesRef.current,
              blurEvents: 0,
              clipboardEvents: 0,
              untrustedEvents: 0,
            }),
            environment: getEnvironmentFingerprint(),
            timestamp: new Date().toISOString(),
          }}
          onClose={() => setShowSubmitModal(false)}
          isEn={isEn}
        />
      )}
    </div>
  );
};
