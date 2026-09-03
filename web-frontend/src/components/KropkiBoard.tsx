// web-frontend/src/components/KropkiBoard.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { KropkiSpec, WebKropkiGenerator, SolvingStep } from '../engines/kropkiGenerator';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

export const KropkiBoard: React.FC<Props> = ({ puzzle, puzzleData }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, profile, getCompositeCognitiveIndex, exportLongitudinalDataset } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as KropkiSpec;
  const n = spec?.size || 4;
  const initialGrid = spec?.initialGrid || Array.from({ length: n }, () => Array(n).fill(0));
  const dots = spec?.dots || [];
  const solvingSteps = spec?.solvingSteps || [];

  const [grid, setGrid] = useState<number[][]>(() => initialGrid.map((r) => [...r]));
  const [notes, setNotes] = useState<Set<number>[][]>(() =>
    Array.from({ length: n }, () => Array.from({ length: n }, () => new Set<number>()))
  );
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>([0, 0]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [conflictsCount, setConflictsCount] = useState<number>(0);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);

  const [isNoteMode, setIsNoteMode] = useState<boolean>(false);
  const [isNoGuessMode, setIsNoGuessMode] = useState<boolean>(true);
  const [guessWarning, setGuessWarning] = useState<string | null>(null);

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHintStep, setActiveHintStep] = useState<SolvingStep | null>(null);
  const [boardScale, setBoardScale] = useState<number>(1.0);

  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const hasRecordedRef = useRef<boolean>(false);

  useEffect(() => {
    setGrid(initialGrid.map((r) => [...r]));
    setNotes(Array.from({ length: n }, () => Array.from({ length: n }, () => new Set<number>())));
    setSelectedCell([0, 0]);
    setIsCompleted(false);
    setElapsedMs(0);
    setConflictsCount(0);
    setProofSignature(null);
    setGuessWarning(null);
    setHintLevel(0);
    setActiveHintStep(null);
    startTimeRef.current = Date.now();
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id]);

  useEffect(() => {
    if (isCompleted) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted]);

  const checkCompletion = useCallback((currentGrid: number[][]) => {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (currentGrid[r][c] === 0) return false;
      }
    }

    for (let i = 0; i < n; i++) {
      const rowVals = new Set<number>();
      const colVals = new Set<number>();
      for (let j = 0; j < n; j++) {
        rowVals.add(currentGrid[i][j]);
        colVals.add(currentGrid[j][i]);
      }
      if (rowVals.size !== n || colVals.size !== n) return false;
    }

    for (const dot of dots) {
      const v1 = currentGrid[dot.r1][dot.c1];
      const v2 = currentGrid[dot.r2][dot.c2];
      if (dot.type === 'white') {
        if (Math.abs(v1 - v2) !== 1) return false;
      } else if (dot.type === 'black') {
        if (v1 !== v2 * 2 && v2 !== v1 * 2) return false;
      }
    }

    return true;
  }, [n, dots]);

  const toggleNote = useCallback((num: number) => {
    if (isCompleted || !selectedCell) return;
    const [r, c] = selectedCell;
    if (initialGrid[r][c] !== 0 || grid[r][c] !== 0) return;

    setNotes((prev) => {
      const next = prev.map((row) => row.map((s) => new Set(s)));
      const targetSet = next[r][c];
      if (targetSet.has(num)) targetSet.delete(num);
      else targetSet.add(num);
      return next;
    });
  }, [isCompleted, selectedCell, initialGrid, grid]);

  const handleRequestHint = useCallback(() => {
    if (isCompleted) return;

    const deductions = WebKropkiGenerator.getStrictDeductions(grid, dots, n);
    if (deductions.size === 0) {
      setGuessWarning(isEn ? 'Current grid requires global cross-check!' : '目前需要全局交叉比對！');
      return;
    }

    const [coord, info] = deductions.entries().next().value;
    const [r, c] = coord.split(',').map(Number);

    setSelectedCell([r, c]);

    if (!activeHintStep || activeHintStep.row !== r || activeHintStep.col !== c) {
      setActiveHintStep({
        step: 1,
        type: info.type,
        row: r,
        col: c,
        value: info.value,
        rationale: info.rationale,
      });
      setHintLevel(1);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, grid, dots, n, isEn, activeHintStep]);

  const handleInputNumber = useCallback((num: number) => {
    if (isCompleted || !selectedCell) return;
    const [r, c] = selectedCell;
    if (initialGrid[r][c] !== 0) return;

    if (isNoteMode && num !== 0) {
      toggleNote(num);
      return;
    }

    if (isNoGuessMode && num !== 0) {
      const deductions = WebKropkiGenerator.getStrictDeductions(grid, dots, n);
      const deduction = deductions.get(`${r},${c}`);

      if (!deduction || deduction.value !== num) {
        setGuessWarning(
          isEn
            ? 'Not a forced deduction yet! Check adjacent dots or row/col eliminations first.'
            : '這步還不是必然定式喔！先觀察相鄰圓點或行列唯餘吧。'
        );
        setTimeout(() => setGuessWarning(null), 3000);
        return;
      }
    }

    setGuessWarning(null);
    setHintLevel(0);
    setActiveHintStep(null);

    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = next[r][c] === num ? 0 : num;

      if (num !== 0) {
        setNotes((prevNotes) => {
          const updated = prevNotes.map((row) => row.map((s) => new Set(s)));
          updated[r][c].clear();
          return updated;
        });
      }

      if (checkCompletion(next)) {
        setIsCompleted(true);
        const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

        if (!hasRecordedRef.current && actualPuzzle) {
          hasRecordedRef.current = true;
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: 'kropki',
            tier: (actualPuzzle.tier as TierKey) || 'kids',
            cognitiveLoad: actualPuzzle.cognitiveLoad || {
              spatial: 0.6,
              numeric: 0.9,
              workingMemory: 0.8,
              inhibition: 0.7,
            },
            isSuccess: true,
            timeSpentSec: timeSpent,
            conflictsCount,
            technique: 'ConstraintSatisfaction',
            isPureClear: conflictsCount === 0,
          });

          try {
            const canonical = `${actualPuzzle.id}|${timeSpent}|${conflictsCount}|KROPKI_LEGENDARY`;
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
      }
      return next;
    });

    if (navigator.vibrate) navigator.vibrate(10);
  }, [isCompleted, selectedCell, initialGrid, isNoteMode, toggleNote, isNoGuessMode, grid, dots, n, isEn, checkCompletion, actualPuzzle, conflictsCount, recordAttempt, profile.personalBest.fastestTime]);

  const handleTouchStart = (num: number) => {
    longPressTimerRef.current = setTimeout(() => {
      toggleNote(num);
      longPressTimerRef.current = null;
    }, 400);
  };

  const handleTouchEnd = (num: number) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      handleInputNumber(num);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || !selectedCell) return;
      const [r, c] = selectedCell;

      if (['ArrowUp', 'KeyW'].includes(e.code)) setSelectedCell([Math.max(0, r - 1), c]);
      if (['ArrowDown', 'KeyS'].includes(e.code)) setSelectedCell([Math.min(n - 1, r + 1), c]);
      if (['ArrowLeft', 'KeyA'].includes(e.code)) setSelectedCell([r, Math.max(0, c - 1)]);
      if (['ArrowRight', 'KeyD'].includes(e.code)) setSelectedCell([r, Math.min(n - 1, c + 1)]);
      if (e.code === 'KeyN') setIsNoteMode((prev) => !prev);
      if (e.code === 'KeyH') handleRequestHint();

      const parsed = parseInt(e.key, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= n) {
        if (e.shiftKey) toggleNote(parsed);
        else handleInputNumber(parsed);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        handleInputNumber(0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompleted, selectedCell, n, toggleNote, handleInputNumber, handleRequestHint]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  const deductionStats = useMemo(() => {
    const forced = solvingSteps.filter((s) => s.type.startsWith('dot_forced')).length;
    const naked = solvingSteps.filter((s) => s.type === 'naked_single').length;
    const total = forced + naked || 1;
    const forcedPercent = Math.round((forced / total) * 100);
    const nakedPercent = 100 - forcedPercent;
    return { forced, naked, forcedPercent, nakedPercent };
  }, [solvingSteps]);

  const handleClosePBModal = useCallback(() => {
    setShowPBModal(false);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono">
      {/* 頂部數據列 */}
      <div className="w-full grid grid-cols-3 gap-1 mb-1.5 text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? 'Speed' : '競速'}</div>
          <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? 'Dimension' : '階數'}</div>
          <div className="text-cyan-300 font-bold">{n} * {n}</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[7px]">{isEn ? 'White / Black' : '差壹 / 雙倍'}</div>
          <div className="text-amber-400 font-bold">{dots.length} {isEn ? 'clues' : '提示'}</div>
        </div>
      </div>

      {/* 180° 對稱美學標籤 & 縮放控制 */}
      <div className="w-full flex items-center justify-between px-1 mb-1.5">
        <div>
          {spec?.isSymmetric180 && (
            <span className="px-2 py-0.5 rounded-full bg-indigo-950/70 border border-indigo-500/40 text-indigo-300 text-[7.5px] font-bold flex items-center gap-1 shadow-[0_0_8px_rgba(99,102,241,0.2)]">
              {isEn ? '180° Rotational Symmetry' : '180° 中心對稱盤面'}
            </span>
          )}
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

      {/* 盤面區域 */}
      <div
        className="relative p-2 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl transition-transform duration-150"
        style={{ transform: `scale(${boardScale})`, transformOrigin: 'top center' }}
      >
        <div
          className="grid gap-1 bg-slate-900/80 p-1 rounded-lg"
          style={{
            gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
            width: 'min(88vw, 44vh)',
            height: 'min(88vw, 44vh)',
          }}
        >
          {grid.map((row, r) =>
            row.map((val, c) => {
              const isSelected = selectedCell?.[0] === r && selectedCell?.[1] === c;
              const isInitial = initialGrid[r][c] !== 0;
              const cellNotes = notes[r][c];
              const isHintTarget = activeHintStep?.row === r && activeHintStep?.col === c;

              let cellStyle = 'bg-slate-950/70 text-transparent hover:bg-slate-900/50';
              if (isHintTarget && hintLevel >= 1) {
                cellStyle = 'bg-amber-500/40 text-amber-200 ring-2 ring-amber-400 animate-pulse z-10';
              } else if (isSelected) {
                cellStyle = 'bg-indigo-600/50 text-white ring-2 ring-indigo-400 z-10';
              } else if (isInitial) {
                cellStyle = 'bg-slate-800/90 text-cyan-300 font-extrabold';
              } else if (val !== 0) {
                cellStyle = 'bg-slate-900/90 text-slate-100';
              }

              const rightDot = c < n - 1 ? dots.find((d) => d.r1 === r && d.c1 === c && d.r2 === r && d.c2 === c + 1) : null;
              const bottomDot = r < n - 1 ? dots.find((d) => d.r1 === r && d.c1 === c && d.r2 === r + 1 && d.c2 === c) : null;

              return (
                <div
                  key={`${r}-${c}`}
                  onClick={() => setSelectedCell([r, c])}
                  className={`relative flex items-center justify-center font-black text-sm sm:text-base rounded-md cursor-pointer transition ${cellStyle}`}
                >
                  {val !== 0 ? (
                    val
                  ) : cellNotes.size > 0 ? (
                    <div className="absolute inset-0 p-0.5 grid grid-cols-3 gap-0 text-[7px] sm:text-[9px] text-amber-400/90 font-mono items-center justify-items-center">
                      {Array.from({ length: n }, (_, i) => i + 1).map((num) => (
                        <span key={num} className="leading-none">
                          {cellNotes.has(num) ? num : ''}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {rightDot && (
                    <span
                      className={`absolute -right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full z-20 border-2 ${
                        rightDot.type === 'white'
                          ? 'bg-white border-slate-900 shadow-[0_0_8px_rgba(255,255,255,0.9)]'
                          : 'bg-black border-slate-400 shadow-[0_0_8px_rgba(0,0,0,0.9)]'
                      }`}
                    />
                  )}

                  {bottomDot && (
                    <span
                      className={`absolute left-1/2 -bottom-2 -translate-x-1/2 w-3.5 h-3.5 rounded-full z-20 border-2 ${
                        bottomDot.type === 'white'
                          ? 'bg-white border-slate-900 shadow-[0_0_8px_rgba(255,255,255,0.9)]'
                          : 'bg-black border-slate-400 shadow-[0_0_8px_rgba(0,0,0,0.9)]'
                      }`}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 3 階提示階梯訊息卡片 */}
      {hintLevel > 0 && activeHintStep && (
        <div className="mt-2.5 p-2 bg-amber-950/70 border border-amber-500/60 rounded-lg text-[8px] text-amber-200 text-center max-w-[min(88vw,44vh)] animate-fade-in">
          <div className="font-bold flex items-center justify-center gap-1 mb-0.5">
            <span>{isEn ? 'Hint Ladder' : '因果思考提示'}</span>
            <span className="text-amber-400">Level {hintLevel}/3</span>
          </div>
          {hintLevel === 1 && (
            <div>
              {isEn
                ? `Focus on Cell (${activeHintStep.row + 1}, ${activeHintStep.col + 1}). Check its neighbors!`
                : `請觀察座標格 (${activeHintStep.row + 1}, ${activeHintStep.col + 1}) 與周邊約束！`}
            </div>
          )}
          {hintLevel === 2 && (
            <div>
              {activeHintStep.rationale}
            </div>
          )}
          {hintLevel === 3 && (
            <div className="text-amber-300 font-bold">
              {isEn
                ? `Decisive deduction: The unique valid value is ${activeHintStep.value}!`
                : `因果唯一收斂：該格數值為 ${activeHintStep.value}，請親手填入！`}
            </div>
          )}
        </div>
      )}

      {/* 無猜測模式警告浮動條 */}
      {guessWarning && (
        <div className="mt-2 px-3 py-1 bg-amber-950/90 border border-amber-500/70 text-amber-300 text-[8px] rounded-lg animate-bounce text-center max-w-[min(88vw,44vh)]">
          {guessWarning}
        </div>
      )}

      {/* 虛擬數字鍵盤 */}
      <div className="flex flex-col gap-1.5 mt-2.5 w-full max-w-[min(88vw,44vh)]">
        <div className="flex gap-1.5">
          {Array.from({ length: n }, (_, i) => i + 1).map((num) => (
            <button
              key={num}
              onMouseDown={() => handleTouchStart(num)}
              onMouseUp={() => handleTouchEnd(num)}
              onTouchStart={() => handleTouchStart(num)}
              onTouchEnd={() => handleTouchEnd(num)}
              className={`flex-1 py-2 border font-bold text-xs sm:text-sm rounded-lg transition active:scale-95 ${
                isNoteMode
                  ? 'bg-amber-950/40 border-amber-600/70 text-amber-300'
                  : 'bg-slate-900 border-slate-700 hover:bg-slate-800 text-cyan-300'
              }`}
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => handleInputNumber(0)}
            className="px-2.5 py-2 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 font-bold text-xs rounded-lg transition active:scale-95"
            title={isEn ? 'Erase' : '清除'}
          >
            DEL
          </button>
        </div>

        {/* 控制功能列 */}
        <div className="flex items-center justify-between px-1">
          <div className="flex gap-1">
            <button
              onClick={() => setIsNoteMode((prev) => !prev)}
              className={`px-2 py-1 text-[8px] font-bold rounded-md border transition ${
                isNoteMode
                  ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {isNoteMode ? '筆記 ON' : '筆記'}
            </button>
            <button
              onClick={() => setIsNoGuessMode((prev) => !prev)}
              className={`px-2 py-1 text-[8px] font-bold rounded-md border transition ${
                isNoGuessMode
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {isNoGuessMode ? '無猜測 ON' : '無猜測'}
            </button>
            <button
              onClick={handleRequestHint}
              className="px-2 py-1 text-[8px] font-bold rounded-md border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition flex items-center gap-0.5"
            >
              {isEn ? 'Hint' : '提示'}
            </button>
          </div>
          <span className="text-[7px] text-slate-500">
            {isEn ? 'Key: H (Hint), N (Note)' : '快捷鍵：H提示 / N筆記'}
          </span>
        </div>
      </div>

      {/* 結算面板 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,44vh)] shadow-2xl animate-fade-in font-mono">
          <div className="text-emerald-400 font-bold text-xs mb-0.5">KROPKI RESOLVED</div>
          {isNoGuessMode && (
            <div className="text-[8px] text-amber-300 font-bold mb-1">
              {isEn ? 'Pure Logic Mastery (Zero Guessing)' : '傳奇純邏輯通關（零猜測認證）'}
            </div>
          )}
          <div className="text-[9px] text-slate-400 mb-2">
            {isEn ? 'Time' : '耗時'}: {(elapsedMs / 1000).toFixed(2)}s | Gf: IQ {cci.standardIQ}
          </div>

          {/* 思維風格進度條 */}
          <div className="bg-slate-900/60 border border-slate-800 p-2 rounded-lg mb-2 text-left">
            <div className="text-[8px] text-indigo-300 font-bold mb-1 flex justify-between">
              <span>{isEn ? 'Thinking Profile' : '思維風格分析'}</span>
              <span>{deductionStats.forcedPercent}% {isEn ? 'Dot Deduction' : '圓點因果推導'}</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex">
              <div
                className="bg-indigo-500 h-full transition-all duration-500"
                style={{ width: `${deductionStats.forcedPercent}%` }}
              />
              <div
                className="bg-cyan-500 h-full transition-all duration-500"
                style={{ width: `${deductionStats.nakedPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-[7px] text-slate-400 mt-1">
              <span>{isEn ? 'Dot' : '圓點'}: {deductionStats.forced} {isEn ? 'steps' : '步'}</span>
              <span>{isEn ? 'Elimination' : '唯餘'}: {deductionStats.naked} {isEn ? '步'}</span>
            </div>

            <div className="mt-2 pt-1.5 border-t border-slate-800 flex justify-between items-center text-[7.5px]">
              <span className="text-slate-400">{isEn ? 'Max Forced Domino Chain' : '最長多米諾必然鏈'}:</span>
              <span className="text-cyan-300 font-bold">
                {spec?.maxForcedChain || deductionStats.forced} {isEn ? 'consecutive steps' : '步連鎖推導'}
              </span>
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
              {isEn ? 'Export Data' : '匯出數據'}
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
        <PBCelebrationModal pb={profile.personalBest} onClose={handleClosePBModal} isEn={isEn} />
      )}
    </div>
  );
};
