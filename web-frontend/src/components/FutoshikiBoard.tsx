// web-frontend/src/components/FutoshikiBoard.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  FutoshikiSpec,
  FutoshikiHintStep,
  WebFutoshikiGenerator,
  SYMBOLIC_SETS,
} from '../engines/futoshikiGenerator';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

export const FutoshikiBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as FutoshikiSpec;
  const size = spec?.size || 4;
  const initialGrid = spec?.initialGrid || [];
  const inequalities = spec?.inequalities || [];
  const solution = spec?.solution || [];
  const chainDepth = spec?.longestChainLength || (actualPuzzle?.metrics as any)?.longestInequalityChain || 2;
  const cruxCoords = (actualPuzzle?.metrics as any)?.cruxCoordinates || (spec?.crux ? [spec.crux.r, spec.crux.c] : [0, 0]);
  const depthProfile = (actualPuzzle?.metrics as any)?.depthProfile || spec?.depthProfile || [1, 2, 3, 2, 1];
  const seed = (actualPuzzle?.metrics as any)?.seed || spec?.seed || 12345;
  const isSymmetric = (actualPuzzle?.metrics as any)?.isSymmetric ?? true;

  const [displayMode, setDisplayMode] = useState<'numeric' | 'symbolic_dots' | 'symbolic_flora'>('numeric');
  const [enableOffload, setEnableOffload] = useState<boolean>(false);

  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState<number[][]>(() =>
    initialGrid.length > 0 ? initialGrid.map((r) => [...r]) : Array.from({ length: size }, () => Array(size).fill(0))
  );
  const [selectedCell, setSelectedCell] = useState<[number, number]>([0, 0]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isTimeOut, setIsTimeOut] = useState<boolean>(false);

  const [cruxBreakthrough, setCruxBreakthrough] = useState<boolean>(false);
  const [seedCopied, setSeedCopied] = useState<boolean>(false);

  const [hintsTriggeredCount, setHintsTriggeredCount] = useState<number>(0);
  const timeLimit = actualPuzzle?.metrics?.estimated_time_sec || 150;
  const [remainingSec, setRemainingSec] = useState<number>(timeLimit);
  const [accumulatedMs, setAccumulatedMs] = useState<number>(0);
  const lastActiveTimestamp = useRef<number>(performance.now());
  const isSuspended = useRef<boolean>(false);

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<FutoshikiHintStep | null>(null);

  const initialMask = useMemo(() => {
    return initialGrid.map((row) => row.map((val) => val !== 0));
  }, [initialGrid]);

  const renderValue = useCallback(
    (val: number) => {
      if (val === 0) return '';
      if (displayMode === 'symbolic_dots') return SYMBOLIC_SETS.dots[val - 1] || `${val}`;
      if (displayMode === 'symbolic_flora') return SYMBOLIC_SETS.flora[val - 1] || `${val}`;
      return `${val}`;
    },
    [displayMode]
  );

  useEffect(() => {
    setGrid(initialGrid.map((r) => [...r]));
    setSelectedCell([0, 0]);
    setIsCompleted(false);
    setIsTimeOut(false);
    setCruxBreakthrough(false);
    setSeedCopied(false);
    setRemainingSec(timeLimit);
    setAccumulatedMs(0);
    setHintsTriggeredCount(0);
    lastActiveTimestamp.current = performance.now();
    setHintLevel(0);
    setActiveHint(null);

    requestAnimationFrame(() => {
      boardContainerRef.current?.focus();
    });
  }, [actualPuzzle?.id, size, initialGrid, timeLimit]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) isSuspended.current = true;
      else {
        lastActiveTimestamp.current = performance.now();
        isSuspended.current = false;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (isCompleted || isTimeOut) return;
    const timer = setInterval(() => {
      if (isSuspended.current) return;
      const now = performance.now();
      const delta = now - lastActiveTimestamp.current;
      lastActiveTimestamp.current = now;

      setAccumulatedMs((prev) => {
        const next = prev + delta;
        if (tournamentMode) {
          const spentSec = Math.floor(next / 1000);
          const left = Math.max(0, timeLimit - spentSec);
          setRemainingSec(left);
          if (left === 0) setIsTimeOut(true);
        }
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [isCompleted, isTimeOut, tournamentMode, timeLimit]);

  const conflicts = useMemo(() => {
    const set = new Set<string>();

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = grid[r][c];
        if (v === 0) continue;
        for (let oc = c + 1; oc < size; oc++) {
          if (grid[r][oc] === v) {
            set.add(`${r},${c}`);
            set.add(`${r},${oc}`);
          }
        }
        for (let or = r + 1; or < size; or++) {
          if (grid[or][c] === v) {
            set.add(`${r},${c}`);
            set.add(`${or},${c}`);
          }
        }
      }
    }

    for (const ineq of inequalities) {
      const v1 = grid[ineq.r1][ineq.c1];
      const v2 = grid[ineq.r2][ineq.c2];
      if (v1 !== 0 && v2 !== 0) {
        if (ineq.op === '>' && !(v1 > v2)) {
          set.add(`${ineq.r1},${ineq.c1}`);
          set.add(`${ineq.r2},${ineq.c2}`);
        }
        if (ineq.op === '<' && !(v1 < v2)) {
          set.add(`${ineq.r1},${ineq.c1}`);
          set.add(`${ineq.r2},${ineq.c2}`);
        }
      }
    }

    return set;
  }, [grid, size, inequalities]);

  const offloadSummary = useMemo(() => {
    const [selR, selC] = selectedCell;
    const rowUsed = new Set<number>();
    const colUsed = new Set<number>();

    for (let c = 0; c < size; c++) {
      if (grid[selR][c] !== 0) rowUsed.add(grid[selR][c]);
    }
    for (let r = 0; r < size; r++) {
      if (grid[r][selC] !== 0) colUsed.add(grid[r][selC]);
    }

    const available = [];
    for (let i = 1; i <= size; i++) {
      if (!rowUsed.has(i) && !colUsed.has(i)) available.push(i);
    }

    return { rowUsed, colUsed, available };
  }, [grid, size, selectedCell]);

  const checkVictory = useCallback(
    (curGrid: number[][]): boolean => {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (curGrid[r][c] === 0) return false;
          if (solution.length > 0 && curGrid[r][c] !== solution[r][c]) return false;
        }
      }
      return conflicts.size === 0;
    },
    [size, solution, conflicts.size]
  );

  const setCellValue = useCallback(
    (r: number, c: number, val: number) => {
      if (isCompleted || isTimeOut || initialMask[r]?.[c]) return;

      setHintLevel(0);
      setActiveHint(null);

      setGrid((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = val;

        if (r === cruxCoords[0] && c === cruxCoords[1] && val !== 0 && val === solution[r]?.[c]) {
          setCruxBreakthrough(true);
          setTimeout(() => setCruxBreakthrough(false), 1500);
        }

        if (checkVictory(next)) {
          setIsCompleted(true);
          const timeSpent = Math.max(1, Math.round(accumulatedMs / 1000));
          const isPure = hintsTriggeredCount === 0;

          if (actualPuzzle) {
            recordAttempt({
              puzzleId: actualPuzzle.id,
              engineType: 'futoshiki',
              tier: (actualPuzzle.tier as TierKey) || 'kids',
              cognitiveLoad: {
                spatial: 0.85,
                numeric: displayMode === 'numeric' ? 0.95 : 0.45,
                workingMemory: enableOffload ? 0.35 : 0.85,
                inhibition: 0.9,
              },
              isSuccess: true,
              timeSpentSec: timeSpent,
              conflictsCount: conflicts.size,
              technique: 'AC3ConstraintPropagation',
              isPureClear: isPure,
            });
          }
        }
        return next;
      });
    },
    [
      isCompleted,
      isTimeOut,
      initialMask,
      checkVictory,
      accumulatedMs,
      hintsTriggeredCount,
      cruxCoords,
      solution,
      actualPuzzle,
      recordAttempt,
      displayMode,
      enableOffload,
      conflicts.size,
    ]
  );

  const handleCopySeed = () => {
    navigator.clipboard.writeText(`FUTO-S${seed}-T${actualPuzzle?.tier || 'kids'}`);
    setSeedCopied(true);
    setTimeout(() => setSeedCopied(false), 2000);
  };

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (isCompleted || isTimeOut) return;
      const [r, c] = selectedCell;
      if (initialMask[r]?.[c]) return;
      e.preventDefault();

      const current = grid[r][c];
      if (e.deltaY < 0) {
        const nextVal = current === size ? 0 : current + 1;
        setCellValue(r, c, nextVal);
      } else if (e.deltaY > 0) {
        const nextVal = current === 0 ? size : current - 1;
        setCellValue(r, c, nextVal);
      }
    },
    [isCompleted, isTimeOut, selectedCell, initialMask, grid, size, setCellValue]
  );

  const handleRequestHint = useCallback(() => {
    if (isCompleted || isTimeOut) return;
    const step = WebFutoshikiGenerator.getNextForcedDeduction(grid, size, inequalities);
    if (!step) return;

    if (!activeHint || activeHint.r !== step.r || activeHint.c !== step.c) {
      setActiveHint(step);
      setHintLevel(1);
      setHintsTriggeredCount((prev) => prev + 1);
      setSelectedCell([step.r, step.c]);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, isTimeOut, grid, size, inequalities, activeHint]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isTimeOut) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const [r, c] = selectedCell;
      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          e.preventDefault();
          setSelectedCell([Math.max(0, r - 1), c]);
          break;
        case 's':
        case 'arrowdown':
          e.preventDefault();
          setSelectedCell([Math.min(size - 1, r + 1), c]);
          break;
        case 'a':
        case 'arrowleft':
          e.preventDefault();
          setSelectedCell([r, Math.max(0, c - 1)]);
          break;
        case 'd':
        case 'arrowright':
          e.preventDefault();
          setSelectedCell([r, Math.min(size - 1, c + 1)]);
          break;
        case '0':
        case 'backspace':
        case 'delete':
        case ' ':
          e.preventDefault();
          setCellValue(r, c, 0);
          break;
        case 'h':
          e.preventDefault();
          handleRequestHint();
          break;
        default: {
          const num = parseInt(e.key, 10);
          if (!isNaN(num) && num >= 1 && num <= size) {
            e.preventDefault();
            setCellValue(r, c, num);
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, size, isCompleted, isTimeOut, setCellValue, handleRequestHint]);

  const horizontalIneqMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ineq of inequalities) {
      if (ineq.r1 === ineq.r2 && ineq.c1 + 1 === ineq.c2) {
        map.set(`${ineq.r1},${ineq.c1}`, ineq.op);
      }
    }
    return map;
  }, [inequalities]);

  const verticalIneqMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ineq of inequalities) {
      if (ineq.c1 === ineq.c2 && ineq.r1 + 1 === ineq.r2) {
        map.set(`${ineq.r1},${ineq.c1}`, ineq.op === '>' ? 'v' : '^');
      }
    }
    return map;
  }, [inequalities]);

  const cellSize = Math.min(230 / size, 38);
  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  return (
    <div
      ref={boardContainerRef}
      tabIndex={0}
      onWheel={handleWheel}
      className="relative flex flex-col items-center justify-center p-2 select-none font-mono outline-none w-full max-w-[340px] mx-auto"
    >
      {/* 攻克 Crux 突破橫幅 */}
      {cruxBreakthrough && (
        <div className="fixed top-3 z-50 px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-950 font-black text-xs rounded-full shadow-[0_0_20px_rgba(251,191,36,0.8)] animate-bounce flex items-center gap-1.5 border border-white">
          <span>✨</span>
          <span>{isEn ? 'CRUX BREACHED!' : '攻克關鍵邏輯華點！'}</span>
        </div>
      )}

      {/* 對稱性與盤面元數據 */}
      <div className="w-full flex items-center justify-between gap-1 mb-2 px-1 text-[7.5px]">
        <div className="flex items-center gap-1">
          <button
            onClick={() =>
              setDisplayMode((prev) =>
                prev === 'numeric' ? 'symbolic_dots' : prev === 'symbolic_dots' ? 'symbolic_flora' : 'numeric'
              )
            }
            className="px-2 py-1 bg-slate-900 border border-slate-700 hover:border-cyan-400 rounded text-cyan-300 font-bold"
          >
            {displayMode === 'numeric' && (isEn ? '🔢 Numeric' : '🔢 數字')}
            {displayMode === 'symbolic_dots' && (isEn ? '⚪ Dots' : '⚪ 點陣')}
            {displayMode === 'symbolic_flora' && (isEn ? '🌱 Flora' : '🌱 符號')}
          </button>
          <button
            onClick={() => setEnableOffload((prev) => !prev)}
            className={`px-2 py-1 rounded border font-bold ${
              enableOffload
                ? 'bg-purple-950 border-purple-500 text-purple-300'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
          >
            🧠 {isEn ? 'Offload' : '卸載'}: {enableOffload ? (isEn ? 'ON' : '開啟') : (isEn ? 'OFF' : '關閉')}
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400 font-semibold">
          {isSymmetric && (
            <span className="text-cyan-400 font-bold flex items-center gap-0.5" title={isEn ? '180° Point Symmetric Layout' : '180° 旋轉點對稱美學盤面'}>
              🔄 {isEn ? '180° Sym' : '180° 對稱'}
            </span>
          )}
          <span className="text-slate-600">|</span>
          <span className="text-purple-300 font-bold">
            {isEn ? 'Chain' : '鏈深'}: {chainDepth}
          </span>
          <span className="text-slate-600">|</span>
          <button
            onClick={handleCopySeed}
            className="text-slate-500 hover:text-slate-300 font-mono underline"
            title={isEn ? 'Copy Seed' : '複製 Seed 題目種子'}
          >
            {seedCopied ? (isEn ? 'Copied' : '已複製') : `S:${String(seed).slice(-4)}`}
          </button>
        </div>
      </div>

      {/* 工作記憶卸載草稿盤 */}
      {enableOffload && (
        <div className="w-full mb-2 p-1.5 bg-slate-950/80 border border-purple-900/60 rounded-lg text-[7.5px] text-slate-300 flex items-center justify-between">
          <span className="text-purple-400 font-bold">
            {isEn
              ? `Cell [${selectedCell[0] + 1}, ${selectedCell[1] + 1}] Candidates:`
              : `格 [${selectedCell[0] + 1}, ${selectedCell[1] + 1}] 候選:`}
          </span>
          <div className="flex gap-1">
            {offloadSummary.available.length > 0 ? (
              offloadSummary.available.map((val) => (
                <span key={`cand-${val}`} className="px-1.5 py-0.5 bg-purple-950/60 text-purple-200 border border-purple-700/50 rounded font-bold">
                  {renderValue(val)}
                </span>
              ))
            ) : (
              <span className="text-rose-400 font-bold">
                {isEn ? 'No Valid Candidates' : '無合法候選數'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 棋盤主體 */}
      <div className="p-3 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl flex flex-col items-center">
        {Array.from({ length: size }).map((_, r) => (
          <React.Fragment key={`row-group-${r}`}>
            <div className="flex items-center">
              {Array.from({ length: size }).map((_, c) => {
                const val = grid[r][c];
                const isInitial = initialMask[r]?.[c];
                const isSelected = selectedCell[0] === r && selectedCell[1] === c;
                const isConflict = conflicts.has(`${r},${c}`);
                const isHintTarget = activeHint?.r === r && activeHint?.c === c && hintLevel === 3;
                const isCruxCell = r === cruxCoords[0] && c === cruxCoords[1] && !isInitial;
                const horizOp = horizontalIneqMap.get(`${r},${c}`);

                let bgClass = isInitial
                  ? 'bg-slate-900 text-amber-300 font-black border border-slate-700 shadow-inner'
                  : 'bg-slate-950 text-cyan-300 hover:bg-slate-900/80 border border-slate-800';

                if (isConflict) bgClass += ' ring-2 ring-rose-500 bg-rose-950/40 text-rose-300';
                if (isHintTarget) bgClass += ' ring-2 ring-amber-400 bg-amber-500/30 animate-pulse';

                return (
                  <React.Fragment key={`cell-${r}-${c}`}>
                    <div
                      onClick={() => setSelectedCell([r, c])}
                      className={`relative flex items-center justify-center font-bold text-sm cursor-pointer rounded transition select-none ${bgClass} ${
                        isSelected ? 'ring-2 ring-cyan-400 z-10 shadow-[0_0_8px_rgba(34,211,238,0.7)]' : ''
                      }`}
                      style={{ width: cellSize, height: cellSize }}
                    >
                      {renderValue(val)}

                      {isCruxCell && (
                        <div className="absolute inset-0 ring-2 ring-amber-400/70 animate-pulse rounded pointer-events-none" />
                      )}
                      {isCruxCell && cruxBreakthrough && (
                        <div className="absolute inset-0 ring-4 ring-yellow-300 animate-ping rounded pointer-events-none" />
                      )}
                      {isCruxCell && val === 0 && (
                        <span className="absolute -top-1 -right-1 text-[7px] text-amber-400 font-black">
                          ★
                        </span>
                      )}
                    </div>
                    {c < size - 1 && (
                      <div className="flex items-center justify-center text-slate-400 font-bold text-xs" style={{ width: 14 }}>
                        {horizOp || ''}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {r < size - 1 && (
              <div className="flex items-center my-0.5">
                {Array.from({ length: size }).map((_, c) => {
                  const vertOp = verticalIneqMap.get(`${r},${c}`);
                  return (
                    <React.Fragment key={`vert-${r}-${c}`}>
                      <div className="flex items-center justify-center text-slate-400 font-bold text-xs" style={{ width: cellSize, height: 12 }}>
                        {vertOp || ''}
                      </div>
                      {c < size - 1 && <div style={{ width: 14 }} />}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* 雙行觸控大按鍵 */}
      <div className="w-full mt-2.5">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${Math.ceil((size + 1) / 2)}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: size }, (_, i) => i + 1).map((num) => (
            <button
              key={`num-pad-${num}`}
              onClick={() => setCellValue(selectedCell[0], selectedCell[1], num)}
              className="h-11 bg-slate-900 border border-slate-700 hover:border-cyan-400 active:bg-cyan-950 text-cyan-300 font-bold text-sm rounded-lg transition shadow flex items-center justify-center cursor-pointer"
            >
              {renderValue(num)}
            </button>
          ))}
          <button
            onClick={() => setCellValue(selectedCell[0], selectedCell[1], 0)}
            className="h-11 bg-slate-900 border border-slate-700 hover:border-rose-400 active:bg-rose-950 text-rose-400 font-bold text-sm rounded-lg transition shadow flex items-center justify-center cursor-pointer"
            title={isEn ? 'Clear' : '清空'}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 因果提示階梯 */}
      <div className="flex items-center justify-between w-full mt-2 gap-1.5">
        <button
          onClick={handleRequestHint}
          disabled={isCompleted || isTimeOut}
          className="w-full py-1.5 text-xs font-bold rounded-lg border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition flex items-center justify-center gap-1 shadow disabled:opacity-40 cursor-pointer"
        >
          💡 {isEn ? 'Hint Ladder [H]' : '因果提示階梯 [H]'}
        </button>
      </div>

      {hintLevel > 0 && activeHint && (
        <div className="mt-2 p-2 rounded-xl text-center w-full font-mono border bg-slate-900/90 border-amber-500/60 text-slate-200 text-[8px]">
          {hintLevel === 1 && (
            <span>
              {isEn
                ? `🔍 Inspect partial order constraints around [${activeHint.r + 1}, ${activeHint.c + 1}]`
                : `🔍 審視坐標 [${activeHint.r + 1}, ${activeHint.c + 1}] 的偏序約束`}
            </span>
          )}
          {hintLevel === 2 && (
            <span className="text-cyan-300 font-bold">
              ⚡ {isEn ? (activeHint.humanReadable.en || activeHint.rationale) : activeHint.humanReadable.zh}
            </span>
          )}
          {hintLevel === 3 && (
            <span className="text-rose-400 font-extrabold">
              {isEn
                ? `🎯 Target cell must strictly be ${renderValue(activeHint.forcedValue)}!`
                : `🎯 目標格必然填入 ${renderValue(activeHint.forcedValue)}！`}
            </span>
          )}
        </div>
      )}

      {/* 結算面板與推理節奏圖 (Deduction Flow Map) */}
      {isCompleted && (
        <div className="mt-2.5 p-3 bg-slate-950 border border-emerald-500/80 rounded-xl text-center w-full shadow-2xl font-mono animate-fade-in">
          <div className="text-emerald-400 font-bold text-xs mb-0.5 uppercase tracking-wider">
            {isEn ? 'RELATIONAL MATRIX BALANCED!' : '關係矩陣完全收斂平衡！'}
          </div>

          {depthProfile.length > 0 && (
            <div className="my-2 p-2 bg-slate-900/80 border border-slate-800 rounded-lg text-left">
              <div className="flex items-center justify-between text-[7px] text-slate-400 mb-1">
                <span>🧠 {isEn ? 'Deduction Flow Map' : '推理節奏圖 (Deduction Flow)'}</span>
                <span className="text-emerald-400 font-bold">
                  {isEn ? 'Symmetry Match: 100%' : '對稱吻合度: 100%'}
                </span>
              </div>
              <svg width="100%" height="22" viewBox="0 0 200 22" className="overflow-visible">
                <polyline
                  fill="none"
                  stroke="#a855f7"
                  strokeWidth="1.5"
                  points={depthProfile
                    .map((val: number, idx: number) => `${idx * 45 + 10},${Math.max(2, 20 - (val / 5) * 16)}`)
                    .join(' ')}
                />
                {depthProfile.map((depth: number, idx: number) => (
                  <circle
                    key={`dot-${idx}`}
                    cx={idx * 45 + 10}
                    cy={Math.max(2, 20 - (depth / 5) * 16)}
                    r={idx === 2 ? '4' : '3'}
                    fill={idx === 2 ? '#f59e0b' : depth >= 3 ? '#60a5fa' : '#64748b'}
                  />
                ))}
              </svg>
              <div className="flex justify-between text-[6px] text-slate-500 mt-1 px-1">
                <span>{isEn ? 'Intro' : '鋪陳'}</span>
                <span>{isEn ? 'Ascent' : '爬坡'}</span>
                <span className="text-amber-400 font-bold">⚡{isEn ? 'Crux' : '關鍵'}</span>
                <span>{isEn ? 'Harvest' : '收割'}</span>
                <span>{isEn ? 'Coda' : '尾聲'}</span>
              </div>
            </div>
          )}

          <div className="text-[8.5px] text-slate-300 mb-1">
            {isEn
              ? `Time: ${(accumulatedMs / 1000).toFixed(2)}s | Chain Depth: ${chainDepth} | Gf Index: IQ ${cci.standardIQ}`
              : `耗時: ${(accumulatedMs / 1000).toFixed(2)}s | 鏈深: ${chainDepth} 階 | Gf 指標: IQ ${cci.standardIQ}`}
          </div>
          <div className="text-[8px] text-cyan-400 font-bold">
            {isEn
              ? `✨ Seed: ${seed} · Partial Order Chain Fully Converged`
              : `✨ Seed: ${seed} · 偏序鏈完全收斂`}
          </div>
        </div>
      )}
    </div>
  );
};
