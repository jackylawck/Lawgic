// web-frontend/src/components/MazeBoard.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
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

  const [playerPos, setPlayerPos] = useState<[number, number]>(startPos);
  const [trail, setTrail] = useState<[number, number][]>([startPos]);
  const [visitedSet, setVisitedSet] = useState<Set<string>>(new Set([`${startPos[0]},${startPos[1]}`]));
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [fogMode, setFogMode] = useState<boolean>(false); // 🌫️ 迷霧工作記憶模式

  const startTimeRef = useRef<number>(Date.now());
  const backtrackCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setPlayerPos(startPos);
    setTrail([startPos]);
    setVisitedSet(new Set([`${startPos[0]},${startPos[1]}`]));
    setIsCompleted(false);
    startTimeRef.current = Date.now();
    backtrackCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id]);

  const movePlayer = useCallback(
    (dx: number, dy: number) => {
      if (isCompleted || !grid || grid.length === 0) return;

      setPlayerPos(([currX, currY]) => {
        const nextX = currX + dx;
        const nextY = currY + dy;

        // 碰撞邊界與障礙物 (1 為牆壁)
        if (
          nextY < 0 ||
          nextY >= grid.length ||
          nextX < 0 ||
          nextX >= grid[0].length ||
          grid[nextY][nextX] === 1
        ) {
          if (navigator.vibrate) navigator.vibrate(8);
          return [currX, currY];
        }

        const nextKey = `${nextX},${nextY}`;
        const newPos: [number, number] = [nextX, nextY];

        // 🧠 認知決策分析：若走向已經走過的節點（回頭），代表剛才走進了死胡同（Backtracking）
        if (visitedSet.has(nextKey)) {
          backtrackCountRef.current += 1;
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
                workingMemory: fogMode ? 0.9 : 0.5,
                inhibition: 0.7,
              },
              isSuccess: true,
              timeSpentSec: timeSpent,
              conflictsCount: backtrackCountRef.current, // 輸出真正具備心理測量價值的「死路回溯次數」
            });
          }
        }

        return newPos;
      });
    },
    [grid, endPos, isCompleted, visitedSet, fogMode, actualPuzzle, recordAttempt]
  );

  // 1. 👆 原生滑動手勢 (Touch Swipe Gesture)
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || isCompleted) return;
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
    const minDistance = 24; // 觸發滑動的最小像素位移

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (Math.abs(deltaX) > minDistance) {
        movePlayer(deltaX > 0 ? 1 : -1, 0);
      }
    } else {
      if (Math.abs(deltaY) > minDistance) {
        movePlayer(0, deltaY > 0 ? 1 : -1);
      }
    }
    touchStartRef.current = null;
  };

  // 2. ⌨️ 鍵盤導航 (WASD / Arrows)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted) return;
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
  }, [movePlayer, isCompleted]);

  // 3. 🕹️ 自定義手把事件監聽
  useEffect(() => {
    const handleCustomMove = (e: CustomEvent<{ dx: number; dy: number }>) => {
      movePlayer(e.detail.dx, e.detail.dy);
    };
    window.addEventListener('logicore:joystick-move' as any, handleCustomMove);
    return () => window.removeEventListener('logicore:joystick-move' as any, handleCustomMove);
  }, [movePlayer]);

  if (!grid || grid.length === 0) return null;

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none">
      {/* 頂部輔助模式控制 */}
      <div className="w-full flex items-center justify-between px-2 mb-2 text-[10px] font-mono">
        <button
          onClick={() => setFogMode((prev) => !prev)}
          className={`px-2 py-1 rounded border transition ${
            fogMode
              ? 'bg-purple-950/80 border-purple-500 text-purple-300 font-bold shadow'
              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
          }`}
        >
          {fogMode ? '🌫️ 迷霧啟動 (3x3 盲區)' : '👁️ 全圖視野'}
        </button>

        <div className="text-slate-500 text-[9px]">
          回溯決策: <span className="text-cyan-400 font-bold">{backtrackCountRef.current}</span>
        </div>
      </div>

      {/* 迷宮盤面（支援觸控手勢滑動） */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="grid gap-[1px] bg-slate-900 border-2 border-slate-700 p-1.5 rounded-xl shadow-2xl touch-none"
        style={{
          gridTemplateColumns: `repeat(${grid[0].length}, minmax(0, 1fr))`,
        }}
      >
        {grid.map((row, rIdx) =>
          row.map((cell, cIdx) => {
            const isWall = cell === 1;
            const isStart = cIdx === startPos[0] && rIdx === startPos[1];
            const isEnd = cIdx === endPos[0] && rIdx === endPos[1];
            const isPlayer = cIdx === playerPos[0] && rIdx === playerPos[1];
            const isTrail = trail.some(([tx, ty]) => tx === cIdx && ty === rIdx);
            const isOptimal = optimalSolution.some(([ox, oy]) => ox === cIdx && oy === rIdx);

            // 迷霧視野判定（半徑 2 格）
            const inSight =
              !fogMode ||
              (Math.abs(rIdx - playerPos[1]) <= 2 && Math.abs(cIdx - playerPos[0]) <= 2) ||
              isCompleted;

            if (!inSight) {
              return (
                <div
                  key={`${rIdx}-${cIdx}`}
                  className="w-6 h-6 sm:w-7 sm:h-7 bg-slate-950/95 border border-slate-900 rounded-sm"
                />
              );
            }

            return (
              <div
                key={`${rIdx}-${cIdx}`}
                className={`w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-sm font-bold text-[10px] transition-all duration-75 relative ${
                  isWall
                    ? 'bg-slate-800/90 border border-slate-700/50 shadow-inner'
                    : isPlayer
                    ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/50 scale-105 z-20'
                    : isEnd
                    ? 'bg-emerald-500 text-white animate-pulse'
                    : isStart
                    ? 'bg-indigo-900 text-indigo-200'
                    : isCompleted && isOptimal
                    ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-500/30' // 🎯 通關最短路徑複盤
                    : isTrail
                    ? 'bg-cyan-950/40 text-cyan-500/30'
                    : 'bg-slate-950'
                }`}
              >
                {isPlayer ? '●' : isEnd ? '★' : isStart ? 'S' : isCompleted && isOptimal ? '·' : ''}
              </div>
            );
          })
        )}
      </div>

      {/* 4. 🎯 通關元認知重播提示 */}
      {isCompleted && (
        <div className="mt-2.5 p-2 bg-slate-900/90 border border-emerald-500/50 rounded-lg text-center font-mono text-[10px] text-emerald-300 w-full max-w-xs">
          <div>🎉 拓撲成功抵達！</div>
          <div className="text-[9px] text-slate-400 mt-0.5">
            步數: {trail.length} | 最佳: {optimalSolution.length} | 回溯: {backtrackCountRef.current}
          </div>
          <div className="text-[8px] text-emerald-400/80 mt-0.5">綠色點為上帝視角最短路徑</div>
        </div>
      )}
    </div>
  );
};
