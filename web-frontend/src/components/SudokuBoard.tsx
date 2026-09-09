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
import { SudokuHintStep } from '../engines/sudokuGenerator';

class SoundFX {
  private static ctx: AudioContext | null = null;

  private static getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public static playInputSuccess() {
    const ctx = this.getContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.02);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.02);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.02);
  }

  public static playBlockedError() {
    const ctx = this.getContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(260, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(180, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  }

  public static playHintTone() {
    const ctx = this.getContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  }
}

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

  if (!actualPuzzle) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-xs font-mono text-slate-500 animate-pulse">
        {isEn ? 'Synchronizing Cognitive Constraint Matrix...' : '載入數獨約束矩陣中...'}
      </div>
    );
  }

  const [internalAssessment, setInternalAssessment] = useState<boolean>(false);
  const isAssessmentMode = tournamentMode || internalAssessment;

  const metrics = (actualPuzzle.metrics as any) || {};
  const highestTech = metrics.highest_technique || 'NakedSingle';
  const theoryTime = metrics.estimated_time_sec || 120;
  const currentTier = (actualPuzzle.tier as TierKey) || 'kids';

  const timeLimitMap: Record<TierKey, number> = {
    kids: 300,
    intermediate: 420,
    expert: 540,
    master: 600,
    legendary: 720,
    ultimate: 900,
  };
  const standardTimeLimit = timeLimitMap[currentTier] || 480;

  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics(highestTech, theoryTime, 'sudoku');
  }, [getBenchmarkMetrics, highestTech, theoryTime]);

  const initialGrid = useMemo(() => {
    const spec = (actualPuzzle.puzzle && typeof actualPuzzle.puzzle === 'object') ? (actualPuzzle.puzzle as any) : {};
    const raw =
      spec.grid ||
      spec.clues ||
      spec.initialGrid ||
      (actualPuzzle as any)?.grid ||
      (actualPuzzle as any)?.clues ||
      actualPuzzle.puzzle;

    if (!raw) return Array(81).fill(0);
    if (Array.isArray(raw)) {
      return Array.isArray(raw[0]) ? raw.flat() : raw;
    }
    return Array(81).fill(0);
  }, [actualPuzzle]);

  const flatSolution = useMemo(() => {
    const spec = (actualPuzzle.puzzle && typeof actualPuzzle.puzzle === 'object') ? (actualPuzzle.puzzle as any) : {};
    const sol = actualPuzzle.solution || spec.solution || (actualPuzzle as any)?.solution;
    if (!sol || !Array.isArray(sol)) return [];
    return Array.isArray(sol[0]) ? sol.flat() : sol;
  }, [actualPuzzle]);

  const hints: SudokuHintStep[] = useMemo(() => {
    return (actualPuzzle.metrics as any)?.hints || (actualPuzzle.puzzle as any)?.hints || [];
  }, [actualPuzzle]);

  const [grid, setGrid] = useState<number[]>(initialGrid);
  const [candidates, setCandidates] = useState<Record<number, Set<number>>>({});
  const [isNoteMode, setIsNoteMode] = useState<boolean>(false);
  const [isShiftPressed, setIsShiftPressed] = useState<boolean>(false);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [conflictCell, setConflictCell] = useState<number | null>(null);
  const [hardBlockedCell, setHardBlockedCell] = useState<number | null>(null);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isResigned, setIsResigned] = useState<boolean>(false);
  const [isFailedAssessment, setIsFailedAssessment] = useState<boolean>(false);
  const [isTimedOut, setIsTimedOut] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [showMetricsDrawer, setShowMetricsDrawer] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);
  const [violationAlert, setViolationAlert] = useState<string | null>(null);
  const [bookmarkToast, setBookmarkToast] = useState<string | null>(null);

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHintText, setActiveHintText] = useState<string | null>(null);

  // 800ms 防誤觸長按狀態（雙軌：滑鼠與鍵盤 R）
  const [resignHoldProgress, setResignHoldProgress] = useState<number>(0);
  const resignFrameRef = useRef<number | null>(null);
  const resignStartTimeRef = useRef<number | null>(null);

  const tabSwitchesRef = useRef<number>(0);
  const blurEventsRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  // 選中格即時計算合法候選數（次視覺化 Auto-Candidates）
  const liveAutoCandidates = useMemo(() => {
    if (selectedCell === null || grid[selectedCell] !== 0) return new Set<number>();
    const r = Math.floor(selectedCell / 9);
    const c = selectedCell % 9;
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;

    const used = new Set<number>();
    for (let i = 0; i < 9; i++) {
      if (grid[r * 9 + i] !== 0) used.add(grid[r * 9 + i]);
      if (grid[i * 9 + c] !== 0) used.add(grid[i * 9 + c]);
    }
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) {
        const val = grid[(br + dr) * 9 + (bc + dc)];
        if (val !== 0) used.add(val);
      }
    }

    const available = new Set<number>();
    for (let n = 1; n <= 9; n++) {
      if (!used.has(n)) available.add(n);
    }
    return available;
  }, [selectedCell, grid]);

  // Shift / Alt 修飾鍵
  useEffect(() => {
    const handleKeyUpDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Alt') {
        setIsShiftPressed(e.type === 'keydown');
      }
    };
    window.addEventListener('keydown', handleKeyUpDown);
    window.addEventListener('keyup', handleKeyUpDown);
    return () => {
      window.removeEventListener('keydown', handleKeyUpDown);
      window.removeEventListener('keyup', handleKeyUpDown);
    };
  }, []);

  const effectiveNoteMode = isNoteMode || isShiftPressed;

  // 防作弊監聽
  useEffect(() => {
    if (!isAssessmentMode || isCompleted || isTimedOut || isFailedAssessment || isResigned) return;

    const handleVisibility = () => {
      if (document.hidden) {
        tabSwitchesRef.current += 1;
        setViolationAlert(isEn ? '⚠️ Focus loss detected' : '⚠️ 偵測到離開作答視窗');
        setTimeout(() => setViolationAlert(null), 2500);
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
  }, [isAssessmentMode, isCompleted, isTimedOut, isFailedAssessment, isResigned, isEn]);

  // 初始化與書籤狀態同步
  useEffect(() => {
    const bookmark = profile.bookmarks[actualPuzzle.id || ''];
    if (bookmark && bookmark.boardState) {
      setGrid(Array.isArray(bookmark.boardState) && bookmark.boardState.length > 0 ? bookmark.boardState : initialGrid);
      setElapsedSec(bookmark.elapsedSec);
      setBookmarkToast(isEn ? 'Restored bookmarked progress' : '已自動恢復暫存進度');
      setTimeout(() => setBookmarkToast(null), 2000);
    } else {
      setGrid(initialGrid);
      setElapsedSec(0);
    }

    setCandidates({});
    setIsNoteMode(false);
    setSelectedCell(null);
    setConflictCell(null);
    setHardBlockedCell(null);
    setIsCompleted(false);
    setIsResigned(false);
    setIsFailedAssessment(false);
    setIsTimedOut(false);
    setProofSignature(null);
    setViolationAlert(null);
    setHintLevel(0);
    setActiveHintText(null);
    setResignHoldProgress(0);
    tabSwitchesRef.current = 0;
    blurEventsRef.current = 0;
    startTimeRef.current = Date.now() - (bookmark?.elapsedSec ? bookmark.elapsedSec * 1000 : 0);
    conflictCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [initialGrid, actualPuzzle.id, profile.bookmarks, isEn]);

  // 計時器
  useEffect(() => {
    if (isCompleted || isTimedOut || isFailedAssessment || isResigned) return;
    const timer = setInterval(() => {
      const currentElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSec(currentElapsed);

      if (isAssessmentMode && currentElapsed >= standardTimeLimit) {
        setIsTimedOut(true);
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: 'sudoku',
            tier: currentTier,
            cognitiveLoad: actualPuzzle.cognitiveLoad || { spatial: 0.3, numeric: 0.7, workingMemory: 0.8, inhibition: 0.6 },
            isSuccess: false,
            timeSpentSec: standardTimeLimit,
            conflictsCount: conflictCountRef.current,
            technique: highestTech,
            partialCompletionRatio: Number((grid.filter((v, i) => v !== 0 && v === flatSolution[i]).length / 81).toFixed(2)),
          });
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isCompleted, isTimedOut, isFailedAssessment, isResigned, isAssessmentMode, standardTimeLimit, actualPuzzle, currentTier, highestTech, recordAttempt, grid, flatSolution]);

  // 勝利驗證判定
  const checkVictory = useCallback(
    async (currentGrid: number[]) => {
      const flatSol = flatSolution;
      if (flatSol.length !== 81) return;

      const isPerfectMatch = currentGrid.every((v, i) => v === flatSol[i]);

      if (isPerfectMatch) {
        setIsCompleted(true);
        removeBookmark(actualPuzzle.id);

        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: actualPuzzle.engine_type || 'sudoku',
            tier: currentTier,
            cognitiveLoad: actualPuzzle.cognitiveLoad || { spatial: 0.3, numeric: 0.7, workingMemory: 0.8, inhibition: 0.6 },
            isSuccess: true,
            timeSpentSec: timeSpent,
            conflictsCount: conflictCountRef.current,
            technique: highestTech,
            partialCompletionRatio: 1.0,
            isPureClear: conflictCountRef.current === 0 && hintLevel === 0,
          });

          try {
            const canonical = [actualPuzzle.id, currentTier, timeSpent, conflictCountRef.current, 'PERFECT'].join('|');
            const enc = new TextEncoder();
            const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(canonical));
            const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
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
    [actualPuzzle, recordAttempt, removeBookmark, currentTier, highestTech, benchmarkData.isNewPB, flatSolution, hintLevel]
  );

  const handleBookmarkPuzzle = useCallback(() => {
    if (isCompleted || isTimedOut || isFailedAssessment || isResigned) return;
    saveBookmark({
      puzzleId: actualPuzzle.id,
      engineType: 'sudoku',
      tier: currentTier,
      boardState: grid,
      elapsedSec,
      bookmarkedAt: new Date().toISOString(),
    });
    setBookmarkToast(isEn ? '📌 Progress bookmarked' : '📌 已暫存此局進度');
    setTimeout(() => setBookmarkToast(null), 2000);
    if (navigator.vibrate) navigator.vibrate(25);
  }, [isCompleted, isTimedOut, isFailedAssessment, isResigned, actualPuzzle, currentTier, grid, elapsedSec, saveBookmark, isEn]);

  // 投降邏輯
  const handleGracefulResign = useCallback(() => {
    if (isCompleted || isTimedOut || isFailedAssessment || isResigned || !flatSolution.length) return;
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);

    setIsResigned(true);
    hasRecordedRef.current = true;
    removeBookmark(actualPuzzle.id);
    setGrid([...flatSolution]);

    const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    recordAttempt({
      puzzleId: actualPuzzle.id,
      engineType: 'sudoku',
      tier: currentTier,
      cognitiveLoad: actualPuzzle.cognitiveLoad || { spatial: 0.3, numeric: 0.7, workingMemory: 0.8, inhibition: 0.6 },
      isSuccess: false,
      timeSpentSec: timeSpent,
      conflictsCount: conflictCountRef.current,
      technique: highestTech,
      partialCompletionRatio: 0.5,
      isPureClear: false,
    });
  }, [isCompleted, isTimedOut, isFailedAssessment, isResigned, flatSolution, actualPuzzle, currentTier, highestTech, recordAttempt, removeBookmark]);

  // 800ms 長按投降動畫控制器
  const startResignHold = useCallback(() => {
    if (isCompleted || isTimedOut || isFailedAssessment || isResigned || !flatSolution.length) return;
    if (resignStartTimeRef.current !== null) return;

    resignStartTimeRef.current = Date.now();
    const DURATION = 800;

    const updateProgress = () => {
      if (!resignStartTimeRef.current) return;
      const elapsed = Date.now() - resignStartTimeRef.current;
      const progress = Math.min(1, elapsed / DURATION);
      setResignHoldProgress(progress);

      if (progress < 1) {
        resignFrameRef.current = requestAnimationFrame(updateProgress);
      } else {
        handleGracefulResign();
        setResignHoldProgress(0);
        resignStartTimeRef.current = null;
      }
    };

    resignFrameRef.current = requestAnimationFrame(updateProgress);
  }, [isCompleted, isTimedOut, isFailedAssessment, isResigned, flatSolution, handleGracefulResign]);

  const cancelResignHold = useCallback(() => {
    if (resignFrameRef.current) {
      cancelAnimationFrame(resignFrameRef.current);
      resignFrameRef.current = null;
    }
    resignStartTimeRef.current = null;
    setResignHoldProgress(0);
  }, []);

  useEffect(() => {
    return () => {
      if (resignFrameRef.current) cancelAnimationFrame(resignFrameRef.current);
    };
  }, []);

  // 提示系統
  const triggerHintLadder = useCallback(() => {
    if (hints.length === 0 || isCompleted || isTimedOut || isFailedAssessment || isResigned) return;

    SoundFX.playHintTone();
    const nextLevel = Math.min(3, hintLevel + 1);
    const hintData = hints.find((h) => h.level === nextLevel) || hints[hints.length - 1];

    setHintLevel(nextLevel);
    setActiveHintText(isEn ? hintData.messageEn : hintData.messageZh);

    if (nextLevel === 3 && hintData.row !== undefined && hintData.col !== undefined) {
      setSelectedCell(hintData.row * 9 + hintData.col);
    }

    if (navigator.vibrate) navigator.vibrate(20);
  }, [hints, isCompleted, isTimedOut, isFailedAssessment, isResigned, hintLevel, isEn]);

  const handleCellClick = (index: number) => {
    if (initialGrid[index] !== 0 || isCompleted || isTimedOut || isFailedAssessment || isResigned) return;
    setSelectedCell(index);
    if (navigator.vibrate) navigator.vibrate(10);
  };

  // 數字輸入核心（含硬阻斷、非同步 microtask 解耦）
  const handleNumberInput = useCallback((num: number) => {
    if (selectedCell === null || initialGrid[selectedCell] !== 0 || isCompleted || isTimedOut || isFailedAssessment || isResigned) return;

    if (effectiveNoteMode && num !== 0) {
      SoundFX.playInputSuccess();
      setCandidates((prev) => {
        const cellCandidates = new Set(prev[selectedCell] || []);
        if (cellCandidates.has(num)) {
          cellCandidates.delete(num);
        } else {
          cellCandidates.add(num);
        }
        return { ...prev, [selectedCell]: cellCandidates };
      });
      if (navigator.vibrate) navigator.vibrate(12);
      return;
    }

    const flatSol = flatSolution;
    const expectedValue = flatSol[selectedCell];

    // 評測模式硬阻斷
    if (isAssessmentMode && num !== 0 && expectedValue !== undefined && num !== expectedValue) {
      SoundFX.playBlockedError();
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
      conflictCountRef.current += 1;
      setHardBlockedCell(selectedCell);
      setTimeout(() => setHardBlockedCell(null), 400);
      return;
    }

    // 自由模式標紅
    if (!isAssessmentMode && num !== 0 && expectedValue !== undefined && num !== expectedValue) {
      SoundFX.playBlockedError();
      if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
      conflictCountRef.current += 1;
      setConflictCell(selectedCell);
      setTimeout(() => setConflictCell(null), 450);
      return;
    }

    if (num !== 0) {
      SoundFX.playInputSuccess();
    }

    const nextGrid = [...grid];
    nextGrid[selectedCell] = num;
    setGrid(nextGrid);

    if (num !== 0) {
      setCandidates((prev) => {
        const updated = { ...prev };
        delete updated[selectedCell];
        return updated;
      });
    }

    // Microtask 脫鉤：不阻塞按鍵同步堆疊
    queueMicrotask(() => {
      checkVictory(nextGrid);
    });
  }, [selectedCell, initialGrid, isCompleted, isTimedOut, isFailedAssessment, isResigned, effectiveNoteMode, flatSolution, isAssessmentMode, grid, checkVictory]);

  // 鍵盤全映射監聽（支援 Numpad, Space, H, Esc, 及長按 R 投降）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isTimedOut || isFailedAssessment || isResigned) return;

      // 鍵盤長按 R 投降雙軌支援
      if (e.key === 'r' || e.key === 'R') {
        if (!e.repeat) {
          startResignHold();
        }
        return;
      }

      if (e.key === 'Escape') {
        setActiveHintText(null);
        return;
      }

      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        triggerHintLadder();
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsNoteMode((prev) => !prev);
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        setIsNoteMode((prev) => !prev);
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) {
        e.preventDefault();
        setSelectedCell((prev) => {
          if (prev === null) return 0;
          const r = Math.floor(prev / 9);
          const c = prev % 9;
          if (e.code === 'ArrowUp' || e.code === 'KeyW') return Math.max(0, r - 1) * 9 + c;
          if (e.code === 'ArrowDown' || e.code === 'KeyS') return Math.min(8, r + 1) * 9 + c;
          if (e.code === 'ArrowLeft' || e.code === 'KeyA') return r * 9 + Math.max(0, c - 1);
          if (e.code === 'ArrowRight' || e.code === 'KeyD') return r * 9 + Math.min(8, c + 1);
          return prev;
        });
        return;
      }

      if (selectedCell === null) return;

      let num: number | null = null;
      if (e.code.startsWith('Digit')) {
        const val = parseInt(e.code.replace('Digit', ''), 10);
        if (!isNaN(val) && val >= 0 && val <= 9) num = val;
      } else if (e.code.startsWith('Numpad')) {
        const val = parseInt(e.code.replace('Numpad', ''), 10);
        if (!isNaN(val) && val >= 0 && val <= 9) num = val;
      }

      if (num !== null) {
        handleNumberInput(num);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        handleNumberInput(0);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        cancelResignHold();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedCell, isCompleted, isTimedOut, isFailedAssessment, isResigned, triggerHintLadder, handleNumberInput, startResignHold, cancelResignHold]);

  const solvingPath: string[] = metrics.solving_path || ['Standard Derivation'];
  const remainingTime = Math.max(0, standardTimeLimit - elapsedSec);
  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  const selectedValue = selectedCell !== null ? grid[selectedCell] : 0;
  const selectedRow = selectedCell !== null ? Math.floor(selectedCell / 9) : -1;
  const selectedCol = selectedCell !== null ? selectedCell % 9 : -1;
  const selectedBox = selectedCell !== null ? Math.floor(selectedRow / 3) * 3 + Math.floor(selectedCol / 3) : -1;

  const currentHintObj = hintLevel >= 1 ? hints[hintLevel - 1] : null;
  const hintFocusRow = currentHintObj?.row;
  const hintFocusCol = currentHintObj?.col;
  const hintFocusBox = hintFocusRow !== undefined && hintFocusCol !== undefined ? Math.floor(hintFocusRow / 3) * 3 + Math.floor(hintFocusCol / 3) : -1;

  return (
    <div className="relative flex flex-col items-center justify-center w-full min-h-[90vh] select-none py-2 font-mono bg-slate-950 text-slate-100 overflow-hidden">
      {violationAlert && (
        <div className="fixed top-4 z-50 px-4 py-2 bg-rose-600 border border-rose-400 text-white font-bold text-xs rounded-full shadow-2xl animate-bounce">
          {violationAlert}
        </div>
      )}
      {bookmarkToast && (
        <div className="fixed top-4 z-50 px-4 py-2 bg-indigo-600 border border-indigo-400 text-white font-bold text-xs rounded-full shadow-2xl animate-fade-in">
          {bookmarkToast}
        </div>
      )}

      {/* 頂部心流控制列 */}
      <header className="w-full max-w-[min(94vw,74vh)] flex items-center justify-between text-xs text-slate-400 mb-2 px-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setInternalAssessment((p) => !p)}
            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
              isAssessmentMode
                ? 'bg-rose-950/80 border-rose-600 text-rose-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {isAssessmentMode ? (isEn ? '● ASSESSMENT' : '● 標準施測') : (isEn ? '○ FREE FLOW' : '○ 自由心流')}
          </button>
          <span className="text-slate-500 font-semibold text-[11px] hidden sm:inline">
            Tier: <span className="text-indigo-400 uppercase">{currentTier}</span>
          </span>
        </div>

        <div className="text-sm font-bold tracking-wider">
          {isAssessmentMode ? (
            <span className={`px-2.5 py-0.5 rounded border ${remainingTime <= 60 ? 'bg-rose-950 border-rose-600 text-rose-300 animate-pulse' : 'bg-slate-900 border-slate-800 text-rose-400'}`}>
              ⏱️ {String(Math.floor(remainingTime / 60)).padStart(2, '0')}:{String(remainingTime % 60).padStart(2, '0')}
            </span>
          ) : (
            <span className="text-slate-300">
              ⏱️ {String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:{String(elapsedSec % 60).padStart(2, '0')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isCompleted && !isTimedOut && !isFailedAssessment && !isResigned && (
            <>
              <button
                onClick={handleBookmarkPuzzle}
                className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs rounded transition cursor-pointer"
                title={isEn ? 'Save Progress' : '暫存進度'}
              >
                📌
              </button>
              {/* 800ms 防誤觸長按投降按鈕 */}
              <button
                onMouseDown={startResignHold}
                onMouseUp={cancelResignHold}
                onMouseLeave={cancelResignHold}
                onTouchStart={startResignHold}
                onTouchEnd={cancelResignHold}
                className="relative px-2 py-1 bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-800/80 text-slate-400 hover:text-rose-300 text-xs rounded transition cursor-pointer select-none overflow-hidden"
                title={isEn ? 'Hold [R] or Click to Resign (800ms)' : '長按 [R] 鍵或滑鼠 800ms 投降覆盤'}
              >
                {resignHoldProgress > 0 && (
                  <div
                    className="absolute inset-0 bg-rose-600/30 transition-none pointer-events-none"
                    style={{ width: `${resignHoldProgress * 100}%` }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1">
                  <span>🕊️</span>
                  {resignHoldProgress > 0 && (
                    <span className="text-[9px] font-bold text-rose-300 font-mono">
                      {Math.round(resignHoldProgress * 100)}%
                    </span>
                  )}
                </span>
              </button>
              {hints.length > 0 && (
                <button
                  onClick={triggerHintLadder}
                  className="px-2.5 py-0.5 bg-amber-950/90 hover:bg-amber-900 border border-amber-600 text-amber-300 text-[10px] font-bold rounded flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-lg shadow-amber-950/30"
                  title="Press [H] for next hint"
                >
                  💡 {hintLevel === 0 ? (isEn ? 'Hint [H]' : '提示 [H]') : `L${hintLevel} [H]`}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {activeHintText && (
        <div className="w-full max-w-[min(94vw,74vh)] bg-slate-900/95 border border-amber-500/70 text-amber-200 text-xs px-3 py-2 rounded-xl mb-2 flex items-center justify-between gap-2 shadow-2xl backdrop-blur animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 rounded font-black text-[9px]">L{hintLevel}</span>
            <span className="leading-relaxed">{activeHintText}</span>
          </div>
          <button onClick={() => setActiveHintText(null)} className="text-slate-400 hover:text-slate-200 text-xs font-bold cursor-pointer" title="[Esc] to close">✕</button>
        </div>
      )}

      {/* 主舞台與 A-I / 1-9 坐標 */}
      <div className="relative flex flex-col items-center">
        <div className="grid grid-cols-9 w-[min(90vw,70vh)] pl-4 text-center text-[9px] text-slate-500 font-bold mb-1 tracking-widest pointer-events-none font-mono">
          {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((char) => (
            <div key={char}>{char}</div>
          ))}
        </div>

        <div className="flex items-center">
          <div className="flex flex-col justify-around h-[min(90vw,70vh)] w-4 pr-1 text-right text-[9px] text-slate-500 font-bold pointer-events-none font-mono">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((rowNum) => (
              <div key={rowNum}>{rowNum}</div>
            ))}
          </div>

          <main
            className={`relative grid grid-cols-9 gap-[1px] border-2 p-1 rounded-2xl shadow-2xl w-[min(90vw,70vh)] h-[min(90vw,70vh)] transition-all ${
              isResigned ? 'bg-rose-950/10 border-rose-900/50' : 'bg-slate-800/90 border-slate-700'
            }`}
          >
            {grid.map((val, idx) => {
              const isGiven = initialGrid[idx] !== 0;
              const isSelected = selectedCell === idx;
              const isConflict = conflictCell === idx;
              const isHardBlocked = hardBlockedCell === idx;

              const row = Math.floor(idx / 9);
              const col = idx % 9;
              const box = Math.floor(row / 3) * 3 + Math.floor(col / 3);

              const isSameValue = selectedValue > 0 && val === selectedValue;
              const isInSameLineOrBox = selectedCell !== null && (row === selectedRow || col === selectedCol || box === selectedBox);

              const isInHintConstraintZone = hintLevel >= 1 && (row === hintFocusRow || col === hintFocusCol || box === hintFocusBox);
              const isTargetHintCell = hintLevel === 3 && row === hintFocusRow && col === hintFocusCol;

              const borderRight = (col + 1) % 3 === 0 && col !== 8 ? 'border-r-2 border-r-slate-600' : '';
              const borderBottom = (row + 1) % 3 === 0 && row !== 8 ? 'border-b-2 border-b-slate-600' : '';

              const cellCandidates = candidates[idx];
              const isBivalueCell = cellCandidates && cellCandidates.size === 2;
              const showAutoCandidates = isSelected && val === 0 && (!cellCandidates || cellCandidates.size === 0);

              return (
                <button
                  key={idx}
                  onClick={() => handleCellClick(idx)}
                  className={`w-full h-full flex items-center justify-center text-sm sm:text-xl font-bold transition-all rounded-sm relative cursor-pointer ${borderRight} ${borderBottom} ${
                    isResigned
                      ? 'bg-rose-950/60 text-rose-300'
                      : isHardBlocked
                      ? 'bg-rose-600 text-white ring-4 ring-rose-500 z-30'
                      : isTargetHintCell
                      ? 'bg-amber-600 border-amber-300 text-white ring-2 ring-amber-400 animate-pulse z-20'
                      : isConflict
                      ? 'bg-rose-600 text-white animate-pulse'
                      : isSelected
                      ? 'bg-indigo-600 text-white ring-2 ring-indigo-300 z-10'
                      : isSameValue
                      ? 'bg-cyan-950/90 text-cyan-300 border border-cyan-500/70 shadow-sm'
                      : isInHintConstraintZone
                      ? 'bg-amber-950/30 ring-1 ring-amber-500/40 text-slate-200'
                      : isInSameLineOrBox
                      ? 'bg-slate-900/90 text-slate-200'
                      : isGiven
                      ? 'bg-slate-900/40 text-slate-400 font-black'
                      : val !== 0
                      ? 'bg-slate-950 text-cyan-400'
                      : 'bg-slate-950 hover:bg-slate-900/80 text-transparent'
                  }`}
                >
                  {val !== 0 ? (
                    val
                  ) : cellCandidates && cellCandidates.size > 0 ? (
                    <div className="grid grid-cols-3 grid-rows-3 w-full h-full p-0.5 pointer-events-none">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                        <span
                          key={n}
                          className={`text-[7px] sm:text-[9px] leading-none flex items-center justify-center ${
                            cellCandidates.has(n)
                              ? isBivalueCell
                                ? 'text-purple-400 font-black'
                                : 'text-slate-300 font-semibold'
                              : 'text-transparent'
                          }`}
                        >
                          {n}
                        </span>
                      ))}
                    </div>
                  ) : showAutoCandidates ? (
                    <div className="grid grid-cols-3 grid-rows-3 w-full h-full p-0.5 pointer-events-none">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                        <span
                          key={n}
                          className={`text-[7px] sm:text-[9px] leading-none flex items-center justify-center font-mono ${
                            liveAutoCandidates.has(n) ? 'text-slate-600/40 font-normal select-none' : 'text-transparent'
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
          </main>
        </div>
      </div>

      {/* 底部輸入按鈕列 */}
      {!isCompleted && !isTimedOut && !isFailedAssessment && !isResigned && (
        <footer className="flex flex-col gap-2 mt-3 w-full max-w-[min(90vw,70vh)] pl-4">
          <div className="grid grid-cols-10 gap-1 sm:gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                onClick={() => handleNumberInput(num)}
                disabled={selectedCell === null}
                className="py-2.5 sm:py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-25 active:scale-95 text-slate-100 border border-slate-800 hover:border-slate-700 rounded-xl text-sm sm:text-base font-bold transition shadow cursor-pointer"
              >
                {num}
              </button>
            ))}
            <button
              onClick={() => handleNumberInput(0)}
              disabled={selectedCell === null}
              className="py-2.5 sm:py-3 bg-rose-950/40 hover:bg-rose-900/50 disabled:opacity-25 active:scale-95 text-rose-300 border border-rose-900/60 rounded-xl text-sm sm:text-base font-bold transition shadow cursor-pointer"
            >
              ⌫
            </button>
          </div>

          <div className="flex justify-between items-center px-1 text-xs text-slate-500">
            <button
              onClick={() => setIsNoteMode((p) => !p)}
              className={`px-3 py-1 rounded-lg border text-xs font-bold transition flex items-center gap-1.5 active:scale-95 cursor-pointer ${
                effectiveNoteMode
                  ? 'bg-amber-950 border-amber-500 text-amber-300 shadow-sm shadow-amber-500/30'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>✏️</span>
              <span>{isEn ? 'Notes [Space / Shift]' : '筆記模式 [Space / Shift]'}</span>
              <span className={`w-2 h-2 rounded-full ${effectiveNoteMode ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`} />
            </button>

            <span className="text-[10px] text-slate-500 hidden sm:inline font-mono">
              {effectiveNoteMode ? (isEn ? 'Hold Shift or Press Space' : '按住 Shift 或按 Space 快速切換') : (isEn ? 'Numpad 1-9 & Hold [R] to Resign' : '支援 Numpad 數字鍵，長按 [R] 投降')}
            </span>
          </div>
        </footer>
      )}

      {/* 玻璃擬態半透明覆盤浮層 */}
      {(isCompleted || isResigned || isTimedOut || isFailedAssessment) && (
        <div className="absolute inset-0 z-40 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-md bg-slate-900/95 border border-indigo-500/50 rounded-2xl p-4 shadow-2xl text-center font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <div className="text-left">
                <div className="text-[9px] text-slate-500 uppercase tracking-wider">Formal Logic Proof</div>
                <div className="text-sm text-indigo-300 font-bold">
                  {isCompleted ? (isEn ? '✨ Victory Verified' : '✨ 完美落子通關') : (isEn ? '🕊️ Resigned for Replay' : '🕊️ 已投降，進入覆盤')}
                </div>
              </div>
              <div className="px-2.5 py-1 bg-cyan-950 border border-cyan-500 rounded text-xs font-bold text-cyan-300">
                IQ {cci.standardIQ} (±{cci.semIQ})
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs text-slate-400 mb-3">
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <div className="text-[9px] text-slate-500">{isEn ? 'Time' : '耗時'}</div>
                <div className="text-slate-100 font-bold text-sm">{elapsedSec}s</div>
              </div>
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <div className="text-[9px] text-slate-500">{isEn ? 'IRT' : '難度係數'}</div>
                <div className="text-cyan-300 font-bold text-sm">{metrics.irt_logit_difficulty ?? 0.0}</div>
              </div>
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <div className="text-[9px] text-slate-500">{isEn ? 'Conflicts' : '衝突'}</div>
                <div className="text-amber-300 font-bold text-sm">{conflictCountRef.current}</div>
              </div>
            </div>

            <div className="mb-3">
              <MetricErrorBar
                actualVal={elapsedSec}
                benchmarkVal={benchmarkData.benchmarkTime}
                ci95={benchmarkData.ci95}
                sem={benchmarkData.sem}
                unit="s"
                isEn={isEn}
              />
            </div>

            {showMetricsDrawer ? (
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-left mb-3 animate-fade-in space-y-2">
                <CognitiveRadarChart
                  dimensions={profile.cognitiveDimensions}
                  previousDimensions={profile.previousCognitiveDimensions}
                  size={140}
                />
                <div className="text-[9px] text-slate-400">
                  <strong>Solving Path:</strong> {solvingPath.join(' ➔ ')}
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowMetricsDrawer(true)}
                className="w-full py-1 mb-3 text-[10px] text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
              >
                {isEn ? '▼ View Cognitive Dimensions & Solving Path' : '▼ 展開完整認知維度與推導路徑'}
              </button>
            )}

            <div className="flex gap-2">
              <button
                onClick={exportLongitudinalDataset}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-xs rounded-xl border border-cyan-500/40 transition cursor-pointer"
              >
                📊 {isEn ? 'Export Data' : '匯出數據'}
              </button>
              <button
                onClick={() => setShowSubmitModal(true)}
                className="flex-1 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-lg transition active:scale-95 cursor-pointer"
              >
                📤 {isEn ? 'Submit' : '賽事提交'}
              </button>
            </div>
          </div>
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
