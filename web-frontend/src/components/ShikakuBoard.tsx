// web-frontend/src/components/ShikakuBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { ShikakuSpec, ShikakuRect } from '../engines/shikakuGenerator';
import { VaultManager, VaultItem } from '../utils/vaultStorage';
import {
  TournamentProctoringSession,
  getEnvironmentFingerprint,
  calculateInfractionScore,
} from '../utils/tournamentSecurity';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

export const ShikakuBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, profile, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec: ShikakuSpec = (actualPuzzle as any)?.puzzle || (actualPuzzle as any)?.spec;
  const rows = spec?.rows || 8;
  const cols = spec?.cols || 8;
  const grid = useMemo(() => spec?.grid || [], [spec]);
  const currentTier = (actualPuzzle?.tier as TierKey) || 'ultimate';
  const seed = (actualPuzzle?.metrics as any)?.seed || (spec as any)?.seed || 12345;

  const [placedRects, setPlacedRects] = useState<ShikakuRect[]>([]);
  const [dragStart, setDragStart] = useState<[number, number] | null>(null);
  const [dragCurrent, setDragCurrent] = useState<[number, number] | null>(null);
  const [evaporatingIdx, setEvaporatingIdx] = useState<number | null>(null);
  const [inspectedIdx, setInspectedIdx] = useState<number | null>(null);

  // 物理態：奇異點坍縮與真空靜息態
  const [isCollapsing, setIsCollapsing] = useState<boolean>(false);
  const [collapseCentroid, setCollapseCentroid] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [isSingularityDormant, setIsSingularityDormant] = useState<boolean>(false);

  // 金庫收藏與排行榜提交
  const [isFav, setIsFav] = useState<boolean>(() =>
    actualPuzzle?.id ? VaultManager.isFavorited(actualPuzzle.id) : false
  );
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);

  const startTimeRef = useRef<number>(Date.now());
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const movesCount = useRef<number>(0);
  const lastRectTapRef = useRef<{ idx: number; timestamp: number }>({ idx: -1, timestamp: 0 });
  const hasRecordedRef = useRef<boolean>(false);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);

  // 實體防作弊稽核 Session
  const proctoringRef = useRef<TournamentProctoringSession | null>(null);

  useEffect(() => {
    proctoringRef.current = new TournamentProctoringSession();
    return () => {
      proctoringRef.current?.destroy();
      proctoringRef.current = null;
    };
  }, [actualPuzzle?.id]);

  useEffect(() => {
    setPlacedRects([]);
    setDragStart(null);
    setDragCurrent(null);
    setEvaporatingIdx(null);
    setInspectedIdx(null);
    setIsCollapsing(false);
    setIsSingularityDormant(false);
    setShowSubmitModal(false);
    startTimeRef.current = Date.now();
    setElapsedSec(0);
    movesCount.current = 0;
    hasRecordedRef.current = false;
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
  }, [actualPuzzle?.id, rows, cols]);

  useEffect(() => {
    if (isCollapsing || isSingularityDormant) return;
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isCollapsing, isSingularityDormant]);

  // 觸覺震動編碼
  const emitSpacetimeHapticTelemetry = useCallback((seconds: number, moves: number) => {
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;

    const pattern: number[] = [];
    const secTens = Math.floor(seconds / 10);
    const secUnits = seconds % 10;

    for (let i = 0; i < secTens; i++) pattern.push(450, 120);
    pattern.push(0, 250);
    for (let i = 0; i < secUnits; i++) pattern.push(70, 90);

    pattern.push(0, 600);

    const moveTens = Math.floor(moves / 10);
    const moveUnits = moves % 10;
    for (let i = 0; i < moveTens; i++) pattern.push(450, 120);
    pattern.push(0, 250);
    for (let i = 0; i < moveUnits; i++) pattern.push(70, 90);

    navigator.vibrate(pattern);
  }, []);

  // 盤面有效線索點集
  const activeClues = useMemo(() => {
    const list: { r: number; c: number; area: number; isPrime: boolean }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = grid[r]?.[c];
        if (val !== null && val !== undefined) {
          const isPrime = val > 1 && [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31].includes(val);
          list.push({ r, c, area: val, isPrime });
        }
      }
    }
    return list;
  }, [grid, rows, cols]);

  // 八分節段頂點接觸奇偶光流 (Octant Segmented Vertex Parity)
  const octantParity = useMemo(() => {
    const segments = Array(8).fill(0);
    const midR = rows / 2;
    const midC = cols / 2;

    const cover = Array.from({ length: rows }, () => Array(cols).fill(0));
    let conflicts = 0;
    let emptyCells = 0;

    placedRects.forEach((r) => {
      for (let ir = r.r; ir < r.r + r.h; ir++) {
        for (let ic = r.c; ic < r.c + r.w; ic++) {
          if (ir < rows && ic < cols) cover[ir][ic]++;
        }
      }

      const corners: [number, number][] = [
        [r.r, r.c],
        [r.r, r.c + r.w],
        [r.r + r.h, r.c],
        [r.r + r.h, r.c + r.w],
      ];

      corners.forEach(([cr, cc]) => {
        if (cr === 0) segments[cc < midC ? 0 : 1] += 1;
        if (cc === cols) segments[cr < midR ? 2 : 3] += 1;
        if (cr === rows) segments[cc >= midC ? 4 : 5] += 1;
        if (cc === 0) segments[cr >= midR ? 6 : 7] += 1;
      });
    });

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cover[r][c] > 1) conflicts++;
        else if (cover[r][c] === 0) emptyCells++;
      }
    }

    const defectMask = segments.map((vertexCount) => vertexCount % 2 !== 0);
    const isResolved = conflicts === 0 && emptyCells === 0 && placedRects.length > 0;

    return { defectMask, hasDefects: defectMask.some(Boolean), isResolved };
  }, [placedRects, rows, cols]);

  // 奇異點引力坍縮序列
  useEffect(() => {
    if (octantParity.isResolved && !isCollapsing && !isSingularityDormant && !hasRecordedRef.current) {
      hasRecordedRef.current = true;
      const last = placedRects[placedRects.length - 1];
      const cx = last ? ((last.c + last.w / 2) / cols) * 100 : 50;
      const cy = last ? ((last.r + last.h / 2) / rows) * 100 : 50;
      setCollapseCentroid({ x: cx, y: cy });

      setIsCollapsing(true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([15, 60, 90]);

      setTimeout(() => {
        setIsCollapsing(false);
        setIsSingularityDormant(true);

        const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        setElapsedSec(duration);

        emitSpacetimeHapticTelemetry(duration, movesCount.current);

        if (actualPuzzle) {
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: 'shikaku',
            tier: currentTier,
            cognitiveLoad: actualPuzzle.cognitiveLoad || {
              spatial: 0.96,
              numeric: 0.94,
              workingMemory: 0.92,
              inhibition: 0.9,
            },
            isSuccess: true,
            timeSpentSec: duration,
            conflictsCount: 0,
            technique: 'SingularityParityConvergence',
            irtDifficulty: 5.5,
            isPureClear: true,
            partialCredit: 1.0,
          });
        }
      }, 850);
    }
  }, [
    octantParity.isResolved,
    isCollapsing,
    isSingularityDormant,
    placedRects,
    cols,
    rows,
    actualPuzzle,
    currentTier,
    recordAttempt,
    emitSpacetimeHapticTelemetry,
  ]);

  // 雙擊退火蒸發與單擊審視
  const handleRectTouch = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCollapsing || isSingularityDormant) return;

    const now = Date.now();
    const prev = lastRectTapRef.current;

    if (prev.idx === idx && now - prev.timestamp < 280) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(45);
      setEvaporatingIdx(idx);
      setTimeout(() => {
        setPlacedRects((cur) => cur.filter((_, i) => i !== idx));
        setEvaporatingIdx(null);
        setInspectedIdx(null);
      }, 150);
      lastRectTapRef.current = { idx: -1, timestamp: 0 };
    } else {
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(6);
      setInspectedIdx((curr) => (curr === idx ? null : idx));
      lastRectTapRef.current = { idx, timestamp: now };
    }
  }, [isCollapsing, isSingularityDormant]);

  // 因果張量質量場預覽
  const previewPhysics = useMemo(() => {
    if (!dragStart || !dragCurrent) return null;
    const minR = Math.min(dragStart[0], dragCurrent[0]);
    const maxR = Math.max(dragStart[0], dragCurrent[0]);
    const minC = Math.min(dragStart[1], dragCurrent[1]);
    const maxC = Math.max(dragStart[1], dragCurrent[1]);
    const w = maxC - minC + 1;
    const h = maxR - minR + 1;

    let blockedPrimes = 0;
    activeClues.forEach((clue) => {
      const isInside = clue.r >= minR && clue.r <= maxR && clue.c >= minC && clue.c <= maxC;
      if (!isInside && clue.isPrime) {
        const isHBlocked = clue.r >= minR && clue.r <= maxR;
        const isVBlocked = clue.c >= minC && clue.c <= maxC;
        if (isHBlocked || isVBlocked) blockedPrimes++;
      }
    });

    const massTension = Math.min(1.0, 0.25 + (blockedPrimes / Math.max(1, activeClues.length * 0.4)) * 0.75);

    return {
      top: `${(minR / rows) * 100}%`,
      left: `${(minC / cols) * 100}%`,
      width: `${(w / cols) * 100}%`,
      height: `${(h / rows) * 100}%`,
      luminance: massTension,
    };
  }, [dragStart, dragCurrent, rows, cols, activeClues]);

  const handlePointerCommit = useCallback(() => {
    if (dragStart && dragCurrent) {
      const minR = Math.min(dragStart[0], dragCurrent[0]);
      const maxR = Math.max(dragStart[0], dragCurrent[0]);
      const minC = Math.min(dragStart[1], dragCurrent[1]);
      const maxC = Math.max(dragStart[1], dragCurrent[1]);

      let numR = minR;
      let numC = minC;
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          if (grid[r]?.[c] !== null && grid[r]?.[c] !== undefined) {
            numR = r;
            numC = c;
            break;
          }
        }
      }

      const rect: ShikakuRect = {
        r: minR,
        c: minC,
        w: maxC - minC + 1,
        h: maxR - minR + 1,
        numberR: numR,
        numberC: numC,
      };

      movesCount.current++;
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
      setPlacedRects((prev) => [
        ...prev.filter((r) => !(r.r === rect.r && r.c === rect.c && r.w === rect.w && r.h === rect.h)),
        rect,
      ]);
    }
    setDragStart(null);
    setDragCurrent(null);
  }, [dragStart, dragCurrent, grid]);

  // 全局 PointerUp 防止游標拖出棋盤外時卡住
  useEffect(() => {
    const handleGlobalUp = () => {
      if (dragStart) {
        handlePointerCommit();
      }
    };
    window.addEventListener('mouseup', handleGlobalUp);
    window.addEventListener('touchend', handleGlobalUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('touchend', handleGlobalUp);
    };
  }, [dragStart, handlePointerCommit]);

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragStart || !gridContainerRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const cellEl = target?.closest?.('[data-shikaku-cell]') as HTMLElement | null;
    if (cellEl) {
      const r = parseInt(cellEl.dataset.r || '-1', 10);
      const c = parseInt(cellEl.dataset.c || '-1', 10);
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        setDragCurrent([r, c]);
      }
    }
  };

  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const vaultItem: VaultItem = {
      id: actualPuzzle.id,
      engine: 'shikaku',
      tier: String(actualPuzzle.tier || 'ultimate'),
      seed: Number(seed),
      steps: movesCount.current,
      timeSpentSec: elapsedSec,
      date: new Date().toISOString(),
    };
    const res = VaultManager.toggleFavorite(vaultItem);
    setIsFav(res.isFav);
  };

  const handleUndo = () => {
    if (placedRects.length === 0 || isCollapsing || isSingularityDormant) return;
    setPlacedRects((prev) => prev.slice(0, -1));
  };

  const handleClearAll = () => {
    if (isCollapsing || isSingularityDormant) return;
    setPlacedRects([]);
    setInspectedIdx(null);
  };

  const cci = useMemo(() => {
    try {
      return getCompositeCognitiveIndex();
    } catch {
      return { standardIQ: 110 };
    }
  }, [getCompositeCognitiveIndex]);

  if (!actualPuzzle) {
    return null;
  }

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono outline-none touch-none w-full max-w-[420px] mx-auto">
      {/* 頂部 HUD */}
      <div className="w-full max-w-[340px] mb-2 flex items-center justify-between px-2 text-[9px] text-neutral-400">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold tracking-widest">SHIKAKU</span>
          <button
            onClick={handleToggleFavorite}
            className={`px-1.5 py-0.5 rounded border transition cursor-pointer text-[8px] ${
              isFav ? 'border-amber-500 text-amber-300 bg-amber-950/40' : 'border-neutral-800 text-neutral-500 hover:text-white'
            }`}
            title={isFav ? (isEn ? 'In Vault' : '已在傳奇庫') : (isEn ? 'Save to Vault' : '收藏')}
          >
            {isFav ? '★' : '☆'}
          </button>
        </div>
        <div className="flex items-center gap-3 text-[8px] font-mono">
          <span>
            {isEn ? 'RECTS' : '區塊'}: <b className="text-neutral-200">{placedRects.length}</b>
          </span>
          <span>
            {isEn ? 'TIME' : '耗時'}: <b className="text-neutral-200">{elapsedSec}s</b>
          </span>
        </div>
      </div>

      {/* 物理岩板本體 */}
      <div
        ref={gridContainerRef}
        onTouchMove={handleTouchMove}
        onClick={() => {
          if (isSingularityDormant) {
            emitSpacetimeHapticTelemetry(elapsedSec, movesCount.current);
          }
        }}
        className={`relative p-0 transition-all duration-1000 rounded-xl overflow-hidden bg-black border border-neutral-900 shadow-2xl ${
          isSingularityDormant ? 'cursor-pointer' : ''
        }`}
        style={{ width: 'min(86vw, 42vh)', height: 'min(86vw, 42vh)' }}
      >
        {/* 八分節段頂點奇偶光流 */}
        {!isSingularityDormant ? (
          <div className="absolute -inset-[1px] pointer-events-none z-30">
            <div className="absolute top-0 left-0 w-1/2 h-[2px] flex">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[0] ? 'bg-white/95 animate-pulse shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
            <div className="absolute top-0 right-0 w-1/2 h-[2px] flex">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[1] ? 'bg-white/95 animate-pulse shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
            <div className="absolute top-0 right-0 h-1/2 w-[2px]">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[2] ? 'bg-white/95 animate-pulse shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
            <div className="absolute bottom-0 right-0 h-1/2 w-[2px]">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[3] ? 'bg-white/95 animate-pulse shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
            <div className="absolute bottom-0 right-0 w-1/2 h-[2px]">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[4] ? 'bg-white/95 animate-pulse shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
            <div className="absolute bottom-0 left-0 w-1/2 h-[2px]">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[5] ? 'bg-white/95 animate-pulse shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
            <div className="absolute bottom-0 left-0 h-1/2 w-[2px]">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[6] ? 'bg-white/95 animate-pulse shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
            <div className="absolute top-0 left-0 h-1/2 w-[2px]">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[7] ? 'bg-white/95 animate-pulse shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 pointer-events-none z-30 border border-white/20 animate-pulse shadow-[0_0_32px_rgba(255,255,255,0.06)]" />
        )}

        {/* 矩形晶體層 */}
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
          {placedRects.map((rect, idx) => {
            const isEvaporating = evaporatingIdx === idx;
            const isInspected = inspectedIdx === idx;

            const collapseStyle = isCollapsing
              ? {
                  transform: `translate3d(${collapseCentroid.x - ((rect.c + rect.w / 2) / cols) * 100}%, ${
                    collapseCentroid.y - ((rect.r + rect.h / 2) / rows) * 100
                  }%, 0) scale(0)`,
                  opacity: 0,
                  filter: 'brightness(5)',
                  transition: 'transform 850ms cubic-bezier(0.7, 0, 0.84, 0), opacity 850ms ease, filter 850ms ease',
                }
              : {};

            return (
              <div
                key={idx}
                onClick={(e) => handleRectTouch(idx, e)}
                className={`absolute rounded-none pointer-events-auto cursor-pointer border transition-all duration-150 ${
                  isEvaporating
                    ? 'scale-0 opacity-0 duration-150 ease-out border-white'
                    : isInspected
                    ? 'border-white bg-white/20 shadow-[0_0_16px_rgba(255,255,255,0.5)] z-20'
                    : 'border-white/40 bg-white/[0.04] hover:border-white/80'
                }`}
                style={{
                  top: `${(rect.r / rows) * 100}%`,
                  left: `${(rect.c / cols) * 100}%`,
                  width: `${(rect.w / cols) * 100}%`,
                  height: `${(rect.h / rows) * 100}%`,
                  ...collapseStyle,
                }}
              />
            );
          })}

          {/* 拖曳預覽框 */}
          {previewPhysics && !isCollapsing && !isSingularityDormant && (
            <div
              className="absolute border border-white pointer-events-none transition-all duration-75"
              style={{
                top: previewPhysics.top,
                left: previewPhysics.left,
                width: previewPhysics.width,
                height: previewPhysics.height,
                opacity: previewPhysics.luminance,
                boxShadow: `0 0 ${previewPhysics.luminance * 24}px rgba(255,255,255,${previewPhysics.luminance * 0.6})`,
              }}
            />
          )}
        </div>

        {/* 底層格點矩陣 */}
        <div
          className={`relative w-full h-full transition-opacity duration-1000 ${
            isSingularityDormant ? 'opacity-0' : 'opacity-100'
          }`}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: rows }).map((_, r) =>
            Array.from({ length: cols }).map((__, c) => {
              const val = grid[r]?.[c];
              return (
                <div
                  key={`${r},${c}`}
                  data-shikaku-cell="true"
                  data-r={r}
                  data-c={c}
                  onMouseDown={() => {
                    setDragStart([r, c]);
                    setDragCurrent([r, c]);
                  }}
                  onMouseEnter={() => {
                    if (dragStart) setDragCurrent([r, c]);
                  }}
                  onTouchStart={() => {
                    setDragStart([r, c]);
                    setDragCurrent([r, c]);
                  }}
                  className="relative flex items-center justify-center border border-neutral-900/50 cursor-crosshair hover:bg-neutral-900/30"
                >
                  {val !== null && val !== undefined && (
                    <span className="text-xs sm:text-sm font-bold text-neutral-300 pointer-events-none select-none">
                      {val}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 控制按鈕列 */}
      {!isSingularityDormant && (
        <div className="flex items-center justify-between w-full max-w-[340px] mt-3 gap-2 text-[8px] font-mono">
          <button
            onClick={handleUndo}
            disabled={placedRects.length === 0}
            className="flex-1 py-1.5 rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300 hover:text-white disabled:opacity-30 cursor-pointer"
          >
            ↩ {isEn ? 'Undo' : '復原'}
          </button>
          <button
            onClick={handleClearAll}
            disabled={placedRects.length === 0}
            className="flex-1 py-1.5 rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300 hover:text-rose-400 disabled:opacity-30 cursor-pointer"
          >
            ✕ {isEn ? 'Clear' : '清空'}
          </button>
        </div>
      )}

      {/* 坍縮完成後結算 HUD */}
      {isSingularityDormant && (
        <div className="mt-4 flex flex-col items-center gap-2 animate-fade-in z-40">
          <div className="text-[10px] tracking-widest text-neutral-400 font-mono">
            {isEn ? 'SINGULARITY ACHIEVED' : '奇異點完全閉合'} · {elapsedSec}s · Gf {cci.standardIQ}
          </div>
          <button
            onClick={() => setShowSubmitModal(true)}
            className="px-4 py-1.5 bg-neutral-200 hover:bg-white text-black text-[9px] font-bold tracking-wider rounded transition cursor-pointer shadow-[0_0_15px_rgba(255,255,255,0.3)]"
          >
            {isEn ? 'SUBMIT TO LEADERBOARD' : '提交成績至排行榜'}
          </button>
        </div>
      )}

      {/* 賽事提交 Modal */}
      {showSubmitModal && actualPuzzle && (
        <TournamentSubmissionModal
          payload={{
            submissionId: `SUB-${actualPuzzle.id}-${Date.now().toString(36)}`,
            tournamentId: tournamentMode ? 'WPF_SHIKAKU_2026' : 'GLOBAL_SHIKAKU_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'shikaku',
            tier: (actualPuzzle.tier as string) || 'ultimate',
            timeSpentSec: elapsedSec,
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
