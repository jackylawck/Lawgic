// web-frontend/src/components/MazeBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
}

export const MazeBoard: React.FC<Props> = ({ puzzleData, puzzle }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { recordAttempt } = useLearnerProfile();

  const mazeData = actualPuzzle?.puzzle;
  const grid: number[][] = mazeData?.grid || [];
  const startPos: [number, number] = mazeData?.start || [1, 1];
  const endPos: [number, number] = mazeData?.end || [1, 1];
  const optimalSolution: [number, number][] = actualPuzzle?.solution || [];
  const visualNoise: number = mazeData?.visualNoise ?? 0.3;

  const [playerPos, setPlayerPos] = useState<[number, number]>(startPos);
  const [trail, setTrail] = useState<[number, number][]>([startPos]);
  const [visitedSet, setVisitedSet] = useState<Set<string>>(new Set([`${startPos[0]},${startPos[1]}`]));
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [fogMode, setFogMode] = useState<boolean>(false);

  // 1. ⚡ 60fps 逐幀流暢計時器 (requestAnimationFrame)
  const startTimeRef = useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  const backtrackCountRef = useRef<number>(0);
  const [backtrackDisplay, setBacktrackDisplay] = useState<number>(0);
  const hasRecordedRef = useRef<boolean>(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // 👻 鬼影重播狀態
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [replayStep, setReplayStep] = useState<number>(0);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 2. 初始化重置狀態
  useEffect(() => {
    setPlayerPos(startPos);
    setTrail([startPos]);
    setVisitedSet(new Set([`${startPos[0]},${startPos[1]}`]));
    setIsCompleted(false);
    setIsReplaying(false);
    setReplayStep(0);
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    backtrackCountRef.current = 0;
    setBacktrackDisplay(0);
    hasRecordedRef.current = false;

    if (replayTimerRef.current) clearInterval(replayTimerRef.current);
  }, [actualPuzzle?.id, startPos]);

  // 3. 逐幀計時器循環
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

  // 4. 拓撲死路分析 (尋找具備多重轉彎之動態偽裝死路)
  const dynamicBaitSet = useMemo(() => {
    const baits = new Set<string>();
    if (!grid || grid.length === 0 || visualNoise < 0.3) return baits;

    const optSet = new Set(optimalSolution.map(([x, y]) => `${x},${y}`));
    const h = grid.length;
    const w = grid[0].length;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        // 若該格為非主解通路的死路起點
        if (grid[y][x] === 0 && !optSet.has(`${x},${y}`)) {
          // 向深處探測 4 步以計算轉彎曲折度
          let turns = 0;
          let curr = [x, y];
          let prevDir = [0, 0];
          const localVisited = new Set<string>([`${x},${y}`]);

          for (let step = 0; step < 4; step++) {
            const neighbors: [number, number, number, number][] = [];
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
              const nx = curr[0] + dx;
              const ny = curr[1] + dy;
              if (nx >= 0 && nx < w && ny >= 0 && ny < h && grid[ny][nx] === 0) {
                if (!localVisited.has(`${nx},${ny}`)) {
                  neighbors.push([nx, ny, dx, dy]);
                }
              }
            }

            if (neighbors.length === 1) {
              const [nx, ny, dx, dy] = neighbors[0];
              if (step > 0 && (dx !== prevDir[0] || dy !== prevDir[1])) {
                turns++;
              }
              prevDir = [dx, dy];
              curr = [nx, ny];
              localVisited.add(`${nx},${ny}`);
            } else {
              break;
            }
          }

          // 若死路內部包含 1 次以上轉彎偽裝，將其入口標記為誘餌
          if (turns >= 1) {
            baits.add(`${x},${y}`);
          }
        }
      }
    }
    return baits;
  }, [grid, optimalSolution, visualNoise]);

  // 5. 玩家移動操作
  const movePlayer = useCallback(
    (dx: number, dy: number) => {
      if (isCompleted || isReplaying || !grid || grid.length === 0) return;

      setPlayerPos(([currX, currY]) => {
        const nextX = currX + dx;
        const nextY = currY + dy;

        // 碰壁
        if (
          nextY < 0 ||
          nextY >= grid.length ||
          nextX < 0 ||
          nextX >= grid[0].length ||
          grid[nextY][nextX] === 1
        ) {
          if (navigator.vibrate) navigator.vibrate(10);
          return [currX, currY];
        }

        const nextKey = `${nextX},${nextY}`;
        const newPos: [number, number] = [nextX, nextY];

        // 🧠 認知決策：回溯死路次數判定
        if (visitedSet.has(nextKey)) {
          backtrackCountRef.current += 1;
          setBacktrackDisplay(backtrackCountRef.current);
        } else {
          setVisitedSet((prev) => new Set(prev).add(nextKey));
        }

        setTrail((prev) => [...prev, newPos]);

        // 抵達終點判定
        if (nextX === endPos[0] && nextY === endPos[1]) {
          setIsCompleted(true);
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
                workingMemory: fogMode ? 0.9 : 0.6,
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
    [grid, endPos, isCompleted, isReplaying, visitedSet, fogMode, actualPuzzle, recordAttempt]
  );

  // 6. 👻 鬼影重播功能啟動
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
    }, 60); // 每 60ms 播放一步，形成流暢回放
  }, [trail]);

  // 7. 觸控滑動
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

  // 8. 鍵盤監聽
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

  // 9. 虛擬手把事件
  useEffect(() => {
    const handleCustomMove = (e: CustomEvent<{ dx: number; dy: number }>) => {
      movePlayer(e.detail.dx, e.detail.dy);
    };
    window.addEventListener('logicore:joystick-move' as any, handleCustomMove);
    return () => window.removeEventListener('logicore:joystick-move' as any, handleCustomMove);
  }, [movePlayer]);

  // 10. 🏆 職業段位評級計算
  const rankEvaluation = useMemo(() => {
    if (!isCompleted) return null;
    const optimalLen = Math.max(1, optimalSolution.length);
    const actualSteps = trail.length;
    const overheadRatio = actualSteps / optimalLen;
    const bt = backtrackCountRef.current;

    if (overheadRatio <= 1.05 && bt === 0) {
      return { grade: 'S++', color: 'text-amber-300 border-amber-400 bg-amber-950/80', desc: '神之先驗 (Flawless)' };
    }
    if (overheadRatio <= 1.25 && bt <= 2) {
      return { grade: 'S', color: 'text-cyan-300 border-cyan-400 bg-cyan-950/80', desc: '大師前瞻 (Mastery)' };
    }
    if (overheadRatio <= 1.55 && bt <= 5) {
      return { grade: 'A', color: 'text-emerald-300 border-emerald-400 bg-emerald-950/80', desc: '頂尖推導 (Excellent)' };
    }
    if (overheadRatio <= 2.0 && bt <= 10) {
      return { grade: 'B', color: 'text-blue-300 border-blue-400 bg-blue-950/80', desc: '穩健探索 (Competent)' };
    }
    return { grade: 'C', color: 'text-slate-400 border-slate-600 bg-slate-900', desc: '過度回溯 (Drifting)' };
  }, [isCompleted, optimalSolution.length, trail.length]);

  if (!grid || grid.length === 0) return null;

  const optimalLen = Math.max(1, optimalSolution.length);
  const currentOverhead = Math.round((trail.length / optimalLen) * 100);

  // 取得目前重播位置
  const replayCurrentPos = isReplaying && trail[replayStep] ? trail[replayStep] : null;

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono">
      {/* 🏎️ 60fps 逐幀流暢壓力儀表板 */}
      <div className="w-full grid grid-cols-4 gap-1.5 px-1 mb-2 text-[9px] sm:text-[10px]">
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[8px]">⏱️ 60fps 競速</div>
          <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(2)}s</div>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[8px]">🎯 步數/最佳</div>
          <div className={`font-bold ${currentOverhead > 140 ? 'text-rose-400' : 'text-cyan-300'}`}>
            {isReplaying ? replayStep + 1 : trail.length}/{optimalLen}{' '}
            <span className="text-[8px] opacity-70">({currentOverhead}%)</span>
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[8px]">🔄 回溯誘捕</div>
          <div className={`font-bold ${backtrackDisplay > 3 ? 'text-amber-400' : 'text-slate-300'}`}>
            {backtrackDisplay} 次
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
          <div className="text-[8px]">🌫️ 視野</div>
          <div className="text-[9px]">{fogMode ? '3x3 盲區' : '全圖'}</div>
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
            const isEnd = cIdx === endPos[0] && rIdx === endPos[1];
            const isPlayer = isReplaying
              ? replayCurrentPos && replayCurrentPos[0] === cIdx && replayCurrentPos[1] === rIdx
              : cIdx === playerPos[0] && rIdx === playerPos[1];

            const isTrail = isReplaying
              ? trail.slice(0, replayStep + 1).some(([tx, ty]) => tx === cIdx && ty === rIdx)
              : trail.some(([tx, ty]) => tx === cIdx && ty === rIdx);

            const isOptimal = optimalSolution.some(([ox, oy]) => ox === cIdx && oy === rIdx);
            const isDynamicBait = dynamicBaitSet.has(`${cIdx},${rIdx}`);

            // 迷霧視野 (Fog Radius: 2)
            const inSight =
              !fogMode ||
              (Math.abs(rIdx - playerPos[1]) <= 2 && Math.abs(cIdx - playerPos[0]) <= 2) ||
              isCompleted ||
              isReplaying;

            if (!inSight) {
              return (
                <div
                  key={`${rIdx}-${cIdx}`}
                  className="w-4 h-4 sm:w-6 sm:h-6 bg-slate-950/95 border border-slate-900 rounded-xs"
                />
              );
            }

            return (
              <div
                key={`${rIdx}-${cIdx}`}
                className={`w-4 h-4 sm:w-6 sm:h-6 flex items-center justify-center rounded-xs font-bold text-[8px] sm:text-[10px] transition-all duration-75 relative ${
                  isWall
                    ? 'bg-slate-800/90 border border-slate-700/40 shadow-inner'
                    : isPlayer
                    ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/80 scale-105 z-20 ring-1 ring-cyan-300'
                    : isEnd
                    ? 'bg-emerald-500 text-white animate-pulse shadow-md shadow-emerald-500/50'
                    : isStart
                    ? 'bg-indigo-900 text-indigo-200'
                    : isCompleted && isOptimal
                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/40'
                    : isTrail
                    ? 'bg-cyan-950/40 text-cyan-400/30'
                    : isDynamicBait && !isCompleted
                    ? 'bg-amber-900/60 border border-amber-500/50 text-amber-300/80 shadow-[0_0_6px_rgba(245,158,11,0.25)]' // ⚡ 動態拓撲偽裝誘餌
                    : 'bg-slate-900/60'
                }`}
              >
                {isPlayer ? (
                  '●'
                ) : isEnd ? (
                  '★'
                ) : isStart ? (
                  'S'
                ) : isCompleted && isOptimal ? (
                  '·'
                ) : isDynamicBait && !isCompleted ? (
                  <span className="text-[7px] text-amber-400/90">⚡</span>
                ) : (
                  ''
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 🏆 結算評鑑與 👻 鬼影軌跡重播面板 */}
      {isCompleted && rankEvaluation && (
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

          <div className="grid grid-cols-3 gap-2 text-[9px] text-slate-400">
            <div>耗時: <span className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(2)}s</span></div>
            <div>步數: <span className="text-cyan-300 font-bold">{trail.length}</span> / {optimalLen}</div>
            <div>回溯: <span className="text-amber-400 font-bold">{backtrackCountRef.current}</span></div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="text-[8px] text-emerald-400/90 text-left">
              ★ 綠色高亮路徑為上帝視角最優解
            </div>
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
              <span>{isReplaying ? '重播中...' : '觀看重播'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
