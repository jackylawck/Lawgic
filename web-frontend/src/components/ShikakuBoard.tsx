import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { ShikakuSpec, ShikakuRect } from '../engines/shikakuGenerator';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

export const ShikakuBoard: React.FC<Props> = ({ puzzleData, puzzle }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { recordAttempt } = useLearnerProfile();

  if (!actualPuzzle) {
    return <div className="fixed inset-0 bg-black" />;
  }

  const spec: ShikakuSpec = (actualPuzzle as any)?.puzzle || (actualPuzzle as any)?.spec;
  const rows = spec?.rows || 8;
  const cols = spec?.cols || 8;
  const grid = useMemo(() => spec?.grid || [], [spec]);
  const currentTier = (actualPuzzle.tier as TierKey) || 'ultimate';

  const [placedRects, setPlacedRects] = useState<ShikakuRect[]>([]);
  const [dragStart, setDragStart] = useState<[number, number] | null>(null);
  const [dragCurrent, setDragCurrent] = useState<[number, number] | null>(null);
  const [evaporatingIdx, setEvaporatingIdx] = useState<number | null>(null);
  const [inspectedIdx, setInspectedIdx] = useState<number | null>(null);

  // 物理態：奇異點坍縮與真空靜息態
  const [isCollapsing, setIsCollapsing] = useState<boolean>(false);
  const [collapseCentroid, setCollapseCentroid] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [isSingularityDormant, setIsSingularityDormant] = useState<boolean>(false);

  const startTimeRef = useRef<number>(Date.now());
  const elapsedSecRef = useRef<number>(0);
  const movesCount = useRef<number>(0);
  const lastRectTapRef = useRef<{ idx: number; timestamp: number }>({ idx: -1, timestamp: 0 });

  useEffect(() => {
    setPlacedRects([]);
    setDragStart(null);
    setDragCurrent(null);
    setEvaporatingIdx(null);
    setInspectedIdx(null);
    setIsCollapsing(false);
    setIsSingularityDormant(false);
    startTimeRef.current = Date.now();
    elapsedSecRef.current = 0;
    movesCount.current = 0;
  }, [actualPuzzle.id, rows, cols]);

  useEffect(() => {
    if (isCollapsing || isSingularityDormant) return;
    const timer = setInterval(() => {
      elapsedSecRef.current = Math.floor((Date.now() - startTimeRef.current) / 1000);
    }, 1000);
    return () => clearInterval(timer);
  }, [isCollapsing, isSingularityDormant]);

  // 觸覺震動編碼：長震 450ms (十位) / 短震 70ms (個位)
  const emitSpacetimeHapticTelemetry = useCallback((seconds: number, moves: number) => {
    if (!navigator.vibrate) return;

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
        if (val !== null) {
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
        for (let ic = r.c; ic < r.c + r.w; ic++) cover[ir][ic]++;
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

  // 奇異點引力坍縮序列 (Singularity Collapse)
  useEffect(() => {
    if (octantParity.isResolved && !isCollapsing && !isSingularityDormant) {
      const last = placedRects[placedRects.length - 1];
      const cx = last ? ((last.c + last.w / 2) / cols) * 100 : 50;
      const cy = last ? ((last.r + last.h / 2) / rows) * 100 : 50;
      setCollapseCentroid({ x: cx, y: cy });

      setIsCollapsing(true);
      if (navigator.vibrate) navigator.vibrate([15, 60, 90]);

      setTimeout(() => {
        setIsCollapsing(false);
        setIsSingularityDormant(true);

        const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        elapsedSecRef.current = duration;

        emitSpacetimeHapticTelemetry(duration, movesCount.current);

        recordAttempt({
          puzzleId: actualPuzzle.id,
          engineType: 'shikaku',
          tier: currentTier,
          cognitiveLoad: actualPuzzle.cognitiveLoad || {
            spatial: 0.96,
            numeric: 0.94,
            workingMemory: 0.92,
            inhibition: 0.90,
          },
          isSuccess: true,
          timeSpentSec: duration,
          conflictsCount: 0,
          technique: 'SingularityParityConvergence',
          irtDifficulty: 5.5,
          isPureClear: true,
          partialCredit: 1.0,
        });
      }, 850);
    }
  }, [octantParity.isResolved, isCollapsing, isSingularityDormant, placedRects, cols, rows, actualPuzzle, currentTier, recordAttempt, emitSpacetimeHapticTelemetry]);

  // 雙擊退火蒸發與單擊戰術冷審視
  const handleRectTouch = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCollapsing || isSingularityDormant) return;

    const now = Date.now();
    const prev = lastRectTapRef.current;

    if (prev.idx === idx && now - prev.timestamp < 280) {
      if (navigator.vibrate) navigator.vibrate(45);
      setEvaporatingIdx(idx);
      setTimeout(() => {
        setPlacedRects((cur) => cur.filter((_, i) => i !== idx));
        setEvaporatingIdx(null);
        setInspectedIdx(null);
      }, 150);
      lastRectTapRef.current = { idx: -1, timestamp: 0 };
    } else {
      if (navigator.vibrate) navigator.vibrate(6);
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

  const handlePointerUp = () => {
    if (dragStart && dragCurrent) {
      const minR = Math.min(dragStart[0], dragCurrent[0]);
      const maxR = Math.max(dragStart[0], dragCurrent[0]);
      const minC = Math.min(dragStart[1], dragCurrent[1]);
      const maxC = Math.max(dragStart[1], dragCurrent[1]);

      let numR = minR, numC = minC;
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          if (grid[r]?.[c] !== null) {
            numR = r;
            numC = c;
            break;
          }
        }
      }

      const rect: ShikakuRect = {
        r: minR, c: minC, w: maxC - minC + 1, h: maxR - minR + 1, numberR: numR, numberC: numC
      };

      movesCount.current++;
      if (navigator.vibrate) navigator.vibrate(8);
      setPlacedRects((prev) => [
        ...prev.filter((r) => !(r.r === rect.r && r.c === rect.c && r.w === rect.w && r.h === rect.h)),
        rect
      ]);
    }
    setDragStart(null);
    setDragCurrent(null);
  };

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center select-none overflow-hidden touch-none font-mono">
      
      {/* 物理岩板本體 */}
      <div
        onMouseUp={handlePointerUp}
        onTouchEnd={handlePointerUp}
        onClick={() => {
          if (isSingularityDormant) {
            emitSpacetimeHapticTelemetry(elapsedSecRef.current, movesCount.current);
          }
        }}
        className={`relative p-0 transition-all duration-1000 ${
          isSingularityDormant ? 'cursor-pointer' : ''
        }`}
        style={{ width: 'min(86vw, 44vh)', height: 'min(86vw, 44vh)' }}
      >
        {/* 八分節段頂點奇偶光流 */}
        {!isSingularityDormant ? (
          <div className="absolute -inset-[2px] pointer-events-none z-30">
            {/* Top (0, 1) */}
            <div className="absolute top-0 left-0 w-1/2 h-[2px] flex">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[0] ? 'bg-white/95 animate-[pulse_0.22s_infinite] shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
            <div className="absolute top-0 right-0 w-1/2 h-[2px] flex">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[1] ? 'bg-white/95 animate-[pulse_0.22s_infinite] shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>

            {/* Right (2, 3) */}
            <div className="absolute top-0 right-0 h-1/2 w-[2px]">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[2] ? 'bg-white/95 animate-[pulse_0.22s_infinite] shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
            <div className="absolute bottom-0 right-0 h-1/2 w-[2px]">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[3] ? 'bg-white/95 animate-[pulse_0.22s_infinite] shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>

            {/* Bottom (4, 5) */}
            <div className="absolute bottom-0 right-0 w-1/2 h-[2px]">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[4] ? 'bg-white/95 animate-[pulse_0.22s_infinite] shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
            <div className="absolute bottom-0 left-0 w-1/2 h-[2px]">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[5] ? 'bg-white/95 animate-[pulse_0.22s_infinite] shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>

            {/* Left (6, 7) */}
            <div className="absolute bottom-0 left-0 h-1/2 w-[2px]">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[6] ? 'bg-white/95 animate-[pulse_0.22s_infinite] shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
            <div className="absolute top-0 left-0 h-1/2 w-[2px]">
              <div className={`w-full h-full transition-all duration-300 ${octantParity.defectMask[7] ? 'bg-white/95 animate-[pulse_0.22s_infinite] shadow-[0_0_8px_white]' : 'bg-white/10'}`} />
            </div>
          </div>
        ) : (
          /* 事件視界微光（Event Horizon Halo） */
          <div className="absolute -inset-[1px] pointer-events-none z-30 border border-white/20 animate-[pulse_3.2s_cubic-bezier(0.4,0,0.6,1)_infinite] shadow-[0_0_32px_rgba(255,255,255,0.06)]" />
        )}

        {/* 矩形晶體層：引力坍縮、退火蒸發與戰術審視 */}
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
          {placedRects.map((rect, idx) => {
            const isEvaporating = evaporatingIdx === idx;
            const isInspected = inspectedIdx === idx;

            const collapseStyle = isCollapsing ? {
              transform: `translate3d(${collapseCentroid.x - ((rect.c + rect.w / 2) / cols) * 100}%, ${collapseCentroid.y - ((rect.r + rect.h / 2) / rows) * 100}%, 0) scale(0)`,
              opacity: 0,
              filter: 'brightness(5)',
              transition: 'transform 850ms cubic-bezier(0.7, 0, 0.84, 0), opacity 850ms ease, filter 850ms ease',
            } : {};

            return (
              <div
                key={idx}
                onClick={(e) => handleRectTouch(idx, e)}
                className={`absolute rounded-none pointer-events-auto cursor-pointer border transition-all duration-150 ${
                  isEvaporating
                    ? 'scale-0 opacity-0 duration-150 ease-out border-white'
                    : isInspected
                    ? 'border-white bg-white/20 shadow-[0_0_16px_rgba(255,255,255,0.5)] z-20'
                    : 'border-white/35 bg-white/[0.02] hover:border-white/70'
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

          {/* 因果張量質量場預覽 */}
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

        {/* 靜默底盤矩陣 */}
        <div
          className={`relative w-full h-full border border-neutral-900/60 transition-opacity duration-1000 ${
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
                  onMouseDown={() => { setDragStart([r, c]); setDragCurrent([r, c]); }}
                  onMouseEnter={() => { if (dragStart) setDragCurrent([r, c]); }}
                  onTouchStart={() => { setDragStart([r, c]); setDragCurrent([r, c]); }}
                  className="relative flex items-center justify-center border border-neutral-900/30 cursor-crosshair"
                >
                  {val !== null && (
                    <span className="text-xs font-light text-neutral-400 pointer-events-none select-none">
                      {val}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

      </div>

    </div>
  );
};
