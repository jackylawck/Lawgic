// web-frontend/src/components/MazeBoard.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  MazeSpec,
  DeceptionWaypoint,
  TwinLandmarkPair,
  PlayableMazeEngine,
  Direction,
  DIR_ARROWS,
  PreviewResult,
  CellState,
} from '../engines/mazeGenerator';

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

  const engineRef = useRef<PlayableMazeEngine | null>(null);

  const [playerPos, setPlayerPos] = useState<[number, number]>(start);
  const [cellGrid, setCellGrid] = useState<CellState[][]>(spec?.cells || []);
  const [playerPath, setPlayerPath] = useState<[number, number][]>([start]);
  const [currentEntropy, setCurrentEntropy] = useState<number>(0);
  const [undoCount, setUndoCount] = useState<number>(0);
  const [stepCount, setStepCount] = useState<number>(0);

  const [previewHover, setPreviewHover] = useState<PreviewResult | null>(null);

  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [isDarkVision, setIsDarkVision] = useState<boolean>(false);
  const [repelWarning, setRepelWarning] = useState<string | null>(null);
  const [undoNotice, setUndoNotice] = useState<boolean>(false);

  const [isGlitching, setIsGlitching] = useState<boolean>(false);
  const glitchTriggeredRef = useRef<boolean>(false);

  const [ghostMode, setGhostMode] = useState<'none' | 'player' | 'optimal'>('none');
  const [ghostPos, setGhostPos] = useState<[number, number] | null>(null);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [showDeceptionWaypoints, setShowDeceptionWaypoints] = useState<boolean>(false);
  const [selectedWaypoint, setSelectedWaypoint] = useState<DeceptionWaypoint | null>(null);
  const [visitedCounts, setVisitedCounts] = useState<Map<string, number>>(new Map());

  const lastMoveTimeRef = useRef<number>(Date.now());
  const [strategicThoughtTime, setStrategicThoughtTime] = useState<number>(0);

  const updateCellsPartial = useCallback((changedCoords: [number, number][]) => {
    if (!engineRef.current || changedCoords.length === 0) return;
    const engine = engineRef.current;

    setCellGrid((prev) => {
      const newGrid = [...prev];
      const rowsTouched = new Set<number>();

      for (const [x, y] of changedCoords) {
        if (!rowsTouched.has(y)) {
          newGrid[y] = [...newGrid[y]];
          rowsTouched.add(y);
        }
        newGrid[y][x] = { ...engine.cells[y][x] };
      }
      return newGrid;
    });
  }, []);

  const handleFullReset = useCallback(() => {
    if (!spec) return;
    const newEngine = new PlayableMazeEngine(spec);
    engineRef.current = newEngine;

    setPlayerPos([newEngine.pos[0], newEngine.pos[1]]);
    setCellGrid(newEngine.cells.map((r) => r.map((c) => ({ ...c }))));
    setPlayerPath([[newEngine.pos[0], newEngine.pos[1]]]);
    setCurrentEntropy(0);
    setUndoCount(0);
    setStepCount(0);
    setVisitedCounts(new Map([[`${newEngine.pos[0]},${newEngine.pos[1]}`, 1]]));
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
    setRepelWarning(null);
    setPreviewHover(null);
    setUndoNotice(false);
    glitchTriggeredRef.current = false;
    lastMoveTimeRef.current = Date.now();
  }, [spec]);

  useEffect(() => {
    handleFullReset();
  }, [actualPuzzle?.id, handleFullReset]);

  useEffect(() => {
    if (isCompleted) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted, startTime]);

  const handlePhysicsMove = useCallback(
    (dir: Direction): boolean => {
      if (isCompleted || !engineRef.current) return false;

      const now = Date.now();
      const stepDuration = now - lastMoveTimeRef.current;
      lastMoveTimeRef.current = now;

      const engine = engineRef.current;
      const res = engine.step({ type: 'MOVE', dir });

      if (!res.success) {
        if (res.reason === 'REPULSION') {
          setRepelWarning(isEn ? 'Repelled by matching charge!' : '同極相斥，無法踏入！');
          setTimeout(() => setRepelWarning(null), 1000);
        }
        return false;
      }

      setRepelWarning(null);
      setPreviewHover(null);

      const nextPos: [number, number] = [res.landing[0], res.landing[1]];
      setPlayerPos(nextPos);
      setStepCount(engine.steps);
      setCurrentEntropy(engine.computeHammingEntropy());
      updateCellsPartial(res.changedCells);

      setPlayerPath((prev) => [...prev, nextPos]);

      setVisitedCounts((prev) => {
        const next = new Map(prev);
        const key = `${nextPos[0]},${nextPos[1]}`;
        next.set(key, (next.get(key) || 0) + 1);
        return next;
      });

      const distToGoal = Math.abs(nextPos[0] - end[0]) + Math.abs(nextPos[1] - end[1]);
      if (distToGoal <= 2 && spec.hasPhase2MentalGlitch && !glitchTriggeredRef.current) {
        glitchTriggeredRef.current = true;
        setIsGlitching(true);
        setTimeout(() => setIsGlitching(false), 300);
      }

      if (stepDuration > 1500) {
        setStrategicThoughtTime((prev) => prev + stepDuration);
      }

      if (res.hitGoal) {
        setIsCompleted(true);
        const timeSpent = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        const optLen = Math.max(1, optimalSolution.length);
        if (actualPuzzle) {
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: 'maze',
            tier: (actualPuzzle.tier as TierKey) || 'kids',
            cognitiveLoad: actualPuzzle.cognitiveLoad || {
              spatial: 0.95,
              numeric: 0.25,
              workingMemory: 0.85,
              inhibition: 0.9,
            },
            isSuccess: true,
            timeSpentSec: timeSpent,
            conflictsCount: engine.undoCount,
            technique: 'ParityCollapseNavigation',
            isPureClear: playerPath.length <= optLen * 1.15 && engine.undoCount === 0,
          });
        }
      }

      return true;
    },
    [isCompleted, end, spec.hasPhase2MentalGlitch, isEn, startTime, optimalSolution.length, actualPuzzle, recordAttempt, playerPath.length, updateCellsPartial]
  );

  const handlePhysicsRotate = useCallback(() => {
    if (isCompleted || !engineRef.current) return;
    const engine = engineRef.current;
    const res = engine.step({ type: 'ROTATE' });
    if (res.success) {
      setStepCount(engine.steps);
      setCurrentEntropy(engine.computeHammingEntropy());
      updateCellsPartial(res.changedCells);
      setPreviewHover(null);
    }
  }, [isCompleted, updateCellsPartial]);

  const handlePhysicsUndo = useCallback(() => {
    if (isCompleted || !engineRef.current) return;
    const engine = engineRef.current;
    const res = engine.undo();
    if (res.success) {
      setPlayerPos([engine.pos[0], engine.pos[1]]);
      setStepCount(engine.steps);
      setUndoCount(engine.undoCount);
      setCurrentEntropy(engine.computeHammingEntropy());
      updateCellsPartial(res.changedCells);
      setPlayerPath((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
      setPreviewHover(null);
      setUndoNotice(true);
      setTimeout(() => setUndoNotice(false), 800);
    }
  }, [isCompleted, updateCellsPartial]);

  const hoverRafRef = useRef<number | null>(null);
  const handleHoverDir = useCallback(
    (dir: Direction | null) => {
      if (hoverRafRef.current) cancelAnimationFrame(hoverRafRef.current);

      hoverRafRef.current = requestAnimationFrame(() => {
        if (isCompleted || !engineRef.current || dir === null) {
          setPreviewHover(null);
          return;
        }
        const p = engineRef.current.preview(dir);
        setPreviewHover(p);
      });
    },
    [isCompleted]
  );

  useEffect(() => {
    if (ghostMode === 'none') {
      setGhostPos(null);
      return;
    }

    const replayTrack = ghostMode === 'optimal' ? optimalSolution : playerPath;
    if (!replayTrack || replayTrack.length === 0) {
      setGhostMode('none');
      return;
    }

    let idx = 0;
    const interval = setInterval(() => {
      if (idx >= replayTrack.length) {
        setGhostMode('none');
        clearInterval(interval);
        return;
      }
      setGhostPos(replayTrack[idx]);
      idx++;
    }, ghostMode === 'optimal' ? 60 : 90);

    return () => clearInterval(interval);
  }, [ghostMode, optimalSolution, playerPath]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handlePhysicsUndo();
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          e.preventDefault();
          handlePhysicsMove(0);
          break;
        case 'd':
        case 'arrowright':
          e.preventDefault();
          handlePhysicsMove(1);
          break;
        case 's':
        case 'arrowdown':
          e.preventDefault();
          handlePhysicsMove(2);
          break;
        case 'a':
        case 'arrowleft':
          e.preventDefault();
          handlePhysicsMove(3);
          break;
        case ' ':
          e.preventDefault();
          handlePhysicsRotate();
          break;
        case 'v':
          e.preventDefault();
          setIsDarkVision((prev) => !prev);
          break;
        case 'r':
          e.preventDefault();
          handleFullReset();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePhysicsMove, handlePhysicsRotate, handlePhysicsUndo, handleFullReset, isCompleted]);

  const cci = useMemo(() => {
    try {
      return getCompositeCognitiveIndex();
    } catch {
      return { standardIQ: 110 };
    }
  }, [getCompositeCognitiveIndex]);

  const cellSize = Math.max(16, Math.min(340 / Math.max(width, height), 26));

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
      className={`flex flex-col items-center justify-center p-2 select-none font-mono outline-none touch-none transition-colors duration-75 ${
        isGlitching ? 'bg-rose-950/40 ring-4 ring-rose-500' : ''
      }`}
    >
      {/* 數據看板 */}
      <div className="w-full max-w-[360px] mb-2 flex flex-col gap-1 text-[9px]">
        <div className="flex items-center justify-between px-1 text-slate-400">
          <span className="text-cyan-400 font-bold">
            {spec.hasPhase2MentalGlitch
              ? (isEn ? '⚔️ Parity Collapse (Pressure)' : '⚔️ 宇稱坍縮滑動（二階考驗）')
              : (isEn ? '🌀 Deterministic Lattice' : '🌀 確定性晶格迷宮')}
          </span>
          <span className="text-slate-500 text-[8px]">
            {isEn ? 'Hamming Mutation' : '漢明擾動'}: <b className="text-cyan-300">{(currentEntropy * 100).toFixed(1)}%</b>
            {previewHover?.canMove && previewHover.entropyDelta !== 0 && (
              <span className={`font-bold ml-1 animate-pulse ${previewHover.entropyDelta > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                ({previewHover.entropyDelta > 0 ? '+' : ''}{((previewHover.entropyDelta / (2 * width * height)) * 100).toFixed(1)}%)
              </span>
            )}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Time' : '耗時'}</div>
            <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Action Steps / Opt' : '動作步數 / 最優'}</div>
            <div className="text-cyan-300 font-bold">
              {stepCount}/{optimalSolution.length > 0 ? optimalSolution.length : '--'}
            </div>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Undo Penalties' : '撤銷代價'}</div>
            <div className={`font-bold ${undoNotice ? 'text-rose-400 animate-bounce' : 'text-slate-400'}`}>
              +{undoCount} {isEn ? 'steps' : '步'}
            </div>
          </div>
        </div>
      </div>

      {repelWarning && (
        <div className="w-full max-w-[360px] mb-1 py-1 px-2 bg-rose-950/90 border border-rose-500 text-rose-200 text-[9px] text-center font-bold rounded animate-pulse shadow-lg">
          ⚡ {repelWarning}
        </div>
      )}

      {/* 迷宮畫布 */}
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

              const cell = cellGrid[y]?.[x];
              const initialCell = spec.initialCells?.[y]?.[x];
              const isPositive = cell?.charge === 1;
              const visitHeat = visitedCounts.get(`${x},${y}`) || 0;

              const hasRealHammingDistortion = initialCell && (cell.charge !== initialCell.charge || cell.spin !== initialCell.spin);

              const isPreviewLanding = previewHover?.canMove && previewHover.landing[0] === x && previewHover.landing[1] === y;
              const isIntermediateSlip = previewHover?.canMove && previewHover.intermediate && previewHover.intermediate[0] === x && previewHover.intermediate[1] === y;

              let cellBg = 'bg-slate-950';
              if (isWall) {
                cellBg = 'bg-slate-900';
              } else if (cell) {
                if (isPositive) {
                  cellBg = hasRealHammingDistortion
                    ? 'bg-rose-950/60 border border-rose-500/60 shadow-[inset_0_0_5px_rgba(244,63,94,0.4)]'
                    : 'bg-rose-950/20 border border-rose-900/30';
                } else {
                  cellBg = hasRealHammingDistortion
                    ? 'bg-blue-950/60 border border-blue-500/60 shadow-[inset_0_0_5px_rgba(59,130,246,0.4)]'
                    : 'bg-blue-950/20 border border-blue-900/30';
                }
              }

              if (showHeatmap && !isWall && visitHeat > 0) {
                cellBg = visitHeat >= 4 ? 'bg-rose-600/80' : visitHeat >= 2 ? 'bg-amber-500/70' : 'bg-emerald-600/50';
              }

              if (showDeceptionWaypoints && waypointHit) {
                cellBg = 'bg-purple-600/90 shadow-[0_0_8px_rgba(168,85,247,0.9)] animate-pulse';
              }

              if (!isVisible && !isCompleted) {
                cellBg = 'bg-slate-950/95';
              }

              return (
                <div
                  key={`${x}-${y}`}
                  onClick={() => waypointHit && setSelectedWaypoint(waypointHit)}
                  style={{ width: cellSize, height: cellSize }}
                  className={`flex items-center justify-center font-bold text-[8px] transition-colors duration-150 relative ${cellBg} ${
                    waypointHit ? 'cursor-pointer' : ''
                  }`}
                >
                  {isVisible && !isWall && cell && (
                    <>
                      {!isGlitching && (
                        <span
                          className={`text-[8px] font-mono select-none ${
                            hasRealHammingDistortion ? 'opacity-90 font-black' : 'opacity-35'
                          } ${isPositive ? 'text-rose-300' : 'text-blue-300'}`}
                        >
                          {DIR_ARROWS[cell.spin]}
                        </span>
                      )}

                      {isStart && <span className="text-emerald-400 text-[9px] font-black absolute z-10">S</span>}
                      {isEnd && (
                        <span className="text-amber-400 text-[9px] font-black absolute z-10 animate-pulse">★</span>
                      )}
                      {isPseudo && !isEnd && <span className="text-purple-400/80 text-[7px] opacity-60 absolute z-10">✦</span>}
                      {(isTwinA || isTwinB) && !isStart && !isEnd && (
                        <span className="text-amber-400/60 text-[7px] font-bold absolute z-10">♊</span>
                      )}

                      {/* 中間滑動折射點 */}
                      {isIntermediateSlip && (
                        <div className="w-full h-full border-2 border-dashed border-amber-400/90 bg-amber-500/20 absolute z-15" />
                      )}

                      {/* 最終落點標記 */}
                      {isPreviewLanding && (
                        <div className="w-full h-full border-2 border-emerald-400 bg-emerald-500/30 absolute z-15 animate-ping" />
                      )}

                      {/* 玩家實體標記 */}
                      {isPlayer && (
                        <div className="w-[70%] h-[70%] bg-cyan-400 rounded-sm shadow-[0_0_8px_rgba(34,211,238,0.9)] z-20 flex items-center justify-center">
                          <div className="w-1.5 h-1.5 bg-black rounded-full" />
                        </div>
                      )}

                      {/* 幽靈重播標記 */}
                      {isGhost && (
                        <div
                          className={`w-[60%] h-[60%] rounded-full z-20 animate-ping ${
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

      {/* 航點資訊視窗 */}
      {selectedWaypoint && (
        <div className="w-full max-w-[360px] mt-2 p-2 bg-slate-900 border border-purple-500/80 rounded-lg text-[8px] text-slate-200 animate-fade-in font-mono flex items-center justify-between">
          <div>
            <div className="text-purple-300 font-bold">
              {isEn ? '🎯 Critical Fork Waypoint' : '🎯 關鍵分歧點'} [{selectedWaypoint.coordinate[0]}, {selectedWaypoint.coordinate[1]}]
            </div>
            <div className="text-slate-400 text-[7.5px]">
              {isEn ? 'Trap Type' : '陷阱類型'}: {selectedWaypoint.trapType}
            </div>
            <div className="text-rose-400 font-bold text-[8px]">
              {isEn ? 'Estimated Regret' : '估計後悔代價'}: ≈ +{selectedWaypoint.regretCost} {isEn ? 'steps' : '步'}
            </div>
          </div>
          <button onClick={() => setSelectedWaypoint(null)} className="px-2 py-1 bg-slate-800 text-slate-400 rounded hover:text-white">
            {isEn ? 'Close' : '關閉'}
          </button>
        </div>
      )}

      {/* 輔助功能列 */}
      <div className="flex items-center justify-between w-full max-w-[360px] mt-2 gap-1 text-[8.5px] font-bold">
        <button
          onClick={() => setIsDarkVision((prev) => !prev)}
          className={`flex-1 py-1.5 rounded-lg border transition cursor-pointer ${
            isDarkVision ? 'bg-purple-600 text-white border-purple-400' : 'bg-slate-900 text-slate-400 border-slate-800'
          }`}
        >
          {isDarkVision ? (isEn ? '👁️ Fog' : '👁️ 戰霧') : (isEn ? '🌐 Full' : '🌐 全圖')}
        </button>

        <button
          onClick={handlePhysicsUndo}
          className="flex-1 py-1.5 rounded-lg border bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 transition cursor-pointer"
        >
          {isEn ? '↩️ Undo (+1)' : '↩️ 撤銷 (+1步)'}
        </button>

        <button
          onClick={handleFullReset}
          className="flex-1 py-1.5 rounded-lg border bg-slate-900 text-rose-400 border-slate-800 hover:bg-rose-950/30 transition cursor-pointer"
        >
          {isEn ? '🔄 Reset' : '🔄 重置'}
        </button>

        {isCompleted && (
          <>
            <button
              onClick={() => setShowHeatmap((prev) => !prev)}
              className={`flex-1 py-1.5 rounded-lg border transition cursor-pointer ${
                showHeatmap ? 'bg-rose-500 text-black border-rose-400' : 'bg-slate-900 text-slate-300 border-slate-800'
              }`}
            >
              {isEn ? '🔥 Heat' : '🔥 熱力'}
            </button>
            <button
              onClick={() => setGhostMode('optimal')}
              disabled={ghostMode !== 'none' || optimalSolution.length === 0}
              className="flex-1 py-1.5 rounded-lg border bg-slate-900 border-emerald-500/50 text-emerald-300 hover:bg-emerald-950/40 transition cursor-pointer"
            >
              {isEn ? '⚡ Ghost' : '⚡ 幽靈'}
            </button>
          </>
        )}
      </div>

      {/* 控制方向盤 */}
      <div className="grid grid-cols-3 gap-1.5 w-full max-w-[220px] mt-2">
        <div />
        <button
          onMouseEnter={() => handleHoverDir(0)}
          onMouseLeave={() => handleHoverDir(null)}
          onClick={() => handlePhysicsMove(0)}
          className="py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-sm font-bold active:bg-cyan-500 active:text-black"
        >
          ▲
        </button>
        <div />

        <button
          onMouseEnter={() => handleHoverDir(3)}
          onMouseLeave={() => handleHoverDir(null)}
          onClick={() => handlePhysicsMove(3)}
          className="py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-sm font-bold active:bg-cyan-500 active:text-black"
        >
          ◀
        </button>

        <button
          onClick={handlePhysicsRotate}
          className="py-2.5 bg-amber-950/60 hover:bg-amber-900/70 border border-amber-600/70 text-amber-300 rounded-lg text-[9px] font-bold active:scale-95 transition"
        >
          {isEn ? '↻ Spin' : '↻ 轉向'}
        </button>

        <button
          onMouseEnter={() => handleHoverDir(1)}
          onMouseLeave={() => handleHoverDir(null)}
          onClick={() => handlePhysicsMove(1)}
          className="py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-sm font-bold active:bg-cyan-500 active:text-black"
        >
          ▶
        </button>

        <div />
        <button
          onMouseEnter={() => handleHoverDir(2)}
          onMouseLeave={() => handleHoverDir(null)}
          onClick={() => handlePhysicsMove(2)}
          className="py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-sm font-bold active:bg-cyan-500 active:text-black"
        >
          ▼
        </button>
        <div />
      </div>

      {/* 結算評鑑 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border-2 border-emerald-500/90 rounded-2xl text-center w-full max-w-[360px] shadow-2xl animate-fade-in font-mono">
          <div className="text-emerald-400 font-black text-sm uppercase tracking-widest animate-pulse">
            {isEn ? 'CITADEL BREACHED!' : '城堡突破成功！'}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 mb-2">
            {isEn ? 'Time' : '耗時'}: {(elapsedMs / 1000).toFixed(2)}s | Gf: IQ {cci.standardIQ}
          </div>
          <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-lg text-[8px] text-slate-300 text-left space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-400">{isEn ? 'Hamming Residual Mutation' : '全域殘留漢明擾動'}:</span>
              <span className="text-cyan-300 font-bold">{(currentEntropy * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{isEn ? 'Action Steps (with Undo)' : '動作步數代價 (含撤銷)'}:</span>
              <span className="text-amber-400 font-bold">{stepCount} {isEn ? 'steps' : '步'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{isEn ? 'Physical Action Efficiency' : '物理動作效率 (玩家/最優)'}:</span>
              <span className="text-emerald-400 font-bold">
                {optimalSolution.length > 0 ? (stepCount / optimalSolution.length).toFixed(2) : '1.00'}x
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{isEn ? 'Peak Divergence Regret' : '最大分歧後悔'}:</span>
              <span className="text-rose-400 font-bold">
                {spec.maxVisualRegretValue > 0 ? `≈ +${spec.maxVisualRegretValue} ${isEn ? 'steps' : '步'}` : (isEn ? 'Optimal Path Followed' : '完美循跡無走歧')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{isEn ? 'Strategic Thinking Time' : '關鍵決策耗時'}:</span>
              <span className="text-amber-300 font-bold">{(strategicThoughtTime / 1000).toFixed(1)}s</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
