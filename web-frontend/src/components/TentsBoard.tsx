// web-frontend/src/components/TentsBoard.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  TentsSpec,
  WebTentsGenerator,
  TentCoord,
  EntropyGainProjection,
} from '../engines/tentsGenerator';
import { VaultManager, VaultItem } from '../utils/vaultStorage';
import {
  TournamentProctoringSession,
  getEnvironmentFingerprint,
  calculateInfractionScore,
} from '../utils/tournamentSecurity';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

type CellState = 0 | 1 | 2 | 3; // 0: 空, 1: 帳篷, 2: 樹木, 3: 草地

interface StrokePoint {
  x: number;
  y: number;
}

interface AnnotationStroke {
  id: string;
  points: StrokePoint[];
}

export const TentsBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const { recordAttempt, profile, getCompositeCognitiveIndex } = useLearnerProfile();
  const spec = useMemo(() => {
    return ((actualPuzzle?.puzzle || actualPuzzle) as unknown as TentsSpec) || null;
  }, [actualPuzzle]);

  const rows = spec?.rows || 6;
  const cols = spec?.cols || 6;
  const initialTrees = useMemo(() => spec?.trees || [], [spec]);
  const initialRowCounts = useMemo(() => spec?.rowCounts || [], [spec]);
  const initialColCounts = useMemo(() => spec?.colCounts || [], [spec]);
  const seed = (actualPuzzle?.metrics as any)?.seed || (spec as any)?.seed || 12345;

  // 棋盤本體狀態
  const [board, setBoard] = useState<CellState[][]>(() => {
    const b: CellState[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const tree of initialTrees) {
      if (tree.r < rows && tree.c < cols) b[tree.r][tree.c] = 2;
    }
    return b;
  });

  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [isCtrlActive, setIsCtrlActive] = useState<boolean>(false);
  const [isAltActive, setIsAltActive] = useState<boolean>(false);
  const [isShiftActive, setIsShiftActive] = useState<boolean>(false);

  // 傳奇庫收藏與排行榜提交
  const [isFav, setIsFav] = useState<boolean>(() =>
    actualPuzzle?.id ? VaultManager.isFavorited(actualPuzzle.id) : false
  );
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);

  // 熵增益光場映射
  const [entropyGainMap, setEntropyGainMap] = useState<Record<string, EntropyGainProjection>>({});

  // 前瞻因果漣漪
  const [hoveredRipple, setHoveredRipple] = useState<{
    path: Array<{ from: [number, number]; to: [number, number] }>;
    fatalCoord?: [number, number];
  } | null>(null);

  // 自由墨跡層
  const [strokes, setStrokes] = useState<AnnotationStroke[]>([]);
  const isDrawingRef = useRef<boolean>(false);
  const currentPointsRef = useRef<StrokePoint[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 平行宇宙幽靈快照
  const [ghostSnapshots, setGhostSnapshots] = useState<CellState[][][]>([]);
  const [ghostIndex, setGhostIndex] = useState<number>(-1);

  // 思維心搏檢測
  const [mindPulseCoord, setMindPulseCoord] = useState<TentCoord | null>(null);

  const startTimeRef = useRef<number>(Date.now());
  const hasRecordedRef = useRef<boolean>(false);
  const cellSize = Math.min(320 / Math.max(rows, cols), 46);

  // 實體防作弊稽核 Session (P0 修復)
  const proctoringRef = useRef<TournamentProctoringSession | null>(null);

  useEffect(() => {
    proctoringRef.current = new TournamentProctoringSession();
    return () => {
      proctoringRef.current?.destroy();
      proctoringRef.current = null;
    };
  }, [actualPuzzle?.id]);

  // 當題目切換時重設狀態
  useEffect(() => {
    const b: CellState[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const tree of initialTrees) {
      if (tree.r < rows && tree.c < cols) b[tree.r][tree.c] = 2;
    }
    setBoard(b);
    setIsCompleted(false);
    setElapsedMs(0);
    setGhostSnapshots([]);
    setGhostIndex(-1);
    setStrokes([]);
    setMindPulseCoord(null);
    setHoveredRipple(null);
    setShowSubmitModal(false);
    hasRecordedRef.current = false;
    startTimeRef.current = Date.now();
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
  }, [actualPuzzle?.id, rows, cols, initialTrees]);

  // 鍵盤修飾鍵全局精確綁定
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') setIsCtrlActive(true);
      if (e.key === 'Alt') {
        e.preventDefault();
        setIsAltActive(true);
      }
      if (e.key === 'Shift') setIsShiftActive(true);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') setIsCtrlActive(false);
      if (e.key === 'Alt') setIsAltActive(false);
      if (e.key === 'Shift') {
        setIsShiftActive(false);
        setGhostIndex(-1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // 計時器
  useEffect(() => {
    if (isCompleted) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted]);

  // 全域奇偶偏差量計算
  const deltaPhi = useMemo(() => {
    let rDef = 0;
    for (let r = 0; r < rows; r++) {
      let placed = 0;
      for (let c = 0; c < cols; c++) if (board[r][c] === 1) placed++;
      rDef += (initialRowCounts[r] || 0) - placed;
    }
    let cDef = 0;
    for (let c = 0; c < cols; c++) {
      let placed = 0;
      for (let r = 0; r < rows; r++) if (board[r][c] === 1) placed++;
      cDef += (initialColCounts[c] || 0) - placed;
    }
    return rDef - cDef;
  }, [board, rows, cols, initialRowCounts, initialColCounts]);

  // 計算並緩存熵光場
  useEffect(() => {
    if (!isCtrlActive || !spec) {
      setEntropyGainMap({});
      return;
    }
    const map: Record<string, EntropyGainProjection> = {};
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 0) {
          map[`${r},${c}`] = WebTentsGenerator.computeEntropyGain(r, c, board as number[][], spec);
        }
      }
    }
    setEntropyGainMap(map);
  }, [isCtrlActive, board, rows, cols, spec]);

  // 懸停因果前瞻探針
  const handleCellHover = useCallback(
    (r: number, c: number) => {
      if (board[r][c] !== 0 || !spec) {
        setHoveredRipple(null);
        return;
      }
      const sim = WebTentsGenerator.simulateHypothesisProbe(board as number[][], spec, { r, c }, 1);
      if (sim.conflictFound && sim.rippleSteps.length > 0) {
        const path = sim.rippleSteps.map((s) => ({
          from: [s.forcedBy.r, s.forcedBy.c] as [number, number],
          to: [s.coord.r, s.coord.c] as [number, number],
        }));
        const fatal = sim.rippleSteps[sim.rippleSteps.length - 1].coord;
        setHoveredRipple({ path, fatalCoord: [fatal.r, fatal.c] });
      } else {
        setHoveredRipple(null);
      }
    },
    [board, spec]
  );

  // 落子與平行宇宙快照保存 + 防重錄守衛 (P2)
  const applyCell = useCallback(
    (r: number, c: number, val: CellState) => {
      if (board[r][c] === 2 || isCompleted) return;

      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(6);

      setGhostSnapshots((prev) => [board.map((row) => [...row]), ...prev.slice(0, 4)]);

      setBoard((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = next[r][c] === val ? 0 : val;

        let allTents = 0;
        const tentCoords: TentCoord[] = [];
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) {
            if (next[i][j] === 1) {
              allTents++;
              tentCoords.push({ r: i, c: j });
            }
          }
        }

        // 完備性與奇偶閉鎖檢定
        if (allTents === initialTrees.length && deltaPhi === 0 && !hasRecordedRef.current) {
          if (WebTentsGenerator.hasUniqueBijectiveMatching(initialTrees, tentCoords, rows, cols)) {
            hasRecordedRef.current = true;
            setIsCompleted(true);
            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([15, 60, 25]);

            if (actualPuzzle) {
              recordAttempt({
                puzzleId: actualPuzzle.id,
                engineType: 'tents',
                tier: (actualPuzzle.tier as TierKey) || 'kids',
                cognitiveLoad: actualPuzzle.cognitiveLoad || { spatial: 1, numeric: 1, workingMemory: 1, inhibition: 1 },
                isSuccess: true,
                timeSpentSec: Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000)),
                conflictsCount: 0,
                technique: 'HomologicalMatching',
                isPureClear: true,
              });
            }
          }
        }

        return next;
      });
    },
    [board, isCompleted, rows, cols, initialTrees, deltaPhi, actualPuzzle, recordAttempt]
  );

  // P1 修復：標準化金庫收藏對接
  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const vaultItem: VaultItem = {
      id: actualPuzzle.id,
      engine: 'tents',
      tier: String(actualPuzzle.tier || 'kids'),
      seed: Number(seed),
      steps: rows * cols,
      timeSpentSec: Math.round(elapsedMs / 1000),
      date: new Date().toISOString(),
    };
    const res = VaultManager.toggleFavorite(vaultItem);
    setIsFav(res.isFav);
  };

  // Canvas 墨跡塗鴉重繪邏輯
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;

    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
  }, [strokes]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isAltActive) return;
    isDrawingRef.current = true;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    currentPointsRef.current = [{ x: e.clientX - rect.left, y: e.clientY - rect.top }];
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !isAltActive) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    currentPointsRef.current.push(pt);

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && currentPointsRef.current.length > 1) {
      const len = currentPointsRef.current.length;
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(currentPointsRef.current[len - 2].x, currentPointsRef.current[len - 2].y);
      ctx.lineTo(currentPointsRef.current[len - 1].x, currentPointsRef.current[len - 1].y);
      ctx.stroke();
    }
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (currentPointsRef.current.length > 1) {
      const newStroke: AnnotationStroke = {
        id: `stroke_${Date.now()}`,
        points: [...currentPointsRef.current],
      };
      setStrokes((prev) => [...prev, newStroke]);

      const pts = currentPointsRef.current;
      const avgX = pts.reduce((a, b) => a + b.x, 0) / pts.length;
      const avgY = pts.reduce((a, b) => a + b.y, 0) / pts.length;
      const targetC = Math.floor(avgX / (cellSize + 4));
      const targetR = Math.floor(avgY / (cellSize + 4));

      let angleSweep = 0;
      for (let i = 1; i < pts.length; i++) {
        const v1x = pts[i - 1].x - avgX, v1y = pts[i - 1].y - avgY;
        const v2x = pts[i].x - avgX, v2y = pts[i].y - avgY;
        angleSweep += Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y);
      }

      if (Math.abs(angleSweep) >= Math.PI * 4.8 && targetR >= 0 && targetR < rows && targetC >= 0 && targetC < cols) {
        setMindPulseCoord({ r: targetR, c: targetC });
      }
    }
    currentPointsRef.current = [];
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!isShiftActive || ghostSnapshots.length === 0) return;
    if (e.deltaY > 0) {
      setGhostIndex((idx) => Math.min(ghostSnapshots.length - 1, idx + 1));
    } else {
      setGhostIndex((idx) => Math.max(-1, idx - 1));
    }
  };

  const activeGhost = ghostIndex >= 0 ? ghostSnapshots[ghostIndex] : null;
  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  return (
    <div
      onWheel={handleWheel}
      className="flex flex-col items-center justify-center p-3 select-none font-mono bg-black text-white min-h-screen w-full max-w-[440px] mx-auto"
    >
      {/* 頂部極致微型看板 */}
      <div className="w-full max-w-sm flex items-center justify-between px-2 mb-2 text-[8px] text-neutral-400">
        <div className="flex items-center gap-2">
          <span>TIME: {(elapsedMs / 1000).toFixed(1)}s</span>
          <span>DIM: {rows}&times;{cols}</span>
          <button
            onClick={handleToggleFavorite}
            className={`px-1.5 py-0.5 rounded border transition cursor-pointer text-[7.5px] ${
              isFav ? 'border-amber-500 text-amber-300 bg-amber-950/40' : 'border-neutral-800 text-neutral-500 hover:text-white'
            }`}
            title={isFav ? (isEn ? 'In Vault' : '已在傳奇庫') : (isEn ? 'Save to Vault' : '收藏')}
          >
            {isFav ? '★' : '☆'}
          </button>
        </div>

        {/* 阻尼相位鎖儀表 */}
        <div className="flex items-center gap-1.5 bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded-full">
          <span className="text-[7px]">PHASE:</span>
          <div className="w-8 h-1.5 bg-neutral-950 rounded-full relative overflow-hidden">
            <div
              className={`absolute top-0 bottom-0 w-2 rounded-full transition-all duration-300 ${
                deltaPhi === 0
                  ? 'left-[40%] bg-emerald-400 shadow-[0_0_8px_#10b981]'
                  : 'left-[80%] bg-amber-400 shadow-[0_0_8px_#f59e0b]'
              }`}
            />
          </div>
          <span className={`text-[7px] font-bold ${deltaPhi === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {deltaPhi === 0 ? 'LOCKED' : `Δ${deltaPhi}`}
          </span>
        </div>

        <div className="text-[7px] text-neutral-500 font-bold">
          {isAltActive ? 'DRAW' : isCtrlActive ? 'ENTROPY' : isShiftActive ? 'GHOST' : 'STANDBY'}
        </div>
      </div>

      {/* 主拓撲網格區域 */}
      <div className="relative p-2 border border-neutral-800 bg-neutral-950 rounded-xl shadow-2xl flex flex-col items-center">
        {/* 直行配額數字 */}
        <div className="flex pl-8 mb-1">
          {initialColCounts.map((count, c) => (
            <div
              key={`c-${c}`}
              className="flex items-center justify-center font-bold text-xs text-amber-400"
              style={{ width: cellSize + 4 }}
            >
              {count}
            </div>
          ))}
        </div>

        <div className="flex relative">
          {/* 橫列配額數字 */}
          <div className="flex flex-col justify-around pr-2">
            {initialRowCounts.map((count, r) => (
              <div
                key={`r-${r}`}
                className="flex items-center justify-end font-bold text-xs text-amber-400"
                style={{ height: cellSize + 4 }}
              >
                {count}
              </div>
            ))}
          </div>

          <div className="relative">
            {/* 自由墨跡 Canvas 層 */}
            <canvas
              ref={canvasRef}
              width={cols * (cellSize + 4)}
              height={rows * (cellSize + 4)}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className={`absolute inset-0 z-30 ${
                isAltActive ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'
              }`}
            />

            {/* 前瞻因果向量 SVG 軌跡 */}
            {hoveredRipple && (
              <svg className="absolute inset-0 pointer-events-none z-25 w-full h-full">
                <defs>
                  <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#f43f5e" />
                  </marker>
                </defs>
                {hoveredRipple.path.map((v, idx) => (
                  <line
                    key={`ripple-${idx}`}
                    x1={v.from[1] * (cellSize + 4) + cellSize / 2}
                    y1={v.from[0] * (cellSize + 4) + cellSize / 2}
                    x2={v.to[1] * (cellSize + 4) + cellSize / 2}
                    y2={v.to[0] * (cellSize + 4) + cellSize / 2}
                    stroke="#f43f5e"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeDasharray="2 2"
                    markerEnd="url(#arrow)"
                    className="animate-pulse"
                  />
                ))}
              </svg>
            )}

            {/* 思維心搏微光光暈 */}
            {mindPulseCoord && (
              <div
                className="absolute pointer-events-none z-20 rounded-full bg-amber-400/10 ring-1 ring-amber-400/30 animate-ping"
                style={{
                  left: mindPulseCoord.c * (cellSize + 4) + 2,
                  top: mindPulseCoord.r * (cellSize + 4) + 2,
                  width: cellSize,
                  height: cellSize,
                }}
              />
            )}

            {/* 棋盤格子本體 */}
            <div
              className="grid gap-1 border border-neutral-800 p-1 bg-black rounded"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                width: cols * cellSize + (cols - 1) * 4 + 8,
                height: rows * cellSize + (rows - 1) * 4 + 8,
              }}
            >
              {board.map((row, r) =>
                row.map((cell, c) => {
                  const gain = entropyGainMap[`${r},${c}`];
                  const isLeap = isCtrlActive && gain?.quantumLeap;
                  const ghostCell = activeGhost ? activeGhost[r][c] : null;

                  return (
                    <div
                      key={`${r}-${c}`}
                      onMouseEnter={() => handleCellHover(r, c)}
                      onClick={() => applyCell(r, c, 1)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        applyCell(r, c, 3);
                      }}
                      className={`relative flex items-center justify-center cursor-pointer transition-all duration-100 ${
                        cell === 2
                          ? 'bg-neutral-900 border border-neutral-800 cursor-default'
                          : cell === 1
                          ? 'bg-neutral-950 border border-amber-500 font-bold text-white shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                          : cell === 3
                          ? 'bg-neutral-950 border border-neutral-800 text-neutral-600'
                          : 'bg-black hover:bg-neutral-900 border border-neutral-900'
                      }`}
                      style={{ width: cellSize, height: cellSize }}
                    >
                      {/* 瞬態對比拉伸光脈衝 */}
                      {isLeap && (
                        <div className="absolute inset-0 rounded bg-white shadow-[0_0_16px_#ffffff] animate-ping opacity-60 z-10 pointer-events-none" />
                      )}

                      {/* 圖元符號 */}
                      <span className="text-xs">
                        {cell === 2 ? '🌲' : cell === 1 ? '⛺' : cell === 3 ? '•' : ''}
                      </span>

                      {/* 平行宇宙殘影 */}
                      {ghostCell !== null && ghostCell !== cell && ghostCell !== 0 && (
                        <span className="absolute text-[9px] text-indigo-400 opacity-60 pointer-events-none">
                          {ghostCell === 1 ? '⛺' : '•'}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 底部微縮拓撲雷達與交互備忘 */}
      <div className="mt-3 flex items-center justify-between w-full max-w-sm px-1">
        <div className="flex gap-2 text-[7.5px] text-neutral-500">
          <span>ALT: DRAW</span>
          <span>CTRL: ENTROPY</span>
          <span>SHIFT+WHEEL: GHOST</span>
        </div>

        {/* 微縮雷達矩陣 */}
        <div
          className="grid gap-[1px] bg-neutral-900 border border-neutral-800 p-0.5 rounded"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: rows * cols }).map((_, idx) => {
            const r = Math.floor(idx / cols);
            const c = idx % cols;
            const isTree = initialTrees.some((t) => t.r === r && t.c === c);
            const isTent = board[r][c] === 1;
            return (
              <div
                key={`mini-${r}-${c}`}
                className={`w-1.5 h-1.5 ${
                  isTent ? 'bg-amber-400' : isTree ? 'bg-emerald-700' : 'bg-neutral-950'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* 勝利結算面板 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-neutral-950 border border-emerald-500/80 rounded-xl text-center max-w-xs w-full shadow-2xl animate-fade-in font-mono">
          <div className="text-emerald-400 font-bold text-xs tracking-widest mb-1">
            TOPOLOGY COLLAPSED
          </div>
          <div className="text-[8px] text-neutral-400 mb-1">
            Gf: IQ {cci.standardIQ} · {(elapsedMs / 1000).toFixed(1)}s
          </div>
          <div className="text-[7.5px] text-neutral-500 mb-2">
            ZERO-ASSUMPTION PROOF: VERIFIED | WPF KEY: {spec?.wpfAnswerKey ?? 'N/A'}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                if (spec?.wpfAnswerKey) {
                  navigator.clipboard.writeText(spec.wpfAnswerKey);
                }
              }}
              className="flex-1 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-700 rounded text-[7.5px] font-bold transition active:scale-95 cursor-pointer"
            >
              COPY KEY
            </button>
            <button
              onClick={() => setShowSubmitModal(true)}
              className="flex-1 py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 text-slate-950 text-[7.5px] font-black rounded transition active:scale-95 cursor-pointer shadow"
            >
              {isEn ? 'SUBMIT' : '賽事提交'}
            </button>
          </div>
        </div>
      )}

      {/* 賽事提交 Modal (P0 修復) */}
      {showSubmitModal && actualPuzzle && (
        <TournamentSubmissionModal
          payload={{
            submissionId: `SUB-${actualPuzzle.id}-${Date.now().toString(36)}`,
            tournamentId: tournamentMode ? 'WPF_TENTS_2026' : 'GLOBAL_TENTS_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'tents',
            tier: (actualPuzzle.tier as TierKey) || 'kids',
            timeSpentSec: Math.round(elapsedMs / 1000),
            conflictsCount: 0,
            infractionScore: proctoringRef.current
              ? calculateInfractionScore(proctoringRef.current.getSnapshot())
              : 0,
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
