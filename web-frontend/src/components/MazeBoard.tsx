// web-frontend/src/components/MazeBoard.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { MazeSpec, DeceptionWaypoint, TwinLandmarkPair } from '../engines/mazeGenerator';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

export const MazeBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as MazeSpec;
  const width = spec?.width || 17;
  const height = spec?.height || 17;
  const grid = spec?.grid || [];
  const start = spec?.start || [1, 1];
  const end = spec?.end || [width - 2, height - 2];
  const pseudoGoals = spec?.pseudoGoals || [];
  const twinLandmarks: TwinLandmarkPair[] = spec?.twinLandmarks || [];
  const deceptionWaypoints: DeceptionWaypoint[] = spec?.deceptionWaypoints || [];
  const optimalSolution: [number, number][] = (actualPuzzle?.solution as [number, number][]) || [];

  const [playerPos, setPlayerPos] = useState<[number, number]>(start);
  const [visitedCells, setVisitedCells] = useState<Map<string, number>>(new Map());
  const [playerPath, setPlayerPath] = useState<[number, number][]>([start]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [isDarkVision, setIsDarkVision] = useState<boolean>(false);

  // Boss 二階段精神污染短暫閃爍 (Phase 2 Mental Glitch)
  const [isGlitching, setIsGlitching] = useState<boolean>(false);
  const glitchTriggeredRef = useRef<boolean>(false);

  // 雙軌幽靈與賽後病理覆盤
  const [ghostMode, setGhostMode] = useState<'none' | 'player' | 'optimal'>('none');
  const [ghostPos, setGhostPos] = useState<[number, number] | null>(null);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [showDeceptionWaypoints, setShowDeceptionWaypoints] = useState<boolean>(false);
  const [selectedWaypoint, setSelectedWaypoint] = useState<DeceptionWaypoint | null>(null);

  // 長按滑行與宏觀思考計時
  const glideIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastMoveTimeRef = useRef<number>(Date.now());
  const [strategicThoughtTime, setStrategicThoughtTime] = useState<number>(0);

  useEffect(() => {
    setPlayerPos(start);
    setVisitedCells(new Map([[`${start[0]},${start[1]}`, 1]]));
    setPlayerPath([start]);
    setIsCompleted(false);
    setElapsedMs(0);
    setStartTime(Date.now());
    setGhostMode('none');
    setGhostPos(null);
    setShowHeatmap(false);
    setShowDeceptionWaypoints(false);
    setSelectedWaypoint(null);
    setStrategicThoughtTime(0);
    setIsGlitching(false);
    glitchTriggeredRef.current = false;
  }, [actualPuzzle?.id, start]);

  useEffect(() => {
    if (isCompleted) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted, startTime]);

  const tryMove = useCallback(
    (dx: number, dy: number): boolean => {
      if (isCompleted) return false;

      const now = Date.now();
      const stepDuration = now - lastMoveTimeRef.current;
      lastMoveTimeRef.current = now;

      const [cx, cy] = playerPos;
      const nx = cx + dx;
      const ny = cy + dy;

      if (nx < 0 || nx >= width || ny < 0 || ny >= height || grid[ny]?.[nx] === 1) {
        return false;
      }

      // 檢查是否踏入終點門前一格：觸發 Boss 二階段 60ms 視網膜抽搐閃爍
      const distToGoal = Math.abs(nx - end[0]) + Math.abs(ny - end[1]);
      if (distToGoal === 1 && spec.hasPhase2MentalGlitch && !glitchTriggeredRef.current) {
        glitchTriggeredRef.current = true;
        setIsGlitching(true);
        setTimeout(() => setIsGlitching(false), 70);
      }

      let branchExits = 0;
      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [ddx, ddy] of dirs) {
        if (grid[cy + ddy]?.[cx + ddx] === 0) branchExits++;
      }
      if (branchExits >= 3 && stepDuration > 1500) {
        setStrategicThoughtTime((prev) => prev + stepDuration);
      }

      const nextPos: [number, number] = [nx, ny];
      setPlayerPos(nextPos);
      setPlayerPath((prev) => [...prev, nextPos]);
      setVisitedCells((prev) => {
        const next = new Map(prev);
        const key = `${nx},${ny}`;
        next.set(key, (next.get(key) || 0) + (stepDuration > 1000 ? 3 : 1));
        return next;
      });

      if (nx === end[0] && ny === end[1]) {
        setIsCompleted(true);
        if (glideIntervalRef.current) clearInterval(glideIntervalRef.current);
        const timeSpent = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        if (actualPuzzle) {
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: 'maze',
            tier: (actualPuzzle.tier as TierKey) || 'kids',
            cognitiveLoad: actualPuzzle.cognitiveLoad || {
              spatial: 0.95,
              numeric: 0.0,
              workingMemory: 0.85,
              inhibition: 0.9,
            },
            isSuccess: true,
            timeSpentSec: timeSpent,
            conflictsCount: 0,
            technique: 'PsychologicalCitadelNavigation',
            isPureClear: playerPath.length <= optimalSolution.length * 1.15,
          });
        }
      }

      return true;
    },
    [isCompleted, playerPos, width, height, grid, end, startTime, actualPuzzle, recordAttempt, playerPath.length, optimalSolution.length, spec.hasPhase2MentalGlitch]
  );

  const startContinuousGlide = useCallback(
    (dx: number, dy: number) => {
      if (glideIntervalRef.current) clearInterval(glideIntervalRef.current);
      tryMove(dx, dy);

      glideIntervalRef.current = setInterval(() => {
        setPlayerPos((curr) => {
          const [cx, cy] = curr;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || grid[ny]?.[nx] === 1) {
            if (glideIntervalRef.current) clearInterval(glideIntervalRef.current);
            return curr;
          }

          const distToGoal = Math.abs(nx - end[0]) + Math.abs(ny - end[1]);
          if (distToGoal === 1 && spec.hasPhase2MentalGlitch && !glitchTriggeredRef.current) {
            glitchTriggeredRef.current = true;
            setIsGlitching(true);
            setTimeout(() => setIsGlitching(false), 70);
          }

          let exits = 0;
          const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
          for (const [ddx, ddy] of dirs) {
            if (grid[ny + ddy]?.[nx + ddx] === 0) exits++;
          }
          if (exits >= 3) {
            if (glideIntervalRef.current) clearInterval(glideIntervalRef.current);
          }

          const nextPos: [number, number] = [nx, ny];
          setPlayerPath((prev) => [...prev, nextPos]);
          setVisitedCells((prev) => {
            const next = new Map(prev);
            const key = `${nx},${ny}`;
            next.set(key, (next.get(key) || 0) + 1);
            return next;
          });

          if (nx === end[0] && ny === end[1]) {
            setIsCompleted(true);
            if (glideIntervalRef.current) clearInterval(glideIntervalRef.current);
          }

          return nextPos;
        });
      }, 75);
    },
    [tryMove, width, height, grid, end, spec.hasPhase2MentalGlitch]
  );

  const stopContinuousGlide = useCallback(() => {
    if (glideIntervalRef.current) {
      clearInterval(glideIntervalRef.current);
      glideIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (ghostMode === 'none') {
      setGhostPos(null);
      return;
    }

    const replayTrack = ghostMode === 'optimal' ? optimalSolution : playerPath;
    let idx = 0;

    const interval = setInterval(() => {
      if (idx >= replayTrack.length) {
        setGhostMode('none');
        clearInterval(interval);
        return;
      }
      setGhostPos(replayTrack[idx]);
      idx++;
    }, ghostMode === 'optimal' ? 50 : 80);

    return () => clearInterval(interval);
  }, [ghostMode, optimalSolution, playerPath]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          e.preventDefault();
          tryMove(0, -1);
          break;
        case 's':
        case 'arrowdown':
          e.preventDefault();
          tryMove(0, 1);
          break;
        case 'a':
        case 'arrowleft':
          e.preventDefault();
          tryMove(-1, 0);
          break;
        case 'd':
        case 'arrowright':
          e.preventDefault();
          tryMove(1, 0);
          break;
        case 'v':
          e.preventDefault();
          setIsDarkVision((prev) => !prev);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tryMove, isCompleted]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);
  const cellSize = Math.min(320 / Math.max(width, height), 24);

  const isVisibleInDark = useCallback(
    (x: number, y: number): boolean => {
      if (!isDarkVision) return true;
      const dx = Math.abs(x - playerPos[0]);
      const dy = Math.abs(y - playerPos[1]);
      return dx <= 2 && dy <= 2;
    },
    [isDarkVision, playerPos]
  );

  return (
    <div
      onPointerUp={stopContinuousGlide}
      className={`flex flex-col items-center justify-center p-2 select-none font-mono outline-none touch-none transition-colors duration-75 ${
        isGlitching ? 'bg-rose-950/40 ring-4 ring-rose-500' : ''
      }`}
    >
      {/* 數據看板 */}
      <div className="w-full max-w-[340px] mb-2 flex flex-col gap-1 text-[9px]">
        <div className="flex items-center justify-between px-1 text-slate-400">
          <span className="text-cyan-400 font-bold">
            {spec.hasPhase2MentalGlitch ? '⚔️ 深淵監視者（Phase 2 精神污染）' : '🌀 認知波浪迷宮'}
          </span>
          <span className="text-slate-500 text-[8px]">
            Gain: {spec.cognitivePhaseGain || 1.45}x | Overlap: {Math.round((spec.visualOptimalOverlapRatio || 0.3) * 100)}%
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Speed' : '耗時'}</div>
            <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Steps' : '步數比'}</div>
            <div className="text-cyan-300 font-bold">{playerPath.length}/{optimalSolution.length}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Max Regret' : '心智流血量'}</div>
            <div className="text-rose-400 font-bold">{spec.maxVisualRegretValue || 24} 步</div>
          </div>
        </div>
      </div>

      {/* 迷宮主畫布 */}
      <div className="relative p-2 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl flex flex-col items-center">
        <div
          className="grid gap-[1px] bg-slate-900/90 p-[2px] rounded border border-slate-800 relative"
          style={{ gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))` }}
        >
          {grid.map((row, y) =>
            row.map((val, x) => {
              const isWall = val === 1;
              const isStart = x === start[0] && y === start[1];
              const isEnd = x === end[0] && y === end[1];
              const isPseudo = pseudoGoals.some(([px, py]) => px === x && py === y);
              
              const isTwinA = twinLandmarks.some((t) => t.landmarkA[0] === x && t.landmarkA[1] === y);
              const isTwinB = twinLandmarks.some((t) => t.landmarkB[0] === x && t.landmarkB[1] === y);

              const waypointHit = deceptionWaypoints.find((w) => w.coordinate[0] === x && w.coordinate[1] === y);
              const isPlayer = x === playerPos[0] && y === playerPos[1];
              const isGhost = ghostPos && ghostPos[0] === x && ghostPos[1] === y;
              const isVisible = isVisibleInDark(x, y);

              const visitHeat = visitedCells.get(`${x},${y}`) || 0;

              let cellColor = isWall ? 'bg-slate-900' : 'bg-slate-950';

              if (showHeatmap && !isWall && visitHeat > 0) {
                if (visitHeat >= 5) cellColor = 'bg-rose-600/90 shadow-[0_0_6px_rgba(225,29,72,0.8)]';
                else if (visitHeat >= 3) cellColor = 'bg-amber-500/80';
                else cellColor = 'bg-emerald-600/60';
              }

              if (showDeceptionWaypoints && waypointHit) {
                cellColor = 'bg-purple-600/90 shadow-[0_0_8px_rgba(168,85,247,0.9)] animate-pulse';
              }

              if (!isVisible && !isCompleted) {
                cellColor = 'bg-slate-950/95';
              }

              return (
                <div
                  key={`${x}-${y}`}
                  onClick={() => waypointHit && setSelectedWaypoint(waypointHit)}
                  style={{ width: cellSize, height: cellSize }}
                  className={`flex items-center justify-center font-bold text-[8px] transition-colors duration-200 relative ${cellColor} ${
                    waypointHit ? 'cursor-pointer' : ''
                  }`}
                >
                  {isVisible && (
                    <>
                      {isStart && <span className="text-emerald-400 text-[10px] z-10">S</span>}
                      {isEnd && (
                        <span className={`text-[10px] animate-pulse z-10 ${isGlitching ? 'text-rose-500 scale-125' : 'text-amber-400'}`}>
                          {isGlitching ? '❌' : '★'}
                        </span>
                      )}
                      {isPseudo && !isEnd && (
                        <span className="text-purple-400/80 text-[8px] opacity-70 z-10">✦</span>
                      )}
                      {(isTwinA || isTwinB) && !isStart && !isEnd && !isWall && (
                        <span className="text-amber-400/60 text-[7px] font-bold z-10">♊</span>
                      )}
                      {isPlayer && (
                        <div className="w-full h-full bg-cyan-400 rounded-sm shadow-[0_0_8px_rgba(34,211,238,0.9)] animate-pulse z-20" />
                      )}
                      {isGhost && (
                        <div
                          className={`w-full h-full rounded-full z-20 animate-ping ${
                            ghostMode === 'optimal' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]' : 'bg-purple-400'
                          }`}
                        />
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 賽後病理切片彈出卡片 */}
      {selectedWaypoint && (
        <div className="w-full max-w-[340px] mt-2 p-2 bg-slate-900 border border-purple-500/80 rounded-lg text-[8px] text-slate-200 animate-fade-in font-mono flex items-center justify-between">
          <div>
            <div className="text-purple-300 font-bold">🎯 致命欺騙航點 [{selectedWaypoint.coordinate[0]}, {selectedWaypoint.coordinate[1]}]</div>
            <div className="text-slate-400 text-[7.5px]">
              類型: {selectedWaypoint.trapType} | 內部二級分岔: {selectedWaypoint.internalSubForks} 處
            </div>
            <div className="text-rose-400 font-bold">心智流血代價: {selectedWaypoint.regretCost} 步</div>
          </div>
          <button
            onClick={() => setSelectedWaypoint(null)}
            className="px-2 py-1 bg-slate-800 text-slate-400 rounded hover:text-white"
          >
            關閉
          </button>
        </div>
      )}

      {/* 控制按鈕群 */}
      <div className="flex items-center justify-between w-full max-w-[340px] mt-2 gap-1 text-[8.5px] font-bold">
        <button
          onClick={() => setIsDarkVision((prev) => !prev)}
          className={`flex-1 py-1.5 rounded-lg border transition cursor-pointer ${
            isDarkVision
              ? 'bg-purple-600 text-white border-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.4)]'
              : 'bg-slate-900 text-slate-400 border-slate-800'
          }`}
        >
          {isDarkVision ? '👁️ 戰霧' : '🌐 全圖'}
        </button>

        {isCompleted && (
          <>
            <button
              onClick={() => setShowHeatmap((prev) => !prev)}
              className={`flex-1 py-1.5 rounded-lg border transition cursor-pointer ${
                showHeatmap
                  ? 'bg-rose-500 text-black border-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.4)]'
                  : 'bg-slate-900 text-slate-300 border-slate-800'
              }`}
            >
              🔥 熱力
            </button>
            <button
              onClick={() => setShowDeceptionWaypoints((prev) => !prev)}
              className={`flex-1 py-1.5 rounded-lg border transition cursor-pointer ${
                showDeceptionWaypoints
                  ? 'bg-purple-600 text-white border-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.4)]'
                  : 'bg-slate-900 text-purple-300 border-slate-800'
              }`}
            >
              🎯 航點
            </button>
            <button
              onClick={() => setGhostMode('optimal')}
              disabled={ghostMode !== 'none'}
              className="flex-1 py-1.5 rounded-lg border bg-slate-900 border-emerald-500/50 text-emerald-300 hover:bg-emerald-950/40 transition cursor-pointer"
            >
              ⚡ 幽靈
            </button>
          </>
        )}
      </div>

      {/* 虛擬長按連續滑行方向盤 */}
      <div className="grid grid-cols-3 gap-1.5 w-full max-w-[200px] mt-2">
        <div />
        <button
          onPointerDown={() => startContinuousGlide(0, -1)}
          className="py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-sm font-bold active:bg-cyan-500 active:text-black"
        >
          ▲
        </button>
        <div />
        <button
          onPointerDown={() => startContinuousGlide(-1, 0)}
          className="py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-sm font-bold active:bg-cyan-500 active:text-black"
        >
          ◀
        </button>
        <button
          onClick={() => setPlayerPos(start)}
          className="py-2.5 bg-slate-950 border border-slate-800 text-slate-500 rounded-lg text-[9px] font-bold"
        >
          重置
        </button>
        <button
          onPointerDown={() => startContinuousGlide(1, 0)}
          className="py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-sm font-bold active:bg-cyan-500 active:text-black"
        >
          ▶
        </button>
        <div />
        <button
          onPointerDown={() => startContinuousGlide(0, 1)}
          className="py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-sm font-bold active:bg-cyan-500 active:text-black"
        >
          ▼
        </button>
        <div />
      </div>

      {/* 通關評鑑面板 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border-2 border-emerald-500/90 rounded-2xl text-center w-full max-w-[340px] shadow-2xl animate-fade-in font-mono">
          <div className="text-emerald-400 font-black text-sm uppercase tracking-widest animate-pulse">
            CITADEL BREACHED!
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 mb-2">
            Time: {(elapsedMs / 1000).toFixed(2)}s | Gf: IQ {cci.standardIQ}
          </div>
          <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-lg text-[8px] text-slate-300 text-left space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-400">宏觀思考累積加分:</span>
              <span className="text-amber-300 font-bold">{(strategicThoughtTime / 1000).toFixed(1)}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">認知波浪增益 (Phase Gain):</span>
              <span className="text-emerald-400 font-bold">{spec.cognitivePhaseGain || 1.45}x</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">步數效率比 (Player/Opt):</span>
              <span className="text-cyan-300 font-bold">{(playerPath.length / optimalSolution.length).toFixed(2)}x</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">深淵監視者認證:</span>
              <span className="text-purple-400 font-bold">Phase 2 Survived ({deceptionWaypoints.length} Traps)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
