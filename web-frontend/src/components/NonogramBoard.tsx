// web-frontend/src/components/NonogramBoard.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

export const NonogramBoard: React.FC<Props> = ({ puzzle, puzzleData }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, profile, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as NonogramSpec;
  const rows = spec?.rows || 5;
  const cols = spec?.cols || 5;
  const rowClues = spec?.rowClues || [];
  const colClues = spec?.colClues || [];
  const solution: boolean[][] = spec?.solution || [];

  const [grid, setGrid] = useState<CellState[][]>(() =>
    Array.from({ length: rows }, () => Array(cols).fill(0))
  );
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>([0, 0]);
  const [isCrossMode, setIsCrossMode] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [startTime, setStartTime] = useState<number>(Date.now());

  // 三階因果提示狀態
  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<NonogramHintStep | null>(null);

  useEffect(() => {
    setGrid(Array.from({ length: rows }, () => Array(cols).fill(0)));
    setSelectedCell([0, 0]);
    setIsCompleted(false);
    setElapsedMs(0);
    setStartTime(Date.now());
    setHintLevel(0);
    setActiveHint(null);
  }, [actualPuzzle?.id, rows, cols]);

  useEffect(() => {
    if (isCompleted) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted, startTime]);

  const rowCompletionStatus = useMemo(() => {
    return Array.from({ length: rows }, (_, r) => {
      const line = grid[r].map((v) => v === 1);
      const clue = WebNonogramGenerator.extractLineClues(line);
      return clue.join(',') === rowClues[r]?.join(',');
    });
  }, [grid, rowClues, rows]);

  const colCompletionStatus = useMemo(() => {
    return Array.from({ length: cols }, (_, c) => {
      const line = Array.from({ length: rows }, (_, r) => grid[r][c] === 1);
      const clue = WebNonogramGenerator.extractLineClues(line);
      return clue.join(',') === colClues[c]?.join(',');
    });
  }, [grid, colClues, rows, cols]);

  const checkVictory = useCallback(
    (curGrid: CellState[][]): boolean => {
      if (!solution || solution.length === 0) return false;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (solution[r][c] !== (curGrid[r][c] === 1)) {
            return false;
          }
        }
      }
      return true;
    },
    [rows, cols, solution]
  );

  const applyCellState = useCallback(
    (r: number, c: number, target: CellState) => {
      if (isCompleted) return;

      setHintLevel(0);
      setActiveHint(null);

      setGrid((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = next[r][c] === target ? 0 : target;

        if (checkVictory(next)) {
          setIsCompleted(true);
          const timeSpent = Math.max(1, Math.round((Date.now() - startTime) / 1000));
          if (actualPuzzle) {
            recordAttempt({
              puzzleId: actualPuzzle.id,
              engineType: 'nonogram',
              tier: (actualPuzzle.tier as TierKey) || 'kids',
              cognitiveLoad: actualPuzzle.cognitiveLoad || {
                spatial: 0.9,
                numeric: 0.5,
                workingMemory: 0.8,
                inhibition: 0.85,
              },
              isSuccess: true,
              timeSpentSec: timeSpent,
              conflictsCount: 0,
              technique: 'ConstraintSatisfaction',
              isPureClear: true,
            });
          }
        }
        return next;
      });
    },
    [isCompleted, checkVictory, startTime, actualPuzzle, recordAttempt]
  );

  const handleCellClick = (r: number, c: number) => {
    setSelectedCell([r, c]);
    applyCellState(r, c, isCrossMode ? 2 : 1);
  };

  const handleCellContextMenu = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    setSelectedCell([r, c]);
    applyCellState(r, c, 2);
  };

  const handleRequestHint = useCallback(() => {
    if (isCompleted) return;

    const step = WebNonogramGenerator.getNextForcedDeduction(rows, cols, rowClues, colClues, grid);
    if (!step) return;

    if (!activeHint || activeHint.targetCell[0] !== step.targetCell[0] || activeHint.targetCell[1] !== step.targetCell[1]) {
      setActiveHint(step);
      setHintLevel(1);
      setSelectedCell(step.targetCell);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, rows, cols, rowClues, colClues, grid, activeHint]);

  const maxColClueLength = useMemo(() => Math.max(1, ...colClues.map((c) => c.length)), [colClues]);
  const maxRowClueLength = useMemo(() => Math.max(1, ...rowClues.map((r) => r.length)), [rowClues]);
  const cellSize = Math.min(260 / Math.max(rows, cols), 36);
  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono">
      {/* 數據看板 */}
      <div className="w-full grid grid-cols-3 gap-1 mb-2 text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? 'Speed' : '競速'}</div>
          <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? 'Dimension' : '規格'}</div>
          <div className="text-cyan-300 font-bold">{rows} &times; {cols}</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? 'Deduction' : '定式純度'}</div>
          <div className="text-amber-400 font-bold">
            {spec.pureDeductionRate ? `${Math.round(spec.pureDeductionRate * 100)}%` : '100%'}
          </div>
        </div>
      </div>

      {/* 棋盤主體 */}
      <div className="relative p-2 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl flex flex-col items-end">
        {/* 頂部列線索 */}
        <div className="flex" style={{ marginLeft: maxRowClueLength * 16 + 8 }}>
          {colClues.map((clueArr, c) => {
            const isDone = colCompletionStatus[c];
            const isHintCol = activeHint?.orientation === 'col' && activeHint?.index === c && hintLevel >= 1;

            return (
              <div
                key={`col-clue-${c}`}
                className={`flex flex-col justify-end items-center text-[9px] font-bold py-1 transition-colors ${
                  isHintCol
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400 rounded-t'
                    : isDone
                    ? 'bg-emerald-950/40 text-emerald-400'
                    : 'text-slate-400'
                }`}
                style={{ width: cellSize + 2, minHeight: maxColClueLength * 14 }}
              >
                {clueArr.map((clue, idx) => (
                  <span
                    key={idx}
                    className={`${isDone ? 'line-through opacity-40 text-emerald-300' : clue === 0 ? 'opacity-30' : 'text-cyan-300'}`}
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
          {/* 左側行線索 */}
          <div className="flex flex-col justify-around pr-2">
            {rowClues.map((clueArr, r) => {
              const isDone = rowCompletionStatus[r];
              const isHintRow = activeHint?.orientation === 'row' && activeHint?.index === r && hintLevel >= 1;

              return (
                <div
                  key={`row-clue-${r}`}
                  className={`flex items-center justify-end gap-1 px-1 text-[9px] font-bold transition-colors ${
                    isHintRow
                      ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400 rounded-l'
                      : isDone
                      ? 'bg-emerald-950/40 text-emerald-400'
                      : 'text-slate-400'
                  }`}
                  style={{ height: cellSize + 2 }}
                >
                  {clueArr.map((clue, idx) => (
                    <span
                      key={idx}
                      className={`${isDone ? 'line-through opacity-40 text-emerald-300' : clue === 0 ? 'opacity-30' : 'text-cyan-300'}`}
                    >
                      {clue}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>

          {/* 像素格子矩陣（含 5x5 粗框線定位） */}
          <div
            className="grid gap-[1px] bg-slate-900/90 p-[2px] rounded border border-slate-800"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {grid.map((row, r) =>
              row.map((val, c) => {
                const isSelected = selectedCell?.[0] === r && selectedCell?.[1] === c;
                const isHintTarget = activeHint?.targetCell[0] === r && activeHint?.targetCell[1] === c;

                let bgClass = 'bg-slate-950 hover:bg-slate-900 text-slate-500';
                if (val === 1) bgClass = 'bg-cyan-400 text-black shadow-[0_0_8px_rgba(34,211,238,0.6)]';
                if (val === 2) bgClass = 'bg-slate-900 text-rose-400';

                if (isHintTarget && hintLevel === 3) {
                  bgClass = 'bg-amber-500/50 text-amber-200 ring-2 ring-amber-400 animate-pulse z-20';
                }

                const borderBottom = (r + 1) % 5 === 0 && r !== rows - 1 ? 'border-b-2 border-slate-700' : '';
                const borderRight = (c + 1) % 5 === 0 && c !== cols - 1 ? 'border-r-2 border-slate-700' : '';

                return (
                  <div
                    key={`${r}-${c}`}
                    onClick={() => handleCellClick(r, c)}
                    onContextMenu={(e) => handleCellContextMenu(e, r, c)}
                    className={`flex items-center justify-center font-bold text-[9px] cursor-pointer transition select-none ${bgClass} ${borderBottom} ${borderRight} ${
                      isSelected ? 'ring-2 ring-indigo-400 z-10' : ''
                    }`}
                    style={{ width: cellSize, height: cellSize }}
                  >
                    {val === 2 && '×'}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 三階因果提示階梯面板 */}
      {hintLevel > 0 && activeHint && (
        <div className="mt-2.5 p-2 bg-slate-900/90 border border-amber-500/60 rounded-xl text-center w-full max-w-[280px] shadow-lg animate-fade-in font-mono">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[7.5px] font-bold text-amber-300 tracking-wider">
              🔮 {isEn ? 'FOCUS RETARGETING' : '視線因果校正'}
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
                🔍 {isEn ? `Scan ${activeHint.orientation.toUpperCase()} ${activeHint.index + 1}` : `請審視第 ${activeHint.index + 1} ${activeHint.orientation === 'row' ? '行' : '列'}`}
              </span>
            )}
            {hintLevel === 2 && (
              <span className="text-cyan-300 font-bold">
                ⚡ {isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}
              </span>
            )}
            {hintLevel === 3 && (
              <span className="text-rose-400 font-extrabold">
                🎯 {isEn ? `Target cell [${activeHint.targetCell[0] + 1}, ${activeHint.targetCell[1] + 1}] is forced ${activeHint.forcedState === 1 ? 'FILLED' : 'CROSSED'}!` : `目標格 [${activeHint.targetCell[0] + 1}, ${activeHint.targetCell[1] + 1}] 必然${activeHint.forcedState === 1 ? '填黑' : '標叉'}！`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 控制按鈕群 */}
      <div className="flex items-center justify-between w-full max-w-[280px] mt-3 gap-2">
        <button
          onClick={() => setIsCrossMode(false)}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition ${
            !isCrossMode
              ? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]'
              : 'bg-slate-900 text-slate-400 border-slate-800'
          }`}
        >
          ■ {isEn ? 'Fill' : '填色'}
        </button>
        <button
          onClick={() => setIsCrossMode(true)}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition ${
            isCrossMode
              ? 'bg-rose-500 text-black border-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.4)]'
              : 'bg-slate-900 text-slate-400 border-slate-800'
          }`}
        >
          × {isEn ? 'Cross' : '標叉'}
        </button>
        <button
          onClick={handleRequestHint}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition flex items-center gap-1"
        >
          💡 {isEn ? 'Hint' : '提示'}
        </button>
      </div>

      {/* 通關成就面板與像素圖案可視化 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-emerald-500/60 rounded-xl text-center w-full max-w-[280px] shadow-2xl animate-fade-in font-mono">
          <div className="text-emerald-400 font-bold text-xs mb-0.5">PIXEL ART RESOLVED!</div>
          <div className="text-[9px] text-slate-400 mb-2">
            {isEn ? 'Time' : '耗時'}: {(elapsedMs / 1000).toFixed(2)}s | Gf: IQ {cci.standardIQ}
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-lg flex flex-col items-center">
            <div className="text-[7.5px] text-amber-300 font-bold mb-1.5 tracking-wider">
              {isEn ? 'DECODED PIXEL EMBLEM' : '解碼像素紋章'}
            </div>
            <div
              className="grid gap-[1px] p-1.5 bg-black rounded border border-slate-800 shadow-inner"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {solution.map((row, r) =>
                row.map((filled, c) => (
                  <div
                    key={`solved-${r}-${c}`}
                    style={{ width: Math.max(8, Math.floor(120 / cols)), height: Math.max(8, Math.floor(120 / cols)) }}
                    className={`rounded-[1px] ${filled ? 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.8)]' : 'bg-slate-900/60'}`}
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
