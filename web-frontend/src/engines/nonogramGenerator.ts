// web-frontend/src/components/NonogramBoard.tsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { PuzzleEntity } from '../generated';
import { useLanguage } from '../contexts/LanguageContext';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { WebNonogramGenerator, NonogramHintStep } from '../engines/nonogramGenerator';

interface NonogramBoardProps {
  puzzle: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

type CellState = 0 | 1 | 2; // 0: 空白, 1: 填黑, 2: 標叉 (X)
type InputMode = 'fill' | 'cross';

interface HistoryState {
  grid: CellState[][];
}

export const NonogramBoard: React.FC<NonogramBoardProps> = ({ puzzle, puzzleData, tournamentMode }) => {
  const activePuzzle = puzzle || puzzleData;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt } = useLearnerProfile();

  // 1. 強韌雙向相容解構：徹底解決屬性未定義引發的 Crash
  const rawSpec = (activePuzzle?.puzzle || {}) as any;
  const rows: number = rawSpec.rows || rawSpec.solution?.length || 5;
  const cols: number = rawSpec.cols || rawSpec.solution?.[0]?.length || 5;

  const rowClues: number[][] = useMemo(() => {
    if (Array.isArray(rawSpec.rowClues)) return rawSpec.rowClues;
    if (Array.isArray(rawSpec.row_clues)) return rawSpec.row_clues;
    if (Array.isArray(rawSpec.hints?.rows)) return rawSpec.hints.rows;
    return Array.from({ length: rows }, () => [0]);
  }, [rawSpec, rows]);

  const colClues: number[][] = useMemo(() => {
    if (Array.isArray(rawSpec.colClues)) return rawSpec.colClues;
    if (Array.isArray(rawSpec.col_clues)) return rawSpec.col_clues;
    if (Array.isArray(rawSpec.hints?.cols)) return rawSpec.hints.cols;
    return Array.from({ length: cols }, () => [0]);
  }, [rawSpec, cols]);

  // 2. 狀態矩陣與互動控制
  const [grid, setGrid] = useState<CellState[][]>(() =>
    Array.from({ length: rows }, () => Array(cols).fill(0))
  );
  const [activeTool, setActiveTool] = useState<InputMode>('fill');
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [hintStep, setHintStep] = useState<NonogramHintStep | null>(null);
  const [conflictsCount, setConflictsCount] = useState<number>(0);

  // 歷史棧 (Undo / Redo)
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryState[]>([]);

  // 拖曳劃線控制 Ref
  const isMouseDownRef = useRef<boolean>(false);
  const dragDrawValRef = useRef<CellState | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const hintCallsCountRef = useRef<number>(0);
  const hintLogsRef = useRef<{ secFromStart: number; level: number }[]>([]);

  // 3. 題目切換重置生命週期
  useEffect(() => {
    setGrid(Array.from({ length: rows }, () => Array(cols).fill(0)));
    setHistory([]);
    setRedoStack([]);
    setIsCompleted(false);
    setHintStep(null);
    setConflictsCount(0);
    startTimeRef.current = Date.now();
    hintCallsCountRef.current = 0;
    hintLogsRef.current = [];
  }, [activePuzzle?.id, rows, cols]);

  // 全域放開滑鼠/觸控監聽
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      isMouseDownRef.current = false;
      dragDrawValRef.current = null;
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchend', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchend', handleGlobalMouseUp);
    };
  }, []);

  // 4. 即時線索完成態判定 (滿足線索即高亮劃除)
  const rowStatus = useMemo(() => {
    return Array.from({ length: rows }, (_, r) => {
      const line = grid[r].map((cell) => cell === 1);
      const extracted = WebNonogramGenerator.extractLineClues(line);
      return extracted.join(',') === (rowClues[r] || [0]).join(',');
    });
  }, [grid, rows, rowClues]);

  const colStatus = useMemo(() => {
    return Array.from({ length: cols }, (_, c) => {
      const line = Array.from({ length: rows }, (_, r) => grid[r][c] === 1);
      const extracted = WebNonogramGenerator.extractLineClues(line);
      return extracted.join(',') === (colClues[c] || [0]).join(',');
    });
  }, [grid, rows, cols, colClues]);

  // 5. 勝利驗證與心理計量回傳
  const checkVictory = useCallback(
    (currentGrid: CellState[][]) => {
      for (let r = 0; r < rows; r++) {
        const line = currentGrid[r].map((cell) => cell === 1);
        const extracted = WebNonogramGenerator.extractLineClues(line);
        if (extracted.join(',') !== (rowClues[r] || [0]).join(',')) return false;
      }
      for (let c = 0; c < cols; c++) {
        const line = Array.from({ length: rows }, (_, r) => currentGrid[r][c] === 1);
        const extracted = WebNonogramGenerator.extractLineClues(line);
        if (extracted.join(',') !== (colClues[c] || [0]).join(',')) return false;
      }
      return true;
    },
    [rows, cols, rowClues, colClues]
  );

  const triggerVictory = useCallback(
    (finalGrid: CellState[][]) => {
      setIsCompleted(true);
      if (navigator.vibrate) navigator.vibrate([40, 60, 40, 80]);

      const timeSpentSec = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
      const isPure = hintCallsCountRef.current === 0;

      // 串接全局縱向常模寫入
      recordAttempt({
        puzzleId: activePuzzle?.id || `nonogram_${rows}x${cols}_${Date.now()}`,
        engineType: 'nonogram',
        tier: activePuzzle?.tier || 'kids',
        cognitiveLoad: activePuzzle?.cognitiveLoad || {
          spatial: 0.75,
          numeric: 0.65,
          workingMemory: 0.70,
          inhibition: 0.85,
        },
        isSuccess: true,
        timeSpentSec,
        conflictsCount,
        isPureModeAttempt: isPure,
        isPureClear: isPure,
        hintLogs: hintLogsRef.current,
        irtDifficulty: activePuzzle?.metrics?.irt_logit_difficulty || 1.2,
      });
    },
    [activePuzzle, rows, cols, conflictsCount, recordAttempt]
  );

  // 6. 核心塗色與網格更新邏輯
  const applyCellMutation = useCallback(
    (r: number, c: number, targetVal: CellState, isStartAction = false) => {
      if (isCompleted) return;

      setGrid((prev) => {
        const prevVal = prev[r][c];
        if (prevVal === targetVal) return prev;

        if (isStartAction) {
          setHistory((hist) => [...hist.slice(-25), { grid: prev.map((row) => [...row]) }]);
          setRedoStack([]);
        }

        const next = prev.map((row, rowIdx) =>
          rowIdx === r ? [...row] : row
        );
        next[r][c] = targetVal;

        // 如果點中的格子與題目底層真實答案相斥，累計衝突指標
        if (rawSpec.solution && rawSpec.solution[r]) {
          const isCorrectBlack = rawSpec.solution[r][c];
          if ((targetVal === 1 && !isCorrectBlack) || (targetVal === 2 && isCorrectBlack)) {
            setConflictsCount((cnt) => cnt + 1);
          }
        }

        if (checkVictory(next)) {
          triggerVictory(next);
        }

        return next;
      });
    },
    [isCompleted, rawSpec.solution, checkVictory, triggerVictory]
  );

  // 滑鼠操作 handlers
  const handleMouseDown = (r: number, c: number, e: React.MouseEvent) => {
    if (isCompleted || e.button === 1) return;
    e.preventDefault();

    isMouseDownRef.current = true;
    const currentVal = grid[r][c];
    let nextVal: CellState = 0;

    // 右鍵或 Alt 鍵快速標叉
    if (e.button === 2 || e.altKey) {
      nextVal = currentVal === 2 ? 0 : 2;
    } else {
      // 根據當前切換工具
      if (activeTool === 'fill') {
        nextVal = currentVal === 1 ? 0 : 1;
      } else {
        nextVal = currentVal === 2 ? 0 : 2;
      }
    }

    dragDrawValRef.current = nextVal;
    applyCellMutation(r, c, nextVal, true);
  };

  const handleMouseEnter = (r: number, c: number) => {
    if (!isMouseDownRef.current || dragDrawValRef.current === null || isCompleted) return;
    applyCellMutation(r, c, dragDrawValRef.current, false);
  };

  // 觸控滑動支援 (Touch Move)
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isMouseDownRef.current || dragDrawValRef.current === null || isCompleted) return;
    const touch = e.touches[0];
    const elem = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!elem) return;

    const rStr = elem.getAttribute('data-r');
    const cStr = elem.getAttribute('data-c');
    if (rStr !== null && cStr !== null) {
      applyCellMutation(parseInt(rStr, 10), parseInt(cStr, 10), dragDrawValRef.current, false);
    }
  };

  // 7. 復原 / 重做 (Undo / Redo)
  const handleUndo = useCallback(() => {
    if (history.length === 0 || isCompleted) return;
    const previous = history[history.length - 1];
    setRedoStack((prev) => [{ grid: grid.map((r) => [...r]) }, ...prev]);
    setGrid(previous.grid);
    setHistory((prev) => prev.slice(0, prev.length - 1));
  }, [history, grid, isCompleted]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted) return;
    const next = redoStack[0];
    setHistory((prev) => [...prev, { grid: grid.map((r) => [...r]) }]);
    setGrid(next.grid);
    setRedoStack((prev) => prev.slice(1));
  }, [redoStack, grid, isCompleted]);

  // 鍵盤快捷鍵 (Ctrl+Z / Ctrl+Y / Space 切換工具)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key === ' ' || e.key === 'Tab') {
        e.preventDefault();
        setActiveTool((prev) => (prev === 'fill' ? 'cross' : 'fill'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // 8. 演算法因果演繹單步提示
  const handleRequestHint = () => {
    if (isCompleted) return;
    const hint = WebNonogramGenerator.getNextForcedDeduction(rows, cols, rowClues, colClues, grid);
    setHintStep(hint);

    hintCallsCountRef.current += 1;
    const secFromStart = Math.round((Date.now() - startTimeRef.current) / 1000);
    hintLogsRef.current.push({ secFromStart, level: 1 });

    if (hint && navigator.vibrate) navigator.vibrate(25);
  };

  const handleApplyHintStep = () => {
    if (!hintStep) return;
    const [hr, hc] = hintStep.targetCell;
    applyCellMutation(hr, hc, hintStep.forcedState, true);
    setHintStep(null);
  };

  return (
    <div
      className="flex flex-col items-center select-none w-full max-w-xl mx-auto p-1 sm:p-2 touch-none"
      onContextMenu={(e) => e.preventDefault()}
      onTouchMove={handleTouchMove}
    >
      {/* 提示訊息橫額 */}
      {hintStep && (
        <div className="w-full mb-2 p-2.5 bg-indigo-950/90 border border-indigo-500/70 rounded-xl text-indigo-200 text-xs shadow-xl animate-fade-in font-mono">
          <div className="flex items-center justify-between font-bold mb-1.5 text-indigo-300">
            <span className="flex items-center gap-1">
              <span>💡</span>
              <span>{isEn ? 'Logical Deduction Step' : '演繹推導單步指引'}</span>
            </span>
            <button
              onClick={() => setHintStep(null)}
              className="px-1.5 py-0.5 rounded text-slate-400 hover:text-white hover:bg-indigo-900/60 transition"
            >
              ✕
            </button>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed mb-2">
            {isEn ? hintStep.humanReadable.en : hintStep.humanReadable.zh}
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={handleApplyHintStep}
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] rounded transition"
            >
              {isEn ? 'Apply Deduction' : '直接填入推論'}
            </button>
          </div>
        </div>
      )}

      {/* 勝利慶祝標誌 */}
      {isCompleted && (
        <div className="w-full mb-2 p-2 bg-emerald-950/90 border border-emerald-500 text-emerald-300 font-bold text-xs rounded-xl shadow-2xl flex items-center justify-center gap-2 animate-victory-pulse font-mono">
          <span>🎉</span>
          <span>{isEn ? 'Nonogram Solved & Sanctioned!' : '像素數織拓撲完美復原！'}</span>
        </div>
      )}

      {/* 互動工具列 (Tool Bar) */}
      <div className="flex items-center justify-between w-full max-w-sm mb-2 px-1 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setActiveTool('fill')}
            className={`flex items-center gap-1 px-3 py-1 rounded border transition font-bold ${
              activeTool === 'fill'
                ? 'bg-indigo-600 border-indigo-400 text-white shadow-sm'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>◼</span>
            <span>{isEn ? 'Fill' : '填黑'}</span>
          </button>
          <button
            onClick={() => setActiveTool('cross')}
            className={`flex items-center gap-1 px-3 py-1 rounded border transition font-bold ${
              activeTool === 'cross'
                ? 'bg-rose-900/80 border-rose-500 text-rose-200 shadow-sm'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>✕</span>
            <span>{isEn ? 'Cross' : '排叉'}</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleUndo}
            disabled={history.length === 0 || isCompleted}
            className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-mono"
            title="Undo (Ctrl+Z)"
          >
            ⤺
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0 || isCompleted}
            className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-mono"
            title="Redo (Ctrl+Y)"
          >
            ⤻
          </button>
        </div>
      </div>

      {/* 數織棋盤主體與自適應外圍線索佈局 */}
      <div className="relative inline-block bg-slate-950 p-2 sm:p-3 rounded-2xl border border-slate-800 shadow-2xl overflow-x-auto max-w-full">
        <div
          className="grid gap-[2px] sm:gap-1"
          style={{
            gridTemplateColumns: `auto repeat(${cols}, minmax(22px, 32px))`,
            gridTemplateRows: `auto repeat(${rows}, minmax(22px, 32px))`,
          }}
        >
          {/* 左上空白交會處 */}
          <div className="bg-slate-900/50 rounded-tl-lg flex items-center justify-center p-1 border-r border-b border-slate-800">
            <span className="text-[8px] text-slate-600 font-mono">LAWGIC</span>
          </div>

          {/* 頂部縱列線索 (Col Clues) */}
          {colClues.map((clue, cIdx) => (
            <div
              key={`col-clue-${cIdx}`}
              className={`flex flex-col items-center justify-end pb-1 px-0.5 bg-slate-900/40 border-b border-slate-700/80 text-[9px] sm:text-[10px] font-mono transition ${
                colStatus[cIdx] ? 'text-slate-600 line-through' : 'text-cyan-300'
              } ${cIdx % 5 === 4 && cIdx !== cols - 1 ? 'border-r-2 border-r-slate-700' : ''}`}
            >
              {clue.map((n, i) => (
                <span key={i} className="py-[1px] leading-tight">{n}</span>
              ))}
            </div>
          ))}

          {/* 棋盤主體與左側行線索 (Row Clues) */}
          {Array.from({ length: rows }).map((_, rIdx) => (
            <React.Fragment key={`row-wrap-${rIdx}`}>
              {/* 左側橫行線索 */}
              <div
                className={`flex items-center justify-end pr-1.5 bg-slate-900/40 border-r border-slate-700/80 text-[9px] sm:text-[10px] font-mono transition gap-1 ${
                  rowStatus[rIdx] ? 'text-slate-600 line-through' : 'text-cyan-300'
                } ${rIdx % 5 === 4 && rIdx !== rows - 1 ? 'border-b-2 border-b-slate-700' : ''}`}
              >
                {(rowClues[rIdx] || [0]).map((n, i) => (
                  <span key={i}>{n}</span>
                ))}
              </div>

              {/* 格子點陣 */}
              {Array.from({ length: cols }).map((_, cIdx) => {
                const cellState = grid[rIdx]?.[cIdx] || 0;
                const isHintTarget = hintStep?.targetCell?.[0] === rIdx && hintStep?.targetCell?.[1] === cIdx;
                const isThickBorderBottom = rIdx % 5 === 4 && rIdx !== rows - 1;
                const isThickBorderRight = cIdx % 5 === 4 && cIdx !== cols - 1;

                return (
                  <button
                    key={`cell-${rIdx}-${cIdx}`}
                    data-r={rIdx}
                    data-c={cIdx}
                    onMouseDown={(e) => handleMouseDown(rIdx, cIdx, e)}
                    onMouseEnter={() => handleMouseEnter(rIdx, cIdx)}
                    className={`relative flex items-center justify-center rounded-[3px] transition text-xs font-bold ${
                      cellState === 1
                        ? 'bg-indigo-500 text-transparent border border-indigo-400 shadow-inner'
                        : cellState === 2
                        ? 'bg-slate-900 text-rose-400 border border-slate-800'
                        : 'bg-slate-900/90 hover:bg-slate-800 border border-slate-800/80 text-transparent'
                    } ${isHintTarget ? 'ring-2 ring-amber-400 animate-pulse z-10' : ''} ${
                      isThickBorderBottom ? 'border-b-2 border-b-slate-600' : ''
                    } ${isThickBorderRight ? 'border-r-2 border-r-slate-600' : ''}`}
                  >
                    {cellState === 2 ? '✕' : ''}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* 底部功能與重設按鈕 */}
      {!tournamentMode && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleRequestHint}
            disabled={isCompleted}
            className="px-3.5 py-1.5 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-[10px] font-mono rounded-lg shadow transition disabled:opacity-40"
          >
            💡 {isEn ? 'Logical Hint' : '單步演繹提示'}
          </button>
          <button
            onClick={() => {
              setHistory((hist) => [...hist, { grid: grid.map((r) => [...r]) }]);
              setGrid(Array.from({ length: rows }, () => Array(cols).fill(0)));
            }}
            disabled={isCompleted}
            className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 text-[10px] font-mono rounded-lg transition disabled:opacity-40"
          >
            ↺ {isEn ? 'Clear Grid' : '清空盤面'}
          </button>
        </div>
      )}
    </div>
  );
};
