// web-frontend/src/components/MazeBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
}

export type StrategyType = 'Macro-Planner' | 'Wall-Follower' | 'Intuitive-Explorer';

interface ProcessTelemetry {
  wallHits: number;
  wallHitRate: number;
  hesitations: number;
  strategy: StrategyType;
  strategyName: string;
  confidence: number;
  cognitiveAdvantage: number;
}

export const MazeBoard: React.FC<Props> = ({ puzzleData, puzzle }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { recordAttempt } = useLearnerProfile();
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const rawData = (actualPuzzle as any)?.puzzle || (actualPuzzle as any)?.spec || (actualPuzzle as any);

  // 1. 深拷貝 Grid 確保不變性與即時改寫
  const baseGrid: number[][] = rawData?.grid || [];
  const h = baseGrid.length;
  const w = baseGrid[0]?.length || 0;

  const startPos: [number, number] = useMemo(() => {
    return rawData?.start || [1, 1];
  }, [rawData]);

  // 2. 確定終點坐標：雙向檢查 end、goal 或右下角，並自動穿透打通
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

    // 防禦邊界溢出
    ex = Math.max(1, Math.min(w - 2, ex));
    ey = Math.max(1, Math.min(h - 2, ey));

    // 💡 關鍵修復：強制打通終點格子與至少一條通路，確保物理上絕對不是牆壁
    nextGrid[ey][ex] = 0;
    if (ey > 1 && nextGrid[ey - 1][ex] === 1 && nextGrid[ey][ex - 1] === 1) {
      nextGrid[ey - 1][ex] = 0;
    }

    return { grid: nextGrid, endPos: [ex, ey] as [number, number] };
  }, [baseGrid, rawData, w, h, startPos]);

  const optimalSolution: [number, number][] = actualPuzzle?.solution || [];

  const [playerPos, setPlayerPos] = useState<[number, number]>(startPos);
  const [trail, setTrail] = useState<[number, number][]>([startPos]);
  const [visitedSet, setVisitedSet] = useState<Set<string>>(new Set([`${startPos[0]},${startPos[1]}`]));
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [fogMode, setFogMode] = useState<boolean>(false); // 預設先看全貌以確認終點，有需要再切換戰霧

  const startTimeRef = useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  const backtrackCountRef = useRef<number>(0);
  const [backtrackDisplay, setBacktrackDisplay] = useState<number>(0);
  const hasRecordedRef = useRef<boolean>(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const wallHitsRef = useRef<number>(0);
  const [wallHitsDisplay, setWallHitsDisplay] = useState<number>(0);
  const lastStepTimeRef = useRef<number>(Date.now());
  const hesitationsRef = useRef<number>(0);

  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [replayStep, setReplayStep] = useState<number>(0);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setPlayerPos(startPos);
    setTrail([startPos]);
    setVisitedSet(new Set([`${startPos[0]},${startPos[1]}`]));
    setIsCompleted(false);
    setIsReplaying(false);
    setReplayStep(0);
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
  }, [actualPuzzle?.id, startPos]);

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

  const updateStrategyHistory = useCallback((newStrategy: StrategyType) => {
    const key = 'logicore_strategy_history';
    let history: StrategyType[] = [];
    try {
      history = JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      history = [];
    }
    history.push(newStrategy);
    if (history.length > 10) history.shift();

    const weights = [0.35, 0.25, 0.20, 0.12, 0.08];
    const recent = history.slice(-5).reverse();
    const weightedScore: Record<StrategyType, number> = {
      'Macro-Planner': 0,
      'Wall-Follower': 0,
      'Intuitive-Explorer': 0,
    };

    recent.forEach((s, i) => {
      weightedScore[s] += weights[i] || 0.08;
    });

    const dominant = (Object.entries(weightedScore).sort((a, b) => b[1] - a[1])[0][0]) as StrategyType;

    localStorage.setItem(key, JSON.stringify(history));
    localStorage.setItem('logicore_dominant_strategy', dominant);
    localStorage.setItem('logicore_last_strategy', dominant);
  }, []);

  const movePlayer = useCallback(
    (dx: number, dy: number) => {
      if (isCompleted || isReplaying || !grid || grid.length === 0) return;

      const now = Date.now();
      const stepDuration = now - lastStepTimeRef.current;

      setPlayerPos(([currX, currY]) => {
        const nextX = currX + dx;
        const nextY = currY + dy;

        const isGoalCell = nextX === endPos[0] && nextY === endPos[1];

        // 碰壁判定：終點格永遠允許進入
        if (
          !isGoalCell &&
          (nextY < 0 ||
            nextY >= grid.length ||
            nextX < 0 ||
            nextX >= grid[0].length ||
            grid[nextY][nextX] === 1)
        ) {
          wallHitsRef.current += 1;
          setWallHitsDisplay(wallHitsRef.current);
          if (navigator.vibrate) navigator.vibrate(10);
          return [currX, currY];
        }

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

        if (isGoalCell) {
          setIsCompleted(true);

          const finalTrailLength = trail.length + 1;
          const optimalLen = Math.max(1, optimalSolution.length || 1);
          const overhead = finalTrailLength / optimalLen;
          const bt = backtrackCountRef.current;
          const whr = (wallHitsRef.current / Math.max(1, finalTrailLength + wallHitsRef.current)) * 100;

          let assignedStrategy: StrategyType = 'Intuitive-Explorer';
          if (overhead <= 1.25 && bt <= 2 && whr <= 10) {
            assignedStrategy = 'Macro-Planner';
          } else if (bt <= 3 && whr <= 15 && overhead <= 1.6) {
            assignedStrategy = 'Wall-Follower';
          }

          updateStrategyHistory(assignedStrategy);

          if (!hasRecordedRef.current && actualPuzzle) {
            hasRecordedRef.current = true;
            const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
            recordAttempt({
              puzzleId: actualPuzzle.id,
              engineType: 'maze',
              tier: (actualPuzzle.tier as TierKey) || 'kids',
              cognitiveLoad: actualPuzzle.cognitiveLoad || {
                spatial: 1.0,
                numeric: 0.0,
                workingMemory: 0.6,
                inhibition: 0.8,
              },
              isSuccess: true,
              timeSpentSec: timeSpent,
              conflictsCount: backtrackCountRef.current,
            });
          }
        }

        return newPos;
      });
    },
    [grid, endPos, isCompleted, isReplaying, visitedSet, actualPuzzle, recordAttempt, trail.length, optimalSolution.length, updateStrategyHistory]
  );

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
    }, 60);
  }, [trail]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || isCompleted || isReplaying) return;
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
    const minDistance = 18;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (Math.abs(deltaX) > minDistance) movePlayer(deltaX > 0 ? 1 : -1, 0);
    } else {
      if (Math.abs(deltaY) > minDistance) movePlayer(0, deltaY > 0 ? 1 : -1);
    }
    touchStartRef.current = null;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isReplaying) return;
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault();
          movePlayer(0, -1);
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          movePlayer(0, 1);
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          movePlayer(-1, 0);
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          movePlayer(1, 0);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [movePlayer, isCompleted, isReplaying]);

  useEffect(() => {
    const handleCustomMove = (e: CustomEvent<{ dx: number; dy: number }>) => {
      movePlayer(e.detail.dx, e.detail.dy);
    };
    window.addEventListener('logicore:joystick-move' as any, handleCustomMove);
    return () => window.removeEventListener('logicore:joystick-move' as any, handleCustomMove);
  }, [movePlayer]);

  const telemetryAnalysis = useMemo((): ProcessTelemetry | null => {
    if (!isCompleted) return null;

    const totalSteps = trail.length;
    const wallHits = wallHitsRef.current;
    const wallHitRate = Math.round((wallHits / Math.max(1, totalSteps + wallHits)) * 100);
    const optimalLen = Math.max(1, optimalSolution.length || 1);
    const overheadRatio = totalSteps / optimalLen;
    const bt = backtrackCountRef.current;
    const hesitations = hesitationsRef.current;

    const simSteps = (actualPuzzle?.metrics as any)?.human_sim_steps || Math.round(optimalLen * 1.6);
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
  }, [isCompleted, trail.length, optimalSolution.length, actualPuzzle?.metrics, isEn]);

  const rankEvaluation = useMemo(() => {
    if (!isCompleted) return null;
    const optimalLen = Math.max(1, optimalSolution.length || 1);
    const actualSteps = trail.length;
    const overheadRatio = actualSteps / optimalLen;
    const bt = backtrackCountRef.current;

    if (overheadRatio <= 1.05 && bt === 0) {
      return { grade: 'S++', color: 'text-amber-300 border-amber-400 bg-amber-950/80', desc: isEn ? 'Flawless Deduction' : '神之先驗 (Flawless)' };
    }
    if (overheadRatio <= 1.25 && bt <= 2) {
      return { grade: 'S', color: 'text-cyan-300 border-cyan-400 bg-cyan-950/80', desc: isEn ? 'Master Foresight' : '大師前瞻 (Mastery)' };
    }
    if (overheadRatio <= 1.55 && bt <= 5) {
      return { grade: 'A', color: 'text-emerald-300 border-emerald-400 bg-emerald-950/80', desc: isEn ? 'Excellent Derivation' : '頂尖推導 (Excellent)' };
    }
    if (overheadRatio <= 2.0 && bt <= 10) {
      return { grade: 'B', color: 'text-blue-300 border-blue-400 bg-blue-950/80', desc: isEn ? 'Competent Exploration' : '穩健探索 (Competent)' };
    }
    return { grade: 'C', color: 'text-slate-400 border-slate-600 bg-slate-900', desc: isEn ? 'Excessive Backtracking' : '過度回溯 (Drifting)' };
  }, [isCompleted, optimalSolution.length, trail.length, isEn]);

  if (!grid || grid.length === 0) return null;

  const optimalLen = Math.max(1, optimalSolution.length || 1);
  const currentOverhead = Math.round((trail.length / optimalLen) * 100);
  const replayCurrentPos = isReplaying && trail[replayStep] ? trail[replayStep] : null;

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono">
      {/* 儀表板 */}
      <div className="w-full grid grid-cols-5 gap-1 px-0.5 mb-2 text-[8px] sm:text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? '⏱️ Speed' : '⏱️ 競速'}</div>
          <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(2)}s</div>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? '🎯 Steps' : '🎯 步數/最佳'}</div>
          <div className={`font-bold ${currentOverhead > 140 ? 'text-rose-400' : 'text-cyan-300'}`}>
            {isReplaying ? replayStep + 1 : trail.length}/{optimalLen}
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? '🔄 Backtrack' : '🔄 回溯'}</div>
          <div className={`font-bold ${backtrackDisplay > 3 ? 'text-amber-400' : 'text-slate-300'}`}>
            {backtrackDisplay} {isEn ? 'pts' : '次'}
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? '🧱 Wall-Hit' : '🧱 觸壁'}</div>
          <div className={`font-bold ${wallHitsDisplay > 4 ? 'text-rose-400' : 'text-slate-300'}`}>
            {wallHitsDisplay} {isEn ? 'pts' : '次'}
          </div>
        </div>

        <button
          onClick={() => setFogMode((prev) => !prev)}
          className={`p-1 rounded border text-center transition ${
            fogMode
              ? 'bg-purple-950/90 border-purple-500 text-purple-300 font-bold shadow'
              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="text-[7px]">{isEn ? '🌫️ Vision' : '🌫️ 視野'}</div>
          <div className="text-[8px]">{fogMode ? (isEn ? 'Fog War' : '3x3 戰霧') : (isEn ? 'Full View' : '全圖')}</div>
        </button>
      </div>

      {/* 迷宮盤面 */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="grid gap-[1px] bg-slate-950 border-2 border-slate-700 p-1 rounded-xl shadow-2xl touch-none max-w-[95vw] max-h-[62vh] overflow-hidden"
        style={{
          gridTemplateColumns: `repeat(${grid[0].length}, minmax(0, 1fr))`,
        }}
      >
        {grid.map((row, rIdx) =>
          row.map((cell, cIdx) => {
            const isStart = cIdx === startPos[0] && rIdx === startPos[1];
            
            // 💡 絕對終點判定：排除起點，只要座標吻合 endPos 即為終點
            const isEnd = !isStart && cIdx === endPos[0] && rIdx === endPos[1];
            
            // 終點絕對不為牆
            const isWall = !isEnd && cell === 1;

            const isPlayer = isReplaying
              ? replayCurrentPos && replayCurrentPos[0] === cIdx && replayCurrentPos[1] === rIdx
              : cIdx === playerPos[0] && rIdx === playerPos[1];

            const isTrail = isReplaying
              ? trail.slice(0, replayStep + 1).some(([tx, ty]) => tx === cIdx && ty === rIdx)
              : trail.some(([tx, ty]) => tx === cIdx && ty === rIdx);

            const isOptimal = optimalSolution.some(([ox, oy]) => ox === cIdx && oy === rIdx);

            const inSight =
              !fogMode ||
              (Math.abs(rIdx - playerPos[1]) <= 2 && Math.abs(cIdx - playerPos[0]) <= 2) ||
              isCompleted ||
              isReplaying ||
              isEnd;

            if (!inSight) {
              return (
                <div
                  key={`${rIdx}-${cIdx}`}
                  className="w-4 h-4 sm:w-6 sm:h-6 bg-slate-950/95 border border-slate-900/60 rounded-xs"
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
                className={`w-4 h-4 sm:w-6 sm:h-6 flex items-center justify-center rounded-xs font-bold text-[8px] sm:text-[10px] transition-all duration-75 relative ${
                  isPlayer
                    ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/80 scale-105 z-20 ring-1 ring-cyan-300'
                    : isEnd
                    ? 'animate-pulse shadow-[0_0_18px_rgba(16,185,129,1)] ring-2 ring-emerald-300'
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
                  <span className="text-[11px] sm:text-xs leading-none select-none z-30">🏁</span>
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

      {/* 結算面板 */}
      {isCompleted && rankEvaluation && telemetryAnalysis && (
        <div className="mt-2.5 p-3 bg-slate-950/95 border border-slate-700 rounded-xl text-center w-full max-w-sm shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
            <div className="text-left">
              <div className="text-[9px] text-slate-500 uppercase">SPEEDRUN CLEAR</div>
              <div className="text-xs text-slate-200 font-bold">{rankEvaluation.desc}</div>
            </div>
            <div className={`px-2.5 py-0.5 border rounded-lg text-lg font-black ${rankEvaluation.color}`}>
              {rankEvaluation.grade}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1 text-[8px] text-slate-400 mb-2.5">
            <div className="bg-slate-900/60 p-1 rounded">
              {isEn ? 'Time' : '耗時'} <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(2)}s</div>
            </div>
            <div className="bg-slate-900/60 p-1 rounded">
              {isEn ? 'Steps' : '步數'} <div className="text-cyan-300 font-bold">{trail.length}/{optimalLen}</div>
            </div>
            <div className="bg-slate-900/60 p-1 rounded">
              {isEn ? 'Backtrack' : '回溯'} <div className="text-amber-400 font-bold">{backtrackCountRef.current}</div>
            </div>
            <div className="bg-slate-900/60 p-1 rounded">
              {isEn ? 'Wall Hit' : '觸壁率'} <div className="text-rose-400 font-bold">{telemetryAnalysis.wallHitRate}%</div>
            </div>
          </div>

          <div className="flex items-center justify-end border-t border-slate-800/80 pt-2.5">
            <button
              onClick={handleStartGhostReplay}
              disabled={isReplaying}
              className={`px-2.5 py-1 rounded text-[9px] font-bold border transition flex items-center gap-1 ${
                isReplaying
                  ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-indigo-950/80 hover:bg-indigo-900 border-indigo-500/60 text-indigo-300 shadow'
              }`}
            >
              <span>👻</span>
              <span>{isReplaying ? (isEn ? 'Replaying...' : '重播中...') : (isEn ? 'Ghost Replay' : '觀看重播')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
