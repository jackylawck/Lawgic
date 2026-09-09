// web-frontend/src/components/LightUpBoard.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  LightUpSpec,
  WebLightUpGenerator,
  LightUpStep,
  ExtendedTierKey,
  DEDUCTION_PRIORITY,
  generateAkariSignature,
} from '../engines/lightupGenerator';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';
import { VaultManager } from '../utils/vaultStorage';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

type CellState = 0 | 1 | 2 | 3; // 0: 空白, 1: 燈泡 (💡), 2: 黑塊, 3: 防護點 (•)
type MobileInputMode = 'light' | 'dot' | 'note';

interface PlayerAction {
  r: number;
  c: number;
  state: CellState;
  timestamp: number;
  isPureDeductionAtTime: boolean;
}

interface BoardSnapshot {
  board: CellState[][];
  pencilNotes: boolean[][];
  playerTrace: PlayerAction[];
  corrections: number;
  totalActions: number;
}

const MAX_HISTORY_LIMIT = 50;

export const LightUpBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const {
    recordAttempt,
    profile,
    getCompositeCognitiveIndex,
    getSpatialCompositeIndex,
    exportLongitudinalDataset,
  } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as LightUpSpec;
  const rows = spec?.rows || 5;
  const cols = spec?.cols || 5;
  const blackBlocks = spec?.blackBlocks || [];
  const tier = (spec?.tier || actualPuzzle?.tier || 'kids') as ExtendedTierKey;

  const [board, setBoard] = useState<CellState[][]>(() => {
    const b: CellState[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const blk of blackBlocks) b[blk.r][blk.c] = 2;
    return b;
  });

  const [pencilNotes, setPencilNotes] = useState<boolean[][]>(() =>
    Array.from({ length: rows }, () => Array(cols).fill(false))
  );

  const [history, setHistory] = useState<BoardSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<BoardSnapshot[]>([]);
  const [playerTrace, setPlayerTrace] = useState<PlayerAction[]>([]);
  const [totalActions, setTotalActions] = useState<number>(0);
  const [corrections, setCorrections] = useState<number>(0);

  const [mobileMode, setMobileMode] = useState<MobileInputMode>('light');

  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [remainingSec, setRemainingSec] = useState<number>(actualPuzzle?.metrics?.estimated_time_sec || 90);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);
  const [isFav, setIsFav] = useState<boolean>(false);
  const [isFocusDarkness, setIsFocusDarkness] = useState<boolean>(false);

  const [activeHintStep, setActiveHintStep] = useState<LightUpStep | null>(null);
  const [hintLevel, setHintLevel] = useState<number>(0);
  const [cellSizeDelta, setCellSizeDelta] = useState<number>(0);

  const startTimeRef = useRef<number>(Date.now());
  const hasRecordedRef = useRef<boolean>(false);
  const totalLifetimeAttemptsRef = useRef<number>(0);

  const timeLimitSec = actualPuzzle?.metrics?.estimated_time_sec || 90;

  useEffect(() => {
    const b: CellState[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const blk of blackBlocks) b[blk.r][blk.c] = 2;
    setBoard(b);
    setPencilNotes(Array.from({ length: rows }, () => Array(cols).fill(false)));
    setHistory([]);
    setRedoStack([]);
    setPlayerTrace([]);
    setIsCompleted(false);
    setElapsedMs(0);
    setRemainingSec(timeLimitSec);
    setTotalActions(0);
    setCorrections(0);
    setProofSignature(null);
    setHintLevel(0);
    setActiveHintStep(null);
    setIsFocusDarkness(false);
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
    startTimeRef.current = Date.now();
    hasRecordedRef.current = false;
    totalLifetimeAttemptsRef.current = 0;
  }, [actualPuzzle?.id, rows, cols, timeLimitSec]);

  useEffect(() => {
    if (isCompleted) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const spent = now - startTimeRef.current;
      setElapsedMs(spent);

      if (tournamentMode) {
        const left = Math.max(0, timeLimitSec - Math.floor(spent / 1000));
        setRemainingSec(left);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted, tournamentMode, timeLimitSec]);

  const lampClashes = useMemo(() => {
    const set = new Set<string>();
    const isBlock = (r: number, c: number) => board[r][c] === 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          const cells = WebLightUpGenerator.getIlluminatedCells(r, c, rows, cols, isBlock);
          for (const [ir, ic] of cells) {
            if (!(ir === r && ic === c) && board[ir][ic] === 1) {
              set.add(`${r},${c}`);
              set.add(`${ir},${ic}`);
            }
          }
        }
      }
    }
    return set;
  }, [board, rows, cols]);

  const litMatrix = useMemo(() => {
    const lit: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
    const isBlock = (r: number, c: number) => board[r][c] === 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          const cells = WebLightUpGenerator.getIlluminatedCells(r, c, rows, cols, isBlock);
          for (const [ir, ic] of cells) lit[ir][ic] = true;
        }
      }
    }
    return lit;
  }, [board, rows, cols]);

  const blockStatusMap = useMemo(() => {
    const map = new Map<string, { current: number; target: number; state: 'under' | 'exact' | 'over' }>();
    const orth = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const blk of blackBlocks) {
      if (blk.clue !== null && blk.clue !== undefined) {
        let count = 0;
        for (const [dr, dc] of orth) {
          const nr = blk.r + dr;
          const nc = blk.c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === 1) count++;
        }
        const state = count === blk.clue ? 'exact' : count < blk.clue ? 'under' : 'over';
        map.set(`${blk.r},${blk.c}`, { current: count, target: blk.clue, state });
      }
    }
    return map;
  }, [board, blackBlocks, rows, cols]);

  const baseCellSize = useMemo(() => {
    const auto = Math.min(320 / Math.max(rows, cols), 44);
    return Math.max(26, Math.min(56, auto + cellSizeDelta));
  }, [rows, cols, cellSizeDelta]);

  const rayLines = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; isClash: boolean }[] = [];
    const isBlock = (r: number, c: number) => board[r][c] === 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          const isClash = lampClashes.has(`${r},${c}`);
          const cx = c * (baseCellSize + 4) + baseCellSize / 2 + 6;
          const cy = r * (baseCellSize + 4) + baseCellSize / 2 + 6;

          let tr = r - 1;
          while (tr >= 0 && !isBlock(tr, c)) tr--;
          lines.push({ x1: cx, y1: cy, x2: cx, y2: (tr + 1) * (baseCellSize + 4) + 6, isClash });

          let br = r + 1;
          while (br < rows && !isBlock(br, c)) br++;
          lines.push({ x1: cx, y1: cy, x2: cx, y2: br * (baseCellSize + 4) + baseCellSize + 6, isClash });

          let lc = c - 1;
          while (lc >= 0 && !isBlock(r, lc)) lc--;
          lines.push({ x1: cx, y1: cy, x2: (lc + 1) * (baseCellSize + 4) + 6, y2: cy, isClash });

          let rc = c + 1;
          while (rc < cols && !isBlock(r, rc)) rc++;
          lines.push({ x1: cx, y1: cy, x2: rc * (baseCellSize + 4) + baseCellSize + 6, y2: cy, isClash });
        }
      }
    }
    return lines;
  }, [board, rows, cols, baseCellSize, lampClashes]);

  const checkVictory = useCallback(
    (curBoard: CellState[][]): boolean => {
      const isBlock = (r: number, c: number) => curBoard[r][c] === 2;
      const orth = [[-1, 0], [1, 0], [0, -1], [0, 1]];

      for (const blk of blackBlocks) {
        if (blk.clue !== null && blk.clue !== undefined) {
          let count = 0;
          for (const [dr, dc] of orth) {
            const nr = blk.r + dr;
            const nc = blk.c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && curBoard[nr][nc] === 1) count++;
          }
          if (count !== blk.clue) return false;
        }
      }

      const lit: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (curBoard[r][c] === 1) {
            const cells = WebLightUpGenerator.getIlluminatedCells(r, c, rows, cols, isBlock);
            for (const [ir, ic] of cells) {
              if (!(ir === r && ic === c) && curBoard[ir][ic] === 1) return false;
              lit[ir][ic] = true;
            }
          }
        }
      }

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (curBoard[r][c] !== 2 && !lit[r][c]) return false;
        }
      }

      return true;
    },
    [rows, cols, blackBlocks]
  );

  const triggerVictory = useCallback(async () => {
    setIsCompleted(true);
    const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

    if (!hasRecordedRef.current && actualPuzzle) {
      hasRecordedRef.current = true;
      const isPure = corrections === 0 && hintLevel === 0;

      recordAttempt({
        puzzleId: actualPuzzle.id,
        engineType: 'lightup',
        tier: (actualPuzzle.tier as TierKey) || 'kids',
        cognitiveLoad: actualPuzzle.cognitiveLoad || {
          spatial: 0.98,
          numeric: 0.45,
          workingMemory: 0.8,
          inhibition: 0.92,
        },
        isSuccess: true,
        timeSpentSec: timeSpent,
        conflictsCount: corrections,
        technique: 'RayCastingIlluminance',
        isPureClear: isPure,
      });

      const signature = await generateAkariSignature(
        `WPC-AKARI-${actualPuzzle.id}-${timeSpent}-${tier.toUpperCase()}`
      );
      setProofSignature(signature);

      if (timeSpent <= profile.personalBest.fastestTime) {
        setShowPBModal(true);
      }
    }
  }, [actualPuzzle, corrections, tier, recordAttempt, profile.personalBest.fastestTime, hintLevel]);

  const pushHistorySnapshot = useCallback(() => {
    setHistory((prev) => {
      const nextSnap: BoardSnapshot = {
        board: board.map((r) => [...r]),
        pencilNotes: pencilNotes.map((r) => [...r]),
        playerTrace: [...playerTrace],
        corrections,
        totalActions,
      };
      const trimmed = prev.length >= MAX_HISTORY_LIMIT ? prev.slice(1) : prev;
      return [...trimmed, nextSnap];
    });
    setRedoStack([]);
  }, [board, pencilNotes, playerTrace, corrections, totalActions]);

  const handleUndo = useCallback(() => {
    if (history.length === 0 || isCompleted) return;
    const previous = history[history.length - 1];

    setRedoStack((prev) => [
      ...prev,
      {
        board: board.map((r) => [...r]),
        pencilNotes: pencilNotes.map((r) => [...r]),
        playerTrace: [...playerTrace],
        corrections,
        totalActions,
      },
    ]);

    setBoard(previous.board);
    setPencilNotes(previous.pencilNotes);
    setPlayerTrace(previous.playerTrace);
    setCorrections(previous.corrections);
    setTotalActions(previous.totalActions);
    setHistory((prev) => prev.slice(0, prev.length - 1));

    if (navigator.vibrate) navigator.vibrate(6);
  }, [history, board, pencilNotes, playerTrace, corrections, totalActions, isCompleted]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted) return;
    const next = redoStack[redoStack.length - 1];

    setHistory((prev) => [
      ...prev,
      {
        board: board.map((r) => [...r]),
        pencilNotes: pencilNotes.map((r) => [...r]),
        playerTrace: [...playerTrace],
        corrections,
        totalActions,
      },
    ]);

    setBoard(next.board);
    setPencilNotes(next.pencilNotes);
    setPlayerTrace(next.playerTrace);
    setCorrections(next.corrections);
    setTotalActions(next.totalActions);
    setRedoStack((prev) => prev.slice(0, prev.length - 1));

    if (navigator.vibrate) navigator.vibrate(6);
  }, [redoStack, board, pencilNotes, playerTrace, corrections, totalActions, isCompleted]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  const applyCellMutation = useCallback(
    (r: number, c: number, targetType: 'light' | 'dot') => {
      if (isCompleted || board[r][c] === 2) return;

      pushHistorySnapshot();
      totalLifetimeAttemptsRef.current += 1;
      setTotalActions((prev) => prev + 1);

      const deductions = WebLightUpGenerator.getStrictDeductions(rows, cols, blackBlocks, board);
      const isPureAtTime = deductions.has(`${r},${c}`);

      setBoard((prev) => {
        const next = prev.map((row) => [...row]);
        const cur = next[r][c];

        let resultingState: CellState = cur;
        if (targetType === 'light') {
          if (cur === 1) {
            resultingState = 0;
            setCorrections((cp) => cp + 1);
          } else {
            resultingState = 1;
          }
        } else if (targetType === 'dot') {
          resultingState = cur === 3 ? 0 : 3;
        }

        next[r][c] = resultingState;

        setPlayerTrace((t) => [
          ...t,
          {
            r,
            c,
            state: resultingState,
            timestamp: Date.now() - startTimeRef.current,
            isPureDeductionAtTime: isPureAtTime,
          },
        ]);

        if (checkVictory(next)) triggerVictory();
        return next;
      });

      if (pencilNotes[r][c]) {
        setPencilNotes((prev) => {
          const next = prev.map((row) => [...row]);
          next[r][c] = false;
          return next;
        });
      }

      if (navigator.vibrate) navigator.vibrate(8);
    },
    [isCompleted, board, pushHistorySnapshot, rows, cols, blackBlocks, pencilNotes, checkVictory, triggerVictory]
  );

  const handleCellClick = (r: number, c: number) => {
    if (mobileMode === 'note') {
      if (board[r][c] === 0) {
        setPencilNotes((prev) => {
          const next = prev.map((row) => [...row]);
          next[r][c] = !next[r][c];
          return next;
        });
        if (navigator.vibrate) navigator.vibrate(4);
      }
      return;
    }
    applyCellMutation(r, c, mobileMode);
  };

  const handleCellContextMenu = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    applyCellMutation(r, c, 'dot');
  };

  const handleRequestHint = useCallback(() => {
    if (isCompleted || tournamentMode) return;

    const deductions = WebLightUpGenerator.getStrictDeductions(rows, cols, blackBlocks, board);
    if (deductions.size === 0) return;

    const candidates = Array.from(deductions.values());

    const recentActions = playerTrace.slice(-3);
    let centroidR = rows / 2;
    let centroidC = cols / 2;

    if (recentActions.length > 0) {
      centroidR = recentActions.reduce((acc, a) => acc + a.r, 0) / recentActions.length;
      centroidC = recentActions.reduce((acc, a) => acc + a.c, 0) / recentActions.length;
    }

    candidates.sort((a, b) => {
      const priorityA = DEDUCTION_PRIORITY[a.type] ?? 0;
      const priorityB = DEDUCTION_PRIORITY[b.type] ?? 0;
      const distA = Math.hypot(a.r - centroidR, a.c - centroidC);
      const distB = Math.hypot(b.r - centroidR, b.c - centroidC);

      const scoreA = priorityA * 10 - distA;
      const scoreB = priorityB * 10 - distB;

      return scoreB - scoreA;
    });

    setActiveHintStep(candidates[0]);
    setHintLevel((prev) => Math.min(3, prev + 1));
  }, [isCompleted, tournamentMode, rows, cols, blackBlocks, board, playerTrace]);

  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const nextFav = VaultManager.toggleFavorite({
      id: actualPuzzle.id,
      engine: 'lightup',
      tier: String(tier),
      seed: 12345,
      steps: totalActions,
      timeSpentSec: Math.round(elapsedMs / 1000),
      date: new Date().toLocaleDateString(),
    });
    setIsFav(nextFav);
  };

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);
  const sci = useMemo(() => getSpatialCompositeIndex(), [getSpatialCompositeIndex, isCompleted]);

  const playerPureRate = useMemo(() => {
    if (playerTrace.length === 0) return 100;
    const pureActions = playerTrace.filter((a) => a.isPureDeductionAtTime).length;
    return Math.round((pureActions / playerTrace.length) * 100);
  }, [playerTrace]);

  const certificationTier = useMemo(() => {
    const lifetimeAttempts = totalLifetimeAttemptsRef.current;
    const unforcedCount = playerTrace.filter((a) => !a.isPureDeductionAtTime).length;
    const hasUsedUndo = lifetimeAttempts > totalActions;

    if (!hasUsedUndo && unforcedCount <= 1 && corrections === 0 && hintLevel === 0) {
      return {
        rank: 'PLATINUM',
        tag: isEn ? 'WPC Grandmaster: Pure Mental Deduction' : 'WPC 特級大師：純腦內無試錯演繹',
        color: 'text-amber-300 border-amber-400 bg-amber-950/70 shadow-[0_0_12px_rgba(251,191,36,0.4)]',
        desc: isEn ? 'Flawless linear solution without physical trial & error.' : '完美線性通關，無任何實體撤回與探索試錯。',
      };
    }

    if (corrections === 0 && unforcedCount <= 3) {
      return {
        rank: 'GOLD',
        tag: isEn ? 'WPC Master: Sandbox Reductio' : 'WPC 大師級：受控沙盤演繹',
        color: 'text-cyan-300 border-cyan-400 bg-cyan-950/70',
        desc: isEn ? 'Zero permanent conflicts with controlled board explorations.' : '零殘留衝突，包含合理的盤面假設與推演收斂。',
      };
    }

    return {
      rank: 'SILVER',
      tag: isEn ? 'WPC Standard Clear' : 'WPC 競技常規通關',
      color: 'text-slate-300 border-slate-600 bg-slate-900',
      desc: isEn ? 'Valid solution verified under tournament rules.' : '符合規則的合法解答完成。',
    };
  }, [playerTrace, corrections, totalActions, hintLevel, isEn]);

  const eleganceIndex = useMemo(() => {
    if (totalActions === 0) return 100;
    return Math.max(0, Math.round(((totalActions - corrections * 1.5) / totalActions) * 100));
  }, [totalActions, corrections]);

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono">
      <div className="w-full grid grid-cols-3 gap-1 mb-1.5 text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">
            {tournamentMode ? (isEn ? '⏱️ Countdown' : '⏱️ 倒數計時') : (isEn ? '⏱️ Speed' : '⏱️ 競速')}
          </div>
          <div className={`font-bold ${tournamentMode && remainingSec <= 20 ? 'text-rose-400 animate-pulse' : 'text-slate-200'}`}>
            {tournamentMode ? `${remainingSec}s` : `${(elapsedMs / 1000).toFixed(1)}s`}
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? '🎯 Elegance' : '🎯 優雅指數'}</div>
          <div className="text-emerald-400 font-bold">{eleganceIndex}%</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? '💡 Illumination' : '💡 光照覆蓋'}</div>
          <div className="text-amber-400 font-bold">
            {Math.round(
              (litMatrix.flat().filter(Boolean).length /
                (rows * cols - blackBlocks.length || 1)) *
                100
            )}%
          </div>
        </div>
      </div>

      <div className="w-full flex items-center justify-between px-1 mb-1.5">
        <div className="flex items-center gap-1.5">
          {tournamentMode ? (
            <span className="px-2 py-0.5 rounded-full bg-amber-950 border border-amber-500 text-amber-300 text-[7.5px] font-extrabold flex items-center gap-1">
              🏆 {isEn ? 'WPC Tournament' : 'WPC 錦標賽'}
            </span>
          ) : (
            <button
              onClick={handleToggleFavorite}
              className={`px-1.5 py-0.5 rounded text-[7.5px] border font-bold cursor-pointer ${
                isFav ? 'bg-amber-950 border-amber-500 text-amber-300' : 'bg-slate-900 border-slate-800 text-slate-500'
              }`}
            >
              {isFav ? (isEn ? '★ Vault' : '★ 收藏') : (isEn ? '☆ Star' : '☆ 標星')}
            </button>
          )}

          {tier === 'ultimate' ? (
            <span className="px-2 py-0.5 rounded-full bg-purple-950 border border-purple-500 text-purple-300 text-[7.5px] font-extrabold">
              ⚡ 10×10
            </span>
          ) : tier === 'legendary' ? (
            <span className="px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-500 text-rose-300 text-[7.5px] font-extrabold">
              👑 9×9
            </span>
          ) : null}

          <button
            onClick={() => setIsFocusDarkness((prev) => !prev)}
            className={`px-1.5 py-0.5 rounded text-[7px] border transition cursor-pointer ${
              isFocusDarkness
                ? 'bg-amber-400 text-slate-950 font-bold border-amber-300 shadow-[0_0_6px_rgba(251,191,36,0.5)]'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            🌑 {isEn ? 'Blindspots' : '盲區凸顯'}
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleUndo}
            disabled={history.length === 0}
            className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-30 text-[8px] cursor-pointer"
            title="Undo (Ctrl+Z)"
          >
            ↩
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-30 text-[8px] cursor-pointer"
            title="Redo (Ctrl+Y)"
          >
            ↪
          </button>
          <div className="w-[1px] h-3 bg-slate-800 mx-0.5" />
          <button
            onClick={() => setCellSizeDelta((d) => Math.max(-10, d - 2))}
            className="w-5 h-5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs flex items-center justify-center cursor-pointer"
          >
            -
          </button>
          <button
            onClick={() => setCellSizeDelta((d) => Math.min(14, d + 2))}
            className="w-5 h-5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs flex items-center justify-center cursor-pointer"
          >
            +
          </button>
        </div>
      </div>

      <div className="relative p-3 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl flex flex-col items-center">
        <div className="relative">
          <svg
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              width: cols * (baseCellSize + 4) + 8,
              height: rows * (baseCellSize + 4) + 8,
            }}
          >
            <defs>
              <linearGradient id="rayGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.15" />
              </linearGradient>
            </defs>
            {rayLines.map((line, idx) => (
              <line
                key={`ray-${idx}`}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke={line.isClash ? '#ef4444' : 'url(#rayGradient)'}
                strokeWidth={line.isClash ? '2' : '2.5'}
                strokeDasharray={line.isClash ? '4 2' : '5 3'}
                strokeOpacity={line.isClash ? 0.9 : 0.8}
              />
            ))}
          </svg>

          <div
            className="grid gap-1 bg-slate-900/90 p-1.5 rounded-lg border border-slate-800"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            }}
          >
            {board.map((row, r) =>
              row.map((cell, c) => {
                const cellKey = `${r},${c}`;
                const isHintTarget = activeHintStep?.r === r && activeHintStep?.c === c;
                const isLit = litMatrix[r][c];
                const isClash = lampClashes.has(cellKey);
                const blockInfo = blackBlocks.find((b) => b.r === r && b.c === c);
                const blockStatus = blockStatusMap.get(cellKey);
                const hasPencilX = pencilNotes[r][c];
                const isSuppressedByDarkFocus = isFocusDarkness && cell === 0 && isLit;

                return (
                  <div
                    key={cellKey}
                    onClick={() => handleCellClick(r, c)}
                    onContextMenu={(e) => handleCellContextMenu(e, r, c)}
                    className={`relative flex items-center justify-center rounded-md font-black select-none transition-colors ${
                      isHintTarget && hintLevel >= 1
                        ? 'bg-amber-500/40 ring-2 ring-amber-400 z-20'
                        : cell === 2
                        ? blockStatus?.state === 'exact'
                          ? 'bg-slate-950 border border-emerald-500/60 text-emerald-400 z-20 cursor-default'
                          : blockStatus?.state === 'over'
                          ? 'bg-slate-950 border border-rose-500 text-rose-400 z-20 cursor-default'
                          : 'bg-slate-950 border border-slate-700 text-slate-200 cursor-default z-20'
                        : isClash
                        ? 'bg-rose-950 border border-rose-500 text-rose-200 z-20 cursor-pointer'
                        : cell === 1
                        ? 'bg-amber-400 text-amber-950 shadow-[0_0_12px_rgba(251,191,36,0.6)] z-20 cursor-pointer'
                        : isSuppressedByDarkFocus
                        ? 'bg-slate-950/30 border border-slate-900/30 opacity-20 cursor-pointer'
                        : isLit
                        ? 'bg-amber-300/15 border border-amber-500/20 cursor-pointer'
                        : 'bg-slate-950 hover:bg-slate-900 border border-slate-800 cursor-pointer'
                    }`}
                    style={{
                      width: baseCellSize,
                      height: baseCellSize,
                      fontSize: baseCellSize < 34 ? '11px' : '14px',
                    }}
                  >
                    {cell === 2 && blockInfo?.clue !== null && blockInfo?.clue !== undefined && (
                      <div className="relative flex items-center justify-center w-full h-full">
                        <span>{blockInfo.clue}</span>
                        {blockStatus?.state === 'under' && (
                          <span className="absolute bottom-0.5 right-1 text-[6.5px] font-mono text-amber-400/90 font-bold">
                            +{blockStatus.target - blockStatus.current}
                          </span>
                        )}
                        {blockStatus?.state === 'exact' && (
                          <span className="absolute top-0.5 right-1 text-[6px] text-emerald-400">✓</span>
                        )}
                      </div>
                    )}

                    {cell === 1 && '💡'}
                    {cell === 3 && <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />}
                    {cell === 0 && hasPencilX && (
                      <span className="text-[10px] text-slate-500 font-bold leading-none select-none">✕</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {!tournamentMode && hintLevel > 0 && activeHintStep && (
        <div className="mt-2.5 p-2 bg-amber-950/70 border border-amber-500/60 rounded-lg text-[8px] text-amber-200 text-center max-w-xs animate-fade-in">
          <div className="font-bold flex items-center justify-center gap-1 mb-0.5">
            <span>💡 {isEn ? 'Spatial Hot-Zone Hint' : '空間熱區感應提示'}</span>
            <span className="text-amber-400">Level {hintLevel}/3</span>
          </div>
          {hintLevel === 1 && (
            <div>
              {isEn
                ? `Focus on Cell (${activeHintStep.r + 1}, ${activeHintStep.c + 1}) within current corridor!`
                : `請注視目前熱區走廊中的座標格 (${activeHintStep.r + 1}, ${activeHintStep.c + 1})！`}
            </div>
          )}
          {hintLevel === 2 && <div>{activeHintStep.humanReadable[isEn ? 'en' : 'zh']}</div>}
          {hintLevel === 3 && (
            <div className="text-amber-300 font-bold">
              {isEn
                ? `Definitive Step: Place ${activeHintStep.state === 1 ? 'Light 💡' : 'Dot •'}!`
                : `定式收斂：此處必然為「${activeHintStep.state === 1 ? '燈泡 💡' : '防護點 •'}」！`}
            </div>
          )}
        </div>
      )}

      <div className="w-full max-w-xs mt-2 px-1 flex flex-col gap-1.5">
        <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 border border-slate-800 rounded-lg">
          <button
            onClick={() => setMobileMode('light')}
            className={`py-1 text-[8px] font-bold rounded transition cursor-pointer flex items-center justify-center gap-1 ${
              mobileMode === 'light'
                ? 'bg-amber-400 text-slate-950 shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            💡 {isEn ? 'Light' : '燈泡'}
          </button>
          <button
            onClick={() => setMobileMode('dot')}
            className={`py-1 text-[8px] font-bold rounded transition cursor-pointer flex items-center justify-center gap-1 ${
              mobileMode === 'dot'
                ? 'bg-slate-200 text-slate-950 shadow-[0_0_8px_rgba(255,255,255,0.4)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            • {isEn ? 'Dot' : '防護點'}
          </button>
          <button
            onClick={() => setMobileMode('note')}
            className={`py-1 text-[8px] font-bold rounded transition cursor-pointer flex items-center justify-center gap-1 ${
              mobileMode === 'note'
                ? 'bg-cyan-400 text-slate-950 shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ✕ {isEn ? 'Note' : '草稿'}
          </button>
        </div>

        <div className="flex items-center justify-between text-[7px] text-slate-500 px-1">
          <span>{isEn ? 'Desktop: L-Click 💡 | R-Click •' : '桌面端：左鍵 💡 | 右鍵 •'}</span>
          {!tournamentMode && (
            <button
              onClick={handleRequestHint}
              className="text-amber-400 hover:text-amber-300 font-bold cursor-pointer"
            >
              💡 {isEn ? 'Request Coach Hint' : '請求教練提示'}
            </button>
          )}
        </div>
      </div>

      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-amber-500/60 rounded-xl text-center w-full max-w-xs shadow-2xl animate-fade-in font-mono">
          <div className="text-amber-300 font-bold text-xs mb-0.5">✨ MUSEUM ILLUMINATED</div>
          <div className="text-[9px] text-slate-400 mb-2">
            {isEn ? 'Time' : '耗時'}: {(elapsedMs / 1000).toFixed(2)}s | Gf: IQ {cci.standardIQ} | {isEn ? 'Spatial Scale' : '空間量尺'}: {sci.standardScore}/19
          </div>

          <div className={`py-1.5 px-2.5 border rounded-lg mb-2 text-left transition-all ${certificationTier.color}`}>
            <div className="flex items-center justify-between font-bold text-[8px] mb-0.5">
              <span>🏆 {certificationTier.tag}</span>
              <span className="text-[7px] opacity-80">{certificationTier.rank}</span>
            </div>
            <div className="text-[6.5px] opacity-90 leading-tight">
              {certificationTier.desc}
            </div>
            <div className="mt-1 pt-1 border-t border-white/10 flex justify-between text-[6px] opacity-75">
              <span>{isEn ? 'Lifetime Actions' : '生涯累計動作'}: {totalLifetimeAttemptsRef.current}</span>
              <span>{isEn ? 'Net Linear Steps' : '最終有效步數'}: {totalActions}</span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-2 rounded-lg mb-2 text-left text-[7px]">
            <div className="text-amber-300 font-bold mb-1 flex justify-between">
              <span>🔬 {isEn ? 'Player Action Audit' : '選手實操演繹審計'}</span>
              <span className="text-cyan-300">{playerPureRate}% {isEn ? 'Pure Logic' : '純演繹率'}</span>
            </div>
            <div className="text-slate-300 space-y-0.5">
              <div>有效推導步數：{totalActions} 步 | 回退/修正次數：{corrections} 次</div>
              <div>解題流暢度：{corrections === 0 ? '✨ 完美零回退推演' : `回退率 ${Math.round((corrections / totalActions) * 100)}%`}</div>
            </div>
          </div>

          <div className="bg-slate-900/90 border border-cyan-800/80 p-2 rounded-lg mb-2 text-left text-[7.5px]">
            <div className="text-cyan-300 font-bold mb-1 flex justify-between">
              <span>🧭 {isEn ? 'Spatial Composite Index' : '空間綜合能力指數 (SCI)'}</span>
              <span className="text-emerald-400">PR {sci.spatialPercentile}%</span>
            </div>
            <div className="grid grid-cols-3 gap-1 text-center py-1 bg-slate-950/80 rounded mb-1 text-[7px]">
              <div>{isEn ? 'Loop Control' : '迴路控制'}: <strong className="text-cyan-300">{sci.eulerianLoopControl}</strong></div>
              <div>{isEn ? 'Partition' : '黑海分割'}: <strong className="text-cyan-300">{sci.planarPartitioning}</strong></div>
              <div>{isEn ? 'Ray Casting' : '射線投射'}: <strong className="text-amber-300">{sci.rayTracingControl}</strong></div>
            </div>
          </div>

          <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800 flex flex-col items-center mb-2">
            <CognitiveRadarChart dimensions={profile.cognitiveDimensions} size={130} />
          </div>

          <button
            onClick={exportLongitudinalDataset}
            className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 border border-cyan-600/50 text-cyan-300 text-[8px] font-bold rounded-lg transition cursor-pointer"
          >
            📊 {isEn ? 'Export Tournament Dossier' : '匯出個人競賽檔案'}
          </button>

          {proofSignature && (
            <div className="mt-2 p-1.5 bg-slate-900 border border-slate-800 rounded text-left">
              <div className="text-[6.5px] font-mono text-cyan-400/80 break-all select-all">
                {isEn ? '🛡️ Sanctioned Signature:' : '🛡️ 賽事抗篡改證書:'} {proofSignature}
              </div>
            </div>
          )}
        </div>
      )}

      {showPBModal && (
        <PBCelebrationModal pb={profile.personalBest} onClose={() => setShowPBModal(false)} isEn={isEn} />
      )}
    </div>
  );
};
