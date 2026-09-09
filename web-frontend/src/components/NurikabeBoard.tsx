import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';
import { getEnvironmentFingerprint, calculateInfractionScore } from '../utils/tournamentSecurity';
import {
  NurikabeAxiomaticEngine,
  NurikabeCellState,
  NurikabeHintStep,
} from '../engines/nurikabeGenerator';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

interface TimelineFrame {
  board: NurikabeCellState[][];
  hasViolation: boolean;
  isHypothesis: boolean;
  timestamp: number;
}

const MAX_HISTORY = 400;

export const NurikabeBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { recordAttempt, profile, getCompositeCognitiveIndex } = useLearnerProfile();
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  if (!actualPuzzle) {
    return (
      <div className="flex items-center justify-center p-8 font-mono text-xs text-neutral-500">
        {isEn ? 'INITIALIZING NEURAL HUD...' : '載入神經儀表板...'}
      </div>
    );
  }

  const spec = (actualPuzzle as any)?.puzzle;
  const rows = spec?.rows || 6;
  const cols = spec?.cols || 6;
  const grid = useMemo(() => (spec?.grid || []) as (number | null)[][], [spec]);
  const currentTier = (actualPuzzle.tier as TierKey) || 'kids';

  const [board, setBoard] = useState<NurikabeCellState[][]>(() =>
    Array.from({ length: rows }, () => Array(cols).fill(0))
  );

  const [timeline, setTimeline] = useState<TimelineFrame[]>(() => [
    {
      board: Array.from({ length: rows }, () => Array(cols).fill(0)),
      hasViolation: false,
      isHypothesis: false,
      timestamp: Date.now(),
    },
  ]);
  const [timelineIndex, setTimelineIndex] = useState<number>(0);

  const [noGuessMode, setNoGuessMode] = useState<boolean>(false);
  const [isHypothesisMode, setIsHypothesisMode] = useState<boolean>(false);
  const [highContrast, setHighContrast] = useState<boolean>(true);
  const [hudWarning, setHudWarning] = useState<string | null>(null);

  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<1 | 2 | 4>(2);
  const [replayStepIndex, setReplayStepIndex] = useState<number>(0);
  const [replayStepsList, setReplayStepsList] = useState<NurikabeHintStep[]>([]);
  const [userStateBackup, setUserStateBackup] = useState<NurikabeCellState[][] | null>(null);

  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);

  // 雙軌計時器
  const startTimeRef = useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [activeContemplationMs, setActiveContemplationMs] = useState<number>(0);
  const movesCountRef = useRef<number>(0);
  const lifetimeViolationsRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  useEffect(() => {
    const blank = Array.from({ length: rows }, () => Array(cols).fill(0));
    setBoard(blank);
    setTimeline([
      { board: blank, hasViolation: false, isHypothesis: false, timestamp: Date.now() },
    ]);
    setTimelineIndex(0);
    setIsCompleted(false);
    setIsReplaying(false);
    setUserStateBackup(null);
    setHudWarning(null);
    setIsHypothesisMode(false);
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    setActiveContemplationMs(0);
    movesCountRef.current = 0;
    lifetimeViolationsRef.current = 0;
    hasRecordedRef.current = false;
  }, [actualPuzzle.id, rows, cols]);

  // HUD 異常偵測
  const hudTopologyAnalysis = useMemo(() => {
    const pools = new Set<string>();
    const overflowingCells = new Set<string>();
    const strandedSeaCells = new Set<string>();

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (
          board[r][c] === 1 &&
          board[r + 1][c] === 1 &&
          board[r][c + 1] === 1 &&
          board[r + 1][c + 1] === 1
        ) {
          pools.add(`${r},${c}`);
          pools.add(`${r + 1},${c}`);
          pools.add(`${r},${c + 1}`);
          pools.add(`${r + 1},${c + 1}`);
        }
      }
    }

    const visitedWhite = new Uint8Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (board[r][c] === 2 && !visitedWhite[idx]) {
          const comp: [number, number][] = [];
          const queue: [number, number][] = [[r, c]];
          visitedWhite[idx] = 1;
          let clue: number | null = null;
          let clueCount = 0;

          while (queue.length > 0) {
            const [cr, cc] = queue.shift()!;
            comp.push([cr, cc]);
            if (grid[cr][cc] !== null) {
              clue = grid[cr][cc];
              clueCount++;
            }
            for (const [nr, nc] of NurikabeAxiomaticEngine.getOrthogonalNeighbors(cr, cc, rows, cols)) {
              const nIdx = nr * cols + nc;
              if (board[nr][nc] === 2 && !visitedWhite[nIdx]) {
                visitedWhite[nIdx] = 1;
                queue.push([nr, nc]);
              }
            }
          }

          if ((clue !== null && comp.length > clue) || clueCount > 1) {
            comp.forEach(([er, ec]) => overflowingCells.add(`${er},${ec}`));
          }
        }
      }
    }

    const seaCells: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) seaCells.push([r, c]);
      }
    }
    if (seaCells.length > 1) {
      const visited = new Set<string>();
      const queue: [number, number][] = [seaCells[0]];
      visited.add(`${seaCells[0][0]},${seaCells[0][1]}`);

      while (queue.length > 0) {
        const [cr, cc] = queue.shift()!;
        for (const [nr, nc] of NurikabeAxiomaticEngine.getOrthogonalNeighbors(cr, cc, rows, cols)) {
          if (board[nr][nc] !== 2) {
            const key = `${nr},${nc}`;
            if (!visited.has(key)) {
              visited.add(key);
              queue.push([nr, nc]);
            }
          }
        }
      }
      for (const [sr, sc] of seaCells) {
        if (!visited.has(`${sr},${sc}`)) strandedSeaCells.add(`${sr},${sc}`);
      }
    }

    return {
      pools,
      overflowingCells,
      strandedSeaCells,
      activePoolsCount: pools.size / 4,
      hasViolations: pools.size > 0 || overflowingCells.size > 0 || strandedSeaCells.size > 0,
    };
  }, [board, rows, cols, grid]);

  // 雙軌時鐘
  useEffect(() => {
    if (isCompleted || isReplaying) return;
    let lastTime = performance.now();
    let frameId: number;

    const tick = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;

      setElapsedMs(Date.now() - startTimeRef.current);
      if (!hudTopologyAnalysis.hasViolations) {
        setActiveContemplationMs((prev) => prev + delta);
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isCompleted, isReplaying, hudTopologyAnalysis.hasViolations]);

  const prevViolationsRef = useRef<number>(0);
  useEffect(() => {
    const cur = hudTopologyAnalysis.activePoolsCount +
      (hudTopologyAnalysis.overflowingCells.size > 0 ? 1 : 0) +
      (hudTopologyAnalysis.strandedSeaCells.size > 0 ? 1 : 0);
    if (cur > prevViolationsRef.current) {
      lifetimeViolationsRef.current += cur - prevViolationsRef.current;
    }
    prevViolationsRef.current = cur;
  }, [hudTopologyAnalysis]);

  const mutateCell = useCallback(
    (r: number, c: number, targetState: NurikabeCellState) => {
      if (isCompleted || isReplaying || grid[r]?.[c] !== null) return;
      const currentVal = board[r][c];
      if (currentVal === targetState) return;

      let hypothesisTriggered = false;

      if (noGuessMode && targetState !== 0) {
        const forcedSteps = NurikabeAxiomaticEngine.getAllForcedDeductions(rows, cols, grid, board);

        if (forcedSteps.length > 0) {
          const isForced = forcedSteps.some(
            (s) => s.r === r && s.c === c && s.forcedState === targetState
          );
          if (!isForced) {
            if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
            setHudWarning(
              isEn
                ? `[NO-GUESS] Move not logically forced. ${forcedSteps.length} deduction(s) open.`
                : `【嚴格演繹攔截】非必然步。全盤尚有 ${forcedSteps.length} 處可邏輯鎖定。`
            );
            setTimeout(() => setHudWarning(null), 1800);
            return;
          }
          setIsHypothesisMode(false);
        } else {
          hypothesisTriggered = true;
          setIsHypothesisMode(true);
        }
      }

      movesCountRef.current++;
      const nextBoard = board.map((row) => [...row]);
      nextBoard[r][c] = targetState;

      const trimmed = timeline.slice(0, timelineIndex + 1);
      const newFrame: TimelineFrame = {
        board: nextBoard,
        hasViolation: hudTopologyAnalysis.hasViolations,
        isHypothesis: hypothesisTriggered,
        timestamp: Date.now(),
      };
      const updatedTimeline = [...trimmed.slice(-MAX_HISTORY), newFrame];

      setBoard(nextBoard);
      setTimeline(updatedTimeline);
      setTimelineIndex(updatedTimeline.length - 1);
    },
    [isCompleted, isReplaying, grid, board, noGuessMode, timeline, timelineIndex, hudTopologyAnalysis.hasViolations, rows, cols, isEn]
  );

  const jumpToTimelineStep = (idx: number) => {
    if (isReplaying || idx < 0 || idx >= timeline.length) return;
    setTimelineIndex(idx);
    setBoard(timeline[idx].board.map((row) => [...row]));
  };

  const jumpToViolation = (direction: 'prev' | 'next') => {
    if (isReplaying) return;
    if (direction === 'prev') {
      for (let i = timelineIndex - 1; i >= 0; i--) {
        if (timeline[i].hasViolation) {
          jumpToTimelineStep(i);
          return;
        }
      }
    } else {
      for (let i = timelineIndex + 1; i < timeline.length; i++) {
        if (timeline[i].hasViolation) {
          jumpToTimelineStep(i);
          return;
        }
      }
    }
  };

  const handleCellInteraction = (r: number, c: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (grid[r]?.[c] !== null) return;
    if (e.shiftKey) {
      mutateCell(r, c, board[r][c] === 2 ? 0 : 2);
    } else if (e.ctrlKey || e.metaKey) {
      mutateCell(r, c, board[r][c] === 1 ? 0 : 1);
    } else if (e.button === 2) {
      mutateCell(r, c, board[r][c] === 2 ? 0 : 2);
    } else {
      mutateCell(r, c, board[r][c] === 1 ? 0 : 1);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isCompleted || isReplaying) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) jumpToTimelineStep(timelineIndex + 1);
        else jumpToTimelineStep(timelineIndex - 1);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        jumpToTimelineStep(timelineIndex + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCompleted, isReplaying, timelineIndex, timeline]);

  // 終局判定
  useEffect(() => {
    if (isCompleted || isReplaying || hudTopologyAnalysis.hasViolations) return;
    if (movesCountRef.current === 0) return;

    let totalClues = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== null) totalClues++;
      }
    }

    const effective = board.map((row, r) =>
      row.map((val, c) => (grid[r]?.[c] !== null ? (2 as NurikabeCellState) : val))
    );

    const isSeaValid = !NurikabeAxiomaticEngine.has2x2Sea(rows, cols, effective) &&
      NurikabeAxiomaticEngine.isSeaConnected(rows, cols, effective);
    const isIslandsValid = NurikabeAxiomaticEngine.verifyAllIslands(rows, cols, grid, effective, totalClues);

    if (isSeaValid && isIslandsValid) {
      setIsCompleted(true);
      const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

      if (!hasRecordedRef.current && actualPuzzle) {
        hasRecordedRef.current = true;
        recordAttempt({
          puzzleId: actualPuzzle.id,
          engineType: 'nurikabe',
          tier: currentTier,
          cognitiveLoad: actualPuzzle.cognitiveLoad || {
            spatial: 0.95,
            numeric: 0.3,
            workingMemory: 0.85,
            inhibition: 0.9,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: lifetimeViolationsRef.current,
          technique: 'AxiomaticDualSingularity',
          irtDifficulty: (actualPuzzle.metrics as any)?.irt_logit_difficulty || 2.4,
          isPureClear: lifetimeViolationsRef.current === 0,
        });
      }
    }
  }, [board, grid, hudTopologyAnalysis.hasViolations, isCompleted, isReplaying, actualPuzzle, rows, cols, currentTier, recordAttempt]);

  const handleStartReplay = () => {
    const snapshot = board.map((row) => [...row]);
    setUserStateBackup(snapshot);

    const simBoard = snapshot.map((row) => [...row]);
    const steps: NurikabeHintStep[] = [];

    let safety = 0;
    while (safety++ < rows * cols * 4) {
      const available = NurikabeAxiomaticEngine.getAllForcedDeductions(rows, cols, grid, simBoard);
      if (available.length === 0) break;
      const step = available[0];
      steps.push(step);
      simBoard[step.r][step.c] = step.forcedState;
    }

    setReplayStepsList(steps);
    setReplayStepIndex(0);
    setIsReplaying(true);
    setBoard(snapshot);
  };

  const handleTakeOverReplay = () => {
    setIsReplaying(false);
    const currentFrame = board.map((row) => [...row]);
    setTimeline([
      { board: currentFrame, hasViolation: false, isHypothesis: false, timestamp: Date.now() },
    ]);
    setTimelineIndex(0);
    setUserStateBackup(null);
  };

  const handleRestoreUserBoard = () => {
    if (!userStateBackup) return;
    setIsReplaying(false);
    setBoard(userStateBackup.map((row) => [...row]));
  };

  useEffect(() => {
    if (!isReplaying || replayStepsList.length === 0) return;
    if (replayStepIndex >= replayStepsList.length) return;

    const delay = Math.round(350 / replaySpeed);
    const timer = setTimeout(() => {
      const step = replayStepsList[replayStepIndex];
      setBoard((prev) => {
        const next = prev.map((row) => [...row]);
        next[step.r][step.c] = step.forcedState;
        return next;
      });
      setReplayStepIndex((prev) => prev + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [isReplaying, replayStepIndex, replayStepsList, replaySpeed]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);
  const currentReplayStep = replayStepsList[replayStepIndex - 1];

  const thoughtDensity = elapsedMs > 0
    ? Math.min(1.0, activeContemplationMs / elapsedMs)
    : 1.0;

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono text-neutral-300">
      <div className="w-full max-w-[360px] flex items-center justify-between border-b border-neutral-800 pb-1.5 mb-2 text-[10px]">
        <div className="flex items-center gap-3">
          <span className="text-neutral-400 font-bold tracking-tighter">
            ⏱ {(elapsedMs / 1000).toFixed(1)}s
          </span>
          <span className="text-cyan-400 font-bold" title="Active Contemplation Time (No Violations)">
            🧠 {(activeContemplationMs / 1000).toFixed(1)}s
          </span>
          <span className="text-neutral-500">
            MOV: <strong className="text-neutral-300">{movesCountRef.current}</strong>
          </span>
          <span className={hudTopologyAnalysis.hasViolations ? 'text-rose-500 font-bold' : 'text-neutral-600'}>
            {hudTopologyAnalysis.activePoolsCount > 0
              ? `POOL:${hudTopologyAnalysis.activePoolsCount}`
              : hudTopologyAnalysis.overflowingCells.size > 0
              ? 'OVERFLOW'
              : hudTopologyAnalysis.strandedSeaCells.size > 0
              ? 'STRANDED'
              : 'AXIOM:OK'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[9px]">
          <button
            onClick={() => setNoGuessMode((prev) => !prev)}
            disabled={tournamentMode}
            className={`px-1.5 py-0.5 rounded border transition cursor-pointer ${
              noGuessMode
                ? isHypothesisMode
                  ? 'border-amber-500 bg-amber-950/80 text-amber-300 font-bold'
                  : 'border-neutral-400 bg-neutral-200 text-black font-bold'
                : 'border-neutral-800 text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {noGuessMode ? (isHypothesisMode ? 'HYPOTHESIS' : 'STRICT') : 'FREE'}
          </button>
          <button
            onClick={() => setHighContrast((prev) => !prev)}
            className="px-1.5 py-0.5 rounded border border-neutral-800 text-neutral-500 hover:text-neutral-300 cursor-pointer"
          >
            {highContrast ? 'INK' : 'DARK'}
          </button>
        </div>
      </div>

      {hudWarning && (
        <div className="fixed top-12 z-50 px-3 py-1 bg-neutral-900 border border-amber-500 text-amber-300 text-[10px] rounded shadow-2xl animate-pulse">
          {hudWarning}
        </div>
      )}

      {isReplaying && (
        <div className="w-full max-w-[360px] mb-2 p-1.5 border border-cyan-800/80 bg-neutral-950 rounded text-[9px] text-cyan-400">
          <div className="flex justify-between items-center mb-1">
            <span className="truncate max-w-[180px]">
              [{replayStepIndex}/{replayStepsList.length}] {currentReplayStep?.techniqueName.en || 'Deduction'}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleTakeOverReplay}
                className="px-1.5 py-0.2 bg-emerald-950 border border-emerald-500 text-emerald-300 font-bold rounded hover:bg-emerald-900 cursor-pointer"
              >
                TAKE OVER
              </button>
              <button
                onClick={handleRestoreUserBoard}
                className="text-neutral-500 hover:text-neutral-300 cursor-pointer"
              >
                EXIT
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`relative overflow-hidden p-1.5 rounded-lg border transition-colors ${
          isHypothesisMode
            ? 'border-amber-600/80 shadow-[0_0_15px_rgba(217,119,6,0.2)]'
            : highContrast
            ? 'bg-black border-neutral-700 shadow-2xl'
            : 'bg-neutral-950 border-neutral-900'
        }`}
        style={{ width: 'min(86vw, 40vh)', height: 'min(86vw, 40vh)', touchAction: 'none' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          className="relative w-full h-full"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: rows }).map((_, r) =>
            Array.from({ length: cols }).map((__, c) => {
              const clue = grid[r]?.[c];
              const state = board[r][c];
              const cellKey = `${r},${c}`;
              const isPool = hudTopologyAnalysis.pools.has(cellKey);
              const isOverflow = hudTopologyAnalysis.overflowingCells.has(cellKey);
              const isStranded = hudTopologyAnalysis.strandedSeaCells.has(cellKey);

              let hudBorderClass = 'border-neutral-900';
              let hudEffectClass = '';

              if (isPool) {
                hudBorderClass = 'border-rose-500';
                hudEffectClass = 'shadow-[inset_0_0_8px_rgba(244,63,94,0.7)]';
              } else if (isOverflow) {
                hudBorderClass = 'border-rose-500 border-2';
                hudEffectClass = 'shadow-[inset_0_0_8px_rgba(244,63,94,0.5)]';
              } else if (isStranded) {
                hudBorderClass = 'border-orange-500 border-dashed';
                hudEffectClass = 'shadow-[inset_0_0_6px_rgba(249,115,22,0.4)]';
              } else if (highContrast) {
                hudBorderClass = 'border-neutral-800';
              }

              return (
                <div
                  key={cellKey}
                  onMouseDown={(e) => handleCellInteraction(r, c, e)}
                  className={`relative flex items-center justify-center border select-none cursor-pointer transition-colors duration-75 ${hudBorderClass} ${hudEffectClass} ${
                    clue !== null
                      ? 'bg-neutral-900 text-neutral-100 font-black'
                      : state === 1
                      ? 'bg-black'
                      : state === 2
                      ? 'bg-neutral-950'
                      : 'bg-neutral-950/60 hover:bg-neutral-900/60'
                  }`}
                >
                  {typeof clue === 'number' ? (
                    <span className="text-sm sm:text-base font-black font-mono tracking-tighter text-amber-400">
                      {clue}
                    </span>
                  ) : state === 1 ? (
                    <div className="w-[84%] h-[84%] rounded-xs bg-black border border-neutral-700 shadow-inner flex items-center justify-center">
                      <div className="w-1 h-1 bg-neutral-600 rounded-full" />
                    </div>
                  ) : state === 2 ? (
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="w-full max-w-[360px] flex flex-col gap-1 mt-2.5 px-0.5">
        <div className="flex items-center justify-between text-[8px] text-neutral-500">
          <div className="flex items-center gap-1">
            <span>STEP: {timelineIndex} / {timeline.length - 1}</span>
            <button
              onClick={() => jumpToViolation('prev')}
              className="px-1 py-0.2 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 rounded text-[7px]"
              title="Jump to Previous Violation"
            >
              ⏪ VIOLATION
            </button>
            <button
              onClick={() => jumpToViolation('next')}
              className="px-1 py-0.2 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 rounded text-[7px]"
              title="Jump to Next Violation"
            >
              ⏩ VIOLATION
            </button>
          </div>
          <span>L: Sea | R/Shift: Dot</span>
        </div>

        <div className="relative w-full h-3 flex items-center">
          <div className="absolute inset-x-0 h-1 bg-neutral-800 rounded-lg pointer-events-none" />

          {timeline.length > 1 &&
            timeline.map((f, i) => {
              if (!f.hasViolation && !f.isHypothesis) return null;
              const leftPercent = (i / (timeline.length - 1)) * 100;
              return (
                <div
                  key={i}
                  className={`absolute top-0.5 bottom-0.5 w-[2px] pointer-events-none ${
                    f.hasViolation ? 'bg-rose-500' : 'bg-amber-400'
                  }`}
                  style={{ left: `${leftPercent}%` }}
                />
              );
            })}

          <input
            type="range"
            min={0}
            max={timeline.length - 1}
            value={timelineIndex}
            disabled={isReplaying}
            onChange={(e) => jumpToTimelineStep(parseInt(e.target.value, 10))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
          />
        </div>
      </div>

      {isCompleted && (
        <div className="mt-3 w-full max-w-[360px] p-3 bg-neutral-950 border border-neutral-800 rounded-lg text-left shadow-2xl font-mono animate-fade-in">
          <div className="flex justify-between items-center border-b border-neutral-800 pb-2 mb-2">
            <div>
              <div className="text-[8px] text-neutral-500 uppercase tracking-wider">AXIOMATIC CALIPER RESOLUTION</div>
              <div className="text-xs font-bold text-neutral-200">MANIFOLD PERFECTLY CLOSED</div>
            </div>
            <div className="text-right">
              <div className="text-[8px] text-neutral-500">WALL TIME</div>
              <div className="text-xs font-bold text-amber-400">{(elapsedMs / 1000).toFixed(1)}s</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[9px] text-neutral-400 mb-3">
            <div>
              MOVES: <strong className="text-neutral-200">{movesCountRef.current}</strong>
            </div>
            <div>
              ACTIVE THINKING: <strong className="text-cyan-400">{(activeContemplationMs / 1000).toFixed(1)}s</strong>
            </div>
            <div>
              DENSITY OF THOUGHT: <strong className="text-emerald-400">{(thoughtDensity * 100).toFixed(1)}%</strong>
            </div>
            <div>
              TOPOLOGY ERRORS: <strong className="text-neutral-200">{lifetimeViolationsRef.current}</strong>
            </div>
            <div>
              FLUID IQ: <strong className="text-cyan-400">{cci.standardIQ}</strong>
            </div>
            <div>
              PERCENTILE: <strong className="text-cyan-400">{(100 - cci.percentileRank).toFixed(1)}%</strong>
            </div>
          </div>

          <div className="flex gap-2 text-[9px]">
            <button
              onClick={handleStartReplay}
              disabled={isReplaying}
              className="flex-1 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 font-bold rounded cursor-pointer"
            >
              AI REPLAY
            </button>
            <button
              onClick={() => setShowSubmitModal(true)}
              className="px-3 py-1 bg-neutral-200 hover:bg-white text-black font-bold rounded cursor-pointer"
            >
              SUBMIT
            </button>
          </div>
        </div>
      )}

      {showSubmitModal && (
        <TournamentSubmissionModal
          payload={{
            submissionId: `SUB-${actualPuzzle.id}-${Date.now().toString(36)}`,
            tournamentId: tournamentMode ? 'WPF_NURIKABE_2026' : 'GLOBAL_TOPOLOGY_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'nurikabe',
            tier: currentTier,
            timeSpentSec: Math.round(elapsedMs / 1000),
            conflictsCount: lifetimeViolationsRef.current,
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
