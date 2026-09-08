// web-frontend/src/components/NonogramBoard.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { NonogramSpec, NonogramHintStep, WebNonogramGenerator } from '../engines/nonogramGenerator';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

type CellState = 0 | 1 | 2; // 0: 空白, 1: 填黑, 2: 標叉

interface HistoryAction {
  changes: { r: number; c: number; prev: CellState; next: CellState }[];
}

export const NonogramBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as NonogramSpec;
  const rows = spec?.rows || 5;
  const cols = spec?.cols || 5;
  const rowClues = spec?.rowClues || [];
  const colClues = spec?.colClues || [];
  const solution: boolean[][] = spec?.solution || [];
  const solvingSteps: NonogramHintStep[] = spec?.solvingSteps || [];

  const [grid, setGrid] = useState<CellState[][]>(() =>
    Array.from({ length: rows }, () => Array(cols).fill(0))
  );
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>([0, 0]);
  const [hoverCell, setHoverCell] = useState<[number, number] | null>(null);
  const [isCrossMode, setIsCrossMode] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [startTime, setStartTime] = useState<number>(Date.now());

  // 競賽級拖曳狀態
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragTargetStateRef = useRef<CellState>(1);
  const currentDragBatchRef = useRef<{ r: number; c: number; prev: CellState; next: CellState }[]>([]);

  // 歷史撤回堆疊（最多保留 50 步）
  const [historyStack, setHistoryStack] = useState<HistoryAction[]>([]);

  // 三階因果提示狀態
  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<NonogramHintStep | null>(null);

  useEffect(() => {
    setGrid(Array.from({ length: rows }, () => Array(cols).fill(0)));
    setSelectedCell([0, 0]);
    setHoverCell(null);
    setIsCompleted(false);
    setElapsedMs(0);
    setStartTime(Date.now());
    setHintLevel(0);
    setActiveHint(null);
    setIsDragging(false);
    setHistoryStack([]);
  }, [actualPuzzle?.id, rows, cols]);

  useEffect(() => {
    if (isCompleted) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted, startTime]);

  // 行完成度、線索總黑格數與容量檢算
  const rowStats = useMemo(() => {
    return Array.from({ length: rows }, (_, r) => {
      const line = grid[r]?.map((v) => v === 1) || [];
      const actualClues = WebNonogramGenerator.extractLineClues(line);
      const isDone = actualClues.join(',') === rowClues[r]?.join(',');
      const expectedFilled = (rowClues[r] || []).reduce((acc, v) => acc + v, 0);
      const currentFilled = line.filter(Boolean).length;
      const isOverflow = currentFilled > expectedFilled;
      const isCapacityMet = currentFilled === expectedFilled && !isDone;
      const hasUnresolved = grid[r]?.some((v) => v === 0) ?? false;
      return { isDone, expectedFilled, currentFilled, isOverflow, isCapacityMet, hasUnresolved };
    });
  }, [grid, rowClues, rows]);

  // 列完成度、線索總黑格數與容量檢算
  const colStats = useMemo(() => {
    return Array.from({ length: cols }, (_, c) => {
      const line = Array.from({ length: rows }, (_, r) => grid[r]?.[c] === 1);
      const actualClues = WebNonogramGenerator.extractLineClues(line);
      const isDone = actualClues.join(',') === colClues[c]?.join(',');
      const expectedFilled = (colClues[c] || []).reduce((acc, v) => acc + v, 0);
      const currentFilled = line.filter(Boolean).length;
      const isOverflow = currentFilled > expectedFilled;
      const isCapacityMet = currentFilled === expectedFilled && !isDone;
      const hasUnresolved = Array.from({ length: rows }, (_, r) => grid[r]?.[c] === 0).some(Boolean);
      return { isDone, expectedFilled, currentFilled, isOverflow, isCapacityMet, hasUnresolved };
    });
  }, [grid, colClues, rows, cols]);

  const checkVictory = useCallback(
    (curGrid: CellState[][]): boolean => {
      if (!solution || solution.length === 0) return false;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (solution[r]?.[c] !== (curGrid[r]?.[c] === 1)) {
            return false;
          }
        }
      }
      return true;
    },
    [rows, cols, solution]
  );

  const applyCellState = useCallback(
    (r: number, c: number, target: CellState, isDragAction = false) => {
      if (isCompleted) return;

      setHintLevel(0);
      setActiveHint(null);

      setGrid((prev) => {
        if (isDragAction && prev[r][c] !== 0) {
          return prev;
        }

        const next = prev.map((row) => [...row]);
        const prevVal = next[r][c];
        const nextVal = prevVal === target ? 0 : target;
        next[r][c] = nextVal;

        if (isDragAction) {
          currentDragBatchRef.current.push({ r, c, prev: prevVal, next: nextVal });
        } else {
          setHistoryStack((hs) => [...hs.slice(-49), { changes: [{ r, c, prev: prevVal, next: nextVal }] }]);
        }

        if (checkVictory(next)) {
          setIsCompleted(true);
          const timeSpent = Math.max(1, Math.round((Date.now() - startTime) / 1000));
          if (actualPuzzle) {
            recordAttempt({
              puzzleId: actualPuzzle.id,
              engineType: 'nonogram',
              tier: (actualPuzzle.tier as TierKey) || 'kids',
              cognitiveLoad: actualPuzzle.cognitiveLoad || {
                spatial: 0.98,
                numeric: 0.82,
                workingMemory: 0.9,
                inhibition: 0.95,
              },
              isSuccess: true,
              timeSpentSec: timeSpent,
              conflictsCount: 0,
              technique: spec?.highestTechnique || 'ConstraintSatisfaction',
              isPureClear: true,
            });
          }
        }
        return next;
      });
    },
    [isCompleted, checkVictory, startTime, actualPuzzle, recordAttempt, spec?.highestTechnique]
  );

  // 撤回邏輯 (Undo)
  const handleUndo = useCallback(() => {
    if (isCompleted || historyStack.length === 0) return;
    const lastAction = historyStack[historyStack.length - 1];
    setHistoryStack((hs) => hs.slice(0, -1));

    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      for (const ch of lastAction.changes) {
        next[ch.r][ch.c] = ch.prev;
      }
      return next;
    });
  }, [isCompleted, historyStack]);

  // 一鍵鎖定整行剩餘空格為叉號
  const handleAutoLockRow = useCallback((r: number) => {
    if (isCompleted) return;
    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      const changes: { r: number; c: number; prev: CellState; next: CellState }[] = [];
      for (let c = 0; c < cols; c++) {
        if (next[r][c] === 0) {
          changes.push({ r, c, prev: 0, next: 2 });
          next[r][c] = 2;
        }
      }
      if (changes.length > 0) {
        setHistoryStack((hs) => [...hs.slice(-49), { changes }]);
      }
      return next;
    });
  }, [isCompleted, cols]);

  // 一鍵鎖定整列剩餘空格為叉號
  const handleAutoLockCol = useCallback((c: number) => {
    if (isCompleted) return;
    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      const changes: { r: number; c: number; prev: CellState; next: CellState }[] = [];
      for (let r = 0; r < rows; r++) {
        if (next[r][c] === 0) {
          changes.push({ r, c, prev: 0, next: 2 });
          next[r][c] = 2;
        }
      }
      if (changes.length > 0) {
        setHistoryStack((hs) => [...hs.slice(-49), { changes }]);
      }
      return next;
    });
  }, [isCompleted, rows]);

  const handlePointerDown = (r: number, c: number, e: React.PointerEvent) => {
    if (isCompleted) return;
    const isRightClick = e.button === 2;
    const targetState: CellState = isRightClick || isCrossMode ? 2 : 1;
    dragTargetStateRef.current = targetState;
    currentDragBatchRef.current = [];
    setIsDragging(true);
    setSelectedCell([r, c]);
    applyCellState(r, c, targetState, false);
  };

  const handlePointerEnter = (r: number, c: number) => {
    setHoverCell([r, c]);
    if (isDragging && !isCompleted) {
      applyCellState(r, c, dragTargetStateRef.current, true);
    }
  };

  const handlePointerUp = () => {
    if (isDragging && currentDragBatchRef.current.length > 0) {
      setHistoryStack((hs) => [...hs.slice(-49), { changes: [...currentDragBatchRef.current] }]);
      currentDragBatchRef.current = [];
    }
    setIsDragging(false);
  };

  const handleRequestHint = useCallback(() => {
    if (isCompleted || tournamentMode) return;

    let targetStep: NonogramHintStep | null = null;
    for (let i = 0; i < solvingSteps.length; i++) {
      const s = solvingSteps[i];
      if (grid[s.r]?.[s.c] === 0) {
        targetStep = s;
        break;
      }
    }

    if (!targetStep) return;

    if (!activeHint || activeHint.r !== targetStep.r || activeHint.c !== targetStep.c) {
      setActiveHint(targetStep);
      setHintLevel(1);
      setSelectedCell([targetStep.r, targetStep.c]);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, tournamentMode, solvingSteps, grid, activeHint]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const [r, c] = selectedCell || [0, 0];
      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          e.preventDefault();
          setSelectedCell([Math.max(0, r - 1), c]);
          break;
        case 's':
        case 'arrowdown':
          e.preventDefault();
          setSelectedCell([Math.min(rows - 1, r + 1), c]);
          break;
        case 'a':
        case 'arrowleft':
          e.preventDefault();
          setSelectedCell([r, Math.max(0, c - 1)]);
          break;
        case 'd':
        case 'arrowright':
          e.preventDefault();
          setSelectedCell([r, Math.min(cols - 1, c + 1)]);
          break;
        case ' ':
        case 'enter':
          e.preventDefault();
          applyCellState(r, c, isCrossMode ? 2 : 1, false);
          break;
        case 'x':
          e.preventDefault();
          applyCellState(r, c, 2, false);
          break;
        case 'c':
          e.preventDefault();
          setIsCrossMode((prev) => !prev);
          break;
        case 'z':
          e.preventDefault();
          handleUndo();
          break;
        case 'h':
          e.preventDefault();
          handleRequestHint();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, rows, cols, isCompleted, isCrossMode, applyCellState, handleRequestHint, handleUndo]);

  const maxColClueLength = useMemo(() => Math.max(1, ...colClues.map((c) => c.length)), [colClues]);
  const maxRowClueLength = useMemo(() => Math.max(1, ...rowClues.map((r) => r.length)), [rowClues]);
  const cellSize = Math.min(280 / Math.max(rows, cols), 36);
  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  return (
    <div
      onPointerUp={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
      className="flex flex-col items-center justify-center p-2 select-none font-mono outline-none touch-none"
    >
      {/* 注入逐行綻放彈性動畫，零外部依賴 */}
      <style>{`
        @keyframes popRevealPixel {
          0% { transform: scale(0) rotate(-6deg); opacity: 0; }
          65% { transform: scale(1.15) rotate(2deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
      `}</style>

      {/* 數據看板與語意主題標題 */}
      <div className="w-full max-w-[340px] mb-2 flex flex-col gap-1 text-[9px]">
        {spec.themeTitleZh && (
          <div className="flex items-center justify-between px-1 text-slate-400">
            <span className="text-amber-400 font-bold">
              {isEn ? spec.themeTitleEn : spec.themeTitleZh}
            </span>
            <span className="text-slate-500 text-[8px]">
              DAG Depth: {spec.criticalPathDepth || 1}
            </span>
          </div>
        )}
        <div className="grid grid-cols-3 gap-1">
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Speed' : '競速'}</div>
            <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Size' : '規格'}</div>
            <div className="text-cyan-300 font-bold">{rows} &times; {cols}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Purity' : '定式純度'}</div>
            <div className="text-amber-400 font-bold">
              {spec.pureDeductionRate ? `${Math.round(spec.pureDeductionRate * 100)}%` : '100%'}
            </div>
          </div>
        </div>
      </div>

      {/* 棋盤主體 */}
      <div className="relative p-2 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl flex flex-col items-end">
        {/* 頂部列線索、容量壓力條與雙擊鎖定 */}
        <div className="flex" style={{ marginLeft: maxRowClueLength * 16 + 14 }}>
          {colClues.map((clueArr, c) => {
            const stat = colStats[c];
            const isHintBeam = activeHint && activeHint.c === c && hintLevel >= 1;
            const isHoveredCol = (hoverCell?.[1] === c) || (selectedCell?.[1] === c);

            return (
              <div
                key={`col-clue-${c}`}
                onDoubleClick={() => handleAutoLockCol(c)}
                title={isEn ? 'Double click: Auto-cross remaining' : '雙擊：快速將剩餘空格標叉'}
                className={`flex flex-col justify-end items-center text-[9px] font-bold py-1 transition-colors relative cursor-pointer ${
                  stat.isOverflow
                    ? 'bg-rose-950/60 text-rose-400 ring-1 ring-rose-500 animate-pulse'
                    : isHintBeam
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400 rounded-t'
                    : isHoveredCol
                    ? 'bg-slate-900 text-cyan-200'
                    : stat.isDone
                    ? 'bg-emerald-950/40 text-emerald-400'
                    : 'text-slate-400'
                }`}
                style={{ width: cellSize + 2, minHeight: maxColClueLength * 14 }}
              >
                <div className="flex items-center gap-0.5 mb-0.5">
                  <span className="text-[6.5px] text-slate-500 opacity-80">
                    {stat.currentFilled}/{stat.expectedFilled}
                  </span>
                  {stat.isCapacityMet && stat.hasUnresolved && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAutoLockCol(c);
                      }}
                      className="text-[8px] text-amber-400 hover:text-amber-200 leading-none"
                      title={isEn ? 'Lock remaining crosses' : '鎖定剩餘叉號'}
                    >
                      ⚡
                    </button>
                  )}
                </div>

                {clueArr.map((clue, idx) => (
                  <span
                    key={idx}
                    className={`${stat.isDone ? 'line-through opacity-40 text-emerald-300' : clue === 0 ? 'opacity-30' : 'text-cyan-300'}`}
                  >
                    {clue}
                  </span>
                ))}
              </div>
            );
          })}
        </div>

        {/* 網格與左側線索 */}
        <div className="flex">
          {/* 左側行線索、容量壓力條與雙擊鎖定 */}
          <div className="flex flex-col justify-around pr-2">
            {rowClues.map((clueArr, r) => {
              const stat = rowStats[r];
              const isHintBeam = activeHint && activeHint.r === r && hintLevel >= 1;
              const isHoveredRow = (hoverCell?.[0] === r) || (selectedCell?.[0] === r);

              return (
                <div
                  key={`row-clue-${r}`}
                  onDoubleClick={() => handleAutoLockRow(r)}
                  title={isEn ? 'Double click: Auto-cross remaining' : '雙擊：快速將剩餘空格標叉'}
                  className={`flex items-center justify-end gap-1 px-1 text-[9px] font-bold transition-colors cursor-pointer ${
                    stat.isOverflow
                      ? 'bg-rose-950/60 text-rose-400 ring-1 ring-rose-500 animate-pulse'
                      : isHintBeam
                      ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400 rounded-l'
                      : isHoveredRow
                      ? 'bg-slate-900 text-cyan-200'
                      : stat.isDone
                      ? 'bg-emerald-950/40 text-emerald-400'
                      : 'text-slate-400'
                  }`}
                  style={{ height: cellSize + 2 }}
                >
                  <div className="flex items-center gap-0.5 mr-0.5">
                    {stat.isCapacityMet && stat.hasUnresolved && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAutoLockRow(r);
                        }}
                        className="text-[8px] text-amber-400 hover:text-amber-200 leading-none"
                        title={isEn ? 'Lock remaining crosses' : '鎖定剩餘叉號'}
                      >
                        ⚡
                      </button>
                    )}
                    <span className="text-[6.5px] text-slate-500 opacity-80">
                      {stat.currentFilled}/{stat.expectedFilled}
                    </span>
                  </div>

                  {clueArr.map((clue, idx) => (
                    <span
                      key={idx}
                      className={`${stat.isDone ? 'line-through opacity-40 text-emerald-300' : clue === 0 ? 'opacity-30' : 'text-cyan-300'}`}
                    >
                      {clue}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>

          {/* 像素格子矩陣 */}
          <div
            className="grid gap-[1px] bg-slate-900/90 p-[2px] rounded border border-slate-800"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {grid.map((row, r) =>
              row.map((val, c) => {
                const isSelected = selectedCell?.[0] === r && selectedCell?.[1] === c;
                const isHintTarget = activeHint?.r === r && activeHint?.c === c;
                const isRowOverflow = rowStats[r]?.isOverflow && val === 1;
                const isColOverflow = colStats[c]?.isOverflow && val === 1;

                let bgClass = 'bg-slate-950 hover:bg-slate-900 text-slate-500';
                if (val === 1) bgClass = 'bg-cyan-400 text-black shadow-[0_0_8px_rgba(34,211,238,0.6)]';
                if (val === 2) bgClass = 'bg-slate-900 text-rose-400 font-black';

                if (isRowOverflow || isColOverflow) {
                  bgClass = 'bg-rose-600 text-white animate-pulse ring-1 ring-rose-300';
                }

                if (isHintTarget && hintLevel >= 2) {
                  bgClass = 'bg-amber-500/50 text-amber-200 ring-2 ring-amber-400 animate-pulse z-20';
                }

                const borderBottom = (r + 1) % 5 === 0 && r !== rows - 1 ? 'border-b-2 border-slate-700' : '';
                const borderRight = (c + 1) % 5 === 0 && c !== cols - 1 ? 'border-r-2 border-slate-700' : '';

                return (
                  <div
                    key={`${r}-${c}`}
                    onPointerDown={(e) => handlePointerDown(r, c, e)}
                    onPointerEnter={() => handlePointerEnter(r, c)}
                    className={`flex items-center justify-center font-bold text-[10px] cursor-crosshair transition select-none ${bgClass} ${borderBottom} ${borderRight} ${
                      isSelected ? 'ring-2 ring-indigo-400 z-10' : ''
                    }`}
                    style={{ width: cellSize, height: cellSize }}
                  >
                    {val === 2 && 'x'}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 三階戰術地圖與 Master Key 因果提示面板 */}
      {hintLevel > 0 && activeHint && (
        <div className="mt-2.5 p-2 bg-slate-900/90 border border-amber-500/60 rounded-xl text-center w-full max-w-[340px] shadow-lg animate-fade-in font-mono">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[7.5px] font-bold text-amber-300 tracking-wider">
              {activeHint.isMasterKey ? 'MASTER KEY 咽喉節點' : '戰術因果地圖'}
            </span>
            <div className="flex gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${hintLevel >= 1 ? 'bg-amber-400' : 'bg-slate-700'}`} />
              <span className={`w-1.5 h-1.5 rounded-full ${hintLevel >= 2 ? 'bg-amber-400' : 'bg-slate-700'}`} />
              <span className={`w-1.5 h-1.5 rounded-full ${hintLevel >= 3 ? 'bg-rose-500 animate-ping' : 'bg-slate-700'}`} />
            </div>
          </div>

          <div className="py-1 flex flex-col items-center justify-center gap-0.5 text-[8px] text-slate-200">
            {hintLevel === 1 && (
              <span className="text-amber-300">
                {isEn
                  ? `Focus on intersection of Row #${activeHint.r + 1} and Column #${activeHint.c + 1}`
                  : `請審視第 ${activeHint.r + 1} 行與第 ${activeHint.c + 1} 列直交光束`}
              </span>
            )}
            {hintLevel === 2 && (
              <span className="text-cyan-300 font-bold">
                {isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}
                <span className="block text-[7px] text-slate-400 mt-0.5">
                  DAG Depth: {activeHint.dagDepth} | Antichain: {activeHint.antichainBranching}
                </span>
              </span>
            )}
            {hintLevel === 3 && (
              <span className="text-rose-400 font-extrabold">
                {isEn
                  ? `Target cell [${activeHint.r + 1}, ${activeHint.c + 1}] is forced ${activeHint.forcedState === 1 ? 'FILLED' : 'CROSSED'}!`
                  : `目標格 [${activeHint.r + 1}, ${activeHint.c + 1}] 必然${activeHint.forcedState === 1 ? '填黑' : '標叉'}！`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 控制按鈕群 */}
      <div className="flex items-center justify-between w-full max-w-[340px] mt-3 gap-1.5">
        <button
          onClick={() => setIsCrossMode(false)}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition cursor-pointer ${
            !isCrossMode
              ? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]'
              : 'bg-slate-900 text-slate-400 border-slate-800'
          }`}
        >
          {isEn ? 'Fill' : '填色'}
        </button>
        <button
          onClick={() => setIsCrossMode(true)}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition cursor-pointer ${
            isCrossMode
              ? 'bg-rose-500 text-black border-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.4)]'
              : 'bg-slate-900 text-slate-400 border-slate-800'
          }`}
        >
          {isEn ? 'Cross' : '標叉'}
        </button>
        <button
          onClick={handleUndo}
          disabled={historyStack.length === 0}
          className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition flex items-center gap-1 cursor-pointer ${
            historyStack.length > 0
              ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
              : 'bg-slate-950 text-slate-600 border-slate-900 cursor-not-allowed'
          }`}
          title={isEn ? 'Undo (Z)' : '復原 (Z)'}
        >
          ↩ {isEn ? 'Undo' : '復原'}
        </button>
        {!tournamentMode && (
          <button
            onClick={handleRequestHint}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition flex items-center gap-1 cursor-pointer"
          >
            {isEn ? 'Hint' : '提示'}
          </button>
        )}
      </div>

      {/* 快捷操作指示 */}
      <div className="w-full max-w-[340px] flex items-center justify-between px-1 mt-2 text-[7px] text-slate-500 font-mono">
        <span>WASD: 移動</span>
        <span>Space: 填色</span>
        <span>X: 標叉</span>
        <span>Z: 復原</span>
        <span>⚡: 鎖定剩餘叉</span>
      </div>

      {/* 通關成就面板與 400px 全尺寸像素波紋綻放（Grand Finale Reveal） */}
      {isCompleted && (
        <div className="mt-4 p-4 bg-slate-950/95 border-2 border-emerald-500/90 rounded-2xl text-center w-full max-w-[440px] shadow-[0_0_40px_rgba(16,185,129,0.3)] animate-fade-in font-mono">
          <div className="text-emerald-400 font-black text-sm mb-0.5 uppercase tracking-widest animate-pulse">
            {isEn ? 'PIXEL ART RESOLVED!' : '像素紋章完全解碼！'}
          </div>
          <div className="text-[10px] text-slate-400 mb-3">
            {isEn ? 'Time' : '耗時'}: {(elapsedMs / 1000).toFixed(2)}s | Gf: IQ {cci.standardIQ}
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl flex flex-col items-center">
            <div className="text-[8.5px] text-amber-300 font-bold mb-2 tracking-widest uppercase">
              {spec.themeTitleZh ? `${spec.themeTitleZh} / ${spec.themeTitleEn}` : (isEn ? 'DECODED PIXEL EMBLEM' : '解碼像素紋章')}
            </div>

            {/* 400px 全尺寸斜向動態彈性波紋綻放 */}
            <div
              className="grid gap-[2px] p-3 bg-black rounded-lg border border-slate-800 shadow-[inset_0_0_20px_rgba(0,0,0,0.8)]"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` ,
                width: Math.min(380, Math.max(280, cols * 24)),
              }}
            >
              {solution.map((row, r) =>
                row.map((filled, c) => (
                  <div
                    key={`solved-${r}-${c}`}
                    style={{
                      aspectRatio: '1/1',
                      animation: 'popRevealPixel 0.45s ease-out',
                      animationDelay: `${r * 24 + c * 12}ms`,
                      animationFillMode: 'backwards',
                    }}
                    className={`rounded-[2px] transition-all ${
                      filled
                        ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]'
                        : 'bg-slate-900/80 opacity-40'
                    }`}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
