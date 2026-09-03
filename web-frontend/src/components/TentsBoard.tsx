// web-frontend/src/components/TentsBoard.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { TentsSpec, WebTentsGenerator, TentStep } from '../engines/tentsGenerator';
import {
  LocalPuzzleLibrary,
  TentsInterchangeCodec,
  StandardTentsStrategy,
  DiagonalTentsStrategy,
  ITentsRuleStrategy,
} from '../engines/tentsVariants';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

type CellState = 0 | 1 | 2 | 3;

export const TentsBoard: React.FC<Props> = ({ puzzle, puzzleData }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, profile, getCompositeCognitiveIndex, exportLongitudinalDataset } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as TentsSpec;
  const rows = spec?.rows || 5;
  const cols = spec?.cols || 5;
  const initialTrees = spec?.trees || [];
  const initialRowCounts = spec?.rowCounts || [];
  const initialColCounts = spec?.colCounts || [];
  const solvingSteps = spec?.solvingSteps || [];

  const [board, setBoard] = useState<CellState[][]>(() => {
    const b: CellState[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const t of initialTrees) b[t.r][t.c] = 2;
    return b;
  });

  const [activeVariant, setActiveVariant] = useState<'standard' | 'diagonal'>('standard');
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>([0, 0]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);

  // 模式控制
  const [isNoGuessMode, setIsNoGuessMode] = useState<boolean>(true);
  const [isMonochrome, setIsMonochrome] = useState<boolean>(false);
  const [isShowMatchingEdges, setIsShowMatchingEdges] = useState<boolean>(true);
  const [guessWarning, setGuessWarning] = useState<string | null>(null);
  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHintStep, setActiveHintStep] = useState<TentStep | null>(null);
  const [boardScale, setBoardScale] = useState<number>(1.0);
  const [hasCopiedKey, setHasCopiedKey] = useState<boolean>(false);
  const [hasCopiedTextPuzzle, setHasCopiedTextPuzzle] = useState<boolean>(false);
  const [showImportBox, setShowImportBox] = useState<boolean>(false);
  const [importInput, setImportInput] = useState<string>('');

  // 覆盤步驟時間軸滑塊 (Scrubbing Slider)
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<number>(1);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const replayTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startTimeRef = useRef<number>(Date.now());
  const hasRecordedRef = useRef<boolean>(false);

  // 規則策略實體
  const ruleStrategy: ITentsRuleStrategy = useMemo(() => {
    return activeVariant === 'diagonal' ? new DiagonalTentsStrategy() : new StandardTentsStrategy();
  }, [activeVariant]);

  useEffect(() => {
    const b: CellState[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const t of initialTrees) b[t.r][t.c] = 2;
    setBoard(b);
    setSelectedCell([0, 0]);
    setIsCompleted(false);
    setElapsedMs(0);
    setProofSignature(null);
    setGuessWarning(null);
    setHintLevel(0);
    setActiveHintStep(null);
    setIsReplaying(false);
    setCurrentStepIndex(0);
    if (replayTimerRef.current) clearInterval(replayTimerRef.current);
    startTimeRef.current = Date.now();
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id, rows, cols]);

  useEffect(() => {
    if (isCompleted || isReplaying) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted, isReplaying]);

  const cellSize = Math.min(300 / Math.max(rows, cols), 46);

  // 根據當前策略動態繪製連線
  const matchingLines = useMemo(() => {
    if (!isShowMatchingEdges) return [];
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const matchedTents = new Set<string>();

    for (const tree of initialTrees) {
      const neighbors = ruleStrategy.getAvailableCampNeighbors(tree, rows, cols);
      const availableTent = neighbors.find((n) => board[n.r][n.c] === 1 && !matchedTents.has(`${n.r},${n.c}`));

      if (availableTent) {
        matchedTents.add(`${availableTent.r},${availableTent.c}`);
        lines.push({
          x1: tree.c * (cellSize + 4) + cellSize / 2 + 6,
          y1: tree.r * (cellSize + 4) + cellSize / 2 + 6,
          x2: availableTent.c * (cellSize + 4) + cellSize / 2 + 6,
          y2: availableTent.r * (cellSize + 4) + cellSize / 2 + 6,
        });
      }
    }
    return lines;
  }, [board, initialTrees, rows, cols, cellSize, isShowMatchingEdges, ruleStrategy]);

  // 勝利校驗
  const checkVictory = useCallback(
    (curBoard: CellState[][]): boolean => {
      let totalTents = 0;

      for (let r = 0; r < rows; r++) {
        let rCount = 0;
        for (let c = 0; c < cols; c++) if (curBoard[r][c] === 1) rCount++;
        if (rCount !== initialRowCounts[r]) return false;
        totalTents += rCount;
      }

      for (let c = 0; c < cols; c++) {
        let cCount = 0;
        for (let r = 0; r < rows; r++) if (curBoard[r][c] === 1) cCount++;
        if (cCount !== initialColCounts[c]) return false;
      }

      if (totalTents !== initialTrees.length) return false;

      // 空間排斥校驗
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (curBoard[r][c] === 1) {
            if (ruleStrategy.hasCollision(r, c, curBoard as number[][], rows, cols)) {
              return false;
            }
          }
        }
      }

      // 每棵樹配對有效性
      for (const t of initialTrees) {
        const neighbors = ruleStrategy.getAvailableCampNeighbors(t, rows, cols);
        if (!neighbors.some((n) => curBoard[n.r][n.c] === 1)) return false;
      }

      return true;
    },
    [rows, cols, initialRowCounts, initialColCounts, initialTrees, ruleStrategy]
  );

  const triggerVictory = useCallback(() => {
    setIsCompleted(true);
    const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

    if (!hasRecordedRef.current && actualPuzzle) {
      hasRecordedRef.current = true;
      recordAttempt({
        puzzleId: actualPuzzle.id,
        engineType: 'tents',
        tier: (actualPuzzle.tier as TierKey) || 'kids',
        cognitiveLoad: actualPuzzle.cognitiveLoad || {
          spatial: 0.92,
          numeric: 0.48,
          workingMemory: 0.75,
          inhibition: 0.88,
        },
        isSuccess: true,
        timeSpentSec: timeSpent,
        conflictsCount: 0,
        technique: 'BipartiteMatching',
        isPureClear: true,
      });

      try {
        const canonical = `${actualPuzzle.id}|${timeSpent}|${activeVariant.toUpperCase()}|WPF_CERTIFIED`;
        const enc = new TextEncoder();
        window.crypto.subtle.digest('SHA-256', enc.encode(canonical)).then((buf) => {
          const hex = Array.from(new Uint8Array(buf))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          setProofSignature(`VERIFIED_${hex.slice(0, 24).toUpperCase()}`);
        });
      } catch {
        setProofSignature(`LOCAL_${Date.now()}`);
      }

      if (timeSpent <= profile.personalBest.fastestTime) {
        setShowPBModal(true);
      }
    }
  }, [actualPuzzle, activeVariant, recordAttempt, profile.personalBest.fastestTime]);

  const applyCellState = useCallback(
    (r: number, c: number, targetState: CellState) => {
      if (isCompleted || isReplaying || board[r][c] === 2) return;

      const isHintExempt = activeHintStep && activeHintStep.r === r && activeHintStep.c === c;

      if (isNoGuessMode && board[r][c] === 0 && targetState !== 0 && !isHintExempt) {
        const deductions = WebTentsGenerator.getProgressiveDeductions(rows, cols, initialTrees, initialRowCounts, initialColCounts, board);
        const deduction = deductions.get(`${r},${c}`);

        if (!deduction || (deduction.state === 1 && targetState !== 1) || (deduction.state === 2 && targetState !== 3)) {
          setGuessWarning(
            isEn
              ? '🤔 Not a forced move yet! Observe capacities or contradiction probe.'
              : '🤔 這步還不是必然定式喔！先觀察容量或反證排除。'
          );
          setTimeout(() => setGuessWarning(null), 3000);
          return;
        }
      }

      setGuessWarning(null);
      setHintLevel(0);
      setActiveHintStep(null);

      setBoard((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = next[r][c] === targetState ? 0 : targetState;
        if (checkVictory(next)) triggerVictory();
        return next;
      });

      if (navigator.vibrate) navigator.vibrate(8);
    },
    [isCompleted, isReplaying, board, activeHintStep, isNoGuessMode, rows, cols, initialTrees, initialRowCounts, initialColCounts, isEn, checkVictory, triggerVictory]
  );

  const handleLeftClick = (r: number, c: number) => {
    setSelectedCell([r, c]);
    applyCellState(r, c, 1);
  };

  const handleRightClick = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    setSelectedCell([r, c]);
    applyCellState(r, c, 3);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isReplaying || !selectedCell) return;
      const [r, c] = selectedCell;

      if (['ArrowUp', 'KeyW'].includes(e.code)) setSelectedCell([Math.max(0, r - 1), c]);
      if (['ArrowDown', 'KeyS'].includes(e.code)) setSelectedCell([Math.min(rows - 1, r + 1), c]);
      if (['ArrowLeft', 'KeyA'].includes(e.code)) setSelectedCell([r, Math.max(0, c - 1)]);
      if (['ArrowRight', 'KeyD'].includes(e.code)) setSelectedCell([r, Math.min(cols - 1, c + 1)]);

      if (['Digit1', 'KeyT'].includes(e.code)) applyCellState(r, c, 1);
      if (['Digit2', 'KeyG'].includes(e.code)) applyCellState(r, c, 3);
      if (['Digit0', 'KeyC', 'Backspace', 'Delete'].includes(e.code)) applyCellState(r, c, 0);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompleted, isReplaying, selectedCell, rows, cols, applyCellState]);

  const handleRequestHint = useCallback(() => {
    if (isCompleted || isReplaying) return;

    const deductions = WebTentsGenerator.getProgressiveDeductions(rows, cols, initialTrees, initialRowCounts, initialColCounts, board);
    if (deductions.size === 0) {
      setGuessWarning(isEn ? 'Observe bipartite pairing around trees!' : '請觀察樹木周圍的二分圖配對！');
      return;
    }

    const item = deductions.values().next().value;
    const { r, c, state, type, rationale, humanReadable } = item;

    setSelectedCell([r, c]);

    if (!activeHintStep || activeHintStep.r !== r || activeHintStep.c !== c) {
      setActiveHintStep({
        step: 1,
        type,
        r, c, state,
        rationale,
        humanReadable,
      });
      setHintLevel(1);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, isReplaying, rows, cols, initialTrees, initialRowCounts, initialColCounts, board, isEn, activeHintStep]);

  // 細節 3：跳轉至特定步驟 (Step Scrubbing)
  const renderStepAt = useCallback((targetStep: number) => {
    const baseBoard: CellState[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const t of initialTrees) baseBoard[t.r][t.c] = 2;

    for (let i = 0; i < targetStep && i < solvingSteps.length; i++) {
      const st = solvingSteps[i];
      baseBoard[st.r][st.c] = st.state === 1 ? 1 : 3;
    }

    setBoard(baseBoard);
    setCurrentStepIndex(targetStep);
  }, [rows, cols, initialTrees, solvingSteps]);

  // 變速自動重播
  const handleStartReplay = (speedMultiplier: number = 1) => {
    if (solvingSteps.length === 0) return;
    if (replayTimerRef.current) clearInterval(replayTimerRef.current);

    setIsReplaying(true);
    setReplaySpeed(speedMultiplier);

    let step = 0;
    renderStepAt(0);

    const intervalMs = Math.max(60, Math.round(500 / speedMultiplier));
    replayTimerRef.current = setInterval(() => {
      step++;
      if (step > solvingSteps.length) {
        if (replayTimerRef.current) clearInterval(replayTimerRef.current);
        setIsReplaying(false);
        return;
      }
      renderStepAt(step);
    }, intervalMs);
  };

  const handleStopReplay = () => {
    if (replayTimerRef.current) clearInterval(replayTimerRef.current);
    setIsReplaying(false);
  };

  // 細節 1：純文字題目匯出
  const handleExportTextPuzzle = () => {
    if (actualPuzzle) {
      const text = TentsInterchangeCodec.exportToText(actualPuzzle);
      navigator.clipboard.writeText(text);
      setHasCopiedTextPuzzle(true);
      setTimeout(() => setHasCopiedTextPuzzle(false), 2000);
    }
  };

  // 細節 1：純文字題目匯入解析
  const handleImportTextPuzzle = () => {
    const parsed = TentsInterchangeCodec.importFromText(importInput);
    if (!parsed) {
      alert(isEn ? 'Invalid Tents Code format!' : '無效的帳篷題目格式！');
      return;
    }
    setActiveVariant(parsed.variant);
    const newBoard: CellState[][] = Array.from({ length: parsed.rows }, () => Array(parsed.cols).fill(0));
    for (const t of parsed.trees) newBoard[t.r][t.c] = 2;
    setBoard(newBoard);
    setShowImportBox(false);
    setImportInput('');
    setIsCompleted(false);
    startTimeRef.current = Date.now();
  };

  const handleCopyAnswerKey = () => {
    if (spec?.wpfAnswerKey) {
      navigator.clipboard.writeText(spec.wpfAnswerKey);
      setHasCopiedKey(true);
      setTimeout(() => setHasCopiedKey(false), 2000);
    }
  };

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  return (
    <div className={`flex flex-col items-center justify-center p-2 select-none font-mono ${isMonochrome ? 'bg-black text-white' : ''}`}>
      {/* 頂部數據列 */}
      <div className="w-full grid grid-cols-3 gap-1 mb-1.5 text-[9px]">
        <div className={`border p-1.5 rounded text-center ${isMonochrome ? 'bg-neutral-950 border-neutral-800' : 'bg-slate-950 border-slate-800'}`}>
          <div className="text-slate-500 text-[7px]">{isEn ? '⏱️ Speed' : '⏱️ 競速'}</div>
          <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
        </div>
        <div className={`border p-1.5 rounded text-center ${isMonochrome ? 'bg-neutral-950 border-neutral-800' : 'bg-slate-950 border-slate-800'}`}>
          <div className="text-slate-500 text-[7px]">{isEn ? '📐 Dimension' : '📐 規模'}</div>
          <div className={`${isMonochrome ? 'text-white' : 'text-cyan-300'} font-bold`}>{rows} × {cols}</div>
        </div>
        <div className={`border p-1.5 rounded text-center ${isMonochrome ? 'bg-neutral-950 border-neutral-800' : 'bg-slate-950 border-slate-800'}`}>
          <div className="text-slate-500 text-[7px]">{isEn ? '🌲 Variant' : '🌲 規則'}</div>
          <div className={`${isMonochrome ? 'text-white' : 'text-emerald-400'} font-bold text-[7.5px]`}>
            {activeVariant === 'diagonal' ? 'DIAGONAL' : 'STANDARD'}
          </div>
        </div>
      </div>

      {/* 控制列：細節 2 變體切換、黑白切換、匯入匯出 */}
      <div className="w-full flex items-center justify-between px-1 mb-1.5">
        <div className="flex items-center gap-1.5">
          {/* 細節 2：動態切換正交 / 對角變體 */}
          <button
            onClick={() => setActiveVariant((v) => (v === 'standard' ? 'diagonal' : 'standard'))}
            className={`px-1.5 py-0.5 rounded text-[7px] font-bold border transition ${
              activeVariant === 'diagonal'
                ? 'bg-amber-500 text-black border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                : 'bg-slate-900 text-slate-300 border-slate-700'
            }`}
          >
            {activeVariant === 'diagonal' ? '⟳ 对角變體' : '⟳ 正交標準'}
          </button>
          <button
            onClick={() => setIsMonochrome((prev) => !prev)}
            className={`px-1.5 py-0.5 rounded text-[7px] font-bold border transition ${
              isMonochrome
                ? 'bg-white text-black border-white shadow-[0_0_6px_rgba(255,255,255,0.8)]'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            {isMonochrome ? '◼ PRINT' : '◻ KAWAII'}
          </button>
          <button
            onClick={() => setShowImportBox(true)}
            className="px-1.5 py-0.5 rounded text-[7px] font-bold bg-slate-900 text-cyan-300 border border-slate-800 hover:bg-slate-800"
          >
            📥 {isEn ? 'Import' : '匯入'}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setBoardScale((s) => Math.max(0.85, Number((s - 0.05).toFixed(2))))}
            className="w-5 h-5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs flex items-center justify-center active:scale-95"
            title={isEn ? 'Zoom Out' : '縮小'}
          >
            -
          </button>
          <span className="text-[7.5px] text-slate-500 font-mono w-7 text-center">
            {Math.round(boardScale * 100)}%
          </span>
          <button
            onClick={() => setBoardScale((s) => Math.min(1.25, Number((s + 0.05).toFixed(2))))}
            className="w-5 h-5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs flex items-center justify-center active:scale-95"
            title={isEn ? 'Zoom In' : '放大'}
          >
            +
          </button>
        </div>
      </div>

      {/* 盤面主體 */}
      <div
        className={`relative p-3 border-2 transition-transform duration-150 flex flex-col items-center ${
          isMonochrome
            ? 'bg-black border-neutral-700 shadow-none rounded-none'
            : 'bg-slate-950 border-slate-800 rounded-xl shadow-2xl'
        }`}
        style={{ transform: `scale(${boardScale})`, transformOrigin: 'top center' }}
      >
        {/* 頂部列配額指示 */}
        <div className="flex pl-8 mb-1">
          {initialColCounts.map((count, c) => {
            let currentInCol = 0;
            for (let r = 0; r < rows; r++) if (board[r][c] === 1) currentInCol++;
            const isFull = currentInCol === count;

            return (
              <div
                key={`col-${c}`}
                className={`flex items-center justify-center font-bold text-xs ${
                  isFull ? 'text-neutral-500' : isMonochrome ? 'text-white font-extrabold' : 'text-amber-400'
                }`}
                style={{ width: cellSize + 4 }}
              >
                {count}
              </div>
            );
          })}
        </div>

        <div className="flex relative">
          {/* 左側行配額指示 */}
          <div className="flex flex-col justify-around pr-2">
            {initialRowCounts.map((count, r) => {
              let currentInRow = 0;
              for (let c = 0; c < cols; c++) if (board[r][c] === 1) currentInRow++;
              const isFull = currentInRow === count;

              return (
                <div
                  key={`row-${r}`}
                  className={`flex items-center justify-end font-bold text-xs ${
                    isFull ? 'text-neutral-500' : isMonochrome ? 'text-white font-extrabold' : 'text-amber-400'
                  }`}
                  style={{ height: cellSize + 4 }}
                >
                  {count}
                </div>
              );
            })}
          </div>

          <div className="relative">
            {/* SVG 連線層 */}
            <svg
              className="absolute inset-0 pointer-events-none z-20"
              style={{
                width: cols * (cellSize + 4) + 8,
                height: rows * (cellSize + 4) + 8,
              }}
            >
              {matchingLines.map((line, idx) => (
                <line
                  key={`match-${idx}`}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={isMonochrome ? '#ffffff' : '#10b981'}
                  strokeWidth={isMonochrome ? '1.5' : '2.5'}
                  strokeDasharray="2 2"
                  className={isMonochrome ? '' : 'animate-pulse'}
                />
              ))}
            </svg>

            {/* 方格矩陣 */}
            <div
              className={`grid gap-1 p-1.5 border ${
                isMonochrome
                  ? 'bg-neutral-900 border-neutral-600 rounded-none'
                  : 'bg-slate-900/90 border-slate-800 rounded-lg'
              }`}
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                width: cols * cellSize + (cols - 1) * 4 + 12,
                height: rows * cellSize + (rows - 1) * 4 + 12,
              }}
            >
              {board.map((row, r) =>
                row.map((cell, c) => {
                  const isSelected = selectedCell?.[0] === r && selectedCell?.[1] === c;
                  const isHintTarget = activeHintStep?.r === r && activeHintStep?.c === c;

                  return (
                    <div
                      key={`${r}-${c}`}
                      onClick={() => handleLeftClick(r, c)}
                      onContextMenu={(e) => handleRightClick(e, r, c)}
                      className={`relative flex items-center justify-center text-sm sm:text-base cursor-pointer transition select-none ${
                        isMonochrome
                          ? `rounded-none border ${
                              isHintTarget && hintLevel >= 2
                                ? 'border-white bg-neutral-800 ring-2 ring-white z-30'
                                : isSelected
                                ? 'border-white bg-neutral-800 z-20'
                                : cell === 2
                                ? 'bg-black border-neutral-700 cursor-default'
                                : cell === 1
                                ? 'bg-black border-neutral-500 font-bold text-white'
                                : cell === 3
                                ? 'bg-neutral-950 border-neutral-800 text-neutral-500'
                                : 'bg-black hover:bg-neutral-900 border-neutral-800'
                            }`
                          : `rounded-md ${
                              isHintTarget && hintLevel >= 2
                                ? 'ring-2 ring-rose-500 bg-rose-950/40 animate-pulse z-30'
                                : isSelected
                                ? 'ring-2 ring-indigo-400 bg-indigo-950/50 z-20'
                                : cell === 2
                                ? 'bg-emerald-950/60 border border-emerald-800/40 cursor-default'
                                : cell === 1
                                ? 'bg-amber-950/80 border border-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                                : cell === 3
                                ? 'bg-emerald-950/30 border border-emerald-900/30'
                                : 'bg-slate-950/80 hover:bg-slate-900 border border-slate-800/60'
                            }`
                      }`}
                      style={{ width: cellSize, height: cellSize }}
                    >
                      {isMonochrome ? (
                        cell === 2 ? '●' : cell === 1 ? '▲' : cell === 3 ? '·' : ''
                      ) : (
                        cell === 2 ? '🌲' : cell === 1 ? '⛺' : cell === 3 ? (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/50" />
                        ) : ''
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 視線因果校正提示 */}
      {hintLevel > 0 && activeHintStep && (
        <div className="mt-2.5 p-2 bg-slate-900/90 border border-amber-500/60 rounded-xl text-center max-w-xs animate-fade-in shadow-lg">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[7.5px] font-bold text-amber-300 tracking-wider">
              🔮 {isEn ? 'FOCUS RETARGETING' : '視線因果校正'}
            </span>
            <div className="flex gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${hintLevel >= 1 ? 'bg-amber-400' : 'bg-slate-700'}`} />
              <span className={`w-1.5 h-1.5 rounded-full ${hintLevel >= 2 ? 'bg-amber-400' : 'bg-slate-700'}`} />
              <span className={`w-1.5 h-1.5 rounded-full ${hintLevel >= 3 ? 'bg-rose-500 animate-ping' : 'bg-slate-700'}`} />
            </div>
          </div>

          <div className="py-1 flex flex-col items-center justify-center gap-1 text-[8.5px] font-mono text-slate-200">
            {hintLevel === 1 && (
              <span className="text-amber-300">
                🔍 {isEn ? 'Inspect coordinate cluster' : '審視座標群'} [{activeHintStep.r + 1}, {activeHintStep.c + 1}]
              </span>
            )}
            {hintLevel === 2 && (
              <span className="text-cyan-300 font-bold">
                ⚡ {activeHintStep.rationale}
              </span>
            )}
            {hintLevel === 3 && (
              <span className="text-rose-400 font-extrabold flex items-center gap-1">
                <span>🎯 {isEn ? 'Contradiction identified! Decide cell yourself.' : '矛盾源已框定！請親手敲下結論。'}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* 警告浮動條 */}
      {guessWarning && (
        <div className="mt-2 px-3 py-1 bg-amber-950/90 border border-amber-500/70 text-amber-300 text-[8px] rounded-lg animate-bounce text-center max-w-xs">
          {guessWarning}
        </div>
      )}

      {/* 底部按鈕列 */}
      <div className="flex items-center justify-between w-full max-w-xs mt-2 px-1 text-[7.5px] text-slate-400">
        <div className="flex gap-1.5">
          <button
            onClick={() => setIsNoGuessMode((prev) => !prev)}
            className={`px-2 py-1 text-[7.5px] font-bold rounded-md border transition ${
              isNoGuessMode
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            🧠 {isNoGuessMode ? 'NO-GUESS' : 'FREE'}
          </button>
          <button
            onClick={handleRequestHint}
            className="px-2 py-1 text-[7.5px] font-bold rounded-md border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition flex items-center gap-0.5"
          >
            💡 {isEn ? 'Hint' : '提示'}
          </button>
        </div>
        <span>
          {isEn ? 'L: Tent | R: Grass | 1/2: Key' : '左鍵: 帳篷 | 右鍵: 草地 | 鍵: 1/2'}
        </span>
      </div>

      {/* 細節 1：純文字題目匯入彈窗 */}
      {showImportBox && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in font-mono">
          <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl w-full max-w-sm">
            <div className="text-xs font-bold text-cyan-300 mb-2">📥 匯入題目代碼 (Interchange Code)</div>
            <textarea
              value={importInput}
              onChange={(e) => setImportInput(e.target.value)}
              placeholder="貼上 TENTS:8x8:standard:... 格式"
              className="w-full h-20 bg-slate-950 border border-slate-800 rounded p-1.5 text-[8px] text-slate-200 font-mono resize-none focus:outline-none focus:border-cyan-500 mb-2"
            />
            <div className="flex gap-1.5">
              <button
                onClick={handleImportTextPuzzle}
                className="flex-1 py-1 bg-cyan-600 hover:bg-cyan-500 text-black font-bold text-xs rounded transition"
              >
                載入開戰
              </button>
              <button
                onClick={() => setShowImportBox(false)}
                className="px-3 py-1 bg-slate-800 text-slate-300 text-xs rounded hover:bg-slate-700 transition"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 結算面板 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-emerald-500/60 rounded-xl text-center w-full max-w-xs shadow-2xl animate-fade-in font-mono">
          <div className="text-emerald-400 font-bold text-xs mb-0.5">✨ CAMP ESTABLISHED</div>
          {isNoGuessMode && (
            <div className="text-[8px] text-amber-300 font-bold mb-1">
              🏆 {isEn ? 'Pure Matching Mastery (Zero Guessing)' : '傳奇純空間配對（零猜測認證）'}
            </div>
          )}
          <div className="text-[9px] text-slate-400 mb-2">
            {isEn ? 'Time' : '耗時'}: {(elapsedMs / 1000).toFixed(2)}s | Gf: IQ {cci.standardIQ}
          </div>

          {/* WPF Answer Key */}
          <div className="mb-2 p-1.5 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-between">
            <div className="text-left">
              <div className="text-[6.5px] text-slate-500 font-bold uppercase tracking-wider">
                🏁 WPF Answer Key
              </div>
              <div className="text-xs font-mono font-black text-amber-300 tracking-widest mt-0.5">
                {spec?.wpfAnswerKey || 'N/A'}
              </div>
            </div>
            <button
              onClick={handleCopyAnswerKey}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[7px] text-cyan-300 rounded border border-slate-700 transition active:scale-95"
            >
              {hasCopiedKey ? (isEn ? '✓ Copied' : '✓ 已複製') : (isEn ? 'Copy' : '複製題解碼')}
            </button>
          </div>

          {/* 細節 1：純文字題目代碼匯出 */}
          <div className="mb-2 flex gap-1">
            <button
              onClick={handleExportTextPuzzle}
              className="w-full py-1 bg-slate-900 hover:bg-slate-800 border border-emerald-500/40 text-emerald-300 text-[7.5px] font-bold rounded transition flex items-center justify-center gap-1"
            >
              📋 {hasCopiedTextPuzzle ? (isEn ? '✓ Code Copied to Clipboard' : '✓ 題目代碼已複製') : (isEn ? 'Export Puzzle (Discord Share)' : '匯出題目代碼 (Discord分享)')}
            </button>
          </div>

          {/* 細節 3：覆盤時間軸步進拖曳滑塊 (Step Scrubbing Range Slider) */}
          <div className="mb-2 p-2 bg-slate-900/80 border border-indigo-500/40 rounded-lg text-left">
            <div className="text-[7.5px] text-indigo-300 font-bold mb-1 flex justify-between items-center">
              <span>🔁 {isEn ? 'Decision Branch Scrubbing' : '決策分歧點步進拖曳'}</span>
              <span className="text-amber-300 font-mono">{currentStepIndex} / {solvingSteps.length} 步</span>
            </div>

            {/* 拖曳滑桿 */}
            <input
              type="range"
              min={0}
              max={solvingSteps.length}
              value={currentStepIndex}
              onChange={(e) => {
                handleStopReplay();
                renderStepAt(Number(e.target.value));
              }}
              className="w-full accent-indigo-400 cursor-pointer mb-1.5"
            />

            {/* 變速按鈕群 */}
            <div className="flex gap-1 items-center">
              <span className="text-[6.5px] text-slate-500 mr-1">PLAY:</span>
              {[0.5, 1, 2, 5].map((spd) => (
                <button
                  key={spd}
                  onClick={() => handleStartReplay(spd)}
                  className={`flex-1 py-0.5 text-[7px] font-bold rounded border transition active:scale-95 ${
                    isReplaying && replaySpeed === spd
                      ? 'bg-amber-400 text-black border-amber-300'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  {spd}x
                </button>
              ))}
              {isReplaying && (
                <button
                  onClick={handleStopReplay}
                  className="px-1.5 py-0.5 text-[7px] font-bold rounded bg-rose-950 text-rose-300 border border-rose-800"
                >
                  ■ 暫停
                </button>
              )}
            </div>
          </div>

          <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800 flex flex-col items-center mb-2">
            <CognitiveRadarChart dimensions={profile.cognitiveDimensions} size={130} />
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={exportLongitudinalDataset}
              className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 border border-cyan-600/50 text-cyan-300 text-[8px] font-bold rounded-lg transition"
            >
              📊 {isEn ? 'Export Data' : '匯出數據'}
            </button>
          </div>

          {proofSignature && (
            <div className="mt-2 p-1.5 bg-slate-900 border border-slate-800 rounded text-left">
              <div className="text-[6.5px] font-mono text-cyan-400/80 break-all select-all">
                {proofSignature}
              </div>
            </div>
          )}
        </div>
      )}

      {showPBModal && (
        <PBCelebrationModal pb={profile.personalBest} onClose={() => setShowPBModal(false)} isEn={isEn} />
      )}
    </div>
  );
};
