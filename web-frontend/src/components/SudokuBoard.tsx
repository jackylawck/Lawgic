// web-frontend/src/components/SudokuBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  useAccessibilitySettings,
  useAccessibilityActions,
  ColorBlindMode,
} from '../contexts/AccessibilityContext';
import { MetricErrorBar } from './MetricErrorBar';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';
import { getEnvironmentFingerprint, calculateInfractionScore } from '../utils/tournamentSecurity';
import { SudokuHintStep } from '../engines/sudokuGenerator';

interface Props {
  readonly puzzleData?: PuzzleEntity;
  readonly puzzle?: PuzzleEntity;
  readonly tournamentMode?: boolean;
}

const TIER_TIME_LIMITS: Record<TierKey, number> = {
  kids: 300,
  intermediate: 420,
  expert: 540,
  master: 600,
  legendary: 720,
  ultimate: 900,
} as const;

const MODAL_FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function resolveConflictStyles(mode: ColorBlindMode, isHardBlocked: boolean, isConflict: boolean): string {
  if (!isHardBlocked && !isConflict) return '';
  if (mode === 'achromatopsia') {
    return 'bg-slate-100 text-slate-950 ring-4 ring-white z-30 font-black';
  }
  if (mode === 'protanopia' || mode === 'deuteranopia') {
    return 'bg-amber-500 text-slate-950 ring-4 ring-amber-300 z-30 font-black';
  }
  return 'bg-rose-600 text-white ring-4 ring-rose-500 z-30';
}

export const SudokuBoard: React.FC<Props> = ({
  puzzleData,
  puzzle,
  tournamentMode = false,
}) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const { soundFeedback, hapticFeedback, reducedMotion, colorBlindMode } =
    useAccessibilitySettings();
  const { playSound, announce } = useAccessibilityActions();

  const {
    recordAttempt,
    saveBookmark,
    removeBookmark,
    getBenchmarkMetrics,
    profile,
    getCompositeCognitiveIndex,
    exportLongitudinalDataset,
  } = useLearnerProfile();

  const boardId = useId();
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const cellButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const summaryCloseBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  // 1. 資料解析與防禦（單一 useMemo 收斂冗餘）
  const puzzleSpec = useMemo(() => {
    if (!actualPuzzle) {
      return {
        initialGrid: Array(81).fill(0),
        flatSolution: [] as number[],
        hints: [] as SudokuHintStep[],
      };
    }

    const spec =
      actualPuzzle.puzzle && typeof actualPuzzle.puzzle === 'object'
        ? (actualPuzzle.puzzle as Record<string, unknown>)
        : {};

    const rawGrid =
      spec.grid ||
      spec.clues ||
      spec.initialGrid ||
      (actualPuzzle as unknown as Record<string, unknown>).grid ||
      (actualPuzzle as unknown as Record<string, unknown>).clues ||
      actualPuzzle.puzzle;

    let initial: number[] = Array(81).fill(0);
    if (Array.isArray(rawGrid)) {
      const flat = Array.isArray(rawGrid[0]) ? rawGrid.flat() : rawGrid;
      if (flat.length === 81) {
        initial = flat.map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0));
      }
    }

    const rawSol =
      actualPuzzle.solution ||
      spec.solution ||
      (actualPuzzle as unknown as Record<string, unknown>).solution;
    let solution: number[] = [];
    if (Array.isArray(rawSol)) {
      const flat = Array.isArray(rawSol[0]) ? rawSol.flat() : rawSol;
      if (flat.length === 81) {
        solution = flat.map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0));
      }
    }

    const metricsObj = actualPuzzle.metrics as Record<string, unknown> | undefined;
    const rawHints = metricsObj?.hints || spec.hints;
    const hintsList = Array.isArray(rawHints) ? (rawHints as SudokuHintStep[]) : [];

    return { initialGrid: initial, flatSolution: solution, hints: hintsList };
  }, [actualPuzzle]);

  const { initialGrid, flatSolution, hints } = puzzleSpec;

  const metrics = (actualPuzzle?.metrics as Record<string, unknown>) || {};
  const highestTech = (metrics.highest_technique as string) || 'NakedSingle';
  const theoryTime = (metrics.estimated_time_sec as number) || 120;
  const currentTier = ((actualPuzzle?.tier as TierKey) || 'kids') as TierKey;
  const standardTimeLimit = TIER_TIME_LIMITS[currentTier] || 480;

  // 2. 核心遊戲狀態
  const [internalAssessment, setInternalAssessment] = useState(false);
  const isAssessmentMode = tournamentMode || internalAssessment;

  const [grid, setGrid] = useState<number[]>(() => [...initialGrid]);
  const gridRef = useRef<number[]>(grid);
  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  const [candidates, setCandidates] = useState<Record<number, Set<number>>>({});
  const [isNoteMode, setIsNoteMode] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [selectedCell, setSelectedCell] = useState<number>(0);
  const [conflictCell, setConflictCell] = useState<number | null>(null);
  const [hardBlockedCell, setHardBlockedCell] = useState<number | null>(null);

  const [isCompleted, setIsCompleted] = useState(false);
  const [isResigned, setIsResigned] = useState(false);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  const [showPBModal, setShowPBModal] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showMetricsDrawer, setShowMetricsDrawer] = useState(false);
  const [, setProofSignature] = useState<string | null>(null);
  const [violationAlert, setViolationAlert] = useState<string | null>(null);
  const [bookmarkToast, setBookmarkToast] = useState<string | null>(null);

  const [hintLevel, setHintLevel] = useState(0);
  const [activeHintText, setActiveHintText] = useState<string | null>(null);

  // 長按投降
  const [resignHoldProgress, setResignHoldProgress] = useState(0);
  const resignFrameRef = useRef<number | null>(null);
  const resignStartTimeRef = useRef<number | null>(null);

  // 審計與安全指標 Ref
  const tabSwitchesRef = useRef(0);
  const blurEventsRef = useRef(0);
  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef(0);
  const hasRecordedRef = useRef(false);

  const effectiveNoteMode = isNoteMode || isShiftPressed;

  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics(highestTech, theoryTime, 'sudoku');
  }, [getBenchmarkMetrics, highestTech, theoryTime]);

  const triggerHaptic = useCallback(
    (pattern: number | number[]) => {
      if (hapticFeedback && !reducedMotion && typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(pattern);
        } catch {}
      }
    },
    [hapticFeedback, reducedMotion]
  );

  // 3. 自動候選數即時計算
  const liveAutoCandidates = useMemo(() => {
    if (grid[selectedCell] !== 0) return new Set<number>();
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

  // 4. 進度初始化與書籤安全同步
  const puzzleId = actualPuzzle?.id;
  const bookmarksRef = useRef(profile.bookmarks);
  useEffect(() => {
    bookmarksRef.current = profile.bookmarks;
  }, [profile.bookmarks]);

  useEffect(() => {
    if (!puzzleId) return;
    const bookmark = bookmarksRef.current[puzzleId];
    if (bookmark && bookmark.boardState && Array.isArray(bookmark.boardState) && bookmark.boardState.length === 81) {
      setGrid([...bookmark.boardState]);
      setElapsedSec(bookmark.elapsedSec);
      const msg = isEn ? 'Restored bookmarked progress' : '已自動恢復暫存進度';
      setBookmarkToast(msg);
      announce(msg, 'polite');
      setTimeout(() => setBookmarkToast(null), 2000);
    } else {
      setGrid([...initialGrid]);
      setElapsedSec(0);
    }

    setCandidates({});
    setIsNoteMode(false);
    setSelectedCell(0);
    setConflictCell(null);
    setHardBlockedCell(null);
    setIsCompleted(false);
    setIsResigned(false);
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
  }, [puzzleId, initialGrid, isEn, announce]);

  // 5. 防作弊環境焦點檢測
  useEffect(() => {
    if (!isAssessmentMode || isCompleted || isTimedOut || isResigned) return;

    const handleVisibility = () => {
      if (document.hidden) {
        tabSwitchesRef.current += 1;
        const msg = isEn ? 'Warning: Focus loss detected' : '警告：偵測到離開作答視窗';
        setViolationAlert(msg);
        announce(msg, 'assertive');
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
  }, [isAssessmentMode, isCompleted, isTimedOut, isResigned, isEn, announce]);

  // 6. 視窗離焦修飾鍵重置
  useEffect(() => {
    const handleResetShift = () => setIsShiftPressed(false);
    window.addEventListener('blur', handleResetShift);
    document.addEventListener('visibilitychange', handleResetShift);
    return () => {
      window.removeEventListener('blur', handleResetShift);
      document.removeEventListener('visibilitychange', handleResetShift);
    };
  }, []);

  // 7. 勝利判定
  const checkVictory = useCallback(
    async (currentGrid: number[]) => {
      if (flatSolution.length !== 81 || isCompleted || hasRecordedRef.current) return;
      const isPerfectMatch = currentGrid.every((v, i) => v === flatSolution[i]);

      if (isPerfectMatch) {
        hasRecordedRef.current = true;
        setIsCompleted(true);
        if (actualPuzzle?.id) removeBookmark(actualPuzzle.id);

        playSound('celebration');
        triggerHaptic([40, 60, 100]);

        const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        recordAttempt({
          puzzleId: actualPuzzle?.id || 'unknown',
          engineType: actualPuzzle?.engine_type || 'sudoku',
          tier: currentTier,
          cognitiveLoad: actualPuzzle?.cognitiveLoad || { spatial: 0.3, numeric: 0.7, workingMemory: 0.8, inhibition: 0.6 },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
          technique: highestTech,
          partialCompletionRatio: 1.0,
          isPureClear: conflictCountRef.current === 0 && hintLevel === 0,
        });

        announce(isEn ? 'Puzzle solved perfectly!' : '數獨約束矩陣已完美解開！', 'assertive');

        try {
          const canonical = [actualPuzzle?.id, currentTier, timeSpent, conflictCountRef.current, 'PERFECT'].join('|');
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
    },
    [flatSolution, isCompleted, actualPuzzle, removeBookmark, playSound, triggerHaptic, currentTier, highestTech, hintLevel, announce, isEn, benchmarkData.isNewPB, recordAttempt]
  );

  // 8. 數字輸入核心處理
  const handleNumberInput = useCallback(
    (num: number) => {
      if (
        initialGrid[selectedCell] !== 0 ||
        isCompleted ||
        isTimedOut ||
        isResigned
      ) {
        return;
      }

      if (effectiveNoteMode && num !== 0) {
        playSound('step');
        triggerHaptic(12);
        setCandidates((prev) => {
          const cellCandidates = new Set(prev[selectedCell] || []);
          if (cellCandidates.has(num)) {
            cellCandidates.delete(num);
          } else {
            cellCandidates.add(num);
          }
          return { ...prev, [selectedCell]: cellCandidates };
        });
        return;
      }

      const expectedValue = flatSolution[selectedCell];

      // 評測模式硬阻斷
      if (isAssessmentMode && num !== 0 && expectedValue !== undefined && num !== expectedValue) {
        playSound('conflict');
        triggerHaptic([60, 40, 60]);
        conflictCountRef.current += 1;
        setHardBlockedCell(selectedCell);
        announce(
          isEn
            ? `Conflict at row ${Math.floor(selectedCell / 9) + 1}, column ${(selectedCell % 9) + 1}`
            : `第 ${Math.floor(selectedCell / 9) + 1} 列第 ${(selectedCell % 9) + 1} 行發生數值衝突`,
          'assertive'
        );
        setTimeout(() => setHardBlockedCell(null), 400);
        return;
      }

      // 自由模式標紅提醒
      if (!isAssessmentMode && num !== 0 && expectedValue !== undefined && num !== expectedValue) {
        playSound('conflict');
        triggerHaptic([30, 50, 30]);
        conflictCountRef.current += 1;
        setConflictCell(selectedCell);
        setTimeout(() => setConflictCell(null), 450);
        return;
      }

      if (num !== 0) {
        playSound('click');
        triggerHaptic(10);
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

      queueMicrotask(() => {
        checkVictory(nextGrid);
      });
    },
    [initialGrid, selectedCell, isCompleted, isTimedOut, isResigned, effectiveNoteMode, flatSolution, isAssessmentMode, playSound, triggerHaptic, announce, isEn, grid, checkVictory]
  );

  // 9. 具備焦點作用域（Focus-Scoped）的二維 Roving 鍵盤巡航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isTimedOut || isResigned) return;

      if (!boardContainerRef.current?.contains(document.activeElement)) {
        return;
      }

      if (e.key === 'Shift' || e.key === 'Alt') {
        setIsShiftPressed(true);
        return;
      }

      if (e.key === 'Escape') {
        setActiveHintText(null);
        return;
      }

      if (e.code === 'Space' || e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setIsNoteMode((p) => !p);
        return;
      }

      const row = Math.floor(selectedCell / 9);
      const col = selectedCell % 9;
      let nextCell: number | null = null;

      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        nextCell = Math.max(0, row - 1) * 9 + col;
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        nextCell = Math.min(8, row + 1) * 9 + col;
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        nextCell = row * 9 + Math.max(0, col - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        nextCell = row * 9 + Math.min(8, col + 1);
      }

      if (nextCell !== null) {
        e.preventDefault();
        setSelectedCell(nextCell);
        cellButtonRefs.current[nextCell]?.focus();
        return;
      }

      let num: number | null = null;
      if (e.code.startsWith('Digit')) {
        const val = parseInt(e.code.replace('Digit', ''), 10);
        if (!isNaN(val) && val >= 0 && val <= 9) num = val;
      } else if (e.code.startsWith('Numpad')) {
        const val = parseInt(e.code.replace('Numpad', ''), 10);
        if (!isNaN(val) && val >= 0 && val <= 9) num = val;
      }

      if (num !== null) {
        e.preventDefault();
        handleNumberInput(num);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        handleNumberInput(0);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Alt') {
        setIsShiftPressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isCompleted, isTimedOut, isResigned, selectedCell, handleNumberInput]);

  // 10. 計時器核心（透過 gridRef 解耦，填數零開銷）
  useEffect(() => {
    if (isCompleted || isTimedOut || isResigned) return;
    const timer = setInterval(() => {
      const currentElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSec(currentElapsed);

      if (isAssessmentMode && currentElapsed >= standardTimeLimit) {
        setIsTimedOut(true);
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          recordAttempt({
            puzzleId: actualPuzzle?.id || 'unknown',
            engineType: 'sudoku',
            tier: currentTier,
            cognitiveLoad: actualPuzzle?.cognitiveLoad || { spatial: 0.3, numeric: 0.7, workingMemory: 0.8, inhibition: 0.6 },
            isSuccess: false,
            timeSpentSec: standardTimeLimit,
            conflictsCount: conflictCountRef.current,
            technique: highestTech,
            partialCompletionRatio: Number(
              (gridRef.current.filter((v, i) => v !== 0 && v === flatSolution[i]).length / 81).toFixed(2)
            ),
          });
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [isCompleted, isTimedOut, isResigned, isAssessmentMode, standardTimeLimit, actualPuzzle?.id, actualPuzzle?.cognitiveLoad, currentTier, highestTech, recordAttempt, flatSolution]);

  // 11. 提示系統
  const triggerHintLadder = useCallback(() => {
    if (hints.length === 0 || isCompleted || isTimedOut || isResigned) return;

    playSound('hint');
    triggerHaptic(20);

    const nextLevel = Math.min(3, hintLevel + 1);
    const hintData = hints.find((h) => h.level === nextLevel) || hints[hints.length - 1];

    setHintLevel(nextLevel);
    const msg = isEn ? hintData.messageEn : hintData.messageZh;
    setActiveHintText(msg);
    announce(msg, 'polite');

    if (nextLevel === 3 && hintData.row !== undefined && hintData.col !== undefined) {
      const targetIdx = hintData.row * 9 + hintData.col;
      setSelectedCell(targetIdx);
      cellButtonRefs.current[targetIdx]?.focus();
    }
  }, [hints, isCompleted, isTimedOut, isResigned, playSound, triggerHaptic, hintLevel, isEn, announce]);

  // 12. 投降覆盤機制（滑鼠 + 鍵盤 Enter/Space 雙軌長按）
  const handleGracefulResign = useCallback(() => {
    if (isCompleted || isTimedOut || isResigned || flatSolution.length !== 81) return;
    triggerHaptic([40, 60, 40]);

    setIsResigned(true);
    hasRecordedRef.current = true;
    if (actualPuzzle?.id) removeBookmark(actualPuzzle.id);
    setGrid([...flatSolution]);

    const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    recordAttempt({
      puzzleId: actualPuzzle?.id || 'unknown',
      engineType: 'sudoku',
      tier: currentTier,
      cognitiveLoad: actualPuzzle?.cognitiveLoad || { spatial: 0.3, numeric: 0.7, workingMemory: 0.8, inhibition: 0.6 },
      isSuccess: false,
      timeSpentSec: timeSpent,
      conflictsCount: conflictCountRef.current,
      technique: highestTech,
      partialCompletionRatio: 0.5,
      isPureClear: false,
    });
  }, [isCompleted, isTimedOut, isResigned, flatSolution, triggerHaptic, actualPuzzle, removeBookmark, currentTier, highestTech, recordAttempt]);

  const startResignHold = useCallback(() => {
    if (isCompleted || isTimedOut || isResigned || flatSolution.length !== 81) return;
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
  }, [isCompleted, isTimedOut, isResigned, flatSolution, handleGracefulResign]);

  const cancelResignHold = useCallback(() => {
    if (resignFrameRef.current) {
      cancelAnimationFrame(resignFrameRef.current);
      resignFrameRef.current = null;
    }
    resignStartTimeRef.current = null;
    setResignHoldProgress(0);
  }, []);

  const handleResignKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        startResignHold();
      }
    },
    [startResignHold]
  );

  const handleResignKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        cancelResignHold();
      }
    },
    [cancelResignHold]
  );

  const handleBookmarkPuzzle = useCallback(() => {
    if (isCompleted || isTimedOut || isResigned || !actualPuzzle?.id) return;
    saveBookmark({
      puzzleId: actualPuzzle.id,
      engineType: 'sudoku',
      tier: currentTier,
      boardState: grid,
      elapsedSec,
      bookmarkedAt: new Date().toISOString(),
    });
    const msg = isEn ? 'Progress bookmarked' : '已暫存此局進度';
    setBookmarkToast(`📌 ${msg}`);
    announce(msg, 'polite');
    setTimeout(() => setBookmarkToast(null), 2000);
    triggerHaptic(25);
  }, [isCompleted, isTimedOut, isResigned, actualPuzzle?.id, saveBookmark, currentTier, grid, elapsedSec, isEn, announce, triggerHaptic]);

  // 13. 覆盤結算浮層焦點管理（Focus Trap）
  const isSummaryActive = isCompleted || isResigned || isTimedOut;
  useEffect(() => {
    if (isSummaryActive) {
      previouslyFocusedElementRef.current =
        document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null;
      summaryCloseBtnRef.current?.focus();
    } else {
      previouslyFocusedElementRef.current?.focus();
    }
  }, [isSummaryActive]);

  const handleSummaryKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      const container = e.currentTarget;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  if (!actualPuzzle) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-xs font-mono text-slate-500 animate-pulse">
        {isEn ? 'Synchronizing Cognitive Constraint Matrix...' : '載入數獨約束矩陣中...'}
      </div>
    );
  }

  const selectedValue = grid[selectedCell] || 0;
  const selectedRow = Math.floor(selectedCell / 9);
  const selectedCol = selectedCell % 9;
  const selectedBox = Math.floor(selectedRow / 3) * 3 + Math.floor(selectedCol / 3);

  const currentHintObj = hintLevel >= 1 ? hints[hintLevel - 1] : null;
  const hintFocusRow = currentHintObj?.row;
  const hintFocusCol = currentHintObj?.col;
  const hintFocusBox =
    hintFocusRow !== undefined && hintFocusCol !== undefined
      ? Math.floor(hintFocusRow / 3) * 3 + Math.floor(hintFocusCol / 3)
      : -1;

  const remainingTime = Math.max(0, standardTimeLimit - elapsedSec);
  const cci = getCompositeCognitiveIndex();
  const solvingPath: readonly string[] = (metrics.solving_path as string[]) || ['Standard Derivation'];

  return (
    <div
      ref={boardContainerRef}
      role="region"
      aria-label={isEn ? 'Sudoku Puzzle Game Board' : '數獨對弈盤面'}
      className="relative flex flex-col items-center justify-center w-full min-h-[90vh] select-none py-2 font-mono bg-slate-950 text-slate-100 overflow-hidden"
    >
      {violationAlert && (
        <div role="alert" className="fixed top-4 z-50 px-4 py-2 bg-rose-600 border border-rose-400 text-white font-bold text-xs rounded-full shadow-2xl animate-bounce">
          {violationAlert}
        </div>
      )}
      {bookmarkToast && (
        <div role="status" aria-live="polite" className="fixed top-4 z-50 px-4 py-2 bg-indigo-600 border border-indigo-400 text-white font-bold text-xs rounded-full shadow-2xl">
          {bookmarkToast}
        </div>
      )}

      {/* 頂部心流控制列 */}
      <header className="w-full max-w-[min(94vw,74vh)] flex items-center justify-between text-xs text-slate-400 mb-2 px-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setInternalAssessment((p) => !p)}
            className={`px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
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

        {/* aria-live="off" 避免螢幕閱讀器每秒喧囂讀取時間跳動 */}
        <div className="text-sm font-bold tracking-wider" aria-live="off">
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
          {!isCompleted && !isTimedOut && !isResigned && (
            <>
              <button
                type="button"
                onClick={handleBookmarkPuzzle}
                aria-label={isEn ? 'Bookmark current progress' : '暫存目前進度'}
                className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs rounded cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                📌
              </button>
              <button
                type="button"
                onMouseDown={startResignHold}
                onMouseUp={cancelResignHold}
                onMouseLeave={cancelResignHold}
                onTouchStart={startResignHold}
                onTouchEnd={cancelResignHold}
                onKeyDown={handleResignKeyDown}
                onKeyUp={handleResignKeyUp}
                aria-label={isEn ? 'Hold to resign and show solution (Space, Enter, or mouse)' : '長按投降並顯示正解 (支援空白鍵、Enter 或滑鼠)'}
                className="relative px-2 py-1 bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-800/80 text-slate-400 hover:text-rose-300 text-xs rounded cursor-pointer select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
              >
                {resignHoldProgress > 0 && (
                  <div
                    className="absolute inset-0 bg-rose-600/30 pointer-events-none"
                    style={{ width: `${resignHoldProgress * 100}%` }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1">
                  <span aria-hidden="true">🕊️</span>
                  {resignHoldProgress > 0 && (
                    <span className="text-[9px] font-bold text-rose-300 font-mono">
                      {Math.round(resignHoldProgress * 100)}%
                    </span>
                  )}
                </span>
              </button>
              {hints.length > 0 && (
                <button
                  type="button"
                  onClick={triggerHintLadder}
                  aria-label={isEn ? `Get hint level ${hintLevel + 1}` : `取得第 ${hintLevel + 1} 級提示`}
                  className="px-2.5 py-0.5 bg-amber-950/90 hover:bg-amber-900 border border-amber-600 text-amber-300 text-[10px] font-bold rounded flex items-center gap-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  💡 {hintLevel === 0 ? (isEn ? 'Hint' : '提示') : `L${hintLevel}`}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {activeHintText && (
        <div
          role="status"
          aria-live="polite"
          className="w-full max-w-[min(94vw,74vh)] bg-slate-900/95 border border-amber-500/70 text-amber-200 text-xs px-3 py-2 rounded-xl mb-2 flex items-center justify-between gap-2 shadow-2xl backdrop-blur animate-fade-in"
        >
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 rounded font-black text-[9px]">
              L{hintLevel}
            </span>
            <span className="leading-relaxed">{activeHintText}</span>
          </div>
          <button
            type="button"
            onClick={() => setActiveHintText(null)}
            aria-label={isEn ? 'Dismiss hint' : '關閉提示'}
            className="text-slate-400 hover:text-slate-200 text-xs font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* 主數獨棋盤：符合 WAI-ARIA APG 2D Grid 完整樹狀規範 */}
      <div className="relative flex flex-col items-center">
        {/* 橫坐標 A-I */}
        <div className="grid grid-cols-9 w-[min(90vw,70vh)] pl-4 text-center text-[9px] text-slate-500 font-bold mb-1 tracking-widest pointer-events-none font-mono" aria-hidden="true">
          {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((char) => (
            <div key={char}>{char}</div>
          ))}
        </div>

        <div className="flex items-center">
          {/* 縱坐標 1-9 */}
          <div className="flex flex-col justify-around h-[min(90vw,70vh)] w-4 pr-1 text-right text-[9px] text-slate-500 font-bold pointer-events-none font-mono" aria-hidden="true">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((rowNum) => (
              <div key={rowNum}>{rowNum}</div>
            ))}
          </div>

          <main
            role="grid"
            aria-label={isEn ? '9 by 9 Sudoku Grid' : '9x9 數獨網格'}
            aria-rowcount={9}
            aria-colcount={9}
            className={`relative grid grid-cols-9 gap-[1px] border-2 p-1 rounded-2xl shadow-2xl w-[min(90vw,70vh)] h-[min(90vw,70vh)] ${
              isResigned ? 'bg-rose-950/10 border-rose-900/50' : 'bg-slate-800/90 border-slate-700'
            }`}
          >
            {Array.from({ length: 9 }, (_, r) => (
              <div key={r} role="row" aria-rowindex={r + 1} className="contents">
                {Array.from({ length: 9 }, (_, c) => {
                  const idx = r * 9 + c;
                  const val = grid[idx];
                  const isGiven = initialGrid[idx] !== 0;
                  const isSelected = selectedCell === idx;
                  const isConflict = conflictCell === idx;
                  const isHardBlocked = hardBlockedCell === idx;
                  const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);

                  const isSameValue = selectedValue > 0 && val === selectedValue;
                  const isInSameLineOrBox = r === selectedRow || c === selectedCol || box === selectedBox;
                  const isInHintConstraintZone = hintLevel >= 1 && (r === hintFocusRow || c === hintFocusCol || box === hintFocusBox);
                  const isTargetHintCell = hintLevel === 3 && r === hintFocusRow && c === hintFocusCol;

                  const borderRight = (c + 1) % 3 === 0 && c !== 8 ? 'border-r-2 border-r-slate-600' : '';
                  const borderBottom = (r + 1) % 3 === 0 && r !== 8 ? 'border-b-2 border-b-slate-600' : '';

                  const cellCandidates = candidates[idx];
                  const isBivalueCell = cellCandidates && cellCandidates.size === 2;
                  const showAutoCandidates = isSelected && val === 0 && (!cellCandidates || cellCandidates.size === 0);

                  const coordName = `${String.fromCharCode(65 + c)}${r + 1}`;
                  const conflictMark = isConflict || isHardBlocked ? (isEn ? ' (Conflict)' : ' (衝突)') : '';
                  const cellAriaLabel = `${coordName}, ${
                    val !== 0
                      ? `${val} ${isGiven ? (isEn ? 'given clue' : '初始提示') : ''}`
                      : isEn
                      ? 'empty'
                      : '空格'
                  }${conflictMark}`;

                  const conflictClass = resolveConflictStyles(colorBlindMode, isHardBlocked, isConflict);

                  return (
                    <div
                      key={idx}
                      role="gridcell"
                      aria-colindex={c + 1}
                      aria-selected={isSelected}
                      className="w-full h-full relative"
                    >
                      <button
                        ref={(el) => {
                          cellButtonRefs.current[idx] = el;
                        }}
                        type="button"
                        tabIndex={isSelected ? 0 : -1} // Roving Tabindex
                        onClick={() => {
                          setSelectedCell(idx);
                          triggerHaptic(10);
                        }}
                        aria-label={cellAriaLabel}
                        className={`w-full h-full flex items-center justify-center text-sm sm:text-xl font-bold rounded-sm relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${borderRight} ${borderBottom} ${
                          isResigned
                            ? 'bg-rose-950/60 text-rose-300'
                            : conflictClass || (
                              isTargetHintCell
                                ? 'bg-amber-600 border-amber-300 text-white ring-2 ring-amber-400 z-20'
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
                            )
                        }`}
                      >
                        {val !== 0 ? (
                          <>
                            <span>{val}</span>
                            {(isConflict || isHardBlocked) && (
                              <span aria-hidden="true" className="absolute top-0.5 right-0.5 text-[8px] leading-none">
                                ✕
                              </span>
                            )}
                          </>
                        ) : cellCandidates && cellCandidates.size > 0 ? (
                          <div className="grid grid-cols-3 grid-rows-3 w-full h-full p-0.5 pointer-events-none" aria-hidden="true">
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
                          <div className="grid grid-cols-3 grid-rows-3 w-full h-full p-0.5 pointer-events-none" aria-hidden="true">
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
                    </div>
                  );
                })}
              </div>
            ))}
          </main>
        </div>
      </div>

      {/* 底部輸入按鈕列 */}
      {!isCompleted && !isTimedOut && !isResigned && (
        <footer className="flex flex-col gap-2 mt-3 w-full max-w-[min(90vw,70vh)] pl-4">
          <div className="grid grid-cols-10 gap-1 sm:gap-1.5" role="group" aria-label={isEn ? 'Number Input Pad' : '數字輸入鍵盤'}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => handleNumberInput(num)}
                disabled={initialGrid[selectedCell] !== 0}
                aria-label={`${isEn ? 'Enter' : '填入'} ${num}`}
                className={`py-2.5 sm:py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-25 text-slate-100 border border-slate-800 hover:border-slate-700 rounded-xl text-sm sm:text-base font-bold shadow cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  reducedMotion ? '' : 'transition active:scale-95'
                }`}
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handleNumberInput(0)}
              disabled={initialGrid[selectedCell] !== 0}
              aria-label={isEn ? 'Erase cell value' : '擦除當前格數值'}
              className={`py-2.5 sm:py-3 bg-rose-950/40 hover:bg-rose-900/50 disabled:opacity-25 text-rose-300 border border-rose-900/60 rounded-xl text-sm sm:text-base font-bold shadow cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-rose-400 ${
                reducedMotion ? '' : 'transition active:scale-95'
              }`}
            >
              ⌫
            </button>
          </div>

          <div className="flex justify-between items-center px-1 text-xs text-slate-500">
            <button
              type="button"
              onClick={() => setIsNoteMode((p) => !p)}
              aria-pressed={effectiveNoteMode}
              className={`px-3 py-1 rounded-lg border text-xs font-bold flex items-center gap-1.5 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                effectiveNoteMode
                  ? 'bg-amber-950 border-amber-500 text-amber-300 shadow-sm shadow-amber-500/30'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span aria-hidden="true">✏️</span>
              <span>{isEn ? 'Notes [Space / Shift]' : '筆記模式 [Space / Shift]'}</span>
              <span className={`w-2 h-2 rounded-full ${effectiveNoteMode ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`} />
            </button>

            <span className="text-[10px] text-slate-500 hidden sm:inline font-mono">
              {effectiveNoteMode ? (isEn ? 'Hold Shift or Press Space' : '按住 Shift 或按 Space 快速切換') : (isEn ? 'Numpad 1-9 & Arrow Keys' : '支援方向鍵巡航與數字鍵盤')}
            </span>
          </div>
        </footer>
      )}

      {/* 覆盤結算視圖：全螢幕隔離 Focus Trap，動態降低 ARIA 優先級防止雙重模態衝突 */}
      {isSummaryActive && (
        <div
          role="dialog"
          aria-modal={!showSubmitModal && !showPBModal}
          aria-hidden={showSubmitModal || showPBModal ? true : undefined}
          aria-labelledby={`${boardId}-summary-title`}
          onKeyDown={handleSummaryKeyDown}
          className={`fixed inset-0 z-40 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in ${
            showSubmitModal || showPBModal ? 'pointer-events-none' : ''
          }`}
        >
          <div className="w-full max-w-md bg-slate-900/95 border border-indigo-500/50 rounded-2xl p-4 shadow-2xl text-center font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <div className="text-left">
                <div className="text-[9px] text-slate-500 uppercase tracking-wider">Formal Logic Proof</div>
                <h2 id={`${boardId}-summary-title`} className="text-sm text-indigo-300 font-bold m-0">
                  {isCompleted ? (isEn ? '✨ Victory Verified' : '✨ 完美落子通關') : (isEn ? '🕊️ Resigned for Replay' : '🕊️ 已投降，進入覆盤')}
                </h2>
              </div>
              <div className="px-2.5 py-1 bg-cyan-950 border border-cyan-500 rounded text-xs font-bold text-cyan-300">
                IQ {cci.standardIQ} (±{cci.semIQ})
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs text-slate-400 mb-3" role="group" aria-label={isEn ? 'Performance metrics' : '對弈表現指標'}>
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <div className="text-[9px] text-slate-500">{isEn ? 'Time' : '耗時'}</div>
                <div className="text-slate-100 font-bold text-sm">{elapsedSec}s</div>
              </div>
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <div className="text-[9px] text-slate-500">{isEn ? 'IRT' : '難度係數'}</div>
                <div className="text-cyan-300 font-bold text-sm">{(metrics.irt_logit_difficulty as number) ?? 0.0}</div>
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
                forceLang={lang}
              />
            </div>

            {showMetricsDrawer ? (
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-left mb-3 animate-fade-in space-y-2">
                <CognitiveRadarChart
                  dimensions={profile.cognitiveDimensions}
                  previousDimensions={profile.previousCognitiveDimensions}
                  size={140}
                  forceLang={lang}
                />
                <div className="text-[9px] text-slate-400">
                  <strong>Solving Path:</strong> {solvingPath.join(' ➔ ')}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowMetricsDrawer(true)}
                className="w-full py-1 mb-3 text-[10px] text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
              >
                {isEn ? '▼ View Cognitive Dimensions & Solving Path' : '▼ 展開完整認知維度與推導路徑'}
              </button>
            )}

            <div className="flex gap-2">
              <button
                ref={summaryCloseBtnRef}
                type="button"
                onClick={exportLongitudinalDataset}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-xs rounded-xl border border-cyan-500/40 cursor-pointer"
              >
                📊 {isEn ? 'Export Data' : '匯出數據'}
              </button>
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                className="flex-1 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-lg cursor-pointer"
              >
                📤 {isEn ? 'Submit' : '賽事提交'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PB 與賽事提交 Modals */}
      {showPBModal && (
        <PBCelebrationModal
          pb={profile.personalBest}
          onClose={() => setShowPBModal(false)}
          forceLang={lang}
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
          forceLang={lang}
        />
      )}
    </div>
  );
};
