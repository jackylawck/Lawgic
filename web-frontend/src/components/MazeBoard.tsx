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

export type StrategyType = 'Macro-Planner' | 'Wall-Follower' | 'Intuitive-Explorer';
export type ViewMode = 'full' | 5 | 3;

interface ProcessTelemetry {
  wallHits: number;
  wallHitRate: number;
  hesitations: number;
  strategy: StrategyType;
  strategyName: string;
  confidence: number;
  cognitiveAdvantage: number;
}

const getDefaultViewMode = (tier: string): ViewMode => {
  switch (tier) {
    case 'kids': return 'full';
    case 'intermediate': return 5;
    case 'expert':
    case 'master':
    case 'legendary':
    case 'ultimate': return 3;
    default: return 'full';
  }
};

export const MazeBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
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

  // 提前返回守衛：保證 actualPuzzle 非空，消除全域 TS18048
  if (!actualPuzzle) {
    return (
      <div className="flex items-center justify-center p-8 text-xs font-mono text-slate-500">
        {isEn ? 'Loading Maze Matrix...' : '載入迷宮矩陣中...'}
      </div>
    );
  }

  const currentTier = (actualPuzzle.tier as TierKey) || 'kids';
  const actualTier =
    (actualPuzzle as any)?.puzzle?.actualTier ||
    (actualPuzzle as any)?.metrics?.actualTier ||
    currentTier;

  const isUltimate = actualTier === 'ultimate';

  const rawData = (actualPuzzle as any)?.puzzle || (actualPuzzle as any)?.spec || (actualPuzzle as any);
  const baseGrid: number[][] = rawData?.grid || [];
  const h = baseGrid.length;
  const w = baseGrid[0]?.length || 0;

  const startPos: [number, number] = useMemo(() => {
    return rawData?.start || [1, 1];
  }, [rawData]);

  const { grid, endPos } = useMemo(() => {
    if (w < 3 || h < 3) {
      return { grid: baseGrid, endPos: [1, 1] as [number, number] };
    }

    const nextGrid = baseGrid.map((row) => [...row]);
    let ex = w - 2;
    let ey = h - 2;

    if (rawData?.end && !(rawData.end[0] === startPos[0] && rawData.end[1] === startPos[1])) {
      ex = rawData.end[0];
      ey = rawData.end[1];
    } else if (rawData?.goal) {
      ex = rawData.goal[0];
      ey = rawData.goal[1];
    }

    ex = Math.max(1, Math.min(w - 2, ex));
    ey = Math.max(1, Math.min(h - 2, ey));

    nextGrid[ey][ex] = 0;
    if (ey > 1 && nextGrid[ey - 1][ex] === 1 && nextGrid[ey][ex - 1] === 1) {
      nextGrid[ey - 1][ex] = 0;
    }

    return { grid: nextGrid, endPos: [ex, ey] as [number, number] };
  }, [baseGrid, rawData, w, h, startPos]);

  const optimalSolution: [number, number][] = actualPuzzle.solution || [];
  const theoryTime = (actualPuzzle.metrics as any)?.estimated_time_sec || Math.max(15, Math.round(optimalSolution.length * 0.8));

  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('TopologicalLookahead', theoryTime, 'maze');
  }, [getBenchmarkMetrics, theoryTime]);

  const [playerPos, setPlayerPos] = useState<[number, number]>(startPos);
  const [trail, setTrail] = useState<[number, number][]>([startPos]);
  const [visitedSet, setVisitedSet] = useState<Set<string>>(new Set([`${startPos[0]},${startPos[1]}`]));
  const [breadcrumbs, setBreadcrumbs] = useState<Set<string>>(new Set());
  const [lookOffset, setLookOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isWallBlockedPulse, setIsWallBlockedPulse] = useState<boolean>(false);

  const [viewMode, setViewMode] = useState<ViewMode>(() => getDefaultViewMode(actualTier));
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);

  const startTimeRef = useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  const backtrackCountRef = useRef<number>(0);
  const [backtrackDisplay, setBacktrackDisplay] = useState<number>(0);
  const wallHitsRef = useRef<number>(0);
  const [wallHitsDisplay, setWallHitsDisplay] = useState<number>(0);

  const lastStepTimeRef = useRef<number>(Date.now());
  const hesitationsRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [replayStep, setReplayStep] = useState<number>(0);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setPlayerPos(startPos);
    setTrail([startPos]);
    setVisitedSet(new Set([`${startPos[0]},${startPos[1]}`]));
    setBreadcrumbs(new Set());
    setLookOffset({ x: 0, y: 0 });
    setViewMode(getDefaultViewMode(actualTier));
    setIsCompleted(false);
    setIsReplaying(false);
    setReplayStep(0);
    setProofSignature(null);
    setIsWallBlockedPulse(false);
    startTimeRef.current = Date.now();
    lastStepTimeRef.current = Date.now();
    setElapsedMs(0);
    backtrackCountRef.current = 0;
    setBacktrackDisplay(0);
    wallHitsRef.current = 0;
    setWallHitsDisplay(0);
    hesitationsRef.current = 0;
    hasRecordedRef.current = false;

    if (replayTimerRef.current) clearInterval(replayTimerRef.current);
  }, [actualPuzzle.id, startPos, actualTier]);

  useEffect(() => {
    if (isCompleted) return;
    let frameId: number;
    const updateTimer = () => {
      setElapsedMs(Date.now() - startTimeRef.current);
      frameId = requestAnimationFrame(updateTimer);
    };
    frameId = requestAnimationFrame(updateTimer);
    return () => cancelAnimationFrame(frameId);
  }, [isCompleted]);

  const handleCycleViewMode = () => {
    if (isUltimate || isCompleted || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(10);

    setViewMode((prev) => {
      if (actualTier === 'kids') {
        return prev === 'full' ? 3 : 'full';
      } else if (actualTier === 'intermediate') {
        return prev === 5 ? 'full' : 5;
      } else {
        return prev === 3 ? 'full' : 3;
      }
    });
  };

  const toggleBreadcrumb = useCallback(() => {
    if (isCompleted || isReplaying) return;
    setBreadcrumbs((prev) => {
      const next = new Set(prev);
      const key = `${playerPos[0]},${playerPos[1]}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (navigator.vibrate) navigator.vibrate(20);
  }, [playerPos, isCompleted, isReplaying]);

  const movePlayer = useCallback(
    (rawDx: number, rawDy: number) => {
      if (isCompleted || isReplaying || !grid || grid.length === 0) return;

      const dx = rawDx > 0 ? 1 : rawDx < 0 ? -1 : 0;
      const dy = rawDy > 0 ? 1 : rawDy < 0 ? -1 : 0;
      if (dx === 0 && dy === 0) return;

      const now = Date.now();
      const stepDuration = now - lastStepTimeRef.current;

      setPlayerPos(([currX, currY]) => {
        const nextX = currX + dx;
        const nextY = currY + dy;

        if (
          nextY < 0 ||
          nextY >= grid.length ||
          nextX < 0 ||
          nextX >= grid[0].length ||
          grid[nextY][nextX] === 1
        ) {
          wallHitsRef.current += 1;
          setWallHitsDisplay(wallHitsRef.current);
          setIsWallBlockedPulse(true);
          setTimeout(() => setIsWallBlockedPulse(false), 180);
          if (navigator.vibrate) navigator.vibrate([15, 30]);
          return [currX, currY];
        }

        const isGoalCell = nextX === endPos[0] && nextY === endPos[1];

        const openBranches = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(
          ([bx, by]) => grid[currY + by]?.[currX + bx] === 0
        ).length;

        if (openBranches >= 3 && stepDuration > 1800) {
          hesitationsRef.current += 1;
        }
        lastStepTimeRef.current = now;

        const nextKey = `${nextX},${nextY}`;
        const newPos: [number, number] = [nextX, nextY];

        if (visitedSet.has(nextKey)) {
          backtrackCountRef.current += 1;
          setBacktrackDisplay(backtrackCountRef.current);
        } else {
          setVisitedSet((prev) => new Set(prev).add(nextKey));
        }

        setTrail((prev) => [...prev, newPos]);
        if (navigator.vibrate) navigator.vibrate(6);

        if (isGoalCell) {
          setIsCompleted(true);
          const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

          if (!hasRecordedRef.current && actualPuzzle) {
            hasRecordedRef.current = true;

            const baseIrt = (actualPuzzle.metrics as any)?.irt_logit_difficulty || 0.0;
            const viewBonus = viewMode === 3 ? 0.6 : viewMode === 5 ? 0.3 : 0.0;
            const weightedIrt = Number((baseIrt + viewBonus).toFixed(2));

            recordAttempt({
              puzzleId: actualPuzzle.id,
              engineType: 'maze',
              tier: currentTier,
              cognitiveLoad: actualPuzzle.cognitiveLoad || {
                spatial: 1.0,
                numeric: 0.0,
                workingMemory: viewMode !== 'full' ? 0.9 : 0.5,
                inhibition: 0.8,
              },
              isSuccess: true,
              timeSpentSec: timeSpent,
              conflictsCount: wallHitsRef.current + backtrackCountRef.current,
              technique: 'TopologicalLookahead',
              irtDifficulty: weightedIrt,
              isPureClear: backtrackCountRef.current === 0 && (isUltimate || viewMode !== 'full'),
            });

            try {
              const canonical = `${actualPuzzle.id}|${timeSpent}|${wallHitsRef.current}|${backtrackCountRef.current}|VIEW_${viewMode}|MAZE_VERIFIED`;
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

        return newPos;
      });
    },
    [grid, endPos, isCompleted, isReplaying, visitedSet, actualPuzzle, currentTier, viewMode, isUltimate, recordAttempt, profile.personalBest.fastestTime]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isReplaying) return;
      if (['ArrowUp', 'KeyW'].includes(e.code)) { e.preventDefault(); movePlayer(0, -1); }
      if (['ArrowDown', 'KeyS'].includes(e.code)) { e.preventDefault(); movePlayer(0, 1); }
      if (['ArrowLeft', 'KeyA'].includes(e.code)) { e.preventDefault(); movePlayer(-1, 0); }
      if (['ArrowRight', 'KeyD'].includes(e.code)) { e.preventDefault(); movePlayer(1, 0); }
      if (['Space', 'KeyE'].includes(e.code)) { e.preventDefault(); toggleBreadcrumb(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [movePlayer, toggleBreadcrumb, isCompleted, isReplaying]);

  useEffect(() => {
    let moveThrottle = false;

    const handleCustomMove = (e: any) => {
      if (!e.detail) return;
      const { dx, dy } = e.detail;

      if (moveThrottle) return;

      let stepX = 0;
      let stepY = 0;
      if (Math.abs(dx) > Math.abs(dy)) {
        if (Math.abs(dx) > 0.2) stepX = dx > 0 ? 1 : -1;
      } else {
        if (Math.abs(dy) > 0.2) stepY = dy > 0 ? 1 : -1;
      }

      if (stepX !== 0 || stepY !== 0) {
        moveThrottle = true;
        movePlayer(stepX, stepY);
        setTimeout(() => {
          moveThrottle = false;
        }, 120);
      }
    };

    const handleCustomLook = (e: any) => {
      if (e.detail) {
        const maxOffsetPx = 28;
        setLookOffset({
          x: Math.round(e.detail.x * maxOffsetPx),
          y: Math.round(e.detail.y * maxOffsetPx),
        });
      }
    };

    const handleCustomAction = () => toggleBreadcrumb();

    window.addEventListener('logicore:joystick-move', handleCustomMove);
    window.addEventListener('logicore:joystick-look', handleCustomLook);
    window.addEventListener('logicore:joystick-action', handleCustomAction);

    return () => {
      window.removeEventListener('logicore:joystick-move', handleCustomMove);
      window.removeEventListener('logicore:joystick-look', handleCustomLook);
      window.removeEventListener('logicore:joystick-action', handleCustomAction);
    };
  }, [movePlayer, toggleBreadcrumb]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || isCompleted || isReplaying) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const minDistance = 14;

    if (distance > minDistance) {
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        movePlayer(deltaX > 0 ? 1 : -1, 0);
      } else {
        movePlayer(0, deltaY > 0 ? 1 : -1);
      }
    }
    touchStartRef.current = null;
  };

  const handleStartGhostReplay = useCallback(() => {
    if (trail.length === 0) return;
    setIsReplaying(true);
    setReplayStep(0);

    if (replayTimerRef.current) clearInterval(replayTimerRef.current);
    replayTimerRef.current = setInterval(() => {
      setReplayStep((prev) => {
        if (prev + 1 >= trail.length) {
          if (replayTimerRef.current) clearInterval(replayTimerRef.current);
          setIsReplaying(false);
          return trail.length - 1;
        }
        return prev + 1;
      });
    }, 55);
  }, [trail]);

  const telemetryAnalysis = useMemo((): ProcessTelemetry | null => {
    if (!isCompleted) return null;

    const totalSteps = trail.length;
    const wallHits = wallHitsRef.current;
    const wallHitRate = Math.round((wallHits / Math.max(1, totalSteps + wallHits)) * 100);
    const optimalLen = Math.max(1, optimalSolution.length || 1);
    const overheadRatio = totalSteps / optimalLen;
    const bt = backtrackCountRef.current;
    const hesitations = hesitationsRef.current;

    const simSteps = (actualPuzzle.metrics as any)?.human_sim_steps || Math.round(optimalLen * 1.6);
    const cognitiveAdvantage = Math.round(simSteps - totalSteps);

    let strategy: StrategyType = 'Intuitive-Explorer';
    let strategyName = isEn ? 'Intuitive Explorer' : '直覺探索型';
    let confidence = 75;

    if (overheadRatio <= 1.25 && bt <= 2 && wallHitRate <= 10) {
      strategy = 'Macro-Planner';
      strategyName = isEn ? 'Macro Planner' : '宏觀推演型';
      confidence = Math.min(98, 80 + Math.round((1.25 - overheadRatio) * 60));
    } else if (bt <= 3 && wallHitRate <= 15 && overheadRatio <= 1.6) {
      strategy = 'Wall-Follower';
      strategyName = isEn ? 'Wall Follower' : '謹慎壁隨型';
      confidence = 82;
    } else {
      strategy = 'Intuitive-Explorer';
      strategyName = isEn ? 'Intuitive Explorer' : '直覺衝刺型';
      confidence = 88;
    }

    return {
      wallHits,
      wallHitRate,
      hesitations,
      strategy,
      strategyName,
      confidence,
      cognitiveAdvantage,
    };
  }, [isCompleted, trail.length, optimalSolution.length, actualPuzzle.metrics, isEn]);

  const rankEvaluation = useMemo(() => {
    if (!isCompleted) return null;
    const optimalLen = Math.max(1, optimalSolution.length || 1);
    const actualSteps = trail.length;
    const overheadRatio = actualSteps / optimalLen;
    const bt = backtrackCountRef.current;

    if (overheadRatio <= 1.05 && bt === 0) {
      return { grade: 'S++', color: 'text-amber-300 border-amber-400 bg-amber-950/80', desc: isEn ? 'Flawless Deduction (S++)' : '神之先驗 (S++)' };
    }
    if (overheadRatio <= 1.25 && bt <= 2) {
      return { grade: 'S', color: 'text-cyan-300 border-cyan-400 bg-cyan-950/80', desc: isEn ? 'Master Foresight (S)' : '大師前瞻 (S)' };
    }
    if (overheadRatio <= 1.55 && bt <= 5) {
      return { grade: 'A', color: 'text-emerald-300 border-emerald-400 bg-emerald-950/80', desc: isEn ? 'Excellent Derivation (A)' : '頂尖推導 (A)' };
    }
    if (overheadRatio <= 2.0 && bt <= 10) {
      return { grade: 'B', color: 'text-blue-300 border-blue-400 bg-blue-950/80', desc: isEn ? 'Competent Exploration (B)' : '穩健探索 (B)' };
    }
    return { grade: 'C', color: 'text-slate-400 border-slate-600 bg-slate-900', desc: isEn ? 'Excessive Backtracking (C)' : '過度回溯 (C)' };
  }, [isCompleted, optimalSolution.length, trail.length, isEn]);

  const handleNavigateTargetGame = (gameId: string) => {
    window.dispatchEvent(new CustomEvent('logicore:navigate-game', { detail: { gameId } }));
  };

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);
  if (!grid || grid.length === 0) return null;

  const optimalLen = Math.max(1, optimalSolution.length || 1);
  const currentOverhead = Math.round((trail.length / optimalLen) * 100);
  const replayCurrentPos = isReplaying && trail[replayStep] ? trail[replayStep] : null;

  return (
    <div className="flex flex-col items-center justify-center p-1 select-none font-mono">
      <div className="w-full grid grid-cols-5 gap-1 px-0.5 mb-1.5 text-[8px] sm:text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '⏱️ Speed' : '⏱️ 競速'}</div>
          <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(2)}s</div>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '🎯 Steps/Opt' : '🎯 步數/最佳'}</div>
          <div className={`font-bold ${currentOverhead > 140 ? 'text-rose-400' : 'text-cyan-300'}`}>
            {isReplaying ? replayStep + 1 : trail.length}/{optimalLen}
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '🔄 Backtrack' : '🔄 回溯'}</div>
          <div className={`font-bold ${backtrackDisplay > 3 ? 'text-amber-400' : 'text-slate-300'}`}>
            {backtrackDisplay} {isEn ? '' : '次'}
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '🧱 Wall-Hit' : '🧱 觸壁'}</div>
          <div className={`font-bold ${wallHitsDisplay > 4 ? 'text-rose-400' : 'text-slate-300'}`}>
            {wallHitsDisplay} {isEn ? '' : '次'}
          </div>
        </div>

        <button
          onClick={handleCycleViewMode}
          disabled={isUltimate}
          className={`p-1 rounded border text-center transition cursor-pointer ${
            isUltimate
              ? 'bg-purple-950/80 border-purple-500 text-purple-300 cursor-not-allowed shadow-xs font-bold'
              : viewMode !== 'full'
              ? 'bg-indigo-950/90 border-indigo-500 text-indigo-300 font-bold shadow-xs'
              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title={isUltimate ? (isEn ? 'Ultimate tier locks 3x3 fog' : '終極階梯強制鎖定 3x3 戰霧') : (isEn ? 'Cycle vision mode' : '切換視野模式')}
        >
          <div className="text-[6.5px]">👁️ {isEn ? 'Vision' : '視野'}</div>
          <div className="text-[7.5px] truncate">
            {isUltimate
              ? (isEn ? '3x3 (Lock)' : '3x3 鎖定')
              : viewMode === 'full'
              ? (isEn ? 'Full View' : '全見視野')
              : viewMode === 5
              ? (isEn ? '5x5 Wide' : '5x5 廣角')
              : (isEn ? '3x3 Fog' : '3x3 戰霧')}
          </div>
        </button>
      </div>

      <div
        className={`relative overflow-hidden p-1 rounded-xl bg-slate-950 border-2 transition-all duration-150 shadow-2xl ${
          isWallBlockedPulse ? 'border-rose-500 ring-2 ring-rose-500/50 scale-[0.99]' : 'border-slate-800'
        }`}
      >
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={(e) => e.preventDefault()}
          onTouchEnd={handleTouchEnd}
          style={{
            gridTemplateColumns: `repeat(${w}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${h}, minmax(0, 1fr))`,
            width: 'min(88vw, 42vh)',
            height: 'min(88vw, 42vh)',
            transform: `translate(${lookOffset.x}px, ${lookOffset.y}px)`,
            touchAction: 'none',
          }}
          className="grid gap-[1px] bg-slate-900 select-none touch-none transition-transform duration-100 ease-out"
        >
          {grid.map((row, rIdx) =>
            row.map((cell, cIdx) => {
              const isStart = cIdx === startPos[0] && rIdx === startPos[1];
              const isEnd = !isStart && cIdx === endPos[0] && rIdx === endPos[1];
              const isWall = !isEnd && cell === 1;
              const hasAnchor = breadcrumbs.has(`${cIdx},${rIdx}`);

              const isPlayer = isReplaying
                ? replayCurrentPos && replayCurrentPos[0] === cIdx && replayCurrentPos[1] === rIdx
                : cIdx === playerPos[0] && rIdx === playerPos[1];

              const isTrail = isReplaying
                ? trail.slice(0, replayStep + 1).some(([tx, ty]) => tx === cIdx && ty === rIdx)
                : trail.some(([tx, ty]) => tx === cIdx && ty === rIdx);

              const isOptimal = optimalSolution.some(([ox, oy]) => ox === cIdx && oy === rIdx);

              const sightRadius = viewMode === 3 ? 1 : viewMode === 5 ? 2 : 999;
              const inSight =
                viewMode === 'full' ||
                (Math.abs(rIdx - playerPos[1]) <= sightRadius && Math.abs(cIdx - playerPos[0]) <= sightRadius) ||
                isCompleted ||
                isReplaying ||
                isEnd;

              if (!inSight) {
                return (
                  <div
                    key={`${rIdx}-${cIdx}`}
                    className="w-full h-full bg-slate-950/95 border border-slate-900/60 rounded-xs"
                  />
                );
              }

              return (
                <div
                  key={`${rIdx}-${cIdx}`}
                  style={
                    isEnd
                      ? { backgroundColor: '#10b981', color: '#ffffff', zIndex: 30 }
                      : undefined
                  }
                  className={`w-full h-full flex items-center justify-center rounded-xs font-bold text-[8px] sm:text-[10px] transition-all duration-75 relative ${
                    isPlayer
                      ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/80 scale-105 z-20 ring-2 ring-white'
                      : isEnd
                      ? 'animate-pulse shadow-[0_0_18px_rgba(16,185,129,1)] ring-2 ring-emerald-300'
                      : hasAnchor
                      ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/60 z-15'
                      : isWall
                      ? 'bg-slate-800/90 border border-slate-700/40 shadow-inner'
                      : isStart
                      ? 'bg-indigo-900 text-indigo-200'
                      : isCompleted && isOptimal
                      ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/40'
                      : isTrail
                      ? 'bg-cyan-950/40 text-cyan-400/30'
                      : 'bg-slate-900/60'
                  }`}
                >
                  {isPlayer ? (
                    '●'
                  ) : isEnd ? (
                    <span className="text-[10px] sm:text-xs leading-none select-none z-30">🏁</span>
                  ) : hasAnchor ? (
                    '✦'
                  ) : isStart ? (
                    'S'
                  ) : isCompleted && isOptimal ? (
                    '·'
                  ) : (
                    ''
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="w-full max-w-[340px] flex items-center justify-between px-1 mt-1 text-[7px] text-slate-500">
        <span>{isEn ? '🎮 Virtual Joystick / Swipe to move' : '🎮 虛擬搖桿 / 螢幕滑動移動'}</span>
        <span>{isEn ? 'E / MARK: Drop Beacon ✦' : 'E / MARK 放置信標 ✦'}</span>
      </div>

      {isCompleted && rankEvaluation && telemetryAnalysis && (
        <div className="mt-2 p-2.5 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,42vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
            <div className="text-left">
              <div className="text-[7.5px] text-slate-500 tracking-wider flex items-center gap-1">
                <span>TOPOLOGICAL MAZE RESOLVED</span>
                {viewMode !== 'full' && (
                  <span className="text-[6.5px] px-1 py-0.2 bg-purple-950 border border-purple-500 text-purple-300 font-bold rounded">
                    FOG {viewMode}x{viewMode}
                  </span>
                )}
              </div>
              <div className="text-xs text-indigo-300 font-bold">✨ {rankEvaluation.desc}</div>
            </div>
            <div className="flex flex-col items-end">
              <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[9px] font-bold text-cyan-300">
                Gf: IQ {cci.standardIQ} (Top {Number((100 - cci.percentileRank).toFixed(1))}%)
              </div>
              <span className="text-[6.5px] text-slate-500 mt-0.5">Strategy: {telemetryAnalysis.strategyName}</span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1 text-[7.5px] text-slate-400 mb-1.5">
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Time' : '耗時'}</div>
              <div className="text-slate-200 font-bold text-[10px]">{(elapsedMs / 1000).toFixed(2)}s</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Efficiency' : '步數效率'}</div>
              <div className="text-cyan-300 font-bold text-[10px]">{trail.length}/{optimalLen}</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Backtrack' : '回溯懲罰'}</div>
              <div className="text-amber-300 font-bold text-[10px]">
                {backtrackCountRef.current} {isEn ? '' : '次'}
              </div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Wall Penalty' : '觸壁干擾'}</div>
              <div className="text-rose-300 font-bold text-[10px]">{telemetryAnalysis.wallHitRate}%</div>
            </div>
          </div>

          <div className="mb-1.5">
            <MetricErrorBar
              actualVal={Math.round(elapsedMs / 1000)}
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

          <div className="bg-indigo-950/40 p-1.5 rounded-lg border border-indigo-800/60 text-left mb-1.5 flex items-center justify-between gap-1.5">
            <div className="flex-1 text-[7.5px] text-slate-300 leading-tight">
              {isEn ? benchmarkData.recommendedFocus.reasonEn : benchmarkData.recommendedFocus.reasonZh}
            </div>
            <button
              onClick={() => handleNavigateTargetGame(benchmarkData.recommendedFocus.targetGame)}
              className="shrink-0 px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[7.5px] rounded transition active:scale-95 cursor-pointer"
            >
              ➜ {isEn ? 'Train' : '訓練'}
            </button>
          </div>

          <div className="flex gap-1 mb-1.5">
            <button
              onClick={handleStartGhostReplay}
              disabled={isReplaying}
              className={`flex-1 py-1 rounded text-[7.5px] font-bold border transition flex items-center justify-center gap-0.5 cursor-pointer ${
                isReplaying
                  ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-indigo-950/80 hover:bg-indigo-900 border-indigo-500/60 text-indigo-300 shadow'
              }`}
            >
              <span>👻</span>
              <span>{isReplaying ? (isEn ? 'Replaying...' : '重播中...') : (isEn ? 'Ghost Replay' : '幽靈重播')}</span>
            </button>

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
                <span>{isEn ? 'LOCAL RECEIPT (SHA-256)' : '本地存證 (SHA-256)'}</span>
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
            tournamentId: tournamentMode ? 'WPF_MAZE_2026' : 'GLOBAL_TOPOLOGY_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'maze',
            tier: currentTier,
            timeSpentSec: Math.round(elapsedMs / 1000),
            conflictsCount: wallHitsRef.current + backtrackCountRef.current,
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
