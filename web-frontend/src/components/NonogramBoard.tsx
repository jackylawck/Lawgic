// web-frontend/src/components/NonogramBoard.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { NonogramSpec, NonogramHintStep, WebNonogramGenerator } from '../engines/nonogramGenerator';
import { VaultManager, VaultItem } from '../utils/vaultStorage';
import {
  TournamentProctoringSession,
  getEnvironmentFingerprint,
  calculateInfractionScore,
} from '../utils/tournamentSecurity';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

// 0: 空白, 1: 填黑, 2: 標叉, 3: 候選暫記點 (Note/Dot)
type CellState = 0 | 1 | 2 | 3;

interface HistoryAction {
  changes: { r: number; c: number; prev: CellState; next: CellState }[];
}

interface NonogramSessionState {
  grid: CellState[][];
  elapsedMs: number;
  historyStack: HistoryAction[];
  activeInputMode: 1 | 2 | 3;
  hintLevel: number;
  activeHint: NonogramHintStep | null;
  isPaused: boolean;
  savedAt: number;
}

/**
 * 專業賽事級計時核心 Hook (SSOT - Wall Clock Accurate, Zero Parent Re-render)
 * 內部嚴格採用 useMemo 保持回傳物件參考穩定，杜絕任何 useEffect 無限 Re-render 迴圈。
 */
function useCompetitionTimer(initialMs: number = 0) {
  const startTimeRef = useRef<number>(Date.now() - initialMs);
  const accumulatedPauseRef = useRef<number>(0);
  const pauseStartRef = useRef<number | null>(null);
  const isPausedRef = useRef<boolean>(false);

  const getElapsedMs = useCallback(() => {
    const now = Date.now();
    let currentPause = accumulatedPauseRef.current;
    if (isPausedRef.current && pauseStartRef.current !== null) {
      currentPause += (now - pauseStartRef.current);
    }
    return Math.max(0, now - startTimeRef.current - currentPause);
  }, []);

  const pause = useCallback(() => {
    if (!isPausedRef.current) {
      isPausedRef.current = true;
      pauseStartRef.current = Date.now();
    }
  }, []);

  const resume = useCallback(() => {
    if (isPausedRef.current) {
      if (pauseStartRef.current !== null) {
        accumulatedPauseRef.current += (Date.now() - pauseStartRef.current);
        pauseStartRef.current = null;
      }
      isPausedRef.current = false;
    }
  }, []);

  const reset = useCallback((targetMs: number = 0) => {
    startTimeRef.current = Date.now() - targetMs;
    accumulatedPauseRef.current = 0;
    pauseStartRef.current = null;
    isPausedRef.current = false;
  }, []);

  return useMemo(() => ({
    getElapsedMs,
    pause,
    resume,
    reset,
  }), [getElapsedMs, pause, resume, reset]);
}

/**
 * 局部自驅動計時器 UI：100ms 頻率的重繪被完全鎖死在此元件內部
 */
const TimerDisplay = memo(({
  getElapsedMs,
  showTimer,
  isPaused,
  isCompleted,
  isEn,
}: {
  getElapsedMs: () => number;
  showTimer: boolean;
  isPaused: boolean;
  isCompleted: boolean;
  isEn: boolean;
}) => {
  const [displayMs, setDisplayMs] = useState<number>(getElapsedMs);

  useEffect(() => {
    if (!showTimer || isPaused || isCompleted) return;

    const interval = setInterval(() => {
      setDisplayMs(getElapsedMs());
    }, 100);

    return () => clearInterval(interval);
  }, [showTimer, isPaused, isCompleted, getElapsedMs]);

  if (!showTimer) {
    return <span>{isEn ? 'Zen (Hidden)' : '靜注 (隱匿)'}</span>;
  }

  return <span>{(displayMs / 1000).toFixed(1)}s</span>;
});
TimerDisplay.displayName = 'TimerDisplay';

export const NonogramBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, profile } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as NonogramSpec;
  const rows = spec?.rows || 5;
  const cols = spec?.cols || 5;
  const rowClues = spec?.rowClues || [];
  const colClues = spec?.colClues || [];
  const solution: boolean[][] = spec?.solution || [];
  const solvingSteps: NonogramHintStep[] = spec?.solvingSteps || [];
  const seed = (actualPuzzle?.metrics as any)?.seed || spec?.seed || 12345;

  const puzzleStorageKey = useMemo(() => `nono_session_${actualPuzzle?.id || 'sandbox'}`, [actualPuzzle?.id]);
  const prevPuzzleKeyRef = useRef<string>(puzzleStorageKey);

  // 核心盤面狀態
  const [grid, setGrid] = useState<CellState[][]>(() => Array.from({ length: rows }, () => Array(cols).fill(0)));
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>([0, 0]);
  const [hoverCell, setHoverCell] = useState<[number, number] | null>(null);

  const [activeInputMode, setActiveInputMode] = useState<1 | 2 | 3>(1);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [finalElapsedMs, setFinalElapsedMs] = useState<number | null>(null);
  const [isFav, setIsFav] = useState<boolean>(() =>
    actualPuzzle?.id ? VaultManager.isFavorited(actualPuzzle.id) : false
  );
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);

  // 訓練級真暫停狀態
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // 雙擊 R 鍵免彈窗防呆
  const [isResetPending, setIsResetPending] = useState<boolean>(false);
  const resetPendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Zen 模式切換
  const [showTimer, setShowTimer] = useState<boolean>(tournamentMode);

  // 統一計時引擎
  const timer = useCompetitionTimer(0);

  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);

  // 拖曳狀態管理
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragTargetStateRef = useRef<CellState>(1);
  const currentDragBatchRef = useRef<{ r: number; c: number; prev: CellState; next: CellState }[]>([]);

  // 歷史撤銷 / 重做隊列
  const [historyStack, setHistoryStack] = useState<HistoryAction[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryAction[]>([]);

  // 漸進式引導提示
  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<NonogramHintStep | null>(null);

  const hasRecordedRef = useRef<boolean>(false);

  // 實體防作弊稽核 Session
  const proctoringRef = useRef<TournamentProctoringSession | null>(null);

  useEffect(() => {
    proctoringRef.current = new TournamentProctoringSession();
    return () => {
      proctoringRef.current?.destroy();
      proctoringRef.current = null;
    };
  }, [actualPuzzle?.id]);

  // 快照持久化指針
  const latestSessionRef = useRef<NonogramSessionState>({
    grid,
    elapsedMs: 0,
    historyStack,
    activeInputMode,
    hintLevel,
    activeHint,
    isPaused: false,
    savedAt: Date.now(),
  });

  useEffect(() => {
    latestSessionRef.current = {
      grid,
      elapsedMs: timer.getElapsedMs(),
      historyStack,
      activeInputMode,
      hintLevel,
      activeHint,
      isPaused,
      savedAt: Date.now(),
    };
  }, [grid, historyStack, activeInputMode, hintLevel, activeHint, isPaused, timer]);

  // 卸載時清理 resetPendingTimerRef
  useEffect(() => {
    return () => {
      if (resetPendingTimerRef.current) {
        clearTimeout(resetPendingTimerRef.current);
      }
    };
  }, []);

  // 鍵盤焦點自動滾動 Ref
  const selectedCellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedCellRef.current) {
      selectedCellRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [selectedCell]);

  // 切換題目生命週期
  useEffect(() => {
    if (prevPuzzleKeyRef.current && prevPuzzleKeyRef.current !== puzzleStorageKey) {
      try {
        latestSessionRef.current.elapsedMs = timer.getElapsedMs();
        localStorage.setItem(prevPuzzleKeyRef.current, JSON.stringify(latestSessionRef.current));
      } catch (_) {}
    }
    prevPuzzleKeyRef.current = puzzleStorageKey;

    let loaded = false;
    let savedDuration = 0;

    try {
      const saved = localStorage.getItem(puzzleStorageKey);
      if (saved) {
        const parsed: NonogramSessionState = JSON.parse(saved);
        if (parsed?.grid?.length === rows && parsed?.grid[0]?.length === cols) {
          setGrid(parsed.grid);
          savedDuration = parsed.elapsedMs || 0;
          setHistoryStack(parsed.historyStack || []);
          setRedoStack([]);
          setActiveInputMode(parsed.activeInputMode || 1);
          setHintLevel(parsed.hintLevel || 0);
          setActiveHint(parsed.activeHint || null);
          const wasPaused = Boolean(parsed.isPaused);
          setIsPaused(wasPaused);
          timer.reset(savedDuration);
          if (wasPaused) timer.pause();
          loaded = true;
        }
      }
    } catch (_) {}

    if (!loaded) {
      setGrid(Array.from({ length: rows }, () => Array(cols).fill(0)));
      setHistoryStack([]);
      setRedoStack([]);
      setHintLevel(0);
      setActiveHint(null);
      setIsPaused(false);
      timer.reset(0);
    }

    setSelectedCell([0, 0]);
    setHoverCell(null);
    setIsCompleted(false);
    setFinalElapsedMs(null);
    setIsDragging(false);
    setIsResetPending(false);
    hasRecordedRef.current = false;
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
  }, [puzzleStorageKey, rows, cols, timer, actualPuzzle?.id]);

  // 卸載前快照保護
  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        latestSessionRef.current.elapsedMs = timer.getElapsedMs();
        localStorage.setItem(puzzleStorageKey, JSON.stringify(latestSessionRef.current));
      } catch (_) {}
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [puzzleStorageKey, timer]);

  const togglePause = useCallback(() => {
    if (isCompleted) return;
    const next = !isPaused;
    if (next) {
      timer.pause();
    } else {
      timer.resume();
    }
    setIsPaused(next);
  }, [isCompleted, isPaused, timer]);

  const toggleTimerVisibility = useCallback(() => {
    setShowTimer((prev) => !prev);
  }, []);

  // Debounced 常態背景持久化
  useEffect(() => {
    if (isCompleted) return;

    const timeoutId = setTimeout(() => {
      try {
        latestSessionRef.current.elapsedMs = timer.getElapsedMs();
        localStorage.setItem(puzzleStorageKey, JSON.stringify(latestSessionRef.current));
      } catch (_) {}
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [grid, historyStack, activeInputMode, hintLevel, activeHint, isPaused, isCompleted, puzzleStorageKey, timer]);

  // 行列完成與容量統計
  const rowStats = useMemo(() => {
    return Array.from({ length: rows }, (_, r) => {
      const line = grid[r]?.map((v) => v === 1) || [];
      const actualClues = WebNonogramGenerator.extractLineClues(line);
      const isDone = actualClues.join(',') === rowClues[r]?.join(',');
      const expectedFilled = (rowClues[r] || []).reduce((acc, v) => acc + v, 0);
      const currentFilled = line.filter(Boolean).length;
      const isOverflow = currentFilled > expectedFilled;
      return { isDone, isOverflow, currentFilled, expectedFilled };
    });
  }, [grid, rowClues, rows]);

  const colStats = useMemo(() => {
    return Array.from({ length: cols }, (_, c) => {
      const line = Array.from({ length: rows }, (_, r) => grid[r]?.[c] === 1);
      const actualClues = WebNonogramGenerator.extractLineClues(line);
      const isDone = actualClues.join(',') === colClues[c]?.join(',');
      const expectedFilled = (colClues[c] || []).reduce((acc, v) => acc + v, 0);
      const currentFilled = line.filter(Boolean).length;
      const isOverflow = currentFilled > expectedFilled;
      return { isDone, isOverflow, currentFilled, expectedFilled };
    });
  }, [grid, colClues, rows, cols]);

  const totalExpectedFilled = useMemo(() => {
    return rowClues.reduce((sum, clues) => sum + clues.reduce((a, b) => a + b, 0), 0);
  }, [rowClues]);

  const currentFilledCount = useMemo(() => {
    return grid.reduce((sum, row) => sum + row.filter((c) => c === 1).length, 0);
  }, [grid]);

  const unresolvedCount = useMemo(() => {
    return grid.reduce((sum, row) => sum + row.filter((c) => c === 0 || c === 3).length, 0);
  }, [grid]);

  // 勝利判定
  const checkVictory = useCallback(
    (curGrid: CellState[][]): boolean => {
      if (!solution || solution.length === 0) return false;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const isFilled = curGrid[r]?.[c] === 1;
          if (solution[r]?.[c] !== isFilled) {
            return false;
          }
        }
      }
      return true;
    },
    [rows, cols, solution]
  );

  const applyCellState = useCallback(
    (r: number, c: number, target: CellState, isDragAction = false) => {
      if (isCompleted || isPaused) return;

      if (activeHint && activeHint.r === r && activeHint.c === c) {
        setHintLevel(0);
        setActiveHint(null);
      }

      setGrid((prev) => {
        if (isDragAction && prev[r][c] !== 0) return prev;

        const next = prev.map((row) => [...row]);
        const prevVal = next[r][c];
        const nextVal = prevVal === target ? 0 : target;
        next[r][c] = nextVal;

        if (isDragAction) {
          currentDragBatchRef.current.push({ r, c, prev: prevVal, next: nextVal });
        } else {
          setHistoryStack((hs) => [...hs.slice(-49), { changes: [{ r, c, prev: prevVal, next: nextVal }] }]);
          setRedoStack([]);
        }

        // P2 修復：加入 hasRecordedRef 防禦重複結算
        if (!hasRecordedRef.current && checkVictory(next)) {
          hasRecordedRef.current = true;
          const preciseElapsed = timer.getElapsedMs();
          setFinalElapsedMs(preciseElapsed);
          setIsCompleted(true);

          try {
            localStorage.removeItem(puzzleStorageKey);
          } catch (_) {}

          const timeSpent = Math.max(1, Math.round(preciseElapsed / 1000));
          if (actualPuzzle) {
            recordAttempt({
              puzzleId: actualPuzzle.id,
              engineType: 'nonogram',
              tier: (actualPuzzle.tier as TierKey) || 'kids',
              cognitiveLoad: actualPuzzle.cognitiveLoad || { spatial: 0.9, numeric: 0.8, workingMemory: 0.8, inhibition: 0.9 },
              isSuccess: true,
              timeSpentSec: timeSpent,
              conflictsCount: 0,
              technique: spec?.highestTechnique || 'ConstraintSatisfaction',
              isPureClear: true,
            });
          }
        }
        return next;
      });
    },
    [isCompleted, isPaused, activeHint, checkVictory, actualPuzzle, recordAttempt, spec?.highestTechnique, puzzleStorageKey, timer]
  );

  const handleUndo = useCallback(() => {
    if (isCompleted || isPaused || historyStack.length === 0) return;
    const lastAction = historyStack[historyStack.length - 1];
    setHistoryStack((hs) => hs.slice(0, -1));
    setRedoStack((rs) => [...rs.slice(-49), lastAction]);

    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      for (const ch of lastAction.changes) {
        next[ch.r][ch.c] = ch.prev;
      }
      return next;
    });
  }, [isCompleted, isPaused, historyStack]);

  const handleRedo = useCallback(() => {
    if (isCompleted || isPaused || redoStack.length === 0) return;
    const nextAction = redoStack[redoStack.length - 1];
    setRedoStack((rs) => rs.slice(0, -1));
    setHistoryStack((hs) => [...hs.slice(-49), nextAction]);

    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      for (const ch of nextAction.changes) {
        next[ch.r][ch.c] = ch.next;
      }
      return next;
    });
  }, [isCompleted, isPaused, redoStack]);

  const executeReset = useCallback(() => {
    setGrid(Array.from({ length: rows }, () => Array(cols).fill(0)));
    setHistoryStack([]);
    setRedoStack([]);
    setHintLevel(0);
    setActiveHint(null);
    timer.reset(0);
    setIsResetPending(false);
  }, [rows, cols, timer]);

  const handleTriggerReset = useCallback(() => {
    if (isCompleted || isPaused) return;

    if (!isResetPending) {
      setIsResetPending(true);
      if (resetPendingTimerRef.current) clearTimeout(resetPendingTimerRef.current);
      resetPendingTimerRef.current = setTimeout(() => {
        setIsResetPending(false);
      }, 2500);
    } else {
      if (resetPendingTimerRef.current) clearTimeout(resetPendingTimerRef.current);
      executeReset();
    }
  }, [isCompleted, isPaused, isResetPending, executeReset]);

  const handleAutoLockRow = useCallback(
    (r: number, clearNotes = false) => {
      if (isCompleted || isPaused) return;
      setGrid((prev) => {
        const next = prev.map((row) => [...row]);
        const changes: { r: number; c: number; prev: CellState; next: CellState }[] = [];
        for (let c = 0; c < cols; c++) {
          const isTarget = clearNotes ? next[r][c] === 0 || next[r][c] === 3 : next[r][c] === 0;
          if (isTarget) {
            changes.push({ r, c, prev: next[r][c], next: 2 });
            next[r][c] = 2;
          }
        }
        if (changes.length > 0) {
          setHistoryStack((hs) => [...hs.slice(-49), { changes }]);
          setRedoStack([]);
        }
        return next;
      });
    },
    [isCompleted, isPaused, cols]
  );

  const handleAutoLockCol = useCallback(
    (c: number, clearNotes = false) => {
      if (isCompleted || isPaused) return;
      setGrid((prev) => {
        const next = prev.map((row) => [...row]);
        const changes: { r: number; c: number; prev: CellState; next: CellState }[] = [];
        for (let r = 0; r < rows; r++) {
          const isTarget = clearNotes ? next[r][c] === 0 || next[r][c] === 3 : next[r][c] === 0;
          if (isTarget) {
            changes.push({ r, c, prev: next[r][c], next: 2 });
            next[r][c] = 2;
          }
        }
        if (changes.length > 0) {
          setHistoryStack((hs) => [...hs.slice(-49), { changes }]);
          setRedoStack([]);
        }
        return next;
      });
    },
    [isCompleted, isPaused, rows]
  );

  const handlePointerDown = (r: number, c: number, e: React.PointerEvent) => {
    if (isCompleted || isPaused) return;

    let targetState: CellState = activeInputMode;
    if (e.shiftKey) {
      targetState = 3;
    } else if (e.button === 2) {
      targetState = 2;
    }

    dragTargetStateRef.current = targetState;
    currentDragBatchRef.current = [];
    setIsDragging(true);
    setSelectedCell([r, c]);
    applyCellState(r, c, targetState, false);
  };

  const handlePointerEnter = (r: number, c: number) => {
    setHoverCell([r, c]);
    if (isDragging && !isCompleted && !isPaused) {
      applyCellState(r, c, dragTargetStateRef.current, true);
    }
  };

  const handlePointerUp = useCallback(() => {
    if (isDragging && currentDragBatchRef.current.length > 0) {
      setHistoryStack((hs) => [...hs.slice(-49), { changes: [...currentDragBatchRef.current] }]);
      setRedoStack([]);
      currentDragBatchRef.current = [];
    }
    setIsDragging(false);
  }, [isDragging]);

  useEffect(() => {
    const handleGlobalUp = () => {
      if (isDragging) handlePointerUp();
    };
    window.addEventListener('pointerup', handleGlobalUp);
    window.addEventListener('pointercancel', handleGlobalUp);
    return () => {
      window.removeEventListener('pointerup', handleGlobalUp);
      window.removeEventListener('pointercancel', handleGlobalUp);
    };
  }, [isDragging, handlePointerUp]);

  const handleRequestHint = useCallback(() => {
    if (isCompleted || isPaused || tournamentMode) return;

    let targetStep: NonogramHintStep | null = null;
    for (let i = 0; i < solvingSteps.length; i++) {
      const s = solvingSteps[i];
      if (grid[s.r]?.[s.c] === 0 || grid[s.r]?.[s.c] === 3) {
        targetStep = s;
        break;
      }
    }

    if (!targetStep) return;

    if (!activeHint || activeHint.r !== targetStep.r || activeHint.c !== targetStep.c) {
      setActiveHint(targetStep);
      setHintLevel(1);
      setSelectedCell([targetStep.r, targetStep.c]);
    } else {
      setHintLevel((prev) => Math.min(4, prev + 1));
    }
  }, [isCompleted, isPaused, tournamentMode, solvingSteps, grid, activeHint]);

  // P0 修復：標準化金庫收藏對接
  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const vaultItem: VaultItem = {
      id: actualPuzzle.id,
      engine: 'nonogram',
      tier: String(actualPuzzle.tier || 'kids'),
      seed: Number(seed),
      steps: rows * cols,
      timeSpentSec: Math.round(timer.getElapsedMs() / 1000),
      date: new Date().toISOString(),
    };
    const res = VaultManager.toggleFavorite(vaultItem);
    setIsFav(res.isFav);
  };

  // 鍵盤全功能映射
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const code = e.code;

      if (code === 'KeyP') {
        e.preventDefault();
        togglePause();
        return;
      }

      if (isCompleted || isPaused) return;

      const [curR, curC] = selectedCell || [0, 0];
      const r = Math.min(Math.max(0, curR), rows - 1);
      const c = Math.min(Math.max(0, curC), cols - 1);

      if (code === 'KeyW' || code === 'ArrowUp') {
        e.preventDefault();
        setSelectedCell([Math.max(0, r - 1), c]);
      } else if (code === 'KeyS' || code === 'ArrowDown') {
        e.preventDefault();
        setSelectedCell([Math.min(rows - 1, r + 1), c]);
      } else if (code === 'KeyA' || code === 'ArrowLeft') {
        e.preventDefault();
        setSelectedCell([r, Math.max(0, c - 1)]);
      } else if (code === 'KeyD' || code === 'ArrowRight') {
        e.preventDefault();
        setSelectedCell([r, Math.min(cols - 1, c + 1)]);
      } else if (code === 'Space' || code === 'Enter') {
        e.preventDefault();
        applyCellState(r, c, activeInputMode, false);
      } else if (code === 'KeyX') {
        e.preventDefault();
        applyCellState(r, c, 2, false);
      } else if (code === 'KeyF') {
        e.preventDefault();
        applyCellState(r, c, 1, false);
      } else if (code === 'KeyE') {
        e.preventDefault();
        applyCellState(r, c, 3, false);
      } else if (code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if (code === 'KeyY') {
        e.preventDefault();
        handleRedo();
      } else if (code === 'KeyR') {
        e.preventDefault();
        handleTriggerReset();
      } else if (code === 'KeyH') {
        e.preventDefault();
        handleRequestHint();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, rows, cols, isCompleted, isPaused, activeInputMode, applyCellState, handleRequestHint, handleUndo, handleRedo, togglePause, handleTriggerReset]);

  const maxColClueLength = useMemo(() => Math.max(1, ...colClues.map((c) => c.length)), [colClues]);
  const maxRowClueLength = useMemo(() => Math.max(1, ...rowClues.map((r) => r.length)), [rowClues]);

  const cellSize = useMemo(() => {
    return Math.max(22, Math.min(340 / Math.max(rows, cols), 36));
  }, [rows, cols]);

  const hintStageLabel = useMemo(() => {
    switch (hintLevel) {
      case 1:
        return isEn ? 'Stage 1: Focus Axis' : '第一階：視線聚焦';
      case 2:
        return isEn ? 'Stage 2: Bounds Pressure' : '第二階：空間擠壓';
      case 3:
        return isEn ? 'Stage 3: Deep Logic' : '第三階：深層推導';
      case 4:
        return isEn ? 'Stage 4: Coordinate Lock' : '第四階：座標定案';
      default:
        return '';
    }
  }, [hintLevel, isEn]);

  const hintContent = useMemo(() => {
    if (!activeHint) return null;
    const rNum = activeHint.r + 1;
    const cNum = activeHint.c + 1;

    if (hintLevel === 1) {
      return isEn
        ? `Direct your focus to Row ${rNum} and Column ${cNum}. The surrounding constraints are approaching a tipping point.`
        : `請將視線移至第 ${rNum} 行與第 ${cNum} 列的直交區域，這條線索群已接近臨界。`;
    }
    if (hintLevel === 2) {
      return isEn
        ? `Examine remaining room vs. block lengths: the total span leaves virtually zero leeway.`
        : `審視線索空間邊界：此線區塊長度加上強制間隔，使得剩餘空間的自由度極度收縮。`;
    }
    if (hintLevel === 3) {
      return isEn
        ? `Line overlap forces a definitive cell state. Can you mathematically isolate the overlap before revealing?`
        : `線索區間重疊已逼出必填格。在點擊揭曉座標前，試著計算哪一格已被兩端邊界同時鎖定？`;
    }
    if (hintLevel === 4) {
      return isEn
        ? `Target identified: Cell (${rNum}, ${cNum}) is forced to be ${activeHint.forcedState === 1 ? 'Filled' : 'Crossed'}.`
        : `坐標定案：(${rNum}, ${cNum}) 在此局勢下必為${activeHint.forcedState === 1 ? '填黑' : '標叉'}。`;
    }
    return null;
  }, [activeHint, hintLevel, isEn]);

  const eurekaInsight = useMemo(() => {
    const rawZh = (spec as any)?.pedagogicalPattern?.coreInsightZh;
    const rawEn = (spec as any)?.pedagogicalPattern?.coreInsightEn;

    if (isEn) {
      return rawEn || 'Key deduction: Orthogonal boundary pinning and parity balance collapse the remaining ambiguity.';
    }
    return rawZh ? `解題關鍵：${rawZh}` : '解題關鍵：邊界長度鎖定與間隙奇偶性，引發剩餘盤面連鎖坍縮。';
  }, [spec, isEn]);

  const techniqueLabel = useMemo(() => {
    const tech = spec?.highestTechnique || 'line_overlap';
    const dict: Record<string, { zh: string; en: string }> = {
      line_overlap: { zh: '區間算術重疊 (Simple Overlap)', en: 'Simple Overlap' },
      space_gap_exclusion: { zh: '空間間隙排除 (Gap Exclusion)', en: 'Gap Exclusion' },
      edge_boundary_lock: { zh: '邊緣錨定遞推 (Edge Logic)', en: 'Edge Boundary Lock' },
      cross_intersection_induction: { zh: '正交交叉歸納 (Cross Induction)', en: 'Cross Induction' },
      two_dimensional_flood_contradiction: { zh: '雙向因果反證 (Contradiction)', en: 'Bidirectional Contradiction' },
    };
    return isEn ? dict[tech]?.en || tech : dict[tech]?.zh || tech;
  }, [spec?.highestTechnique, isEn]);

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className={`flex flex-col items-center justify-center p-4 select-none outline-none touch-none transition-colors duration-200 w-full max-w-[440px] mx-auto ${
        isDarkMode ? 'bg-stone-900 text-stone-200' : 'bg-[#f7f5f0] text-stone-800'
      }`}
    >
      {/* 頂部導航列與狀態指示 */}
      <div className="w-full max-w-[420px] mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="font-serif font-bold tracking-wide text-base">
            {isEn ? spec.themeTitleEn || 'Nonogram' : spec.themeTitleZh || '數織'}
          </span>
          <button
            onClick={handleToggleFavorite}
            className={`px-1.5 py-0.5 rounded border transition cursor-pointer text-xs ${
              isFav ? 'border-amber-500 text-amber-300 bg-amber-950' : 'border-stone-700 text-stone-500'
            }`}
            title={isFav ? (isEn ? 'In Vault' : '已在傳奇庫') : (isEn ? 'Save to Vault' : '收藏')}
          >
            {isFav ? '★' : '☆'}
          </button>
          <span className="text-xs opacity-40 font-mono">
            {rows}&times;{cols}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <button
            onClick={togglePause}
            className={`px-2 py-0.5 rounded transition font-medium border cursor-pointer ${
              isPaused
                ? 'bg-amber-500 text-black border-amber-400 font-bold'
                : 'opacity-60 hover:opacity-100 border-stone-700'
            }`}
            title={isEn ? 'Pause Training (P)' : '暫停訓練 (P)'}
          >
            {isPaused ? (isEn ? 'PAUSED' : '已暫停') : '⏸'}
          </button>

          {/* 計時子組件 */}
          <button
            onClick={toggleTimerVisibility}
            className={`px-2 py-0.5 rounded transition font-medium cursor-pointer ${
              showTimer ? 'opacity-90 bg-stone-800' : 'opacity-40 hover:opacity-80'
            }`}
            title={isEn ? 'Toggle Timer Display' : '切換計時顯示'}
          >
            ⏱{' '}
            <TimerDisplay
              getElapsedMs={timer.getElapsedMs}
              showTimer={showTimer}
              isPaused={isPaused}
              isCompleted={isCompleted}
              isEn={isEn}
            />
          </button>

          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="opacity-50 hover:opacity-100 transition px-1 cursor-pointer"
            title={isEn ? 'Toggle Theme' : '切換主題'}
          >
            {isDarkMode ? '☼' : '☽'}
          </button>
        </div>
      </div>

      {/* 訓練進度與雙擊重置確認提示條 */}
      <div className="w-full max-w-[420px] mb-3 flex items-center justify-between px-1 text-[9px] font-mono">
        <div className="opacity-50 flex items-center gap-2">
          <span>
            {isEn ? 'Filled' : '進度'}: {currentFilledCount}/{totalExpectedFilled}
          </span>
          <span>
            {isEn ? 'Remaining' : '未決'}: {unresolvedCount}
          </span>
        </div>

        {isResetPending && (
          <span className="text-amber-500 font-bold animate-pulse">
            {isEn ? 'Press R again to Reset' : '再按一次 R 確認重設'}
          </span>
        )}
      </div>

      {/* 棋盤主體 */}
      <div
        className={`relative p-3 rounded-lg border shadow-sm transition-colors duration-200 ${
          isDarkMode ? 'bg-stone-950 border-stone-800' : 'bg-white border-stone-300'
        }`}
      >
        {/* 全屏磨砂防偷看暫停遮罩 */}
        {isPaused && (
          <div className="absolute inset-0 z-50 backdrop-blur-md bg-stone-950/70 rounded-lg flex flex-col items-center justify-center text-center p-4">
            <div className="text-sm font-serif font-bold tracking-widest text-stone-200 mb-1">
              {isEn ? 'TRAINING PAUSED' : '訓練暫停中'}
            </div>
            <div className="text-[10px] font-mono opacity-50 mb-3">
              {isEn ? 'Board masked to prevent lookahead' : '盤面已遮蔽，防止視線推演'}
            </div>
            <button
              onClick={togglePause}
              className="px-4 py-1.5 bg-amber-500 text-stone-950 font-bold text-xs rounded shadow transition hover:bg-amber-400 cursor-pointer"
            >
              {isEn ? 'Resume (P)' : '繼續挑戰 (P)'}
            </button>
          </div>
        )}

        {/* 上方列線索 */}
        <div className="flex" style={{ marginLeft: maxRowClueLength * 16 + 8 }}>
          {colClues.map((clueArr, c) => {
            const stat = colStats[c];
            const isHighlight = activeHint && activeHint.c === c && hintLevel >= 1;
            const isCursorAligned = selectedCell?.[1] === c || hoverCell?.[1] === c;

            return (
              <div
                key={`col-${c}`}
                onClick={() => {
                  const safeR = Math.min(selectedCell?.[0] ?? 0, rows - 1);
                  setSelectedCell([safeR, c]);
                }}
                onDoubleClick={(e) => handleAutoLockCol(c, e.shiftKey)}
                title={isEn ? 'Double click: Cross empty (Shift: Clear notes)' : '雙擊：空格標叉 (Shift: 同時清除筆記)'}
                className={`flex flex-col justify-end items-center text-[10px] font-mono py-1 transition-colors cursor-pointer relative ${
                  stat.isOverflow
                    ? 'text-red-500 font-bold'
                    : stat.isDone
                    ? 'opacity-30'
                    : isHighlight
                    ? 'text-amber-500 font-bold'
                    : isCursorAligned
                    ? 'font-bold text-stone-100'
                    : 'opacity-70'
                }`}
                style={{ width: cellSize, minHeight: maxColClueLength * 14 }}
              >
                {isCursorAligned && !stat.isDone && (
                  <span className="absolute -top-3 text-[7px] opacity-40 font-mono">
                    {stat.currentFilled}/{stat.expectedFilled}
                  </span>
                )}
                {clueArr.map((clue, idx) => (
                  <span key={idx} className={stat.isDone ? 'line-through' : ''}>
                    {clue}
                  </span>
                ))}
              </div>
            );
          })}
        </div>

        {/* 網格與左側行線索 */}
        <div className="flex">
          <div className="flex flex-col justify-around pr-2">
            {rowClues.map((clueArr, r) => {
              const stat = rowStats[r];
              const isHighlight = activeHint && activeHint.r === r && hintLevel >= 1;
              const isCursorAligned = selectedCell?.[0] === r || hoverCell?.[0] === r;

              return (
                <div
                  key={`row-${r}`}
                  onClick={() => {
                    const safeC = Math.min(selectedCell?.[1] ?? 0, cols - 1);
                    setSelectedCell([r, safeC]);
                  }}
                  onDoubleClick={(e) => handleAutoLockRow(r, e.shiftKey)}
                  title={isEn ? 'Double click: Cross empty (Shift: Clear notes)' : '雙擊：空格標叉 (Shift: 同時清除筆記)'}
                  className={`flex items-center justify-end gap-1 px-1 text-[10px] font-mono transition-colors cursor-pointer relative ${
                    stat.isOverflow
                      ? 'text-red-500 font-bold'
                      : stat.isDone
                      ? 'opacity-30'
                      : isHighlight
                      ? 'text-amber-500 font-bold'
                      : isCursorAligned
                      ? 'font-bold text-stone-100'
                      : 'opacity-70'
                  }`}
                  style={{ height: cellSize }}
                >
                  {isCursorAligned && !stat.isDone && (
                    <span className="absolute -left-5 text-[7px] opacity-40 font-mono">
                      {stat.currentFilled}/{stat.expectedFilled}
                    </span>
                  )}
                  {clueArr.map((clue, idx) => (
                    <span key={idx} className={stat.isDone ? 'line-through' : ''}>
                      {clue}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>

          {/* 核心網格矩陣 */}
          <div
            className={`grid gap-[1px] p-[1px] rounded border ${
              isDarkMode ? 'bg-stone-800 border-stone-800' : 'bg-stone-300 border-stone-400'
            }`}
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {grid.map((row, r) =>
              row.map((val, c) => {
                const isSelected = selectedCell?.[0] === r && selectedCell?.[1] === c;
                const isHintTarget = activeHint?.r === r && activeHint?.c === c && hintLevel >= 4;

                const borderBottom =
                  (r + 1) % 5 === 0 && r !== rows - 1
                    ? isDarkMode
                      ? 'border-b border-b-stone-600'
                      : 'border-b border-b-stone-400'
                    : '';
                const borderRight =
                  (c + 1) % 5 === 0 && c !== cols - 1
                    ? isDarkMode
                      ? 'border-r border-r-stone-600'
                      : 'border-r border-r-stone-400'
                    : '';

                let bgStyle = isDarkMode ? 'bg-stone-900' : 'bg-white';
                if (val === 1) {
                  bgStyle = isDarkMode ? 'bg-stone-200 text-stone-900' : 'bg-stone-900 text-white';
                } else if (val === 2) {
                  bgStyle = isDarkMode ? 'bg-stone-900 text-stone-500' : 'bg-white text-stone-400';
                } else if (val === 3) {
                  bgStyle = isDarkMode ? 'bg-stone-900' : 'bg-white';
                }

                if (isHintTarget) {
                  bgStyle = 'bg-amber-400/30 text-amber-500';
                }

                return (
                  <div
                    key={`${r}-${c}`}
                    ref={isSelected ? selectedCellRef : null}
                    onPointerDown={(e) => handlePointerDown(r, c, e)}
                    onPointerEnter={() => handlePointerEnter(r, c)}
                    className={`flex items-center justify-center font-sans font-medium text-xs cursor-crosshair transition-colors duration-75 select-none ${bgStyle} ${borderBottom} ${borderRight} ${
                      isSelected
                        ? isDarkMode
                          ? 'ring-2 ring-stone-400 z-10'
                          : 'ring-2 ring-stone-600 z-10'
                        : ''
                    }`}
                    style={{ width: cellSize, height: cellSize }}
                  >
                    {val === 2 && '✕'}
                    {val === 3 && (
                      <div
                        className={`w-2 h-2 rounded-full ${
                          isDarkMode ? 'bg-stone-400 opacity-80' : 'bg-stone-500 opacity-70'
                        }`}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 四階引導提示面板 */}
      {hintLevel > 0 && activeHint && (
        <div
          className={`mt-3 p-3 rounded-lg border text-xs max-w-[420px] w-full flex flex-col gap-1.5 ${
            isDarkMode ? 'bg-stone-950 border-amber-500/30 text-stone-300' : 'bg-amber-50/80 border-amber-200 text-stone-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold text-amber-500 uppercase tracking-wider">
              {hintStageLabel}
            </span>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  title={`Stage ${step}`}
                  className={`w-2 h-2 rounded-sm transition-colors ${
                    hintLevel >= step
                      ? 'bg-amber-500'
                      : isDarkMode
                      ? 'bg-stone-800'
                      : 'bg-stone-300'
                  }`}
                />
              ))}
            </div>
          </div>
          <div className="leading-relaxed font-sans text-xs">{hintContent}</div>
        </div>
      )}

      {/* 選手工具列 */}
      <div className="flex items-center justify-between w-full max-w-[420px] mt-3 gap-1.5 text-xs">
        <button
          onClick={() => setActiveInputMode(1)}
          className={`flex-1 py-2 font-medium rounded border transition cursor-pointer ${
            activeInputMode === 1
              ? isDarkMode
                ? 'bg-stone-200 text-stone-900 border-stone-200'
                : 'bg-stone-900 text-white border-stone-900'
              : isDarkMode
              ? 'bg-stone-900 text-stone-400 border-stone-800'
              : 'bg-stone-100 text-stone-500 border-stone-300'
          }`}
          title={isEn ? 'Fill (F / Space)' : '填黑 (F / Space)'}
        >
          {isEn ? 'Fill' : '填黑'}
        </button>

        <button
          onClick={() => setActiveInputMode(2)}
          className={`flex-1 py-2 font-medium rounded border transition cursor-pointer ${
            activeInputMode === 2
              ? isDarkMode
                ? 'bg-stone-200 text-stone-900 border-stone-200'
                : 'bg-stone-900 text-white border-stone-900'
              : isDarkMode
              ? 'bg-stone-900 text-stone-400 border-stone-800'
              : 'bg-stone-100 text-stone-500 border-stone-300'
          }`}
          title={isEn ? 'Cross (X)' : '標叉 (X)'}
        >
          {isEn ? 'Cross' : '標叉'}
        </button>

        <button
          onClick={() => setActiveInputMode(3)}
          className={`flex-1 py-2 font-medium rounded border transition flex items-center justify-center gap-1 cursor-pointer ${
            activeInputMode === 3
              ? isDarkMode
                ? 'bg-stone-200 text-stone-900 border-stone-200'
                : 'bg-stone-900 text-white border-stone-900'
              : isDarkMode
              ? 'bg-stone-900 text-stone-400 border-stone-800'
              : 'bg-stone-100 text-stone-500 border-stone-300'
          }`}
          title={isEn ? 'Draft Note (E / Shift+Click)' : '候選筆記 (E / Shift+點擊)'}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
          {isEn ? 'Note' : '筆記'}
        </button>

        <button
          onClick={handleUndo}
          disabled={historyStack.length === 0 || isPaused}
          className={`px-2.5 py-2 font-medium rounded border transition cursor-pointer ${
            historyStack.length > 0 && !isPaused
              ? isDarkMode
                ? 'border-stone-800 hover:bg-stone-800'
                : 'border-stone-300 hover:bg-stone-100'
              : 'opacity-30 cursor-not-allowed border-transparent'
          }`}
          title={isEn ? 'Undo (Z)' : '復原 (Z)'}
        >
          ↩
        </button>

        <button
          onClick={handleRedo}
          disabled={redoStack.length === 0 || isPaused}
          className={`px-2.5 py-2 font-medium rounded border transition cursor-pointer ${
            redoStack.length > 0 && !isPaused
              ? isDarkMode
                ? 'border-stone-800 hover:bg-stone-800'
                : 'border-stone-300 hover:bg-stone-100'
              : 'opacity-30 cursor-not-allowed border-transparent'
          }`}
          title={isEn ? 'Redo (Y / Shift+Z)' : '重做 (Y / Shift+Z)'}
        >
          ↪
        </button>

        {!tournamentMode && (
          <button
            onClick={handleRequestHint}
            disabled={isPaused}
            className={`px-3 py-2 font-medium rounded border transition cursor-pointer ${
              isDarkMode
                ? 'border-stone-800 hover:bg-stone-800 text-amber-400'
                : 'border-stone-300 hover:bg-stone-100 text-amber-700'
            }`}
            title={isEn ? 'Hint (H)' : '引導 (H)'}
          >
            {isEn ? 'Hint' : '引導'}
          </button>
        )}
      </div>

      {/* 快捷鍵輔助說明 */}
      <div className="w-full max-w-[420px] flex items-center justify-between px-1 mt-2 text-[8px] opacity-40 font-mono">
        <span>F/Space: 填黑</span>
        <span>X: 標叉</span>
        <span>E/Shift: 筆記</span>
        <span>P: 暫停</span>
        <span>R: 重設</span>
      </div>

      {/* 勝利結算畫面 */}
      {isCompleted && (
        <div
          className={`mt-4 p-5 rounded-xl border text-center w-full max-w-[420px] shadow-sm animate-fade-in ${
            isDarkMode ? 'bg-stone-950 border-stone-800' : 'bg-white border-stone-200'
          }`}
        >
          <div className="text-base font-serif font-bold tracking-wider mb-1">
            {isEn ? 'DECODED' : '解碼完成'}
          </div>
          <div className="text-xs opacity-50 mb-3 font-mono">
            {isEn ? 'Solve Time' : '通關耗時'}:{' '}
            {finalElapsedMs !== null ? (finalElapsedMs / 1000).toFixed(2) : (timer.getElapsedMs() / 1000).toFixed(2)}s
          </div>

          <div className="flex flex-col items-center">
            <div
              className={`grid gap-[1px] p-2 rounded ${isDarkMode ? 'bg-stone-900' : 'bg-stone-200'}`}
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` ,
                width: Math.min(240, cols * 16),
              }}
            >
              {solution.map((row, r) =>
                row.map((filled, c) => (
                  <div
                    key={`solved-${r}-${c}`}
                    style={{ aspectRatio: '1/1' }}
                    className={`rounded-[1px] transition-colors ${
                      filled
                        ? isDarkMode
                          ? 'bg-amber-400'
                          : 'bg-stone-900'
                        : isDarkMode
                        ? 'bg-stone-950'
                        : 'bg-stone-50'
                    }`}
                  />
                ))
              )}
            </div>

            <div className="mt-2.5 text-xs font-serif font-medium">
              {isEn ? spec.themeTitleEn : spec.themeTitleZh}
            </div>

            {/* 訓練收據：演算法技術憑證 */}
            <div className="mt-2 text-[10px] font-mono px-2 py-0.5 rounded bg-stone-800/50 text-amber-400 border border-stone-700/50">
              {isEn ? 'Primary Technique' : '核心技巧'}: {techniqueLabel}
            </div>

            <div className="mt-3 pt-2.5 border-t border-stone-800/60 w-full text-[11px] font-sans text-stone-400 leading-relaxed italic mb-3">
              {eurekaInsight}
            </div>

            <button
              onClick={() => setShowSubmitModal(true)}
              className="w-full py-2 bg-neutral-200 hover:bg-white text-black text-xs font-bold rounded-lg cursor-pointer transition shadow"
            >
              📤 {isEn ? 'Submit to Leaderboard' : '提交成績至排行榜'}
            </button>
          </div>
        </div>
      )}

      {/* 賽事提交 Modal */}
      {showSubmitModal && actualPuzzle && (
        <TournamentSubmissionModal
          payload={{
            submissionId: `SUB-${actualPuzzle.id}-${Date.now().toString(36)}`,
            tournamentId: tournamentMode ? 'WPF_NONOGRAM_2026' : 'GLOBAL_NONOGRAM_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'nonogram',
            tier: (actualPuzzle.tier as string) || 'kids',
            timeSpentSec: Math.round(
              (finalElapsedMs !== null ? finalElapsedMs : timer.getElapsedMs()) / 1000
            ),
            conflictsCount: 0,
            infractionScore: proctoringRef.current
              ? calculateInfractionScore(proctoringRef.current.getSnapshot())
              : 0,
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
