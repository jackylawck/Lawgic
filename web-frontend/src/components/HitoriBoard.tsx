// web-frontend/src/components/HitoriBoard.tsx
/**
 * WPC Grand Champion Edition – Hitori Arena UI
 * Certified for World Puzzle Championship Competition:
 *  - Ergonomic Hotkeys: [1/B] Black, [2/W] White, [0/Del] Clear, [P] Pencil Mark
 *  - Tournament Pure-Static Viewport: Zero scale jitter, zero glow lag
 *  - Zero-Decode Level 1 Hint: Instant Technique Icon & Semantic Label
 *  - High-Legibility Pencil Mark in bottom-left corner
 *  - Real-time Total Action Count & APM Tracking
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  HitoriSpec,
  HitoriHintStep,
  WebHitoriGenerator,
  HITORI_SYMBOLIC_SETS,
} from '../engines/hitoriGenerator';
import { VaultManager } from '../utils/vaultStorage';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

type CellState = 0 | 1 | 2; // 0: 未定, 1: 塗黑 (■), 2: 圈白 (•)
type PencilMark = 0 | 1 | 2; // 0: 無筆記, 1: 候選黑 (✕), 2: 候選白 (•)

interface HistorySnapshot {
  state: CellState[][];
  pencilMarks: PencilMark[][];
}

const MAX_HISTORY = 100;

function computeInstantConflicts(board: number[][], state: CellState[][], size: number): Set<string> {
  const set = new Set<string>();
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (state[r][c] === 1) {
        for (const [dr, dc] of dirs) {
          const nr = r + dr;
          const nc = c + dc;
          if (WebHitoriGenerator.inBounds(nr, nc, size) && state[nr][nc] === 1) {
            set.add(`${r},${c}`);
            set.add(`${nr},${nc}`);
          }
        }
      }
    }
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (state[r][c] === 2) {
        const v = board[r]?.[c];
        for (let oc = c + 1; oc < size; oc++) {
          if (state[r][oc] === 2 && board[r]?.[oc] === v) {
            set.add(`${r},${c}`);
            set.add(`${r},${oc}`);
          }
        }
      }
    }
  }

  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size; r++) {
      if (state[r][c] === 2) {
        const v = board[r]?.[c];
        for (let or = r + 1; or < size; or++) {
          if (state[or][c] === 2 && board[or]?.[c] === v) {
            set.add(`${r},${c}`);
            set.add(`${or},${c}`);
          }
        }
      }
    }
  }

  return set;
}

export const HitoriBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as HitoriSpec;
  const size = spec?.size || 4;
  const board = spec?.board || [];
  const solution = spec?.solution || [];
  const cruxCoords = (actualPuzzle?.metrics as any)?.cruxCoordinates || [0, 0];
  const depthProfile = (actualPuzzle?.metrics as any)?.depthProfile || [1, 2, 3, 2, 1];
  const maxDecisionDepth = (actualPuzzle?.metrics as any)?.maxDecisionDepth || spec?.maxDecisionDepth || 2;
  const seed = (actualPuzzle?.metrics as any)?.seed || spec?.seed || 12345;
  const rhythmType = (actualPuzzle?.metrics as any)?.rhythmType || spec?.rhythmType || 'peaked';

  const [displayMode, setDisplayMode] = useState<'numeric' | 'symbolic_dots' | 'symbolic_geo'>('numeric');
  const [pureInferenceMode, setPureInferenceMode] = useState<boolean>(!tournamentMode);

  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CellState[][]>(() =>
    Array.from({ length: size }, () => Array(size).fill(0))
  );
  const [pencilMarks, setPencilMarks] = useState<PencilMark[][]>(() =>
    Array.from({ length: size }, () => Array(size).fill(0))
  );

  const [undoStack, setUndoStack] = useState<HistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);

  const [selectedCell, setSelectedCell] = useState<[number, number]>([0, 0]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isTimeOut, setIsTimeOut] = useState<boolean>(false);

  const [cruxBreakthrough, setCruxBreakthrough] = useState<boolean>(false);
  const [seedCopied, setSeedCopied] = useState<boolean>(false);
  const [badgeCopied, setBadgeCopied] = useState<boolean>(false);
  const [isFav, setIsFav] = useState<boolean>(false);

  const estSteps = actualPuzzle?.metrics?.human_sim_steps || maxDecisionDepth * 3 || 12;

  const [hintsTriggeredCount, setHintsTriggeredCount] = useState<number>(0);
  const [totalActionsCount, setTotalActionsCount] = useState<number>(0); // 動作次數統計 (APM 基礎)
  const timeLimit = actualPuzzle?.metrics?.estimated_time_sec || 150;
  const [remainingSec, setRemainingSec] = useState<number>(timeLimit);
  const [accumulatedMs, setAccumulatedMs] = useState<number>(0);
  const lastActiveTimestamp = useRef<number>(performance.now());
  const isSuspended = useRef<boolean>(false);

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<HitoriHintStep | null>(null);

  const renderValue = useCallback(
    (val: number | string | undefined): string => {
      if (typeof val !== 'number') return '';
      if (displayMode === 'symbolic_dots') return HITORI_SYMBOLIC_SETS.dots[val - 1] || `${val}`;
      if (displayMode === 'symbolic_geo') return HITORI_SYMBOLIC_SETS.geometric[val - 1] || `${val}`;
      return `${val}`;
    },
    [displayMode]
  );

  useEffect(() => {
    setState(Array.from({ length: size }, () => Array(size).fill(0)));
    setPencilMarks(Array.from({ length: size }, () => Array(size).fill(0)));
    setUndoStack([]);
    setRedoStack([]);
    setSelectedCell([0, 0]);
    setIsCompleted(false);
    setIsTimeOut(false);
    setCruxBreakthrough(false);
    setSeedCopied(false);
    setBadgeCopied(false);
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
    setRemainingSec(timeLimit);
    setAccumulatedMs(0);
    setHintsTriggeredCount(0);
    setTotalActionsCount(0);
    lastActiveTimestamp.current = performance.now();
    setHintLevel(0);
    setActiveHint(null);
    setPureInferenceMode(!tournamentMode);

    requestAnimationFrame(() => {
      boardContainerRef.current?.focus();
    });
  }, [actualPuzzle?.id, size, timeLimit, tournamentMode]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) isSuspended.current = true;
      else {
        lastActiveTimestamp.current = performance.now();
        isSuspended.current = false;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (isCompleted || isTimeOut) return;
    const timer = setInterval(() => {
      if (isSuspended.current) return;
      const now = performance.now();
      const delta = now - lastActiveTimestamp.current;
      lastActiveTimestamp.current = now;

      setAccumulatedMs((prev) => {
        const next = prev + delta;
        if (tournamentMode) {
          const spentSec = Math.floor(next / 1000);
          const left = Math.max(0, timeLimit - spentSec);
          setRemainingSec(left);
          if (left === 0) setIsTimeOut(true);
        }
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [isCompleted, isTimeOut, tournamentMode, timeLimit]);

  const visualConflicts = useMemo(() => {
    if (tournamentMode) return new Set<string>();
    return computeInstantConflicts(board, state, size);
  }, [board, state, size, tournamentMode]);

  const visualOverlayData = useMemo(() => {
    if (tournamentMode || !pureInferenceMode) {
      return { duplicateCoords: new Set<string>(), matchedCoords: new Set<string>() };
    }

    const duplicateCoords = new Set<string>();
    const matchedCoords = new Set<string>();
    const [selR, selC] = selectedCell;
    const currentVal = board[selR]?.[selC];

    for (let r = 0; r < size; r++) {
      const counts = new Map<number, number>();
      for (let c = 0; c < size; c++) {
        if (state[r][c] !== 1) {
          const v = board[r][c];
          counts.set(v, (counts.get(v) || 0) + 1);
        }
      }
      for (let c = 0; c < size; c++) {
        if (state[r][c] !== 1 && (counts.get(board[r][c]) || 0) > 1) {
          duplicateCoords.add(`${r},${c}`);
        }
      }
    }

    for (let c = 0; c < size; c++) {
      const counts = new Map<number, number>();
      for (let r = 0; r < size; r++) {
        if (state[r][c] !== 1) {
          const v = board[r][c];
          counts.set(v, (counts.get(v) || 0) + 1);
        }
      }
      for (let r = 0; r < size; r++) {
        if (state[r][c] !== 1 && (counts.get(board[r][c]) || 0) > 1) {
          duplicateCoords.add(`${r},${c}`);
        }
      }
    }

    if (currentVal !== undefined) {
      for (let c = 0; c < size; c++) {
        if (c !== selC && board[selR][c] === currentVal) matchedCoords.add(`${selR},${c}`);
      }
      for (let r = 0; r < size; r++) {
        if (r !== selR && board[r][selC] === currentVal) matchedCoords.add(`${r},${selC}`);
      }
    }

    return { duplicateCoords, matchedCoords };
  }, [tournamentMode, pureInferenceMode, board, state, size, selectedCell]);

  const currentBlackCount = useMemo(() => {
    return state.flat().filter((v) => v === 1).length;
  }, [state]);

  const checkVictory = useCallback(
    (curState: CellState[][]): boolean => {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (curState[r][c] === 0) return false;
        }
      }
      return WebHitoriGenerator.isValidSolution(board, curState, size);
    },
    [board, size]
  );

  const saveHistorySnapshot = useCallback(() => {
    setUndoStack((prev) => [
      ...prev.slice(-MAX_HISTORY + 1),
      {
        state: state.map((r) => [...r]),
        pencilMarks: pencilMarks.map((r) => [...r]),
      },
    ]);
    setRedoStack([]);
  }, [state, pencilMarks]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0 || isCompleted || isTimeOut) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [
      ...prev,
      {
        state: state.map((r) => [...r]),
        pencilMarks: pencilMarks.map((r) => [...r]),
      },
    ]);
    setState(previous.state);
    setPencilMarks(previous.pencilMarks);
    setUndoStack((prev) => prev.slice(0, -1));
    setTotalActionsCount((prev) => prev + 1);
    setHintLevel(0);
    setActiveHint(null);
  }, [undoStack, state, pencilMarks, isCompleted, isTimeOut]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted || isTimeOut) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [
      ...prev,
      {
        state: state.map((r) => [...r]),
        pencilMarks: pencilMarks.map((r) => [...r]),
      },
    ]);
    setState(next.state);
    setPencilMarks(next.pencilMarks);
    setRedoStack((prev) => prev.slice(0, -1));
    setTotalActionsCount((prev) => prev + 1);
    setHintLevel(0);
    setActiveHint(null);
  }, [redoStack, state, pencilMarks, isCompleted, isTimeOut]);

  const toggleCell = useCallback(
    (r: number, c: number, overrideState?: CellState) => {
      if (isCompleted || isTimeOut) return;

      saveHistorySnapshot();
      setTotalActionsCount((prev) => prev + 1);
      setHintLevel(0);
      setActiveHint(null);

      setPencilMarks((prev) => {
        if (prev[r][c] === 0) return prev;
        const nextMarks = prev.map((row) => [...row]);
        nextMarks[r][c] = 0;
        return nextMarks;
      });

      setState((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = overrideState !== undefined ? overrideState : next[r][c] === 0 ? 1 : next[r][c] === 1 ? 2 : 0;

        if (r === cruxCoords[0] && c === cruxCoords[1] && next[r][c] !== 0 && next[r][c] === solution[r]?.[c]) {
          setCruxBreakthrough(true);
          setTimeout(() => setCruxBreakthrough(false), 1500);
        }

        if (checkVictory(next)) {
          setIsCompleted(true);
          const timeSpent = Math.max(1, Math.round(accumulatedMs / 1000));
          const isPure = hintsTriggeredCount === 0;
          const instantConflicts = computeInstantConflicts(board, next, size);

          if (actualPuzzle) {
            recordAttempt({
              puzzleId: actualPuzzle.id,
              engineType: 'hitori',
              tier: (actualPuzzle.tier as TierKey) || 'kids',
              cognitiveLoad: {
                spatial: 0.9,
                numeric: displayMode === 'numeric' ? 0.8 : 0.45,
                workingMemory: pureInferenceMode ? 0.3 : 0.85,
                inhibition: 0.95,
              },
              isSuccess: true,
              timeSpentSec: timeSpent,
              conflictsCount: instantConflicts.size,
              technique: 'NegativeElimination',
              isPureClear: isPure,
            });
          }
        }
        return next;
      });
    },
    [
      isCompleted,
      isTimeOut,
      saveHistorySnapshot,
      checkVictory,
      accumulatedMs,
      hintsTriggeredCount,
      cruxCoords,
      solution,
      actualPuzzle,
      recordAttempt,
      displayMode,
      pureInferenceMode,
      board,
      size,
    ]
  );

  const handleCellRightClick = useCallback(
    (e: React.MouseEvent, r: number, c: number) => {
      e.preventDefault();
      if (isCompleted || isTimeOut) return;

      setSelectedCell([r, c]);

      if (state[r][c] !== 0) {
        toggleCell(r, c, 0);
        return;
      }

      saveHistorySnapshot();
      setTotalActionsCount((prev) => prev + 1);
      setPencilMarks((prev) => {
        const next = prev.map((row) => [...row]);
        const curMark = next[r][c];
        next[r][c] = curMark === 0 ? 2 : curMark === 2 ? 1 : 0;
        return next;
      });
    },
    [isCompleted, isTimeOut, state, toggleCell, saveHistorySnapshot]
  );

  const handleCopySeed = () => {
    if (tournamentMode) return;
    navigator.clipboard.writeText(`HITORI-S${seed}-T${actualPuzzle?.tier || 'kids'}`);
    setSeedCopied(true);
    setTimeout(() => setSeedCopied(false), 2000);
  };

  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const nextFav = VaultManager.toggleFavorite({
      id: actualPuzzle.id,
      engine: 'hitori',
      tier: String(actualPuzzle.tier || 'kids'),
      seed: Number(seed),
      rhythmType: String(rhythmType),
      steps: Number(estSteps),
      timeSpentSec: Math.round(accumulatedMs / 1000),
      date: new Date().toLocaleDateString(),
    });
    setIsFav(nextFav);
  };

  const handleCopyAsciiBadge = () => {
    const cardText = VaultManager.generateAsciiBadge({
      engine: 'hitori',
      tier: String(actualPuzzle?.tier || 'kids'),
      seed: Number(seed),
      steps: Number(estSteps),
      timeSpentSec: Math.round(accumulatedMs / 1000),
      iq: cci.standardIQ,
      rhythm: String(rhythmType),
    });
    navigator.clipboard.writeText(cardText);
    setBadgeCopied(true);
    setTimeout(() => setBadgeCopied(false), 2000);
  };

  const handleRequestHint = useCallback(() => {
    if (isCompleted || isTimeOut || tournamentMode) return;
    const step = WebHitoriGenerator.getNextForcedDeduction(board, state, size);
    if (!step) return;

    if (!activeHint || activeHint.r !== step.r || activeHint.c !== step.c) {
      setActiveHint(step);
      setHintLevel(1);
      setHintsTriggeredCount((prev) => prev + 1);
      setSelectedCell([step.r, step.c]);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, isTimeOut, tournamentMode, board, state, size, activeHint]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isTimeOut) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const [r, c] = selectedCell;

      // 撤銷 (Ctrl+Z) 與 重做 (Ctrl+Y / Ctrl+Shift+Z)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        handleRedo();
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'arrowup':
          e.preventDefault();
          setSelectedCell([Math.max(0, r - 1), c]);
          break;
        case 'arrowdown':
        case 's':
          e.preventDefault();
          setSelectedCell([Math.min(size - 1, r + 1), c]);
          break;
        case 'arrowleft':
        case 'a':
          e.preventDefault();
          setSelectedCell([r, Math.max(0, c - 1)]);
          break;
        case 'arrowright':
        case 'd':
          e.preventDefault();
          setSelectedCell([r, Math.min(size - 1, c + 1)]);
          break;
        // 暗刺 1 修復：B / 1 統一塗黑
        case '1':
        case 'b':
        case 'j':
          e.preventDefault();
          toggleCell(r, c, 1);
          break;
        // 暗刺 1 修復：W / 2 統一圈白（同時保留原有 2/K）
        case '2':
        case 'w':
        case 'k':
          e.preventDefault();
          toggleCell(r, c, 2);
          break;
        case 'p':
          e.preventDefault();
          if (e.shiftKey) {
            saveHistorySnapshot();
            setPencilMarks((prev) => {
              const next = prev.map((row) => [...row]);
              next[r][c] = 0;
              return next;
            });
          } else if (state[r][c] === 0) {
            saveHistorySnapshot();
            setTotalActionsCount((prev) => prev + 1);
            setPencilMarks((prev) => {
              const next = prev.map((row) => [...row]);
              next[r][c] = next[r][c] === 0 ? 2 : next[r][c] === 2 ? 1 : 0;
              return next;
            });
          }
          break;
        case '0':
        case 'backspace':
        case 'delete':
        case ' ':
          e.preventDefault();
          toggleCell(r, c, 0);
          break;
        case 'h':
          e.preventDefault();
          handleRequestHint();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, size, isCompleted, isTimeOut, toggleCell, handleRequestHint, state, handleUndo, handleRedo, saveHistorySnapshot]);

  const cellSize = useMemo(() => {
    return Math.max(32, Math.min(48, Math.floor(288 / size)));
  }, [size]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  // 即時 APM 換算
  const currentApm = useMemo(() => {
    const minutes = Math.max(0.1, accumulatedMs / 60000);
    return Math.round(totalActionsCount / minutes);
  }, [totalActionsCount, accumulatedMs]);

  const RHYTHM_MAP: Record<string, { icon: string; name: string; desc: string }> = {
    peaked: { icon: '⛰️', name: isEn ? 'Peaked' : '高峰型', desc: isEn ? 'Crux centered breakthrough' : 'Crux 居中破局' },
    climbing: { icon: '📈', name: isEn ? 'Climbing' : '漸進型', desc: isEn ? 'Progressive resistance' : '阻力攀升，尾盤決戰' },
    wavy: { icon: '🌊', name: isEn ? 'Wavy' : '波浪型', desc: isEn ? 'Multiple equivalence classes' : '多重等價類交鋒' },
  };
  const curRhythm = RHYTHM_MAP[rhythmType] || RHYTHM_MAP.peaked;

  return (
    <div
      ref={boardContainerRef}
      tabIndex={0}
      className="relative flex flex-col items-center justify-center p-2 select-none font-mono outline-none w-full max-w-[400px] mx-auto"
    >
      {cruxBreakthrough && !tournamentMode && (
        <div className="fixed top-3 z-50 px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-950 font-black text-xs rounded-full shadow-[0_0_20px_rgba(251,191,36,0.8)] animate-bounce flex items-center gap-1.5 border border-white">
          <span>✨</span>
          <span>{isEn ? 'CRUX BREACHED!' : '攻克關鍵邏輯華點！'}</span>
        </div>
      )}

      {/* 頂部操作與節奏指標列 */}
      <div className="w-full flex items-center justify-between gap-1 mb-2 px-1 text-[7.5px]">
        <div className="flex items-center gap-1">
          <button
            onClick={() =>
              setDisplayMode((prev) =>
                prev === 'numeric' ? 'symbolic_dots' : prev === 'symbolic_dots' ? 'symbolic_geo' : 'numeric'
              )
            }
            className="px-2 py-1 bg-slate-900 border border-slate-700 hover:border-cyan-400 rounded text-cyan-300 font-bold cursor-pointer"
          >
            {displayMode === 'numeric' && (isEn ? '🔢 Numeric' : '🔢 數字')}
            {displayMode === 'symbolic_dots' && (isEn ? '⚪ Dots' : '⚪ 點陣')}
            {displayMode === 'symbolic_geo' && (isEn ? '▲ Shapes' : '▲ 圖形')}
          </button>

          {!tournamentMode ? (
            <button
              onClick={() => setPureInferenceMode((prev) => !prev)}
              className={`px-2 py-1 rounded border font-bold transition cursor-pointer ${
                pureInferenceMode
                  ? 'bg-purple-950 border-purple-500 text-purple-300 shadow-[0_0_8px_rgba(168,85,247,0.4)]'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}
            >
              🧠 {isEn ? 'Overlay' : '視覺疊加'}: {pureInferenceMode ? (isEn ? 'ON' : '開啟') : (isEn ? 'OFF' : '關閉')}
            </button>
          ) : (
            <span className="px-2 py-1 bg-rose-950/80 border border-rose-600 rounded text-rose-300 font-black tracking-wider">
              🏆 {isEn ? 'STRICT RACE' : '錦標賽無輔助'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-slate-400 font-semibold">
          <span className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-amber-300 font-bold" title={curRhythm.desc}>
            {curRhythm.icon} {curRhythm.name}
          </span>
          <button
            onClick={handleToggleFavorite}
            className={`px-1.5 py-0.5 rounded border transition font-bold cursor-pointer ${
              isFav ? 'bg-amber-950 border-amber-500 text-amber-300' : 'bg-slate-900 border-slate-700 text-slate-500 hover:text-slate-300'
            }`}
            title={isFav ? (isEn ? 'In Vault' : '已在傳奇庫') : (isEn ? 'Save to Vault' : '收藏到傳奇庫')}
          >
            {isFav ? '★' : '☆'}
          </button>
        </div>
      </div>

      {/* 狀態看板（含動作計數與 APM） */}
      <div className="w-full grid grid-cols-3 gap-1 mb-2 text-[8px]">
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{tournamentMode ? (isEn ? 'Countdown' : '倒數') : (isEn ? 'Time' : '耗時')}</div>
          <div className={`font-bold ${tournamentMode && remainingSec <= 30 ? 'text-rose-400 animate-pulse' : 'text-slate-200'}`}>
            {tournamentMode ? `${remainingSec}s` : `${(accumulatedMs / 1000).toFixed(1)}s`}
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? 'Blacks Shaded' : '已塗黑格數'}</div>
          <div className="font-bold text-amber-300 font-mono text-[9px]">
            {currentBlackCount}
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? 'Actions (APM)' : '動作 (APM)'}</div>
          <div className="font-mono font-bold text-cyan-300 text-[9px]">
            {totalActionsCount} <span className="text-[7px] text-slate-500">({currentApm})</span>
          </div>
        </div>
      </div>

      {/* 棋盤主體 */}
      <div className="p-2.5 sm:p-3 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl flex flex-col items-center">
        <div
          className="grid gap-[3px] p-[2px] rounded border border-slate-800 bg-slate-900/60"
          style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
        >
          {state.map((row, r) =>
            row.map((val, c) => {
              const num = board[r]?.[c];
              const cellKey = `${r},${c}`;
              const isSelected = selectedCell[0] === r && selectedCell[1] === c;
              const isConflict = visualConflicts.has(cellKey);
              const isHintTarget = activeHint?.r === r && activeHint?.c === c && hintLevel === 3;
              const isCruxCell = r === cruxCoords[0] && c === cruxCoords[1];

              const isDuplicate = visualOverlayData.duplicateCoords.has(cellKey);
              const isMatchedInRowCol = visualOverlayData.matchedCoords.has(cellKey);
              const pencil = pencilMarks[r][c];

              let bgClass = 'bg-slate-950 text-slate-200 hover:bg-slate-900 border border-slate-800';
              if (val === 1) bgClass = 'bg-slate-800 text-slate-500 font-black shadow-inner border border-slate-700';
              if (val === 2) bgClass = 'bg-slate-950 text-cyan-300 font-extrabold ring-2 ring-cyan-500/70 shadow-[0_0_8px_rgba(34,211,238,0.4)] border border-cyan-400';

              if (isConflict) bgClass += ' ring-2 ring-rose-500 bg-rose-950/50 text-rose-300';
              if (isHintTarget) bgClass += ' ring-2 ring-amber-400 bg-amber-500/30 animate-pulse';
              if (isMatchedInRowCol && val === 0) bgClass += ' ring-1 ring-purple-500/50 bg-purple-950/20';

              // 暗刺 2 修復：錦標賽模式下完全靜態，移除 scale 與 shadow 抖動
              const selectRingClass = tournamentMode
                ? 'border-2 border-cyan-400 z-10'
                : 'ring-2 ring-cyan-400 z-10 scale-[1.04] shadow-[0_0_8px_rgba(34,211,238,0.8)] transition';

              return (
                <div
                  key={`${r}-${c}`}
                  onClick={() => { setSelectedCell([r, c]); toggleCell(r, c); }}
                  onContextMenu={(e) => handleCellRightClick(e, r, c)}
                  className={`relative flex items-center justify-center font-bold cursor-pointer rounded select-none ${bgClass} ${
                    isSelected ? selectRingClass : ''
                  }`}
                  style={{ width: cellSize, height: cellSize }}
                >
                  <span
                    className={`relative leading-none text-base sm:text-lg ${
                      val === 1 ? 'line-through opacity-50 text-xs sm:text-sm' : ''
                    } ${
                      isDuplicate && val === 0 ? 'underline decoration-wavy decoration-rose-500/80 underline-offset-4' : ''
                    }`}
                  >
                    {renderValue(num)}
                  </span>

                  {/* 鉛筆標記移至左下角，防遮擋 */}
                  {val === 0 && pencil !== 0 && (
                    <span className="absolute bottom-0.5 left-1 text-[9px] font-mono leading-none pointer-events-none opacity-80">
                      {pencil === 2 ? (
                        <span className="text-cyan-400 font-black">•</span>
                      ) : (
                        <span className="text-rose-400 font-black">✕</span>
                      )}
                    </span>
                  )}

                  {isCruxCell && !tournamentMode && (
                    <div className="absolute inset-0 ring-2 ring-amber-400/70 animate-pulse rounded pointer-events-none" />
                  )}
                  {isCruxCell && cruxBreakthrough && !tournamentMode && (
                    <div className="absolute inset-0 ring-4 ring-yellow-300 animate-ping rounded pointer-events-none" />
                  )}
                  {isCruxCell && val === 0 && !tournamentMode && (
                    <span className="absolute -top-1 -right-1 text-[7px] text-amber-400 font-black">
                      ★
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 快捷鍵指南：清晰標示 [1/B] 與 [2/W] */}
      <div className="w-full max-w-[340px] flex items-center justify-between px-1 mt-1.5 text-[7px] text-slate-500 font-mono">
        <span>{isEn ? '[1/B] Black | [2/W] White' : '[1/B] 塗黑 | [2/W] 圈白'}</span>
        <span>{isEn ? 'R-Click/P: Pencil | [0]: Clear' : '右鍵/P: 筆記 | [0]: 清除'}</span>
        <span>{isEn ? 'Ctrl+Z: Undo' : 'Ctrl+Z: 撤銷'}</span>
      </div>

      {/* 暗刺 3 修復：提示階梯 Level 1 直出技術圖標與定式名稱 */}
      {!tournamentMode && (
        <>
          {hintLevel > 0 && activeHint && (
            <div className="mt-2 p-2 rounded-xl text-center w-full max-w-[340px] font-mono border bg-slate-900/90 border-amber-500/60 text-slate-200 text-[8px]">
              <div className="text-[7.5px] font-bold text-amber-300 mb-0.5">
                🔮 {isEn ? 'NEGATIVE ELIMINATION INFERENCE' : '反向排除・因果推導'}
              </div>
              <div>
                {hintLevel === 1 && (
                  <div className="flex items-center justify-center gap-1 text-[9px] font-bold text-amber-400">
                    <span>{activeHint.techniqueIcon}</span>
                    <span>[{isEn ? activeHint.techniqueName.en : activeHint.techniqueName.zh}]</span>
                    <span className="text-slate-400 text-[7.5px]">
                      @ [{activeHint.r + 1}, {activeHint.c + 1}]
                    </span>
                  </div>
                )}
                {hintLevel === 2 && (
                  <span className="text-cyan-300 font-bold">
                    ⚡ {isEn ? (activeHint.humanReadable.en || activeHint.rationale) : activeHint.humanReadable.zh}
                  </span>
                )}
                {hintLevel === 3 && (
                  <span className="text-rose-400 font-extrabold">
                    {isEn
                      ? `🎯 Target cell must strictly be ${activeHint.forcedState === 1 ? 'BLACK (■)' : 'WHITE (•)'}!`
                      : `🎯 目標格必然${activeHint.forcedState === 1 ? '塗黑 (■)' : '圈白 (•)'}！`}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between w-full max-w-[340px] mt-2 gap-1.5">
            <button
              onClick={handleRequestHint}
              disabled={isCompleted || isTimeOut}
              className="w-full py-1.5 text-xs font-bold rounded-lg border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition flex items-center justify-center gap-1 shadow disabled:opacity-40 cursor-pointer"
            >
              💡 {isEn ? 'Hint Ladder [H]' : '因果提示階梯 [H]'}
            </button>
          </div>
        </>
      )}

      {/* 結算面板 */}
      {isCompleted && (
        <div className="mt-2.5 p-3 bg-slate-950 border border-emerald-500/80 rounded-xl text-center w-full max-w-[340px] shadow-2xl font-mono animate-fade-in">
          <div className="text-emerald-400 font-bold text-xs mb-0.5 uppercase tracking-wider">
            {isEn ? 'HITORI CLEARED & SANCTIONED!' : 'HITORI 孤島數壹・完美收斂！'}
          </div>

          {depthProfile.length > 0 && (
            <div className="my-2 p-2 bg-slate-900/80 border border-slate-800 rounded-lg text-left">
              <div className="flex items-center justify-between text-[7px] text-slate-400 mb-1">
                <span>🧠 {isEn ? 'Deduction Flow Map' : '推理節奏圖 (Deduction Flow)'}</span>
                <span className="text-emerald-400 font-bold">
                  {isEn ? 'Resilience: 2-Edge-Connected' : '韌性: 2-Edge-Connected'}
                </span>
              </div>
              <svg width="100%" height="22" viewBox="0 0 200 22" className="overflow-visible">
                <polyline
                  fill="none"
                  stroke="#a855f7"
                  strokeWidth="1.5"
                  points={depthProfile
                    .map((val: number, idx: number) => `${idx * 45 + 10},${Math.max(2, 20 - (val / 4) * 16)}`)
                    .join(' ')}
                />
                {depthProfile.map((depth: number, idx: number) => (
                  <circle
                    key={`dot-${idx}`}
                    cx={idx * 45 + 10}
                    cy={Math.max(2, 20 - (depth / 4) * 16)}
                    r={idx === 2 ? '4' : '3'}
                    fill={idx === 2 ? '#f59e0b' : depth >= 3 ? '#60a5fa' : '#64748b'}
                  />
                ))}
              </svg>
              <div className="flex justify-between text-[6px] text-slate-500 mt-1 px-1">
                <span>{isEn ? 'Intro' : '鋪陳'}</span>
                <span>{isEn ? 'Ascent' : '爬坡'}</span>
                <span className="text-amber-400 font-bold">⚡{isEn ? 'Crux' : '關鍵'}</span>
                <span>{isEn ? 'Harvest' : '收割'}</span>
                <span>{isEn ? 'Coda' : '尾聲'}</span>
              </div>
            </div>
          )}

          <div className="text-[8.5px] text-slate-300 mb-1">
            {isEn
              ? `Time: ${(accumulatedMs / 1000).toFixed(2)}s | Actions: ${totalActionsCount} (APM: ${currentApm}) | Gf: IQ ${cci.standardIQ}`
              : `耗時: ${(accumulatedMs / 1000).toFixed(2)}s | 總動作: ${totalActionsCount} (APM: ${currentApm}) | Gf: IQ ${cci.standardIQ}`}
          </div>

          <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between gap-1">
            <button
              onClick={handleToggleFavorite}
              className={`px-2 py-1 rounded border text-[8px] font-bold transition flex items-center gap-1 cursor-pointer ${
                isFav
                  ? 'bg-amber-500 text-slate-950 border-amber-300'
                  : 'bg-slate-900 border-slate-700 text-amber-300 hover:bg-slate-800'
              }`}
            >
              <span>{isFav ? '★' : '☆'}</span>
              <span>
                {isFav
                  ? isEn ? 'In Vault' : '已在傳奇庫'
                  : isEn ? 'Star Vault' : '收藏高光題'}
              </span>
            </button>

            <button
              onClick={handleCopyAsciiBadge}
              className="px-2 py-1 rounded border border-slate-700 hover:border-cyan-400 bg-slate-900 text-cyan-300 text-[8px] font-mono transition flex items-center gap-1 cursor-pointer"
              title={isEn ? 'Copy Discord / social ASCII badge' : '複製 Discord/社群純文字戰績卡'}
            >
              <span>📜</span>
              <span>{badgeCopied ? (isEn ? 'Copied!' : '已複製!') : (isEn ? 'Badge' : '榮譽卡')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
