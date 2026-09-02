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

  const mazeData = actualPuzzle?.puzzle || (actualPuzzle as any)?.spec;
  const grid: number[][] = mazeData?.grid || [];
  const startPos: [number, number] = mazeData?.start || [1, 1];

  // 終點座標容錯機制：絕不退回 [1, 1]，預設鎖定網格右下角
  const endPos: [number, number] = useMemo(() => {
    if (mazeData?.end && !(mazeData.end[0] === 1 && mazeData.end[1] === 1)) {
      return mazeData.end;
    }
    if ((mazeData as any)?.goal) {
      return (mazeData as any).goal;
    }
    if (grid.length > 2 && grid[0]?.length > 2) {
      return [grid[0].length - 2, grid.length - 2];
    }
    return [1, 1];
  }, [mazeData, grid]);

  const optimalSolution: [number, number][] = actualPuzzle?.solution || [];

  const [playerPos, setPlayerPos] = useState<[number, number]>(startPos);
  const [trail, setTrail] = useState<[number, number][]>([startPos]);
  const [visitedSet, setVisitedSet] = useState<Set<string>>(new Set([`${startPos[0]},${startPos[1]}`]));
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [fogMode, setFogMode] = useState<boolean>(true); // 預設開啟戰霧

  // 1. ⚡ 60fps 計時器
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

  // 2. 初始化重置
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

  // 3. 計時器
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

  // 4. 滑動平均策略歷史更新
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

  // 5. 玩家移動操作
  const movePlayer = useCallback(
    (dx: number, dy: number) => {
      if (isCompleted || isReplaying || !grid || grid.length === 0) return;

      const now = Date.now();
      const stepDuration = now - lastStepTimeRef.current;

      setPlayerPos(([currX, currY]) => {
        const nextX = currX + dx;
        const nextY = currY + dy;

        const openBranches = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(
          ([bx, by]) => grid[currY + by]?.[currX + bx] === 0
        ).length;

        if (openBranches >= 3 && stepDuration > 1800) {
          hesitationsRef.current += 1;
        }
        lastStepTimeRef.current = now;

        // 碰壁
        if (
          nextY < 0 ||
          nextY >= grid.length ||
          nextX < 0 ||
          nextX >= grid[0].length ||
          grid[nextY][nextX] === 1
        ) {
          wallHitsRef.current += 1;
          setWallHitsDisplay(wallHitsRef.current);
          if (navigator.vibrate) navigator.vibrate(10);
          return [currX, currY];
        }

        const nextKey = `${nextX},${nextY}`;
        const newPos: [number, number] = [nextX, nextY];

        if (visitedSet.has(nextKey)) {
          backtrackCountRef.current += 1;
          setBacktrackDisplay(backtrackCountRef.current);
        } else {
          setVisitedSet((prev) => new Set(prev).add(nextKey));
        }

        setTrail((prev) => [...prev, newPos]);

        // 雙保險終點判定
        const isReachedGoal =
          (nextX === endPos[0] && nextY === endPos[1] && !(nextX === 1 && nextY === 1)) ||
          (nextX === grid[0].length - 2 && nextY === grid.length - 2);

        if (isReachedGoal) {
          setIsCompleted(true);

          const finalTrailLength = trail.length + 1;
          const optimalLen = Math.max(1, optimalSolution.length);
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

  // 統計與策略分析
  const telemetryAnalysis = useMemo((): ProcessTelemetry | null => {
    if (!isCompleted) return null;

    const totalSteps = trail.length;
    const wallHits = wallHitsRef.current;
    const wallHitRate = Math.round((wallHits / Math.max(1, totalSteps + wallHits)) * 100);
    const optimalLen = Math.max(1, optimalSolution.length);
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
  }, [isCompleted, trail.length, optimalSolution.length, actualPuzzle?.metrics, isEn]);

  const rankEvaluation = useMemo(() => {
    if (!isCompleted) return null;
    const optimalLen = Math.max(1, optimalSolution.length);
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

  const handleExportPsychometrics = () => {
    if (!telemetryAnalysis || !actualPuzzle) return;
    const report = {
      standard: 'ISO-Mensa-Dynamic-Cognitive-Telemetry-v2',
      timestamp: new Date().toISOString(),
      puzzleId: actualPuzzle.id,
      tier: actualPuzzle.tier,
      elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
      stepsTaken: trail.length,
      optimalSteps: optimalSolution.length,
      efficiencyRatio: Number((trail.length / Math.max(1, optimalSolution.length)).toFixed(2)),
      backtracks: backtrackCountRef.current,
      wallHits: telemetryAnalysis.wallHits,
      wallHitRate: `${telemetryAnalysis.wallHitRate}%`,
      classifiedStrategy: telemetryAnalysis.strategy,
      rawTrail: trail,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Psychometrics_${actualPuzzle.id}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!grid || grid.length === 0) return null;

  const optimalLen = Math.max(1, optimalSolution.length);
  const currentOverhead = Math.round((trail.length / optimalLen) * 100);
  const replayCurrentPos = isReplaying && trail[replayStep] ? trail[replayStep] : null;

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono">
      {/* 🏎️ 儀表板 */}
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

      {/* 迷宮主盤面 */}
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
            const isWall = cell === 1;
            const isStart = cIdx === startPos[0] && rIdx === startPos[1];
            
            // 💡 燈塔模式雙保險：絕對鎖定終點座標，絕不隱形
            const isEnd =
              (cIdx === endPos[0] && rIdx === endPos[1] && !(cIdx === 1 && rIdx === 1)) ||
              (cIdx === grid[0].length - 2 && rIdx === grid.length - 2);

            const isPlayer = isReplaying
              ? replayCurrentPos && replayCurrentPos[0] === cIdx && replayCurrentPos[1] === rIdx
              : cIdx === playerPos[0] && rIdx === playerPos[1];

            const isTrail = isReplaying
              ? trail.slice(0, replayStep + 1).some(([tx, ty]) => tx === cIdx && ty === rIdx)
              : trail.some(([tx, ty]) => tx === cIdx && ty === rIdx);

            const isOptimal = optimalSolution.some(([ox, oy]) => ox === cIdx && oy === rIdx);

            // 💡 戰霧下終點作為燈塔 (Beacon)，持續穿透迷霧發光
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
                className={`w-4 h-4 sm:w-6 sm:h-6 flex items-center justify-center rounded-xs font-bold text-[8px] sm:text-[10px] transition-all duration-75 relative ${
                  isPlayer
                    ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/80 scale-105 z-20 ring-1 ring-cyan-300'
                    : isEnd
                    ? '!bg-emerald-500 !text-white animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.95)] z-10 border border-emerald-300 ring-2 ring-emerald-400'
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
                  <span className="text-[10px] sm:text-xs select-none">🏁</span>
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

      {/* 🏆 結算評鑑 */}
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

          <div className="flex items-center justify-between gap-1.5 border-t border-slate-800/80 pt-2.5">
            <button
              onClick={handleExportPsychometrics}
              className="px-2 py-1 rounded text-[8px] font-bold border border-emerald-500/50 bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 transition flex items-center gap-1 shadow"
            >
              <span>📊</span>
              <span>{isEn ? 'Export Data' : '匯出常模數據'}</span>
            </button>
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
