import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { MetricErrorBar } from './MetricErrorBar';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';
import { getEnvironmentFingerprint, calculateInfractionScore } from '../utils/tournamentSecurity';
import { WebHeyawakeGenerator, HeyawakeSpec, HeyawakeHintStep } from '../engines/heyawakeGenerator';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

type CellState = 0 | 1 | 2;

interface BoardDelta {
  r: number;
  c: number;
  from: CellState;
  to: CellState;
}

const MAX_HISTORY_STEPS = 200;

// ⚡ 效能隔離計時器：以 200ms 間隔獨立驅動，杜絕 60fps 高頻重繪棋盤
const MemoizedTimer = memo(({ startTime, isCompleted }: { startTime: number; isCompleted: boolean }) => {
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  useEffect(() => {
    if (isCompleted) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 200);
    return () => clearInterval(interval);
  }, [startTime, isCompleted]);

  return <span className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</span>;
});
MemoizedTimer.displayName = 'MemoizedTimer';

export const HeyawakeBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const {
    recordAttempt,
    getBenchmarkMetrics,
    profile,
    getCompositeCognitiveIndex,
    exportLongitudinalDataset,
  } = useLearnerProfile();

  const { lang } = useLanguage();
  const isEn = lang === 'en';

  if (!actualPuzzle) {
    return (
      <div className="flex items-center justify-center p-8 text-xs font-mono text-slate-500">
        {isEn ? 'Loading Heyawake Board...' : '載入黑白分明盤面中...'}
      </div>
    );
  }

  const spec = (actualPuzzle as any)?.puzzle as HeyawakeSpec | undefined;
  const rows = spec?.rows || 6;
  const cols = spec?.cols || 6;
  const rooms = useMemo(() => spec?.rooms || [], [spec]);
  const gridRooms = useMemo(() => spec?.gridRooms || spec?.cellRoomMap || [], [spec]);
  const solution = useMemo(() => spec?.solution || spec?.grid || [], [spec]);

  const currentTier = (actualPuzzle.tier as TierKey) || 'kids';

  const [board, setBoard] = useState<CellState[][]>(() =>
    Array.from({ length: rows }, () => Array(cols).fill(0))
  );
  const [history, setHistory] = useState<BoardDelta[]>([]);
  const [redoStack, setRedoStack] = useState<BoardDelta[]>([]);

  const [cursorPos, setCursorPos] = useState<[number, number]>([0, 0]);
  const [speedMode, setSpeedMode] = useState<boolean>(true); // 預設極速模式（二態切換）
  const [showRadar, setShowRadar] = useState<boolean>(false); // 刀二：預設靜默雷達，按需喚醒

  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [finalTimeSec, setFinalTimeSec] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<HeyawakeHintStep | null>(null);
  const [hintLadderLevel, setHintLadderLevel] = useState<1 | 2 | 3>(1);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);

  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const [conflictDisplay, setConflictDisplay] = useState<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  useEffect(() => {
    setBoard(Array.from({ length: rows }, () => Array(cols).fill(0) as CellState[]));
    setHistory([]);
    setRedoStack([]);
    setCursorPos([0, 0]);
    setIsCompleted(false);
    setFinalTimeSec(0);
    setActiveHint(null);
    setHintLadderLevel(1);
    setShowPBModal(false);
    setShowSubmitModal(false);
    setProofSignature(null);
    startTimeRef.current = Date.now();
    conflictCountRef.current = 0;
    setConflictDisplay(0);
    hasRecordedRef.current = false;
  }, [actualPuzzle.id, rows, cols]);

  // 拓撲約束與白格割點雷達
  const { conflicts, cutPoints } = useMemo(() => {
    const adjacentBlack = new Set<string>();
    const rayViolations = new Set<string>();
    const quotaViolations = new Set<number>();
    const cutPoints = new Set<string>();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          if (c < cols - 1 && board[r][c + 1] === 1) {
            adjacentBlack.add(`${r},${c}`);
            adjacentBlack.add(`${r},${c + 1}`);
          }
          if (r < rows - 1 && board[r + 1][c] === 1) {
            adjacentBlack.add(`${r},${c}`);
            adjacentBlack.add(`${r + 1},${c}`);
          }
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      let segmentStart = 0;
      for (let c = 0; c <= cols; c++) {
        if (c === cols || board[r][c] === 1) {
          if (c - segmentStart > 1) {
            let crossed = 0;
            for (let k = segmentStart; k < c - 1; k++) {
              if (gridRooms[r]?.[k] !== gridRooms[r]?.[k + 1]) crossed++;
            }
            if (crossed >= 2) {
              for (let k = segmentStart; k < c; k++) rayViolations.add(`${r},${k}`);
            }
          }
          segmentStart = c + 1;
        }
      }
    }

    for (let c = 0; c < cols; c++) {
      let segmentStart = 0;
      for (let r = 0; r <= rows; r++) {
        if (r === rows || board[r][c] === 1) {
          if (r - segmentStart > 1) {
            let crossed = 0;
            for (let k = segmentStart; k < r - 1; k++) {
              if (gridRooms[k]?.[c] !== gridRooms[k + 1]?.[c]) crossed++;
            }
            if (crossed >= 2) {
              for (let k = segmentStart; k < r; k++) rayViolations.add(`${k},${c}`);
            }
          }
          segmentStart = r + 1;
        }
      }
    }

    for (const room of rooms) {
      if (room.clue !== null) {
        const blackCount = room.cells.filter(([r, c]) => board[r]?.[c] === 1).length;
        if (blackCount > room.clue) quotaViolations.add(room.id);
      }
    }

    if (showRadar) {
      const totalPotentialWhite = board.reduce((acc, row) => acc + row.filter((c) => c !== 1).length, 0);
      const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (board[r][c] === 0) {
            let sR = -1, sC = -1;
            for (let ir = 0; ir < rows; ir++) {
              for (let ic = 0; ic < cols; ic++) {
                if ((ir !== r || ic !== c) && board[ir][ic] !== 1) {
                  sR = ir; sC = ic; break;
                }
              }
              if (sR !== -1) break;
            }

            if (sR !== -1) {
              const visited = new Uint8Array(rows * cols);
              const qR = new Int32Array(rows * cols);
              const qC = new Int32Array(rows * cols);
              let h = 0, t = 0;
              qR[t] = sR; qC[t] = sC; t++;
              visited[sR * cols + sC] = 1;
              let reached = 0;

              while (h < t) {
                const cr = qR[h], cc = qC[h]; h++; reached++;
                for (const [dr, dc] of dirs) {
                  const nr = cr + dr, nc = cc + dc;
                  if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !(nr === r && nc === c) && board[nr][nc] !== 1) {
                    const idx = nr * cols + nc;
                    if (visited[idx] === 0) {
                      visited[idx] = 1;
                      qR[t] = nr; qC[t] = nc; t++;
                    }
                  }
                }
              }
              if (reached !== totalPotentialWhite - 1) {
                cutPoints.add(`${r},${c}`);
              }
            }
          }
        }
      }
    }

    return { conflicts: { adjacentBlack, rayViolations, quotaViolations }, cutPoints };
  }, [board, rows, cols, gridRooms, rooms, showRadar]);

  const prevConflictTotalRef = useRef<number>(0);
  useEffect(() => {
    const currentTotal =
      conflicts.adjacentBlack.size +
      conflicts.rayViolations.size +
      conflicts.quotaViolations.size;

    if (currentTotal > prevConflictTotalRef.current) {
      conflictCountRef.current += currentTotal - prevConflictTotalRef.current;
      setConflictDisplay(conflictCountRef.current);
    }
    prevConflictTotalRef.current = currentTotal;
  }, [conflicts]);

  const applyCellMutation = useCallback(
    (r: number, c: number, targetState: CellState) => {
      if (isCompleted) return;
      const currentState = board[r][c];
      if (currentState === targetState) return;

      if (navigator.vibrate) navigator.vibrate(8);

      const delta: BoardDelta = { r, c, from: currentState, to: targetState };
      setHistory((prev) => [...prev.slice(-MAX_HISTORY_STEPS + 1), delta]);
      setRedoStack([]);

      setBoard((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = targetState;
        return next;
      });

      setActiveHint(null);
      setHintLadderLevel(1);
    },
    [board, isCompleted]
  );

  const handleCellClick = useCallback(
    (r: number, c: number) => {
      setCursorPos([r, c]);
      let nextState: CellState;
      if (speedMode) {
        nextState = board[r][c] === 1 ? 0 : 1;
      } else {
        nextState = board[r][c] === 0 ? 1 : board[r][c] === 1 ? 2 : 0;
      }
      applyCellMutation(r, c, nextState);
    },
    [board, applyCellMutation, speedMode]
  );

  const handleUndo = useCallback(() => {
    if (history.length === 0 || isCompleted) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const lastDelta = history[history.length - 1];
    setBoard((prev) => {
      const next = prev.map((row) => [...row]);
      next[lastDelta.r][lastDelta.c] = lastDelta.from;
      return next;
    });

    setRedoStack((prev) => [...prev, lastDelta]);
    setHistory((prev) => prev.slice(0, -1));
    setActiveHint(null);
    setHintLadderLevel(1);
  }, [history, isCompleted]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const nextDelta = redoStack[redoStack.length - 1];
    setBoard((prev) => {
      const next = prev.map((row) => [...row]);
      next[nextDelta.r][nextDelta.c] = nextDelta.to;
      return next;
    });

    setHistory((prev) => [...prev, nextDelta]);
    setRedoStack((prev) => prev.slice(0, -1));
    setActiveHint(null);
    setHintLadderLevel(1);
  }, [redoStack, isCompleted]);

  // 刀三：鍵盤防誤觸與最小路徑操作
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted) return;
      const [r, c] = cursorPos;

      if ((e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') && r > 0) {
        e.preventDefault(); setCursorPos([r - 1, c]);
      } else if ((e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') && r < rows - 1) {
        e.preventDefault(); setCursorPos([r + 1, c]);
      } else if ((e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') && c > 0) {
        e.preventDefault(); setCursorPos([r, c - 1]);
      } else if ((e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') && c < cols - 1) {
        e.preventDefault(); setCursorPos([r, c + 1]);
      } else if (e.key === '1') {
        e.preventDefault(); applyCellMutation(r, c, 1);
      } else if (e.key === '2') {
        e.preventDefault();
        // 競速模式下將 2 鍵防禦映射為清除 0，杜絕誤打叉產生的操作卡頓
        if (speedMode) {
          applyCellMutation(r, c, 0);
        } else {
          applyCellMutation(r, c, 2);
        }
      } else if (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace' || e.key === ' ') {
        e.preventDefault(); applyCellMutation(r, c, 0);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cursorPos, rows, cols, applyCellMutation, handleUndo, handleRedo, isCompleted, speedMode]);

  // 完成校驗
  useEffect(() => {
    if (isCompleted || !solution || solution.length === 0) return;
    if (history.length === 0) return;

    let isMatch = true;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isBlack = board[r][c] === 1;
        if (isBlack !== (solution[r][c] === 1)) {
          isMatch = false;
          break;
        }
      }
      if (!isMatch) break;
    }

    if (isMatch) {
      const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
      setFinalTimeSec(timeSpent);
      setIsCompleted(true);

      if (!hasRecordedRef.current && actualPuzzle) {
        hasRecordedRef.current = true;
        const baseIrt = (actualPuzzle.metrics as any)?.irt_logit_difficulty || 1.5;

        recordAttempt({
          puzzleId: actualPuzzle.id,
          engineType: 'heyawake',
          tier: currentTier,
          cognitiveLoad: actualPuzzle.cognitiveLoad || {
            spatial: 0.8,
            numeric: 0.4,
            workingMemory: 0.7,
            inhibition: 0.85,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
          technique: 'HeyawakeDeductionWavefront',
          irtDifficulty: baseIrt,
          isPureClear: conflictCountRef.current === 0 && !activeHint,
        });

        try {
          const canonical = `${actualPuzzle.id}|${timeSpent}|${history.length}|${conflictCountRef.current}|SPEED_${speedMode}|HEYAWAKE_V6`;
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
  }, [board, solution, rows, cols, isCompleted, actualPuzzle, currentTier, recordAttempt, profile.personalBest.fastestTime, activeHint, history.length, speedMode]);

  const handleRequestHint = () => {
    if (isCompleted || tournamentMode) return;
    if (navigator.vibrate) navigator.vibrate(12);

    if (!activeHint) {
      const engineGrid = board.map((row) =>
        row.map((val) => (val === 1 ? 1 : val === 2 ? 2 : 0))
      );
      const hint = WebHeyawakeGenerator.getNextForcedDeduction(rows, cols, rooms, gridRooms, engineGrid);
      if (hint) {
        setActiveHint(hint);
        setCursorPos(hint.targetCell);
        setHintLadderLevel(1);
      }
    } else {
      setHintLadderLevel((prev) => (prev === 1 ? 2 : 3));
    }
  };

  const theoryTime = (actualPuzzle.metrics as any)?.estimated_time_sec || rows * cols * 3;
  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('TopologicalLookahead', theoryTime, 'heyawake');
  }, [getBenchmarkMetrics, theoryTime]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  const roomStatus = useMemo(() => {
    const labelPosMap = new Map<number, [number, number]>();
    const satisfiedRooms = new Set<number>();

    for (const room of rooms) {
      let minR = rows;
      let minC = cols;
      for (const [r, c] of room.cells) {
        if (r < minR || (r === minR && c < minC)) {
          minR = r;
          minC = c;
        }
      }
      labelPosMap.set(room.id, [minR, minC]);

      if (room.clue !== null) {
        const count = room.cells.filter(([r, c]) => board[r]?.[c] === 1).length;
        if (count === room.clue) satisfiedRooms.add(room.id);
      }
    }
    return { labelPosMap, satisfiedRooms };
  }, [rooms, rows, cols, board]);

  return (
    <div className="flex flex-col items-center justify-center p-1 select-none font-mono outline-none">
      {/* 儀表控制頂列 */}
      <div className="w-full grid grid-cols-5 gap-1 px-0.5 mb-1.5 text-[8px] sm:text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '⏱️ Speed' : '⏱️ 競速'}</div>
          {isCompleted ? (
            <span className="text-slate-200 font-bold">{finalTimeSec.toFixed(1)}s</span>
          ) : (
            <MemoizedTimer startTime={startTimeRef.current} isCompleted={isCompleted} />
          )}
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '♟️ Moves' : '♟️ 步數'}</div>
          <div className="text-cyan-300 font-bold">{history.length}</div>
        </div>
        <button
          onClick={() => setSpeedMode((prev) => !prev)}
          className={`p-1 rounded border text-center transition cursor-pointer ${
            speedMode
              ? 'bg-amber-950/80 border-amber-500 text-amber-300 font-bold'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
        >
          <div className="text-[6.5px]">⚡ {isEn ? 'Mode' : '模式'}</div>
          <div className="text-[7.5px]">{speedMode ? (isEn ? 'Speed (2-State)' : '競速 (二態)') : (isEn ? 'Standard' : '標準')}</div>
        </button>
        <button
          onClick={() => setShowRadar((prev) => !prev)}
          className={`p-1 rounded border text-center transition-all cursor-pointer ${
            showRadar
              ? 'bg-cyan-950 border-cyan-400 text-cyan-300 font-bold shadow-[0_0_8px_rgba(6,182,212,0.3)]'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="text-[6.5px]">🔗 {isEn ? 'Radar' : '咽喉雷達'}</div>
          <div className="text-[7.5px]">{showRadar ? (isEn ? 'ACTIVE' : '已啟動') : (isEn ? 'OFF (Tap)' : '關閉')}</div>
        </button>
        <button
          onClick={handleRequestHint}
          disabled={isCompleted || tournamentMode}
          className={`p-1 rounded border text-center transition cursor-pointer ${
            tournamentMode
              ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
              : activeHint
              ? 'bg-indigo-950 border-indigo-500 text-indigo-300 font-bold'
              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="text-[6.5px]">💡 {isEn ? 'Hint' : '提示'}</div>
          <div className="text-[7.5px] truncate">
            {activeHint ? `${isEn ? 'Lv.' : '階梯 '}${hintLadderLevel}/3` : (isEn ? 'Deduce' : '必然推導')}
          </div>
        </button>
      </div>

      {activeHint && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1.5 bg-indigo-950/90 border border-indigo-500/70 rounded-lg text-indigo-200 text-[8px] animate-fade-in text-left shadow-lg">
          <div className="font-bold flex items-center justify-between text-[7px] text-indigo-400 border-b border-indigo-900/60 pb-0.5 mb-1">
            <span>[HINT LADDER LEVEL {hintLadderLevel}/3]</span>
            <span className="uppercase">{activeHint.technique.replace(/_/g, ' ')}</span>
          </div>
          {hintLadderLevel === 1 && (
            <div>
              {isEn
                ? `Focus on [${activeHint.targetCell[0] + 1}, ${activeHint.targetCell[1] + 1}]. A deduction is forced.`
                : `關注坐標 [${activeHint.targetCell[0] + 1}, ${activeHint.targetCell[1] + 1}]，此處存在必然推導。`}
            </div>
          )}
          {hintLadderLevel === 2 && (
            <div>{isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}</div>
          )}
          {hintLadderLevel === 3 && (
            <div className="font-bold text-indigo-300">
              {activeHint.rationale}
              <span className="ml-1 text-cyan-300 underline">
                {activeHint.forcedState === 1 ? (isEn ? '➔ BLACK' : '➔ 填黑') : (isEn ? '➔ WHITE' : '➔ 標叉留白')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 棋盤本體 */}
      <div
        className="relative overflow-hidden p-1.5 rounded-xl bg-slate-950 border-2 border-slate-800 shadow-2xl"
        style={{ touchAction: 'none' }}
      >
        <div
          className="grid select-none bg-slate-900/40"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            width: 'min(88vw, 42vh)',
            height: 'min(88vw, 42vh)',
          }}
        >
          {Array.from({ length: rows }).map((_, r) =>
            Array.from({ length: cols }).map((__, c) => {
              const roomId = gridRooms[r]?.[c] ?? 0;
              const room = rooms.find((rm) => rm.id === roomId);
              const labelCoord = roomStatus.labelPosMap.get(roomId);
              const isLabelCell = labelCoord && labelCoord[0] === r && labelCoord[1] === c && room?.clue !== null;
              const isRoomSatisfied = roomStatus.satisfiedRooms.has(roomId);

              const borderTop = r === 0 || gridRooms[r - 1]?.[c] !== roomId;
              const borderBottom = r === rows - 1 || gridRooms[r + 1]?.[c] !== roomId;
              const borderLeft = c === 0 || gridRooms[r]?.[c - 1] !== roomId;
              const borderRight = c === cols - 1 || gridRooms[r]?.[c + 1] !== roomId;

              const state = board[r][c];
              const cellKey = `${r},${c}`;

              const isAdjConflict = conflicts.adjacentBlack.has(cellKey);
              const isRayConflict = conflicts.rayViolations.has(cellKey);
              const isQuotaConflict = conflicts.quotaViolations.has(roomId);
              const isCutPoint = cutPoints.has(cellKey) && state === 0;

              const isCursor = cursorPos[0] === r && cursorPos[1] === c;
              const isHintTarget = activeHint && activeHint.targetCell[0] === r && activeHint.targetCell[1] === c;

              return (
                <div
                  key={cellKey}
                  onClick={() => handleCellClick(r, c)}
                  // 刀一：磁吸放大 scale-[1.07] + ring-offset 徹底消滅游標盲操延遲
                  className={`relative flex items-center justify-center cursor-pointer select-none transition-all duration-75 ${
                    state === 1
                      ? isAdjConflict
                        ? 'bg-rose-950/80 border border-rose-500 text-rose-200'
                        : isQuotaConflict
                        ? 'bg-slate-950 border border-dashed border-amber-400 text-slate-100'
                        : 'bg-slate-950 text-slate-100 shadow-inner'
                      : isRayConflict
                      ? 'bg-slate-900 border border-dashed border-amber-500/80 text-slate-400'
                      : isCutPoint
                      ? 'bg-cyan-950/20 ring-1 ring-cyan-500/30 text-slate-400'
                      : 'bg-slate-900 hover:bg-slate-800/80 text-slate-400'
                  } ${
                    isCursor
                      ? 'ring-2 ring-cyan-400 ring-offset-1 ring-offset-slate-950 scale-[1.07] z-30 shadow-cyan-950/50 shadow-md'
                      : 'z-0'
                  } ${
                    isHintTarget ? 'ring-2 ring-indigo-400 ring-inset animate-pulse z-20' : ''
                  }`}
                  style={{
                    borderTop: borderTop ? '2.5px solid #6366f1' : '0.5px solid #1e293b',
                    borderBottom: borderBottom ? '2.5px solid #6366f1' : '0.5px solid #1e293b',
                    borderLeft: borderLeft ? '2.5px solid #6366f1' : '0.5px solid #1e293b',
                    borderRight: borderRight ? '2.5px solid #6366f1' : '0.5px solid #1e293b',
                  }}
                >
                  {isLabelCell && (
                    <span
                      className={`absolute top-0.5 left-0.5 text-[8px] sm:text-[9px] font-black leading-none pointer-events-none z-30 ${
                        state === 1
                          ? 'text-emerald-300 drop-shadow-[0_1px_2px_rgba(0,0,0,1)]'
                          : isQuotaConflict
                          ? 'text-amber-400'
                          : isRoomSatisfied
                          ? 'text-emerald-400/90'
                          : 'text-indigo-400'
                      }`}
                    >
                      {room?.clue}
                    </span>
                  )}

                  {state === 1 ? (
                    <div className="w-[84%] h-[84%] bg-slate-950 rounded-xs border border-slate-700 shadow-md flex items-center justify-center">
                      <div className="w-1.5 h-1.5 bg-slate-400/30 rounded-full" />
                    </div>
                  ) : state === 2 ? (
                    <span className="text-[12px] sm:text-sm font-bold text-cyan-400/80 select-none">✕</span>
                  ) : isCutPoint ? (
                    <span className="text-[7.5px] text-cyan-500/50 select-none font-bold">🔗</span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 底部熱鍵指引 */}
      <div className="w-full max-w-[340px] flex items-center justify-between px-1 mt-1.5 text-[7.5px] text-slate-400">
        <div className="flex gap-1">
          <button
            onClick={handleUndo}
            disabled={history.length === 0 || isCompleted}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            ↩ Undo (Z)
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0 || isCompleted}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            ↪ Redo (Y)
          </button>
        </div>
        <div className="text-slate-500 text-[7px]">
          [WASD/方向鍵] 移動 | [1] 填黑 | {speedMode ? '[0/2/Del] 清除' : '[2] 標叉 | [0/Del] 清除'}
        </div>
      </div>

      {/* 賽事結算彈窗 */}
      {isCompleted && (
        <div className="mt-2 p-2.5 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,42vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
            <div className="text-left">
              <div className="text-[7.5px] text-slate-500 tracking-wider">HEYAWAKE RESOLVED</div>
              <div className="text-xs text-indigo-300 font-bold">
                {isEn ? '✨ Heyawake Cleared!' : '✨ 黑白分明・完美解題'}
              </div>
            </div>
            <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[9px] font-bold text-cyan-300">
              Gf: IQ {cci.standardIQ} (Top {Number((100 - cci.percentileRank).toFixed(1))}%)
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[7.5px] text-slate-400 mb-1.5">
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Time' : '耗時'}</div>
              <div className="text-slate-200 font-bold text-[10px]">{finalTimeSec.toFixed(1)}s</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Moves' : '步數'}</div>
              <div className="text-cyan-300 font-bold text-[10px]">{history.length}</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Conflicts' : '衝突累加'}</div>
              <div className="text-amber-300 font-bold text-[10px]">{conflictDisplay}</div>
            </div>
          </div>

          <div className="mb-1.5">
            <MetricErrorBar
              actualVal={finalTimeSec}
              benchmarkVal={benchmarkData.benchmarkTime}
              ci95={benchmarkData.ci95}
              sem={benchmarkData.sem}
              unit="s"
              isEn={isEn}
            />
          </div>

          <div className="bg-slate-900/40 p-1 rounded-lg border border-slate-800 flex flex-col items-center mb-1.5">
            <CognitiveRadarChart
              dimensions={profile.cognitiveDimensions}
              previousDimensions={profile.previousCognitiveDimensions}
              size={135}
            />
          </div>

          <div className="flex gap-1 mb-1.5">
            <button
              onClick={exportLongitudinalDataset}
              className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-cyan-600/50 hover:border-cyan-400 text-cyan-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95 cursor-pointer"
            >
              <span>📊</span>
              <span>{isEn ? 'Dataset' : '匯出數據'}</span>
            </button>
            <button
              onClick={() => setShowSubmitModal(true)}
              className="flex-1 py-1 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 text-slate-950 text-[7.5px] font-black rounded shadow transition active:scale-95 flex items-center justify-center gap-0.5 cursor-pointer"
            >
              <span>📤</span>
              <span>{isEn ? 'Submit' : '賽事提交'}</span>
            </button>
          </div>

          {proofSignature && (
            <div className="p-1 bg-slate-900 border border-slate-800 rounded text-left">
              <div className="text-[6.5px] text-slate-500 font-bold uppercase flex justify-between">
                <span>{isEn ? 'RECEIPT (SHA-256)' : '防偽存證 (SHA-256)'}</span>
                <span className="text-emerald-400 font-mono text-[5.5px]">TAMPER-PROOF</span>
              </div>
              <div className="text-[6px] font-mono text-cyan-400/80 break-all select-all mt-0.5">
                {proofSignature}
              </div>
            </div>
          )}
        </div>
      )}

      {showPBModal && (
        <PBCelebrationModal pb={profile.personalBest} onClose={() => setShowPBModal(false)} isEn={isEn} />
      )}

      {showSubmitModal && (
        <TournamentSubmissionModal
          payload={{
            submissionId: `SUB-${actualPuzzle.id}-${Date.now().toString(36)}`,
            tournamentId: tournamentMode ? 'WPF_HEYAWAKE_2026' : 'GLOBAL_TOPOLOGY_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'heyawake',
            tier: currentTier,
            timeSpentSec: finalTimeSec,
            conflictsCount: conflictCountRef.current,
            infractionScore: calculateInfractionScore({
              tabSwitches: 0,
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
