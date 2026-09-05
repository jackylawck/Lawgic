// web-frontend/src/components/KropkiBoard.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { KropkiSpec, WebKropkiGenerator, SolvingStep, KropkiDot } from '../engines/kropkiGenerator';
import { CognitiveRadarChart } from './CognitiveRadarChart';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

export function KropkiBoard(props: Props) {
  const { puzzle, puzzleData, tournamentMode = false } = props;
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, profile, getCompositeCognitiveIndex, exportLongitudinalDataset } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as KropkiSpec;
  const n = spec?.size || 4;
  const initialGrid = spec?.initialGrid || Array.from({ length: n }, () => Array(n).fill(0));
  const dots: KropkiDot[] = spec?.dots || [];

  const [grid, setGrid] = useState<number[][]>(() => initialGrid.map((r) => [...r]));
  const [notes, setNotes] = useState<Set<number>[][]>(() =>
    Array.from({ length: n }, () => Array.from({ length: n }, () => new Set<number>()))
  );
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>([0, 0]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [conflictsCount, setConflictsCount] = useState<number>(0);
  const [proofSignature, setProofSignature] = useState<string | null>(null);

  const [isNoteMode, setIsNoteMode] = useState<boolean>(false);
  const [isNoGuessMode, setIsNoGuessMode] = useState<boolean>(true);
  const [guessWarning, setGuessWarning] = useState<string | null>(null);

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHintStep, setActiveHintStep] = useState<SolvingStep | null>(null);

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
  }, [actualPuzzle?.id, n]);

  useEffect(() => {
    if (isCompleted) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted]);

  const rightDotMap = useMemo(() => {
    const map = new Map<string, KropkiDot>();
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      if (d.r1 === d.r2 && d.c2 === d.c1 + 1) {
        map.set(`${d.r1},${d.c1}`, d);
      }
    }
    return map;
  }, [dots]);

  const bottomDotMap = useMemo(() => {
    const map = new Map<string, KropkiDot>();
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      if (d.c1 === d.c2 && d.r2 === d.r1 + 1) {
        map.set(`${d.r1},${d.c1}`, d);
      }
    }
    return map;
  }, [dots]);

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

    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
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
      if (targetSet.has(num)) {
        targetSet.delete(num);
      } else {
        targetSet.add(num);
      }
      return next;
    });
  }, [isCompleted, selectedCell, initialGrid, grid]);

  const handleRequestHint = useCallback(() => {
    if (isCompleted || tournamentMode) return;

    const deductions = WebKropkiGenerator.getStrictDeductions(grid, dots, n);
    if (deductions.size === 0) {
      setGuessWarning(
        isEn
          ? 'Requires global Latin Square cross-elimination!'
          : '目前需要全盤拉丁方陣交叉唯餘比對！'
      );
      setTimeout(() => setGuessWarning(null), 3000);
      return;
    }

    const firstEntry = deductions.entries().next().value;
    if (!firstEntry) return;
    const [coord, info] = firstEntry;
    const parts = coord.split(',');
    const r = parseInt(parts[0], 10);
    const c = parseInt(parts[1], 10);

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
  }, [isCompleted, tournamentMode, grid, dots, n, isEn, activeHintStep]);

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
        setConflictsCount((prev) => prev + 1);
        setGuessWarning(
          isEn
            ? `[No-Guess Blocked] Cell [${r + 1}, ${c + 1}] is not a forced deduction yet! Inspect consecutive dots.`
            : `【無猜測攔截】格 [${r + 1}, ${c + 1}] 尚未收斂為唯一確定解！請先觀察圓點倍數/相鄰約束。`
        );
        setTimeout(() => setGuessWarning(null), 3200);
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
          const tierVal = (actualPuzzle.tier as TierKey) || 'kids';
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: 'kropki',
            tier: tierVal,
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
            isPureClear: conflictsCount === 0 && hintLevel === 0,
          });

          setProofSignature(`VERIFIED_KROPKI_${Date.now()}`);
        }
      }
      return next;
    });
  }, [isCompleted, selectedCell, initialGrid, isNoteMode, toggleNote, isNoGuessMode, grid, dots, n, isEn, checkCompletion, actualPuzzle, conflictsCount, recordAttempt, hintLevel]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || !selectedCell) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const [r, c] = selectedCell;

      if (e.code === 'ArrowUp' || e.code === 'KeyW') setSelectedCell([Math.max(0, r - 1), c]);
      if (e.code === 'ArrowDown' || e.code === 'KeyS') setSelectedCell([Math.min(n - 1, r + 1), c]);
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') setSelectedCell([r, Math.max(0, c - 1)]);
      if (e.code === 'ArrowRight' || e.code === 'KeyD') setSelectedCell([r, Math.min(n - 1, c + 1)]);
      if (e.code === 'KeyN') setIsNoteMode((prev) => !prev);
      if (e.code === 'KeyH') handleRequestHint();

      const parsed = parseInt(e.key, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= n) {
        if (e.shiftKey) {
          toggleNote(parsed);
        } else {
          handleInputNumber(parsed);
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0' || e.key === ' ') {
        handleInputNumber(0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompleted, selectedCell, n, toggleNote, handleInputNumber, handleRequestHint]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono outline-none w-full max-w-[380px] mx-auto">
      {/* 頂部數據儀表 */}
      <div className="w-full grid grid-cols-4 gap-1 mb-2 text-[8px] sm:text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '⏱️ Speed' : '⏱️ 競速'}</div>
          <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '📐 Order' : '📐 階數'}</div>
          <div className="text-cyan-300 font-bold">{n} &times; {n}</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '⚫⚪ Dots' : '⚫⚪ 圓點'}</div>
          <div className="text-amber-400 font-bold">{dots.length}</div>
        </div>
        <button
          onClick={() => setIsNoGuessMode((prev) => !prev)}
          className={`p-1 rounded border text-center transition cursor-pointer ${
            isNoGuessMode
              ? 'bg-purple-950 border-purple-500 text-purple-300 font-bold shadow-xs'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
        >
          <div className="text-[6.5px]">🛡️ {isEn ? 'No-Guess' : '無猜測'}</div>
          <div className="text-[7.5px]">{isNoGuessMode ? (isEn ? 'Strict' : '嚴謹') : (isEn ? 'OFF' : '關閉')}</div>
        </button>
      </div>

      {/* 模式切換與提示控制列 */}
      <div className="w-full flex items-center justify-between gap-1 mb-2 px-1 text-[8px]">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsNoteMode((prev) => !prev)}
            className={`px-2 py-1 rounded border font-bold transition cursor-pointer ${
              isNoteMode
                ? 'bg-amber-950 border-amber-400 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.4)]'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title={isEn ? 'Key [N]: Toggle candidate notes' : '快捷鍵 [N]：切換候選筆記模式'}
          >
            ✏️ {isEn ? 'Notes' : '筆記'}: {isNoteMode ? (isEn ? 'ON' : '開啟') : (isEn ? 'OFF' : '關閉')}
          </button>
        </div>

        <button
          onClick={handleRequestHint}
          disabled={isCompleted || tournamentMode}
          className={`px-2.5 py-1 rounded border transition font-bold cursor-pointer ${
            tournamentMode
              ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
              : activeHintStep
              ? 'bg-amber-950 border-amber-500 text-amber-300 shadow-xs'
              : 'bg-indigo-950/80 border-indigo-500/60 text-indigo-300 hover:bg-indigo-900'
          }`}
        >
          💡 {isEn ? 'Hint Ladder' : '提示階梯'} {activeHintStep ? `(Lv.${hintLevel}/3)` : ''}
        </button>
      </div>

      {guessWarning && (
        <div className="w-full mb-2 p-1.5 bg-rose-950 border border-rose-500 text-rose-300 text-[8px] rounded-lg animate-pulse text-center shadow-lg font-bold">
          {guessWarning}
        </div>
      )}

      {/* 三階因果推演提示視窗 */}
      {hintLevel > 0 && activeHintStep && (
        <div className="w-full mb-2 p-2 rounded-xl text-center font-mono border bg-slate-900/95 border-amber-500/60 text-slate-200 text-[8px] shadow-lg animate-fade-in">
          <div className="text-[7.5px] font-bold text-amber-300 mb-0.5">
            🔮 {isEn ? 'KROPKI DEDUCTIVE CHAIN' : '黑白雙星・定式因果推導'}
          </div>
          <div>
            {hintLevel === 1 && (
              <span>
                {isEn
                  ? `🔍 Focus on Cell [${activeHintStep.row + 1}, ${activeHintStep.col + 1}]. Dot constraints enforce parity here.`
                  : `🔍 請關注坐標 [${activeHintStep.row + 1}, ${activeHintStep.col + 1}] 的相鄰圓點約束`}
              </span>
            )}
            {hintLevel === 2 && (
              <span className="text-cyan-300 font-bold">
                ⚡ {activeHintStep.rationale || (isEn ? 'Ratio or adjacent difference excludes other candidates.' : '倍數或差一約束排除其餘候選數。')}
              </span>
            )}
            {hintLevel === 3 && (
              <span className="text-rose-400 font-extrabold">
                {isEn
                  ? `🎯 Cell [${activeHintStep.row + 1}, ${activeHintStep.col + 1}] must strictly be ${activeHintStep.value}!`
                  : `🎯 目標格必然填入唯一解 ${activeHintStep.value}！`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 棋盤主體 */}
      <div className="relative p-2 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl">
        <div
          className="grid gap-1 bg-slate-900/80 p-1 rounded-lg"
          style={{
            gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
            width: 'min(88vw, 42vh)',
            height: 'min(88vw, 42vh)',
          }}
        >
          {grid.map((row, r) =>
            row.map((val, c) => {
              const key = `${r},${c}`;
              const isSelected = selectedCell !== null && selectedCell[0] === r && selectedCell[1] === c;
              const isInitial = initialGrid[r][c] !== 0;
              const cellNotes = notes[r][c];
              const isHintTarget = activeHintStep !== null && activeHintStep.row === r && activeHintStep.col === c;

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

              const rightDot = rightDotMap.get(key);
              const bottomDot = bottomDotMap.get(key);

              return (
                <div
                  key={key}
                  onClick={() => setSelectedCell([r, c])}
                  className={`relative flex items-center justify-center font-black text-sm sm:text-base rounded-md cursor-pointer transition select-none ${cellStyle}`}
                >
                  {val !== 0 && <span>{val}</span>}
                  {val === 0 && cellNotes.size > 0 && (
                    <div className="absolute inset-0 p-0.5 grid grid-cols-3 gap-0 text-[7px] sm:text-[9px] text-amber-400/90 font-mono items-center justify-items-center">
                      {Array.from({ length: n }, (_, i) => i + 1).map((num) => (
                        <span key={num} className="leading-none">
                          {cellNotes.has(num) ? num : ''}
                        </span>
                      ))}
                    </div>
                  )}

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

      {/* 虛擬數字觸控鍵盤 */}
      <div className="flex flex-col gap-1.5 mt-2.5 w-full max-w-[min(88vw,42vh)]">
        <div className="flex gap-1.5">
          {Array.from({ length: n }, (_, i) => i + 1).map((num) => (
            <button
              key={num}
              onClick={() => handleInputNumber(num)}
              className={`flex-1 py-2 border font-bold text-xs sm:text-sm rounded-lg transition active:scale-95 cursor-pointer ${
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
            className="px-3 py-2 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 font-bold text-xs rounded-lg transition active:scale-95 cursor-pointer"
            title={isEn ? 'Clear' : '清空'}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 快捷操作導引 */}
      <div className="w-full max-w-[min(88vw,42vh)] flex items-center justify-between px-1 mt-2 text-[7px] text-slate-500 font-mono">
        <span>{isEn ? 'WASD: Move' : 'WASD: 移動'}</span>
        <span>{isEn ? '1-N: Input' : '1-N: 填數'}</span>
        <span>{isEn ? 'N: Note Mode' : 'N: 筆記模式'}</span>
        <span>{isEn ? 'Space: Clear' : 'Space: 清空'}</span>
      </div>

      {/* 通關成就結算面板 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-emerald-500/80 rounded-xl text-center w-[min(88vw,42vh)] shadow-2xl font-mono animate-fade-in">
          <div className="text-emerald-400 font-bold text-xs mb-0.5 uppercase tracking-wider">
            {isEn ? 'KROPKI POLARITY BALANCED!' : '黑白雙星・完美收斂！'}
          </div>
          <div className="text-[9px] text-slate-300 mb-2">
            {isEn
              ? `Time: ${(elapsedMs / 1000).toFixed(2)}s | Conflicts: ${conflictsCount} | Gf IQ: ${cci.standardIQ}`
              : `耗時: ${(elapsedMs / 1000).toFixed(2)}s | 衝突: ${conflictsCount} 次 | Gf IQ: ${cci.standardIQ}`}
          </div>

          <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800 flex flex-col items-center mb-2">
            <CognitiveRadarChart dimensions={profile.cognitiveDimensions} size={130} />
          </div>

          <div className="flex gap-1">
            <button
              onClick={exportLongitudinalDataset}
              className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-cyan-500/60 text-cyan-300 text-[8px] font-bold rounded transition shadow flex items-center justify-center gap-1 active:scale-95 cursor-pointer"
            >
              <span>📊</span>
              <span>{isEn ? 'Export Dataset' : '匯出數據集'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
