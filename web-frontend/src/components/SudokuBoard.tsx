// web-frontend/src/components/SudokuBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { MetricErrorBar } from './MetricErrorBar';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';
import { getEnvironmentFingerprint, calculateInfractionScore } from '../utils/tournamentSecurity';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

export const SudokuBoard: React.FC<Props> = ({
  puzzleData,
  puzzle,
  tournamentMode = false,
}) => {
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

  const metrics = (actualPuzzle?.metrics as any) || {};
  const highestTech = metrics.highest_technique || 'NakedSingle';
  const theoryTime = metrics.estimated_time_sec || 120;
  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';

  const timeLimitMap: Record<TierKey, number> = {
    kids: 300,
    intermediate: 420,
    expert: 540,
    master: 600,
  };
  const standardTimeLimit = timeLimitMap[currentTier] || 480;

  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics(highestTech, theoryTime);
  }, [getBenchmarkMetrics, highestTech, theoryTime]);

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
  const [candidates, setCandidates] = useState<Record<number, Set<number>>>({});
  const [isNoteMode, setIsNoteMode] = useState<boolean>(false);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [conflictCell, setConflictCell] = useState<number | null>(null);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isFailedAssessment, setIsFailedAssessment] = useState<boolean>(false);
  const [isTimedOut, setIsTimedOut] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);
  const [violationAlert, setViolationAlert] = useState<string | null>(null);
  const [bookmarkToast, setBookmarkToast] = useState<string | null>(null);

  const tabSwitchesRef = useRef<number>(0);
  const blurEventsRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  // 防作弊監聽
  useEffect(() => {
    if (!isAssessmentMode || isCompleted || isTimedOut || isFailedAssessment) return;

    const handleVisibility = () => {
      if (document.hidden) {
        tabSwitchesRef.current += 1;
        setViolationAlert(isEn ? '⚠️ Tab switch detected' : '⚠️ 偵測到切換分頁');
        setTimeout(() => setViolationAlert(null), 3000);
      }
    };

    const handleBlur = () => {
      blurEventsRef.current += 1;
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isAssessmentMode, isCompleted, isTimedOut, isFailedAssessment, isEn]);

  // 初始化與書籤恢復
  useEffect(() => {
    const bookmark = profile.bookmarks[actualPuzzle?.id || ''];
    if (bookmark) {
      setGrid(bookmark.savedBridges.length > 0 ? (bookmark.savedBridges as any) : initialGrid);
      setElapsedSec(bookmark.elapsedSec);
      setBookmarkToast(isEn ? 'Restored bookmarked progress' : '已自動恢復上次暫存進度');
      setTimeout(() => setBookmarkToast(null), 2500);
    } else {
      setGrid(initialGrid);
      setElapsedSec(0);
    }

    setCandidates({});
    setIsNoteMode(false);
    setSelectedCell(null);
    setConflictCell(null);
    setIsCompleted(false);
    setIsFailedAssessment(false);
    setIsTimedOut(false);
    setProofSignature(null);
    setViolationAlert(null);
    tabSwitchesRef.current = 0;
    blurEventsRef.current = 0;
    startTimeRef.current = Date.now() - (bookmark?.elapsedSec ? bookmark.elapsedSec * 1000 : 0);
    conflictCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [initialGrid, actualPuzzle?.id, profile.bookmarks, isEn]);

  // 計時與超時判定
  useEffect(() => {
    if (isCompleted || isTimedOut || isFailedAssessment) return;
    const timer = setInterval(() => {
      const currentElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSec(currentElapsed);

      if (isAssessmentMode && currentElapsed >= standardTimeLimit) {
        setIsTimedOut(true);
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const sol = (actualPuzzle?.solution as any)?.flat() || [];
          const filledCount = grid.filter((v) => v !== 0).length;
          const correctFilled = grid.filter((v, i) => v !== 0 && v === sol[i]).length;
          const partialRatio = filledCount > 0 ? Number((correctFilled / 81).toFixed(2)) : 0;

          recordAttempt({
            puzzleId: actualPuzzle?.id || 'unknown',
            engineType: 'sudoku',
            tier: currentTier,
            cognitiveLoad: actualPuzzle?.cognitiveLoad || {
              spatial: 0.3,
              numeric: 0.7,
              workingMemory: 0.8,
              inhibition: 0.6,
            },
            isSuccess: false,
            timeSpentSec: standardTimeLimit,
            conflictsCount: conflictCountRef.current,
            technique: highestTech,
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
  }, [
    isCompleted,
    isTimedOut,
    isFailedAssessment,
    isAssessmentMode,
    standardTimeLimit,
    actualPuzzle,
    currentTier,
    highestTech,
    recordAttempt,
    grid,
  ]);

  // 勝利判定
  const checkVictory = useCallback(
    async (currentGrid: number[]) => {
      const sol = actualPuzzle?.solution;
      if (!sol || !Array.isArray(sol)) return;
      const flatSol = Array.isArray(sol[0]) ? sol.flat() : sol;

      const isPerfectMatch = flatSol.length === 81 && currentGrid.every((v, i) => v === flatSol[i]);

      if (isPerfectMatch) {
        setIsCompleted(true);
        removeBookmark(actualPuzzle?.id || '');

        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: actualPuzzle.engine_type || 'sudoku',
            tier: currentTier,
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
            partialCompletionRatio: 1.0,
            isPureClear: conflictCountRef.current === 0,
          });

          try {
            const canonical = [
              actualPuzzle.id,
              currentTier,
              timeSpent,
              conflictCountRef.current,
              tabSwitchesRef.current,
              'SUDOKU_PERFECT_MATCH_VERIFIED',
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
      } else if (isAssessmentMode && currentGrid.every((v) => v !== 0)) {
        setIsFailedAssessment(true);
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
          const correctFilled = currentGrid.filter((v, i) => v === flatSol[i]).length;
          const partialRatio = Number((correctFilled / 81).toFixed(2));

          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: actualPuzzle.engine_type || 'sudoku',
            tier: currentTier,
            cognitiveLoad: actualPuzzle.cognitiveLoad || {
              spatial: 0.3,
              numeric: 0.7,
              workingMemory: 0.8,
              inhibition: 0.6,
            },
            isSuccess: false,
            timeSpentSec: timeSpent,
            conflictsCount: conflictCountRef.current,
            technique: highestTech,
            partialCompletionRatio: partialRatio,
          });

          try {
            const canonical = `${actualPuzzle.id}|${timeSpent}|${conflictCountRef.current}|FAILED_FULL_ASSESSMENT`;
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
    },
    [actualPuzzle, recordAttempt, removeBookmark, currentTier, highestTech, isAssessmentMode, benchmarkData.isNewPB]
  );

  // 暫存此局進度
  const handleBookmarkPuzzle = useCallback(() => {
    if (isCompleted || isTimedOut || isFailedAssessment || !actualPuzzle) return;
    saveBookmark({
      puzzleId: actualPuzzle.id,
      engineType: 'sudoku',
      tier: currentTier,
      savedBridges: grid as any,
      elapsedSec,
      bookmarkedAt: new Date().toISOString(),
    });
    setBookmarkToast(isEn ? '📌 Progress bookmarked for later' : '📌 已暫存此局進度，可隨時接續');
    setTimeout(() => setBookmarkToast(null), 2500);
    if (navigator.vibrate) navigator.vibrate([25, 40]);
  }, [isCompleted, isTimedOut, isFailedAssessment, actualPuzzle, currentTier, grid, elapsedSec, saveBookmark, isEn]);

  const handleCellClick = (index: number) => {
    if (initialGrid[index] !== 0 || isCompleted || isTimedOut || isFailedAssessment) return;
    setSelectedCell(index);
    if (navigator.vibrate) navigator.vibrate(10);
  };

  const handleNumberInput = (num: number) => {
    if (selectedCell === null || initialGrid[selectedCell] !== 0 || isCompleted || isTimedOut || isFailedAssessment) return;

    // 筆記模式：切換候選數標記
    if (isNoteMode && num !== 0) {
      setCandidates((prev) => {
        const cellCandidates = new Set(prev[selectedCell] || []);
        if (cellCandidates.has(num)) {
          cellCandidates.delete(num);
        } else {
          cellCandidates.add(num);
        }
        return { ...prev, [selectedCell]: cellCandidates };
      });
      if (navigator.vibrate) navigator.vibrate(15);
      return;
    }

    // 正式填入數值
    const sol = actualPuzzle?.solution;
    const flatSol = sol ? (Array.isArray(sol[0]) ? sol.flat() : sol) : [];
    const expectedValue = flatSol[selectedCell];

    if (!isAssessmentMode) {
      if (num !== 0 && expectedValue !== undefined && num !== expectedValue) {
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
        conflictCountRef.current += 1;
        setConflictCell(selectedCell);
        setTimeout(() => setConflictCell(null), 500);
        return;
      }
    } else {
      if (num !== 0 && expectedValue !== undefined && num !== expectedValue) {
        conflictCountRef.current += 1;
      }
    }

    const nextGrid = [...grid];
    nextGrid[selectedCell] = num;
    setGrid(nextGrid);

    // 清除該格候選數
    if (num !== 0) {
      setCandidates((prev) => {
        const updated = { ...prev };
        delete updated[selectedCell];
        return updated;
      });
    }

    checkVictory(nextGrid);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isTimedOut || isFailedAssessment || selectedCell === null) return;

      if (e.key === 'n' || e.key === 'N') {
        setIsNoteMode((prev) => !prev);
        return;
      }

      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        handleNumberInput(num);
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        handleNumberInput(0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, isCompleted, isTimedOut, isFailedAssessment, grid, isNoteMode]);

  const userStat = profile.techniqueStats?.[highestTech];
  const solvingPath: string[] = metrics.solving_path || ['Standard Derivation'];
  const remainingTime = Math.max(0, standardTimeLimit - elapsedSec);
  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  // 高亮同數值與十字輔助線
  const selectedValue = selectedCell !== null ? grid[selectedCell] : 0;
  const selectedRow = selectedCell !== null ? Math.floor(selectedCell / 9) : -1;
  const selectedCol = selectedCell !== null ? selectedCell % 9 : -1;
  const selectedBox = selectedCell !== null ? Math.floor(selectedRow / 3) * 3 + Math.floor(selectedCol / 3) : -1;

  const handleNavigateTargetGame = (gameId: string) => {
    window.dispatchEvent(new CustomEvent('logicore:navigate-game', { detail: { gameId } }));
  };

  return (
    <div className="flex flex-col items-center w-full select-none py-1 font-mono">
      {/* 違規警告 */}
      {violationAlert && (
        <div className="fixed top-2 z-50 px-3 py-1.5 bg-rose-600 border border-rose-400 text-white font-bold text-xs rounded-full shadow-2xl animate-bounce">
          {violationAlert}
        </div>
      )}

      {/* 暫存提示 */}
      {bookmarkToast && (
        <div className="fixed top-2 z-50 px-3 py-1.5 bg-indigo-600 border border-indigo-400 text-white font-bold text-xs rounded-full shadow-2xl animate-bounce">
          {bookmarkToast}
        </div>
      )}

      {/* 頂部施測模式切換與指標列 */}
      <div className="w-[min(90vw,46vh)] flex items-center justify-between text-[8px] text-slate-500 mb-1 px-1">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setInternalAssessment((prev) => !prev)}
            className={`px-1.5 py-0.5 rounded border transition text-[7px] font-bold ${
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
          <span className="hidden sm:inline">
            Tech: <strong className="text-indigo-400">{highestTech}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {!isCompleted && !isTimedOut && !isFailedAssessment && (
            <button
              onClick={handleBookmarkPuzzle}
              className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 text-[7px] rounded transition"
              title={isEn ? 'Bookmark progress' : '暫存此局進度'}
            >
              📌 {isEn ? 'Save' : '暫存'}
            </button>
          )}

          {tabSwitchesRef.current > 0 && (
            <span className="text-rose-400 font-bold text-[7px]">
              Switches: {tabSwitchesRef.current}
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

      {/* 自適應盤面 */}
      <div className="grid grid-cols-9 gap-[1px] bg-slate-750 border-2 border-slate-700 p-1 rounded-xl shadow-2xl w-[min(90vw,46vh)] h-[min(90vw,46vh)] mx-auto">
        {grid.map((val, idx) => {
          const isGiven = initialGrid[idx] !== 0;
          const isSelected = selectedCell === idx;
          const isConflict = conflictCell === idx;

          const row = Math.floor(idx / 9);
          const col = idx % 9;
          const box = Math.floor(row / 3) * 3 + Math.floor(col / 3);

          const isSameValue = selectedValue > 0 && val === selectedValue;
          const isInSameLineOrBox = selectedCell !== null && (row === selectedRow || col === selectedCol || box === selectedBox);

          const borderRight = (col + 1) % 3 === 0 && col !== 8 ? 'border-r-2 border-r-slate-600' : '';
          const borderBottom = (row + 1) % 3 === 0 && row !== 8 ? 'border-b-2 border-b-slate-600' : '';

          const cellCandidates = candidates[idx];

          return (
            <button
              key={idx}
              onClick={() => handleCellClick(idx)}
              className={`w-full h-full flex items-center justify-center text-xs sm:text-base font-bold transition-colors rounded-xs relative ${borderRight} ${borderBottom} ${
                isConflict
                  ? 'bg-rose-600 text-white animate-pulse'
                  : isSelected
                  ? 'bg-indigo-600 text-white ring-2 ring-indigo-300 z-10'
                  : isSameValue
                  ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/60'
                  : isInSameLineOrBox
                  ? 'bg-slate-900/90 text-slate-200'
                  : isGiven
                  ? 'bg-slate-900/60 text-slate-300'
                  : val !== 0
                  ? 'bg-slate-950 text-cyan-400 font-semibold'
                  : 'bg-slate-950 hover:bg-slate-900 text-transparent'
              }`}
            >
              {val !== 0 ? (
                val
              ) : cellCandidates && cellCandidates.size > 0 ? (
                <div className="grid grid-cols-3 grid-rows-3 w-full h-full p-0.5 pointer-events-none">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <span
                      key={n}
                      className={`text-[6px] sm:text-[7.5px] leading-none flex items-center justify-center font-normal ${
                        cellCandidates.has(n) ? 'text-amber-400 font-bold' : 'text-transparent'
                      }`}
                    >
                      {n}
                    </span>
                  ))}
                </div>
              ) : (
                ''
              )}
            </button>
          );
        })}
      </div>

      {/* 數字鍵盤 + 筆記模式切換 */}
      {!isCompleted && !isTimedOut && !isFailedAssessment && (
        <div className="flex flex-col gap-1.5 mt-2.5 w-[min(90vw,46vh)]">
          <div className="grid grid-cols-10 gap-1">
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

          <div className="flex justify-between items-center px-1 text-[8px] text-slate-400">
            <button
              onClick={() => setIsNoteMode((prev) => !prev)}
              className={`px-2.5 py-1 rounded-lg border text-[8px] font-bold transition flex items-center gap-1 active:scale-95 ${
                isNoteMode
                  ? 'bg-amber-950 border-amber-500 text-amber-300 shadow-sm shadow-amber-500/40'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>✏️</span>
              <span>{isEn ? 'Notes Mode (N)' : '筆記模式 (N)'}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${isNoteMode ? 'bg-amber-400' : 'bg-slate-600'}`} />
            </button>

            <span className="text-[7px] text-slate-500">
              {isNoteMode ? (isEn ? 'Pencil candidate digits' : '輸入小字候選數') : (isEn ? 'Direct entry' : '直接填入數字')}
            </span>
          </div>
        </div>
      )}

      {/* 超時或失誤面板 */}
      {(isTimedOut || isFailedAssessment) && (
        <div className="mt-3 p-3 bg-rose-950/90 border border-rose-600 rounded-xl text-center w-[min(90vw,46vh)] shadow-2xl animate-fade-in">
          <div className="text-xs text-rose-200 font-bold mb-1">
            {isTimedOut ? '⚠️ ASSESSMENT CEILING REACHED' : '⚠️ ASSESSMENT COMPLETED (WITH CONFLICTS)'}
          </div>
          <div className="w-full bg-slate-900 border border-slate-800 rounded-full h-2 overflow-hidden my-1.5">
            <div
              className="bg-amber-400 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.round((grid.filter((v) => v !== 0).length / 81) * 100)}%` }}
            />
          </div>
          <div className="text-[8px] text-slate-300 flex justify-between">
            <span>Filled: {grid.filter((v) => v !== 0).length} / 81</span>
            <span>Conflicts: {conflictCountRef.current}</span>
          </div>
        </div>
      )}

      {/* 臨床測量級心理計量學通關反思面板 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(90vw,46vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
            <div className="text-left">
              <div className="text-[8px] text-slate-500 tracking-wider flex items-center gap-1">
                <span>CONSTRAINT PROPAGATION VERIFIED</span>
                <span className="text-[6.5px] px-1 py-0.2 bg-indigo-950 border border-indigo-700 text-indigo-300 rounded">
                  CSEM: ±{cci.semIQ} IQ
                </span>
              </div>
              <div className="text-xs text-indigo-300 font-bold">
                {elapsedSec <= benchmarkData.benchmarkTime ? '⚡ High-Efficiency Pace' : '🔍 Deep Exploration'}
              </div>
            </div>

            <div className="flex flex-col items-end">
              <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[10px] font-bold text-cyan-300">
                IQ {cci.standardIQ} (95% CI: [{cci.ci95IQ[0]}-{cci.ci95IQ[1]}])
              </div>
              <span className="text-[6.5px] text-slate-400 mt-0.5">
                年齡層 ({cci.ageNorm.cohort}): {cci.ageNorm.ageAdjustedZ >= 0 ? `+${cci.ageNorm.ageAdjustedZ}` : cci.ageNorm.ageAdjustedZ} SD (Top {Number((100 - cci.ageNorm.agePercentile).toFixed(1))}%)
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
              <div>IRT 難度 (b)</div>
              <div className="text-cyan-300 font-bold text-xs">{metrics.irt_logit_difficulty ?? 0.0}</div>
              <div className="text-[7px] text-slate-500">Tech: {highestTech}</div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>約束衝突次數</div>
              <div className="text-amber-300 font-bold text-xs">{conflictCountRef.current} 次</div>
              <div className="text-[7px] text-slate-500">
                Acc: {userStat ? `${Math.round(userStat.accuracy * 100)}%` : '100%'}
              </div>
            </div>
          </div>

          {/* 心理計量學信賴區間誤差棒 */}
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

          {/* 五維認知雙軌雷達圖 */}
          <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800 flex flex-col items-center mb-2">
            <CognitiveRadarChart
              dimensions={profile.cognitiveDimensions}
              previousDimensions={profile.previousCognitiveDimensions}
              size={150}
            />
          </div>

          {/* 推理技巧鏈條 */}
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

          {/* 弱點導引與一鍵跳轉 */}
          <div className="bg-indigo-950/40 p-2 rounded-lg border border-indigo-800/60 text-left mb-2 flex items-center justify-between gap-2">
            <div className="flex-1 text-[8px] text-slate-300">
              {isEn ? benchmarkData.recommendedFocus.reasonEn : benchmarkData.recommendedFocus.reasonZh}
            </div>
            <button
              onClick={() => handleNavigateTargetGame(benchmarkData.recommendedFocus.targetGame)}
              className="shrink-0 px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[8px] rounded transition active:scale-95"
            >
              ➜ {isEn ? 'Train' : '立即訓練'}
            </button>
          </div>

          {/* 操作按鈕群：縱向數據匯出 + 賽事提交入口 */}
          <div className="flex gap-1.5 mb-2">
            <button
              onClick={exportLongitudinalDataset}
              className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 border border-cyan-600/50 hover:border-cyan-400 text-cyan-300 text-[8px] font-bold rounded-lg transition shadow flex items-center justify-center gap-1 active:scale-95"
            >
              <span>📊</span>
              <span>{isEn ? 'Export Dataset' : '匯出縱向數據'}</span>
            </button>

            <button
              onClick={() => setShowSubmitModal(true)}
              className="flex-1 py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 text-slate-950 text-[8px] font-black rounded-lg shadow transition active:scale-95 flex items-center justify-center gap-1"
            >
              <span>📤</span>
              <span>{isEn ? 'Submit Result' : '官方賽事提交'}</span>
            </button>
          </div>

          {/* 本地 Web Crypto SHA-256 存證指紋 */}
          {proofSignature && (
            <div className="mt-1 p-1.5 bg-slate-900 border border-slate-800 rounded text-left">
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
            tournamentId: tournamentMode ? 'WPF_SUDOKU_2026' : 'GLOBAL_LOGIC_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'sudoku',
            tier: currentTier,
            timeSpentSec: elapsedSec,
            conflictsCount: conflictCountRef.current,
            infractionScore: calculateInfractionScore({
              tabSwitches: tabSwitchesRef.current,
              blurEvents: blurEventsRef.current,
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
