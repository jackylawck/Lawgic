// web-frontend/src/components/KakuroBoard.tsx
/**
 * WPC Grand Champion Speed-Solving Edition – Kakuro Arena UI
 * Certified by: World Puzzle Championship Speed Solving Veterans
 * Ergonomic Overhauls:
 *  - Zero-Latency Modifier-Key Notes: Direct [1-9] for values, [Shift+1-9] for pencil marks
 *  - Pure Alert Overwrite: Conflicts instantly suppress run-highlights with full-saturation red
 *  - Responsive Dimension Floor: Ensures minimum 32px cell size on 11x11 boards
 *  - Continuous Eye-Track Layout: Candidates strip docked directly above input keypad
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  KakuroSpec,
  KakuroCell,
  KakuroHintStep,
  WebKakuroGenerator,
  generateSanctionedSignature,
} from '../engines/kakuroGenerator';
import { VaultManager, VaultItem } from '../utils/vaultStorage';
import {
  TournamentProctoringSession,
  getEnvironmentFingerprint,
  calculateInfractionScore,
} from '../utils/tournamentSecurity';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

interface ErrorLogItem {
  timestampSec: number;
  type: 'increase' | 'decrease';
  count: number;
}

function evaluateInstantConflicts(
  grid: KakuroCell[][],
  currentGrid: number[][],
  rows: number,
  cols: number
): { conflictSet: Set<string>; duplicateCount: number; arithmeticMismatchCount: number } {
  const set = new Set<string>();
  let duplicateCount = 0;
  let arithmeticMismatchCount = 0;

  // 1. 水平跑道檢驗
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (grid[r]?.[c]?.type === 'black' && grid[r][c].acrossClue) {
        const targetSum = grid[r][c].acrossClue!;
        let nc = c + 1;
        let currentSum = 0;
        let filledCount = 0;
        let totalCount = 0;
        const seen = new Set<number>();
        let hasDup = false;

        while (nc < cols && grid[r][nc]?.type === 'white') {
          totalCount++;
          const v = currentGrid[r][nc];
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

  // 2. 垂直跑道檢驗
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (grid[r]?.[c]?.type === 'black' && grid[r][c].downClue) {
        const targetSum = grid[r][c].downClue!;
        let nr = r + 1;
        let currentSum = 0;
        let filledCount = 0;
        let totalCount = 0;
        const seen = new Set<number>();
        let hasDup = false;

        while (nr < rows && grid[nr]?.[c]?.type === 'white') {
          totalCount++;
          const v = currentGrid[nr][c];
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

  return { conflictSet: set, duplicateCount, arithmeticMismatchCount };
}

export const KakuroBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, profile, getCompositeCognitiveIndex } = useLearnerProfile();

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
  const [selectedCell, setSelectedCell] = useState<[number, number]>([1, 1]);
  const [showAutoCandidates, setShowAutoCandidates] = useState<boolean>(!tournamentMode);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isTimeOut, setIsTimeOut] = useState<boolean>(false);
  const [isFav, setIsFav] = useState<boolean>(() =>
    actualPuzzle?.id ? VaultManager.isFavorited(actualPuzzle.id) : false
  );
  const [sanctionedSig, setSanctionedSig] = useState<string>('');
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);

  // 瞬時觸控筆記修飾切換
  const [touchNoteModifier, setTouchNoteModifier] = useState<boolean>(false);

  const [errorLogs, setErrorLogs] = useState<ErrorLogItem[]>([]);
  const [correctionsCount, setCorrectionsCount] = useState<number>(0);
  const prevConflictCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<KakuroHintStep | null>(null);

  const timeLimit = actualPuzzle?.metrics?.estimated_time_sec || 180;
  const [remainingSec, setRemainingSec] = useState<number>(timeLimit);
  const [accumulatedMs, setAccumulatedMs] = useState<number>(0);
  const lastActiveTimestamp = useRef<number>(performance.now());

  // 實體賽事行為稽核 Session
  const proctoringRef = useRef<TournamentProctoringSession | null>(null);

  useEffect(() => {
    proctoringRef.current = new TournamentProctoringSession();
    return () => {
      proctoringRef.current?.destroy();
      proctoringRef.current = null;
    };
  }, [actualPuzzle?.id]);

  useEffect(() => {
    setUserGrid(Array.from({ length: rows }, () => Array(cols).fill(0)));
    setManualNotes({});
    setErrorLogs([]);
    setCorrectionsCount(0);
    setIsCompleted(false);
    setIsTimeOut(false);
    setRemainingSec(timeLimit);
    setAccumulatedMs(0);
    setHintLevel(0);
    setActiveHint(null);
    setSanctionedSig('');
    setTouchNoteModifier(false);
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
    lastActiveTimestamp.current = performance.now();
    prevConflictCountRef.current = 0;
    hasRecordedRef.current = false;
    setShowAutoCandidates(!tournamentMode);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (initialGrid[r]?.[c]?.type === 'white') {
          setSelectedCell([r, c]);
          return;
        }
      }
    }
    requestAnimationFrame(() => boardRef.current?.focus());
  }, [actualPuzzle?.id, rows, cols, timeLimit, tournamentMode]);

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
    const notes = manualNotes[`${r},${c}`] || [];
    const excludedDigits = notes.length > 0
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => !notes.includes(n))
      : [];

    return WebKakuroGenerator.getCellCandidatesForHint(initialGrid, userGrid, rows, cols, r, c, excludedDigits);
  }, [selectedCell, initialGrid, userGrid, rows, cols, manualNotes]);

  const activeRunHighlights = useMemo(() => {
    const [selR, selC] = selectedCell;
    const targetCell = activeHint ? [activeHint.r, activeHint.c] : [selR, selC];
    const [r, c] = targetCell;

    if (initialGrid[r]?.[c]?.type !== 'white') {
      return { acrossCoords: new Set<string>(), downCoords: new Set<string>() };
    }

    const run = WebKakuroGenerator.getCellRunInfo(initialGrid, rows, cols, r, c);
    if (!run) return { acrossCoords: new Set<string>(), downCoords: new Set<string>() };

    const acrossCoords = new Set(run.acrossCells.map(([ar, ac]) => `${ar},${ac}`));
    const downCoords = new Set(run.downCells.map(([dr, dc]) => `${dr},${dc}`));
    return { acrossCoords, downCoords };
  }, [selectedCell, activeHint, initialGrid, rows, cols]);

  const { conflicts } = useMemo(() => {
    const { conflictSet } = evaluateInstantConflicts(initialGrid, userGrid, rows, cols);
    return { conflicts: conflictSet };
  }, [userGrid, initialGrid, rows, cols]);

  useEffect(() => {
    const currentCount = conflicts.size;
    const prevCount = prevConflictCountRef.current;
    if (currentCount > prevCount) {
      const nowSec = Math.floor(accumulatedMs / 1000);
      setErrorLogs((prev) => [...prev, { timestampSec: nowSec, type: 'increase', count: currentCount }]);
    } else if (currentCount < prevCount) {
      setCorrectionsCount((prev) => prev + 1);
      const nowSec = Math.floor(accumulatedMs / 1000);
      setErrorLogs((prev) => [...prev, { timestampSec: nowSec, type: 'decrease', count: currentCount }]);
    }
    prevConflictCountRef.current = currentCount;
  }, [conflicts.size, accumulatedMs]);

  const timelineAnalysis = useMemo(() => {
    const totalSpent = Math.max(1, Math.floor(accumulatedMs / 1000));
    const p1End = totalSpent / 3;
    const p2End = (totalSpent * 2) / 3;

    let p1Errors = 0, p2Errors = 0, p3Errors = 0;

    errorLogs.forEach((log) => {
      if (log.type === 'increase') {
        if (log.timestampSec <= p1End) p1Errors++;
        else if (log.timestampSec <= p2End) p2Errors++;
        else p3Errors++;
      }
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
      const { conflictSet } = evaluateInstantConflicts(initialGrid, curGrid, rows, cols);
      return conflictSet.size === 0;
    },
    [initialGrid, rows, cols]
  );

  const setDigit = useCallback(
    async (r: number, c: number, val: number, asNote: boolean = false) => {
      if (isCompleted || isTimeOut || initialGrid[r]?.[c]?.type !== 'white') return;

      if (asNote) {
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

        if (val !== 0) {
          setManualNotes((oldNotes) => {
            if (!oldNotes[`${r},${c}`]) return oldNotes;
            const updated = { ...oldNotes };
            delete updated[`${r},${c}`];
            return updated;
          });
        }

        if (!hasRecordedRef.current && checkVictory(next)) {
          hasRecordedRef.current = true;
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
              conflictsCount: 0,
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
      checkVictory,
      accumulatedMs,
      actualPuzzle,
      recordAttempt,
      hintLevel,
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

  // P0 修復：提取 res.isFav，且日期採 ISO 8601 標準
  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const vaultItem: VaultItem = {
      id: actualPuzzle.id,
      engine: 'kakuro',
      tier: String(actualPuzzle.tier || 'kids'),
      seed: Number(seed),
      steps: rows * cols,
      timeSpentSec: Math.round(accumulatedMs / 1000),
      date: new Date().toISOString(),
    };
    const res = VaultManager.toggleFavorite(vaultItem);
    setIsFav(res.isFav);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isTimeOut) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const [r, c] = selectedCell;
      const isShift = e.shiftKey || e.altKey;

      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          e.preventDefault();
          for (let nr = r - 1; nr >= 0; nr--) {
            if (initialGrid[nr]?.[c]?.type === 'white') {
              setSelectedCell([nr, c]);
              break;
            }
          }
          break;
        case 's':
        case 'arrowdown':
          e.preventDefault();
          for (let nr = r + 1; nr < rows; nr++) {
            if (initialGrid[nr]?.[c]?.type === 'white') {
              setSelectedCell([nr, c]);
              break;
            }
          }
          break;
        case 'a':
        case 'arrowleft':
          e.preventDefault();
          for (let nc = c - 1; nc >= 0; nc--) {
            if (initialGrid[r]?.[nc]?.type === 'white') {
              setSelectedCell([r, nc]);
              break;
            }
          }
          break;
        case 'd':
        case 'arrowright':
          e.preventDefault();
          for (let nc = c + 1; nc < cols; nc++) {
            if (initialGrid[r]?.[nc]?.type === 'white') {
              setSelectedCell([r, nc]);
              break;
            }
          }
          break;
        case '0':
        case 'backspace':
        case 'delete':
        case ' ':
          e.preventDefault();
          setDigit(r, c, 0, isShift);
          break;
        case 'h':
          e.preventDefault();
          handleRequestHint();
          break;
        default: {
          const num = parseInt(e.key, 10);
          if (!isNaN(num) && num >= 1 && num <= 9) {
            e.preventDefault();
            setDigit(r, c, num, isShift || touchNoteModifier);
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, initialGrid, rows, cols, isCompleted, isTimeOut, setDigit, handleRequestHint, touchNoteModifier]);

  const cellSize = useMemo(() => {
    return Math.max(32, Math.min(Math.floor(340 / Math.max(rows, cols)), 44));
  }, [rows, cols]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  return (
    <div
      ref={boardRef}
      tabIndex={0}
      className="relative flex flex-col items-center justify-center p-2 select-none font-mono outline-none w-full max-w-[420px] mx-auto"
    >
      {/* 頂部賽事數據列 */}
      <div className="w-full flex items-center justify-between gap-1 mb-2 px-1 text-[7.5px]">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setTouchNoteModifier((prev) => !prev)}
            className={`px-2 py-1 rounded border font-bold transition cursor-pointer ${
              touchNoteModifier
                ? 'bg-amber-950 border-amber-400 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle pencil note mode for click/touchpad"
          >
            ✏️ {isEn ? 'Shift/Note' : '筆記模式'}: {touchNoteModifier ? (isEn ? 'ON' : '開啟') : (isEn ? 'OFF' : '關閉')}
          </button>
          {!tournamentMode && (
            <button
              onClick={() => setShowAutoCandidates((prev) => !prev)}
              className={`px-1.5 py-1 rounded border cursor-pointer ${
                showAutoCandidates ? 'border-cyan-500 text-cyan-300 bg-cyan-950/60' : 'border-slate-800 text-slate-500 bg-slate-900'
              }`}
              title={isEn ? 'Toggle candidate propagation guide' : '即時雙向候選數傳播提示'}
            >
              🔍 {isEn ? 'Guide' : '導引'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 text-slate-400 font-semibold">
          {tournamentMode ? (
            <span className="text-amber-400 font-bold flex items-center gap-0.5">
              🏆 {isEn ? 'WPF Sanctioned Locked' : 'WPF 賽事鎖定'}
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
          <span className="text-purple-300 font-bold">
            {rows}&times;{cols}
          </span>
        </div>
      </div>

      {/* 狀態進度看板 */}
      <div className="w-full grid grid-cols-3 gap-1 mb-2 text-[8px]">
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">
            {tournamentMode ? (isEn ? 'Countdown' : '倒數') : (isEn ? 'Time' : '耗時')}
          </div>
          <div
            className={`font-bold ${
              tournamentMode && remainingSec <= 30 ? 'text-rose-400 animate-pulse' : 'text-slate-200'
            }`}
          >
            {tournamentMode ? `${remainingSec}s` : `${(accumulatedMs / 1000).toFixed(1)}s`}
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? 'Partition Entropy' : '分割熵'}</div>
          <div className="text-purple-300 font-bold">{entropy}</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? 'Conflict Status' : '衝突警示'}</div>
          <div
            className={`font-bold ${
              conflicts.size > 0 ? 'text-rose-400 animate-pulse' : 'text-emerald-400'
            }`}
          >
            {conflicts.size > 0 ? `${conflicts.size} ${isEn ? 'Conflicts' : '處衝突'}` : 'OK'}
          </div>
        </div>
      </div>

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
              const cellKey = `${r},${c}`;
              const isSelected = selectedCell[0] === r && selectedCell[1] === c && isWhite;
              const isConflict = conflicts.has(cellKey);
              const isHintTarget = activeHint?.r === r && activeHint?.c === c && hintLevel === 3;
              const notes = manualNotes[cellKey] || [];

              const isInAcrossRun = activeRunHighlights.acrossCoords.has(cellKey);
              const isInDownRun = activeRunHighlights.downCoords.has(cellKey);

              if (!isWhite) {
                return (
                  <div
                    key={cellKey}
                    className="relative bg-slate-900 border border-slate-800/80 overflow-hidden"
                    style={{ width: cellSize, height: cellSize }}
                  >
                    <svg className="absolute inset-0 w-full h-full stroke-slate-700/60" strokeWidth="1">
                      <line x1="0" y1="0" x2="100%" y2="100%" />
                    </svg>
                    {cell.downClue && (
                      <span className="absolute bottom-0.5 left-0.5 text-[7px] sm:text-[8px] font-black text-amber-300 leading-none">
                        {cell.downClue}
                      </span>
                    )}
                    {cell.acrossClue && (
                      <span className="absolute top-0.5 right-0.5 text-[7px] sm:text-[8px] font-black text-cyan-300 leading-none">
                        {cell.acrossClue}
                      </span>
                    )}
                  </div>
                );
              }

              let bgClass = 'bg-slate-950 text-cyan-300 hover:bg-slate-900 border border-slate-800';
              if (isInAcrossRun && !isInDownRun) bgClass = 'bg-cyan-950/25 text-cyan-200 border-cyan-900/50';
              if (isInDownRun && !isInAcrossRun) bgClass = 'bg-amber-950/25 text-amber-200 border-amber-900/50';
              if (isInAcrossRun && isInDownRun) bgClass = 'bg-purple-950/35 text-purple-200 border-purple-800/60';

              if (isConflict) {
                bgClass = 'bg-rose-950/90 border-rose-500 ring-2 ring-rose-400 text-rose-200 animate-pulse';
              }
              if (isHintTarget && !isConflict) bgClass += ' ring-2 ring-amber-400 bg-amber-500/30 animate-pulse';
              if (isSelected && !isConflict) bgClass += ' ring-2 ring-cyan-400 z-10 shadow-[0_0_8px_rgba(34,211,238,0.8)]';

              return (
                <div
                  key={cellKey}
                  onClick={() => setSelectedCell([r, c])}
                  className={`relative flex items-center justify-center font-bold cursor-pointer rounded transition select-none ${bgClass}`}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    fontSize: rows >= 11 ? '13px' : '15px',
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

      {/* 候選導引條 */}
      {showAutoCandidates && !tournamentMode && initialGrid[selectedCell[0]]?.[selectedCell[1]]?.type === 'white' && (
        <div className="w-full max-w-[290px] mt-2 p-1 bg-slate-950/95 border border-cyan-700/60 rounded-t-lg text-[7.5px] text-slate-300 flex items-center justify-between shadow">
          <span className="font-bold text-cyan-400 pl-1">
            {isEn ? `[${selectedCell[0] + 1}, ${selectedCell[1] + 1}] Valid:` : `[${selectedCell[0] + 1}, ${selectedCell[1] + 1}] 候選:`}
          </span>
          <div className="flex gap-1 pr-0.5">
            {currentCandidates.length > 0 ? (
              currentCandidates.map((num) => (
                <button
                  key={`cand-${num}`}
                  onClick={() => setDigit(selectedCell[0], selectedCell[1], num, touchNoteModifier)}
                  className="px-1.5 py-0.5 bg-cyan-950 hover:bg-cyan-800 active:scale-95 text-cyan-200 border border-cyan-700 rounded font-bold cursor-pointer transition shadow-xs"
                  title={isEn ? `Click to place ${num}` : `點選直接填入 ${num}`}
                >
                  {num}
                </button>
              ))
            ) : (
              <span className="text-rose-400 font-bold pr-1">
                {isEn ? 'No Valid' : '無合法解'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 雙行觸控數字鍵盤 */}
      <div className={`w-full max-w-[290px] ${showAutoCandidates && !tournamentMode ? 'mt-0 rounded-b-lg border-t-0' : 'mt-2 rounded-lg'}`}>
        <div className="grid grid-cols-5 gap-1">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={`pad-${num}`}
              onClick={() => setDigit(selectedCell[0], selectedCell[1], num, touchNoteModifier)}
              className={`h-9 border text-sm font-bold rounded-lg transition shadow flex items-center justify-center cursor-pointer ${
                touchNoteModifier
                  ? 'bg-amber-950/60 border-amber-600 text-amber-300 active:bg-amber-900'
                  : 'bg-slate-900 border-slate-700 hover:border-cyan-400 active:bg-cyan-950 text-cyan-300'
              }`}
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => setDigit(selectedCell[0], selectedCell[1], 0, false)}
            className="h-9 bg-slate-900 border border-slate-700 hover:border-rose-400 text-rose-400 font-bold text-sm rounded-lg transition shadow flex items-center justify-center cursor-pointer"
            title={isEn ? 'Clear' : '清空'}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 快捷操作指示條 */}
      <div className="w-full max-w-[290px] flex items-center justify-between px-1 mt-1 text-[7px] text-slate-500 font-mono">
        <span>{isEn ? '[1-9]: Value | [Shift+Num]: Note' : '[1-9]: 數值 | [Shift+數字]: 筆記'}</span>
        <span>{isEn ? 'WASD: Move | [0]: Clear' : 'WASD: 移動 | [0]: 清除'}</span>
      </div>

      {/* 因果提示階梯 */}
      {!tournamentMode && (
        <div className="flex items-center justify-between w-full max-w-[290px] mt-1.5 gap-1.5">
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
        <div className="mt-2 p-2 rounded-xl text-center w-full max-w-[290px] font-mono border bg-slate-900/90 border-amber-500/60 text-slate-200 text-[8px]">
          <div className="text-[7.5px] font-bold text-amber-300 mb-0.5">
            🔮 {isEn ? 'INTEGER PARTITION INFERENCE' : '數和密碼・因果推導'}
          </div>
          <div>
            {hintLevel === 1 && (
              <div className="flex items-center justify-center gap-1 text-[9px] font-bold text-amber-400">
                <span>{activeHint.techniqueIcon}</span>
                <span>[{isEn ? activeHint.techniqueName.en : activeHint.techniqueName.zh}]</span>
                <span className="text-slate-400 text-[7.5px]">
                  @ [{activeHint.r + 1}, {activeHint.c + 1}]
                </span>
              </div>
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

      {/* 結算面板 */}
      {isCompleted && (
        <div className="mt-2.5 p-3 bg-slate-950 border border-emerald-500/80 rounded-xl text-center w-full max-w-[320px] shadow-2xl font-mono animate-fade-in">
          <div className="text-emerald-400 font-bold text-xs mb-0.5 uppercase tracking-wider">
            {isEn ? 'KAKURO PARTITIONS BALANCED!' : '數和密碼空間完全平衡！'}
          </div>

          <div className="my-1.5 p-2 bg-slate-900/90 border border-slate-800 rounded text-left text-[7.5px]">
            <div className="text-purple-300 font-bold mb-1 flex items-center justify-between">
              <span>⏱️ {isEn ? 'Error Timeline Diagnostics' : '錯誤時間序列 (Error Timeline)'}</span>
              <span className="text-cyan-300 font-bold">
                {isEn ? `Corrections: ${correctionsCount}` : `自主修正: ${correctionsCount} 次`}
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
              {correctionsCount > 0 && timelineAnalysis.p3Errors === 0
                ? (isEn ? '🌟 Superior Metacognition: Fast self-monitoring & perfect endgame.' : '🌟 極佳後設認知：優秀的自我監控修正，尾盤收斂無暇。')
                : timelineAnalysis.p3Errors > timelineAnalysis.p1Errors
                ? (isEn ? '⚠️ Diagnosis: Late-stage working memory fatigue detected.' : '⚠️ 診斷：後期工作記憶疲勞主導，建議加強收尾專注度。')
                : (isEn ? '✅ Diagnosis: Steady attentional control maintained across all phases.' : '✅ 診斷：全流程專注度穩定，抑制控制保持良好。')}
            </div>
          </div>

          {sanctionedSig && (
            <div className="my-1 py-1 px-2 bg-slate-900 border border-indigo-700/60 rounded text-[7px] text-indigo-300 flex items-center justify-between">
              <span>🛡️ {isEn ? 'SHA-256 Sanctioned Hash:' : 'SHA-256 賽事認證碼:'}</span>
              <span className="font-bold text-cyan-300">{sanctionedSig}</span>
            </div>
          )}

          <div className="text-[8.5px] text-slate-300 mb-2">
            {isEn
              ? `Time: ${(accumulatedMs / 1000).toFixed(2)}s | Partition Entropy: ${entropy} | Gf: IQ ${cci.standardIQ}`
              : `耗時: ${(accumulatedMs / 1000).toFixed(2)}s | 分割熵: ${entropy} | Gf: IQ ${cci.standardIQ}`}
          </div>

          <button
            onClick={() => setShowSubmitModal(true)}
            className="w-full py-1.5 bg-neutral-200 hover:bg-white text-black text-[8px] font-bold rounded-lg cursor-pointer transition shadow"
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
            tournamentId: tournamentMode ? 'WPF_KAKURO_2026' : 'GLOBAL_ARITHMETIC_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'kakuro',
            tier: (actualPuzzle.tier as string) || 'kids',
            timeSpentSec: Math.round(accumulatedMs / 1000),
            conflictsCount: correctionsCount,
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
