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

  const [playerPos, setPlayerPos] = useState<[number, number]>(startPos);
  const [trail, setTrail] = useState<[number, number][]>([startPos]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  useEffect(() => {
    setPlayerPos(startPos);
    setTrail([startPos]);
    setIsCompleted(false);
    startTimeRef.current = Date.now();
    conflictCountRef.current = 0;
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
          if (navigator.vibrate) navigator.vibrate(12);
          conflictCountRef.current += 1;
          return [currX, currY];
        }

        const newPos: [number, number] = [nextX, nextY];
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
                workingMemory: 0.5,
                inhibition: 0.4,
              },
              isSuccess: true,
              timeSpentSec: timeSpent,
              conflictsCount: conflictCountRef.current,
            });
          }
        }

        return newPos;
      });
    },
    [grid, endPos, isCompleted, actualPuzzle, recordAttempt]
  );

  // 鍵盤導航
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

  // 雙手把 Custom Event 監聽
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
      <div
        className="grid gap-[1px] bg-slate-900 border-2 border-slate-700 p-1.5 rounded-xl shadow-2xl"
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

            return (
              <div
                key={`${rIdx}-${cIdx}`}
                className={`w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-sm font-bold text-[10px] transition-all duration-75 ${
                  isWall
                    ? 'bg-slate-800/90 border border-slate-700/50 shadow-inner'
                    : isPlayer
                    ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/50 scale-105 z-10'
                    : isEnd
                    ? 'bg-emerald-500 text-white animate-pulse'
                    : isStart
                    ? 'bg-indigo-900 text-indigo-200'
                    : isTrail
                    ? 'bg-cyan-950/40 text-cyan-500/30'
                    : 'bg-slate-950'
                }`}
              >
                {isPlayer ? '●' : isEnd ? '★' : isStart ? 'S' : ''}
              </div>
            );
          })
        )}
      </div>

      {/* 觸控方向按鈕備份 */}
      <div className="grid grid-cols-3 gap-1.5 mt-3 w-32">
        <div />
        <button
          onClick={() => movePlayer(0, -1)}
          className="p-2 bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-200 border border-slate-700 rounded-lg text-xs font-mono font-bold"
        >
          ▲
        </button>
        <div />
        <button
          onClick={() => movePlayer(-1, 0)}
          className="p-2 bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-200 border border-slate-700 rounded-lg text-xs font-mono font-bold"
        >
          ◀
        </button>
        <button
          onClick={() => movePlayer(0, 1)}
          className="p-2 bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-200 border border-slate-700 rounded-lg text-xs font-mono font-bold"
        >
          ▼
        </button>
        <button
          onClick={() => movePlayer(1, 0)}
          className="p-2 bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-200 border border-slate-700 rounded-lg text-xs font-mono font-bold"
        >
          ▶
        </button>
      </div>
    </div>
  );
};
