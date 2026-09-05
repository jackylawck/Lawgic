// web-frontend/src/components/KakuroBoard.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  KakuroSpec,
  KakuroHintStep,
  WebKakuroGenerator,
  generateSanctionedSignature,
} from '../engines/kakuroGenerator';
import { VaultManager } from '../utils/vaultStorage';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

interface ErrorLogItem {
  timestampSec: number;
  type: 'duplicate' | 'sum_mismatch';
}

export const KakuroBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as KakuroSpec;
  const rows = spec?.rows || 5;
  const cols = spec?.cols || 5;
  const initialGrid = spec?.grid || [];
  const seed = (actualPuzzle?.metrics as any)?.seed || spec?.seed || 12345;
  const entropy = (actualPuzzle?.metrics as any)?.partitionEntropy || spec?.partitionEntropy || 1.2;

  const boardRef = useRef<HTMLDivElement>(null);
  const [userGrid, setUserGrid] = useState<number[][]>(() =>
    Array.from({ length: rows }, () => Array(cols).fill(0))
  );

  const [manualNotes, setManualNotes] = useState<Record<string, number[]>>({});
  const [isNoteMode, setIsNoteMode] = useState<boolean>(false);

  const [selectedCell, setSelectedCell] = useState<[number, number]>([1, 1]);
  const [showAutoCandidates, setShowAutoCandidates] = useState<boolean>(true);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isTimeOut, setIsTimeOut] = useState<boolean>(false);
  const [isFav, setIsFav] = useState<boolean>(false);
  const [sanctionedSig, setSanctionedSig] = useState<string>('');

  const [errorLogs, setErrorLogs] = useState<ErrorLogItem[]>([]);
  const prevConflictCountRef = useRef<number>(0);

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<KakuroHintStep | null>(null);

  const timeLimit = actualPuzzle?.metrics?.estimated_time_sec || 180;
  const [remainingSec, setRemainingSec] = useState<number>(timeLimit);
  const [accumulatedMs, setAccumulatedMs] = useState<number>(0);
  const lastActiveTimestamp = useRef<number>(performance.now());

  useEffect(() => {
    setUserGrid(Array.from({ length: rows }, () => Array(cols).fill(0)));
    setManualNotes({});
    setErrorLogs([]);
    setIsCompleted(false);
    setIsTimeOut(false);
    setRemainingSec(timeLimit);
    setAccumulatedMs(0);
    setHintLevel(0);
    setActiveHint(null);
    setSanctionedSig('');
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
    lastActiveTimestamp.current = performance.now();
    prevConflictCountRef.current = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (initialGrid[r]?.[c]?.type === 'white') {
          setSelectedCell([r, c]);
          return;
        }
      }
    }
    requestAnimationFrame(() => boardRef.current?.focus());
  }, [actualPuzzle?.id, rows, cols, timeLimit]);

  useEffect(() => {
    if (isCompleted || isTimeOut) return;
    const timer = setInterval(() => {
      const now = performance.now();
      const delta = now - lastActiveTimestamp.current;
      lastActiveTimestamp.current = now;

      setAccumulatedMs((prev) => {
        const next = prev + delta;
        if (tournamentMode) {
          const spent = Math.floor(next / 1000);
          const left = Math.max(0, timeLimit - spent);
          setRemainingSec(left);
          if (left === 0) setIsTimeOut(true);
        }
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [isCompleted, isTimeOut, tournamentMode, timeLimit]);

  const currentCandidates = useMemo(() => {
    const [r, c] = selectedCell;
    if (initialGrid[r]?.[c]?.type !== 'white') return [];
    return WebKakuroGenerator.getCellCandidates(initialGrid, userGrid, rows, cols, r, c);
  }, [selectedCell, initialGrid, userGrid, rows, cols]);

  const { conflicts, errorDiagnostics } = useMemo(() => {
    const set = new Set<string>();
    let duplicateCount = 0;
    let arithmeticMismatchCount = 0;

    // 檢查水平區段
    for (let r = 0; r < rows; r++) {
      let c = 0;
      while (c < cols) {
        if (initialGrid[r]?.[c]?.type === 'black' && initialGrid[r][c].acrossClue) {
          const targetSum = initialGrid[r][c].acrossClue!;
          let nc = c + 1;
          let currentSum = 0;
          let filledCount = 0;
          let totalCount = 0;
          const seen = new Set<number>();
          let hasDup = false;

          while (nc < cols && initialGrid[r][nc]?.type === 'white') {
            totalCount++;
            const v = userGrid[r][nc];
            if (v !== 0) {
              filledCount++;
              currentSum += v;
              if (seen.has(v)) {
                set.add(`${r},${nc}`);
                hasDup = true;
              }
              seen.add(v);
            }
            nc++;
          }

          if (hasDup) duplicateCount++;
          if (filledCount === totalCount && currentSum !== targetSum) {
            arithmeticMismatchCount++;
            for (let i = c + 1; i < nc; i++) set.add(`${r},${i}`);
          }
          c = nc;
        } else {
          c++;
        }
      }
    }

    // 檢查垂直區段
    for (let c = 0; c < cols; c++) {
      let r = 0;
      while (r < rows) {
        if (initialGrid[r]?.[c]?.type === 'black' && initialGrid[r][c].downClue) {
          const targetSum = initialGrid[r][c].downClue!;
          let nr = r + 1;
          let currentSum = 0;
          let filledCount = 0;
          let totalCount = 0;
          const seen = new Set<number>();
          let hasDup = false;

          while (nr < rows && initialGrid[nr]?.[c]?.type === 'white') {
            totalCount++;
            const v = userGrid[nr][c];
            if (v !== 0) {
              filledCount++;
              currentSum += v;
              if (seen.has(v)) {
                set.add(`${nr},${c}`);
                hasDup = true;
              }
              seen.add(v);
            }
            nr++;
          }

          if (hasDup) duplicateCount++;
          if (filledCount === totalCount && currentSum !== targetSum) {
            arithmeticMismatchCount++;
            for (let i = r + 1; i < nr; i++) set.add(`${i},${c}`);
          }
          r = nr;
        } else {
          r++;
        }
      }
    }

    return {
      conflicts: set,
      errorDiagnostics: {
        duplicateCount,
        arithmeticMismatchCount,
      },
    };
  }, [userGrid, initialGrid, rows, cols]);

  useEffect(() => {
    const currentCount = conflicts.size;
    if (currentCount > prevConflictCountRef.current) {
      const nowSec = Math.floor(accumulatedMs / 1000);
      const isDup = errorDiagnostics.duplicateCount > 0;
      setErrorLogs((prev) => [
        ...prev,
        { timestampSec: nowSec, type: isDup ? 'duplicate' : 'sum_mismatch' },
      ]);
    }
    prevConflictCountRef.current = currentCount;
  }, [conflicts.size, accumulatedMs, errorDiagnostics]);

  const timelineAnalysis = useMemo(() => {
    const totalSpent = Math.max(1, Math.floor(accumulatedMs / 1000));
    const p1End = totalSpent / 3;
    const p2End = (totalSpent * 2) / 3;

    let p1Errors = 0;
    let p2Errors = 0;
    let p3Errors = 0;

    errorLogs.forEach((log) => {
      if (log.timestampSec <= p1End) p1Errors++;
      else if (log.timestampSec <= p2End) p2Errors++;
      else p3Errors++;
    });

    return { p1Errors, p2Errors, p3Errors };
  }, [errorLogs, accumulatedMs]);

  const checkVictory = useCallback(
    (curGrid: number[][]): boolean => {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (initialGrid[r]?.[c]?.type === 'white' && curGrid[r][c] === 0) return false;
        }
      }
      return conflicts.size === 0;
    },
    [initialGrid, rows, cols, conflicts.size]
  );

  const setDigit = useCallback(
    async (r: number, c: number, val: number) => {
      if (isCompleted || isTimeOut || initialGrid[r]?.[c]?.type !== 'white') return;

      if (isNoteMode) {
        if (val === 0) {
          setManualNotes((prev) => {
            const next = { ...prev };
            delete next[`${r},${c}`];
            return next;
          });
        } else {
          setManualNotes((prev) => {
            const key = `${r},${c}`;
            const current = prev[key] || [];
            const nextList = current.includes(val)
              ? current.filter((x) => x !== val)
              : [...current, val].sort((a, b) => a - b);
            return { ...prev, [key]: nextList };
          });
        }
        return;
      }

      setHintLevel(0);
      setActiveHint(null);

      setUserGrid((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = val;

        if (checkVictory(next)) {
          setIsCompleted(true);
          const timeSpent = Math.max(1, Math.round(accumulatedMs / 1000));

          generateSanctionedSignature(`KAKURO-${actualPuzzle?.id}-${timeSpent}-${seed}`).then(setSanctionedSig);

          if (actualPuzzle) {
            recordAttempt({
              puzzleId: actualPuzzle.id,
              engineType: 'kakuro',
              tier: (actualPuzzle.tier as TierKey) || 'kids',
              cognitiveLoad: { spatial: 0.85, numeric: 0.98, workingMemory: 0.8, inhibition: 0.9 },
              isSuccess: true,
              timeSpentSec: timeSpent,
              conflictsCount: conflicts.size,
              technique: 'PartitionCSP',
              isPureClear: hintLevel === 0,
            });
          }
        }
        return next;
      });
    },
    [
      isCompleted,
      isTimeOut,
      initialGrid,
      isNoteMode,
      checkVictory,
      accumulatedMs,
      actualPuzzle,
      recordAttempt,
      hintLevel,
      conflicts.size,
      seed,
    ]
  );

  const handleRequestHint = useCallback(() => {
    if (isCompleted || isTimeOut || tournamentMode) return;
    const step = WebKakuroGenerator.getNextForcedDeduction(initialGrid, userGrid, rows, cols);
    if (!step) return;

    if (!activeHint || activeHint.r !== step.r || activeHint.c !== step.c) {
      setActiveHint(step);
      setHintLevel(1);
      setSelectedCell([step.r, step.c]);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, isTimeOut, tournamentMode, initialGrid, userGrid, rows, cols, activeHint]);

  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const nextFav = VaultManager.toggleFavorite({
      id: actualPuzzle.id,
      engine: 'kakuro',
      tier: String(actualPuzzle.tier || 'kids'),
      seed: Number(seed),
      steps: rows * cols,
      timeSpentSec: Math.round(accumulatedMs / 1000),
      date: new Date().toLocaleDateString(),
    });
    setIsFav(nextFav);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isTimeOut) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const [r, c] = selectedCell;

      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          e.preventDefault();
          for (let nr = r - 1; nr >= 0; nr--) {
            if (initialGrid[nr]?.[c]?.type === 'white') { setSelectedCell([nr, c]); break; }
          }
          break;
        case 's':
        case 'arrowdown':
          e.preventDefault();
          for (let nr = r + 1; nr < rows; nr++) {
            if (initialGrid[nr]?.[c]?.type === 'white') { setSelectedCell([nr, c]); break; }
          }
          break;
        case 'a':
        case 'arrowleft':
          e.preventDefault();
          for (let nc = c - 1; nc >= 0; nc--) {
            if (initialGrid[r]?.[nc]?.type === 'white') { setSelectedCell([r, nc]); break; }
          }
          break;
        case 'd':
        case 'arrowright':
          e.preventDefault();
          for (let nc = c + 1; nc < cols; nc++) {
            if (initialGrid[r]?.[nc]?.type === 'white') { setSelectedCell([r, nc]); break; }
          }
          break;
        case 'n':
          e.preventDefault();
          setIsNoteMode((prev) => !prev);
          break;
        case '0':
        case 'backspace':
        case 'delete':
        case ' ':
          e.preventDefault();
          setDigit(r, c, 0);
          break;
        case 'h':
          e.preventDefault();
          handleRequestHint();
          break;
        default: {
          const num = parseInt(e.key, 10);
          if (!isNaN(num) && num >= 1 && num <= 9) {
            e.preventDefault();
            setDigit(r, c, num);
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, initialGrid, rows, cols, isCompleted, isTimeOut, setDigit, handleRequestHint]);

  const cellSize = Math.min(260 / Math.max(rows, cols), rows >= 12 ? 28 : 42);
  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  return (
    <div
      ref={boardRef}
      tabIndex={0}
      className="relative flex flex-col items-center justify-center p-2 select-none font-mono outline-none w-full max-w-[400px] mx-auto"
    >
      {/* 頂部賽事實時數據列 */}
      <div className="w-full flex items-center justify-between gap-1 mb-2 px-1 text-[7.5px]">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsNoteMode((prev) => !prev)}
            className={`px-2 py-1 rounded border font-bold transition cursor-pointer ${
              isNoteMode
                ? 'bg-amber-950 border-amber-400 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.4)]'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
            title={isEn ? 'Key [N]: Toggle manual candidate note mode' : '快捷鍵 [N]：切換筆記候選模式'}
          >
            ✏️ {isEn ? 'Notes' : '筆記模式'}: {isNoteMode ? (isEn ? 'ON' : '開啟') : (isEn ? 'OFF' : '關閉')}
          </button>
          <button
            onClick={() => setShowAutoCandidates((prev) => !prev)}
            className={`px-1.5 py-1 rounded border cursor-pointer ${
              showAutoCandidates ? 'border-cyan-500 text-cyan-300 bg-cyan-950/60' : 'border-slate-800 text-slate-500 bg-slate-900'
            }`}
            title={isEn ? 'Toggle real-time candidate propagation guide' : '即時雙向候選數傳播提示'}
          >
            🔍 {isEn ? 'Guide' : '傳播導引'}
          </button>
        </div>

        <div className="flex items-center gap-1 text-slate-400 font-semibold">
          {tournamentMode ? (
            <span className="text-amber-400 font-bold flex items-center gap-0.5">
              🏆 {isEn ? 'WPF Sanctioned Locked' : 'WPF 賽事規範鎖定'}
            </span>
          ) : (
            <button
              onClick={handleToggleFavorite}
              className={`px-1.5 py-0.5 rounded border transition cursor-pointer ${
                isFav ? 'border-amber-500 text-amber-300 bg-amber-950' : 'border-slate-700 text-slate-500'
              }`}
            >
              {isFav ? (isEn ? '★ Vault' : '★ 傳奇') : (isEn ? '☆ Star' : '☆ 收藏')}
            </button>
          )}
          <span className="text-slate-600">|</span>
          <span className="text-purple-300 font-bold">{rows}&times;{cols}</span>
        </div>
      </div>

      {/* 狀態進度看板 */}
      <div className="w-full grid grid-cols-3 gap-1 mb-2 text-[8px]">
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{tournamentMode ? (isEn ? 'Countdown' : '倒數') : (isEn ? 'Time' : '耗時')}</div>
          <div className={`font-bold ${tournamentMode && remainingSec <= 30 ? 'text-rose-400 animate-pulse' : 'text-slate-200'}`}>
            {tournamentMode ? `${remainingSec}s` : `${(accumulatedMs / 1000).toFixed(1)}s`}
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? 'Partition Entropy' : '分割熵 (Entropy)'}</div>
          <div className="text-purple-300 font-bold">{entropy}</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? 'Conflict Status' : '衝突警示'}</div>
          <div className={`font-bold ${conflicts.size > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {conflicts.size > 0 ? `${conflicts.size} ${isEn ? 'Conflicts' : '處衝突'}` : 'OK'}
          </div>
        </div>
      </div>

      {/* 雙向約束傳播候選導引條 */}
      {showAutoCandidates && initialGrid[selectedCell[0]]?.[selectedCell[1]]?.type === 'white' && (
        <div className="w-full mb-2 p-1.5 bg-slate-950/90 border border-cyan-700/60 rounded-lg text-[7.5px] text-slate-300 flex items-center justify-between animate-fade-in shadow">
          <span className="font-bold text-cyan-400">
            {isEn
              ? `Cell [${selectedCell[0] + 1}, ${selectedCell[1] + 1}] Valid Partitions:`
              : `格 [${selectedCell[0] + 1}, ${selectedCell[1] + 1}] 雙向合法候選:`}
          </span>
          <div className="flex gap-1">
            {currentCandidates.length > 0 ? (
              currentCandidates.map((num) => (
                <span key={`cand-${num}`} className="px-1.5 py-0.2 bg-cyan-950 text-cyan-200 border border-cyan-800 rounded font-bold">
                  {num}
                </span>
              ))
            ) : (
              <span className="text-rose-400 font-bold">
                {isEn ? 'No Valid Partition' : '無合法分割組合'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 棋盤主體 */}
      <div className="p-2 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl flex flex-col items-center overflow-auto max-w-full">
        <div
          className="grid gap-[2px] p-[2px] rounded border border-slate-800 bg-slate-900/80"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {initialGrid.map((row, r) =>
            row.map((cell, c) => {
              const isWhite = cell.type === 'white';
              const val = userGrid[r]?.[c] || 0;
              const isSelected = selectedCell[0] === r && selectedCell[1] === c && isWhite;
              const isConflict = conflicts.has(`${r},${c}`);
              const isHintTarget = activeHint?.r === r && activeHint?.c === c && hintLevel === 3;
              const notes = manualNotes[`${r},${c}`] || [];

              if (!isWhite) {
                return (
                  <div
                    key={`${r}-${c}`}
                    className="relative bg-slate-900 border border-slate-800/80 overflow-hidden"
                    style={{ width: cellSize, height: cellSize }}
                  >
                    <svg className="absolute inset-0 w-full h-full stroke-slate-700/60" strokeWidth="1">
                      <line x1="0" y1="0" x2="100%" y2="100%" />
                    </svg>
                    {cell.downClue && (
                      <span className="absolute bottom-0.5 left-0.5 text-[6.5px] font-bold text-amber-300 leading-none">
                        {cell.downClue}
                      </span>
                    )}
                    {cell.acrossClue && (
                      <span className="absolute top-0.5 right-0.5 text-[6.5px] font-bold text-cyan-300 leading-none">
                        {cell.acrossClue}
                      </span>
                    )}
                  </div>
                );
              }

              let bgClass = 'bg-slate-950 text-cyan-300 hover:bg-slate-900 border border-slate-800';
              if (isConflict) bgClass += ' ring-2 ring-rose-500 bg-rose-950/60 text-rose-300';
              if (isHintTarget) bgClass += ' ring-2 ring-amber-400 bg-amber-500/30 animate-pulse';
              if (isSelected) bgClass += ' ring-2 ring-cyan-400 z-10 shadow-[0_0_8px_rgba(34,211,238,0.8)]';

              return (
                <div
                  key={`${r}-${c}`}
                  onClick={() => setSelectedCell([r, c])}
                  className={`relative flex items-center justify-center font-bold cursor-pointer rounded transition select-none ${bgClass}`}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    fontSize: rows >= 12 ? '11px' : '15px',
                  }}
                >
                  {val !== 0 ? (
                    val
                  ) : notes.length > 0 ? (
                    <div className="grid grid-cols-3 w-full h-full p-0.5 pointer-events-none">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                        <span
                          key={`sub-${n}`}
                          className={`flex items-center justify-center text-[5.5px] leading-none ${
                            notes.includes(n) ? 'text-amber-300 font-bold' : 'opacity-0'
                          }`}
                        >
                          {n}
                        </span>
                      ))}
                    </div>
                  ) : (
                    ''
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 雙行觸控數字鍵盤 */}
      <div className="w-full max-w-[280px] mt-2">
        <div className="grid grid-cols-5 gap-1">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={`pad-${num}`}
              onClick={() => setDigit(selectedCell[0], selectedCell[1], num)}
              className={`h-9 border text-sm font-bold rounded-lg transition shadow flex items-center justify-center cursor-pointer ${
                isNoteMode
                  ? 'bg-amber-950/60 border-amber-600 text-amber-300 active:bg-amber-900'
                  : 'bg-slate-900 border-slate-700 hover:border-cyan-400 active:bg-cyan-950 text-cyan-300'
              }`}
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => setDigit(selectedCell[0], selectedCell[1], 0)}
            className="h-9 bg-slate-900 border border-slate-700 hover:border-rose-400 text-rose-400 font-bold text-sm rounded-lg transition shadow flex items-center justify-center cursor-pointer"
            title={isEn ? 'Clear' : '清空'}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 三階因果提示（賽事模式下禁用） */}
      {!tournamentMode && (
        <div className="flex items-center justify-between w-full max-w-[280px] mt-2 gap-1.5">
          <button
            onClick={handleRequestHint}
            disabled={isCompleted || isTimeOut}
            className="w-full py-1.5 text-xs font-bold rounded-lg border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition flex items-center justify-center gap-1 shadow disabled:opacity-40 cursor-pointer"
          >
            💡 {isEn ? 'Hint Ladder [H]' : '因果提示階梯 [H]'}
          </button>
        </div>
      )}

      {hintLevel > 0 && activeHint && (
        <div className="mt-2 p-2 rounded-xl text-center w-full max-w-[280px] font-mono border bg-slate-900/90 border-amber-500/60 text-slate-200 text-[8px]">
          <div className="text-[7.5px] font-bold text-amber-300 mb-0.5">
            🔮 {isEn ? 'INTEGER PARTITION INFERENCE' : '數和密碼・因果推導'}
          </div>
          <div>
            {hintLevel === 1 && (
              <span>
                {isEn
                  ? `🔍 Inspect intersecting sum constraints at [${activeHint.r + 1}, ${activeHint.c + 1}]`
                  : `🔍 審視坐標 [${activeHint.r + 1}, ${activeHint.c + 1}] 的雙向和數分割`}
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
                  ? `🎯 Target cell must strictly be ${activeHint.forcedValue}!`
                  : `🎯 目標格必然填入唯一解 ${activeHint.forcedValue}！`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 結算面板：錯誤時間序列分析與 SHA-256 賽事認證 */}
      {isCompleted && (
        <div className="mt-2.5 p-3 bg-slate-950 border border-emerald-500/80 rounded-xl text-center w-full max-w-[320px] shadow-2xl font-mono animate-fade-in">
          <div className="text-emerald-400 font-bold text-xs mb-0.5 uppercase tracking-wider">
            {isEn ? 'KAKURO PARTITIONS BALANCED!' : '數和密碼空間完全平衡！'}
          </div>

          {/* 錯誤時間序列診斷 */}
          <div className="my-1.5 p-2 bg-slate-900/90 border border-slate-800 rounded text-left text-[7.5px]">
            <div className="text-purple-300 font-bold mb-1 flex items-center justify-between">
              <span>⏱️ {isEn ? 'Error Timeline Diagnostics' : '錯誤時間序列 (Error Timeline)'}</span>
              <span className="text-emerald-400 font-normal">
                {isEn ? `Total Conflicts: ${errorLogs.length}` : `總衝突: ${errorLogs.length} 次`}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 text-center py-1 bg-slate-950/80 rounded mb-1">
              <div>
                {isEn ? 'Early (0-33%):' : '前期 (0-33%):'}{' '}
                <strong className={timelineAnalysis.p1Errors > 0 ? 'text-amber-300' : 'text-emerald-400'}>
                  {timelineAnalysis.p1Errors} {isEn ? '' : '次'}
                </strong>
              </div>
              <div>
                {isEn ? 'Mid (34-66%):' : '中期 (34-66%):'}{' '}
                <strong className={timelineAnalysis.p2Errors > 0 ? 'text-amber-300' : 'text-emerald-400'}>
                  {timelineAnalysis.p2Errors} {isEn ? '' : '次'}
                </strong>
              </div>
              <div>
                {isEn ? 'Late (67-100%):' : '後期 (67-100%):'}{' '}
                <strong className={timelineAnalysis.p3Errors > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                  {timelineAnalysis.p3Errors} {isEn ? '' : '次'}
                </strong>
              </div>
            </div>
            <div className="text-[6.5px] text-slate-400">
              {timelineAnalysis.p3Errors > timelineAnalysis.p1Errors
                ? isEn
                  ? '⚠️ Diagnosis: Late-stage working memory fatigue detected. Enhance endgame focus.'
                  : '⚠️ 診斷：後期工作記憶疲勞主導，建議加強收尾專注度。'
                : isEn
                ? '✅ Diagnosis: Steady attentional control maintained across all phases.'
                : '✅ 診斷：全流程專注度穩定，抑制控制保持良好。'}
            </div>
          </div>

          {/* 賽事簽名 */}
          {sanctionedSig && (
            <div className="my-1 py-1 px-2 bg-slate-900 border border-indigo-700/60 rounded text-[7px] text-indigo-300 flex items-center justify-between">
              <span>🛡️ {isEn ? 'SHA-256 Sanctioned Hash:' : 'SHA-256 賽事認證碼:'}</span>
              <span className="font-bold text-cyan-300">{sanctionedSig}</span>
            </div>
          )}

          <div className="text-[8.5px] text-slate-300 mb-1">
            {isEn
              ? `Time: ${(accumulatedMs / 1000).toFixed(2)}s | Partition Entropy: ${entropy} | Gf: IQ ${cci.standardIQ}`
              : `耗時: ${(accumulatedMs / 1000).toFixed(2)}s | 分割熵: ${entropy} | Gf: IQ ${cci.standardIQ}`}
          </div>
        </div>
      )}
    </div>
  );
};
