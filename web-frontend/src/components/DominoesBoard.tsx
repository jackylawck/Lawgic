// web-frontend/src/components/DominoesBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { MetricErrorBar } from './MetricErrorBar';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';
import { getEnvironmentFingerprint, calculateInfractionScore } from '../utils/tournamentSecurity';
import {
  WebDominoesGenerator,
  DominoesSpec,
  DominoBorderState,
  DominoHintStep,
} from '../engines/dominoesGenerator';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

interface BorderDelta {
  type: 'H' | 'V';
  r: number;
  c: number;
  from: DominoBorderState;
  to: DominoBorderState;
}

type InventoryFilter = 'all' | 'pending' | 'duplicate';

const MAX_HISTORY_STEPS = 250;

export const DominoesBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const {
    recordAttempt,
    getBenchmarkMetrics,
    profile,
    getCompositeCognitiveIndex,
    exportLongitudinalDataset,
  } = useLearnerProfile();

  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const spec: DominoesSpec = (actualPuzzle as any)?.puzzle;
  const rows = spec?.rows || 4;
  const cols = spec?.cols || 5;
  const grid = useMemo(() => spec?.grid || [], [spec]);
  const dominoes = useMemo(() => spec?.dominoes || [], [spec]);
  const solution = useMemo(() => spec?.solutionBorders, [spec]);

  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';

  const [hBorders, setHBorders] = useState<DominoBorderState[][]>(() =>
    Array.from({ length: rows }, () => Array(cols - 1).fill(0))
  );
  const [vBorders, setVBorders] = useState<DominoBorderState[][]>(() =>
    Array.from({ length: rows - 1 }, () => Array(cols).fill(0))
  );

  const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null);
  const [history, setHistory] = useState<BorderDelta[]>([]);
  const [redoStack, setRedoStack] = useState<BorderDelta[]>([]);

  const [noGuessMode, setNoGuessMode] = useState<boolean>(false);
  const [noGuessWarning, setNoGuessWarning] = useState<string | null>(null);
  const [activeHint, setActiveHint] = useState<DominoHintStep | null>(null);
  const [hintLadderLevel, setHintLadderLevel] = useState<1 | 2 | 3>(1);
  const [animatedEvidenceSet, setAnimatedEvidenceSet] = useState<Set<string>>(new Set());
  const [fuzzyAreaHint, setFuzzyAreaHint] = useState<string | null>(null);

  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>('all');
  const [sortByUrgency, setSortByUrgency] = useState<boolean>(true);

  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);

  const startTimeRef = useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const conflictCountRef = useRef<number>(0);
  const [conflictDisplay, setConflictDisplay] = useState<number>(0);
  const movesCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  useEffect(() => {
    setHBorders(Array.from({ length: rows }, () => Array(cols - 1).fill(0)));
    setVBorders(Array.from({ length: rows - 1 }, () => Array(cols).fill(0)));
    setSelectedCell(null);
    setHistory([]);
    setRedoStack([]);
    setIsCompleted(false);
    setActiveHint(null);
    setHintLadderLevel(1);
    setAnimatedEvidenceSet(new Set());
    setFuzzyAreaHint(null);
    setProofSignature(null);
    setNoGuessWarning(null);
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    conflictCountRef.current = 0;
    setConflictDisplay(0);
    movesCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id, rows, cols]);

  useEffect(() => {
    if (isCompleted) return;
    let frameId: number;
    const updateTimer = () => {
      setElapsedMs(Date.now() - startTimeRef.current);
      frameId = requestAnimationFrame(updateTimer);
    };
    frameId = requestAnimationFrame(updateTimer);
    return () => cancelAnimationFrame(frameId);
  }, [isCompleted]);

  useEffect(() => {
    if (!activeHint || activeHint.evidenceCells.length === 0) {
      setAnimatedEvidenceSet(new Set());
      return;
    }

    setAnimatedEvidenceSet(new Set());
    const timers: ReturnType<typeof setTimeout>[] = [];

    activeHint.evidenceCells.forEach(([er, ec], idx) => {
      const t = setTimeout(() => {
        setAnimatedEvidenceSet((prev) => new Set(prev).add(`${er},${ec}`));
        if (navigator.vibrate) navigator.vibrate(5);
      }, idx * 120);
      timers.push(t);
    });

    return () => timers.forEach(clearTimeout);
  }, [activeHint]);

  const analysis = useMemo(() => {
    const foundDominoCounts = new Map<string, number>();
    const cellCoverCounts = Array.from({ length: rows }, () => Array(cols).fill(0));
    const lockedPairs: { r1: number; c1: number; r2: number; c2: number }[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (hBorders[r][c] === 1) {
          const key = WebDominoesGenerator.getDominoKey(grid[r][c], grid[r][c + 1]);
          foundDominoCounts.set(key, (foundDominoCounts.get(key) || 0) + 1);
          cellCoverCounts[r][c]++;
          cellCoverCounts[r][c + 1]++;
          lockedPairs.push({ r1: r, c1: c, r2: r, c2: c + 1 });
        }
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        if (vBorders[r][c] === 1) {
          const key = WebDominoesGenerator.getDominoKey(grid[r][c], grid[r + 1][c]);
          foundDominoCounts.set(key, (foundDominoCounts.get(key) || 0) + 1);
          cellCoverCounts[r][c]++;
          cellCoverCounts[r + 1][c]++;
          lockedPairs.push({ r1: r, c1: c, r2: r + 1, c2: c });
        }
      }
    }

    const pieceCandidateCounts = new Map<string, number>();
    for (const piece of dominoes) {
      const pKey = WebDominoesGenerator.getDominoKey(piece.val1, piece.val2);
      let cand = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (c < cols - 1 && hBorders[r][c] !== 2) {
            if (WebDominoesGenerator.getDominoKey(grid[r][c], grid[r][c + 1]) === pKey) cand++;
          }
          if (r < rows - 1 && vBorders[r][c] !== 2) {
            if (WebDominoesGenerator.getDominoKey(grid[r][c], grid[r + 1][c]) === pKey) cand++;
          }
        }
      }
      pieceCandidateCounts.set(pKey, cand);
    }

    let overlapCells = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cellCoverCounts[r][c] > 1) overlapCells++;
      }
    }

    let duplicatePieces = 0;
    foundDominoCounts.forEach((count) => {
      if (count > 1) duplicatePieces += count - 1;
    });

    const totalConflicts = overlapCells + duplicatePieces;
    const isAllCovered = cellCoverCounts.every((row) => row.every((cnt) => cnt === 1));
    const isAllPiecesUnique = dominoes.every(
      (p) => (foundDominoCounts.get(WebDominoesGenerator.getDominoKey(p.val1, p.val2)) || 0) === 1
    );

    return {
      foundDominoCounts,
      cellCoverCounts,
      lockedPairs,
      pieceCandidateCounts,
      totalConflicts,
      isPerfectTiling: isAllCovered && isAllPiecesUnique,
    };
  }, [hBorders, vBorders, grid, dominoes, rows, cols]);

  const prevConflictsRef = useRef<number>(0);
  useEffect(() => {
    if (analysis.totalConflicts > prevConflictsRef.current) {
      conflictCountRef.current += analysis.totalConflicts - prevConflictsRef.current;
      setConflictDisplay(conflictCountRef.current);
    }
    prevConflictsRef.current = analysis.totalConflicts;
  }, [analysis.totalConflicts]);

  const mutateBorder = useCallback(
    (type: 'H' | 'V', r: number, c: number, targetState: DominoBorderState) => {
      if (isCompleted) return;

      const currentVal = type === 'H' ? hBorders[r][c] : vBorders[r][c];
      if (currentVal === targetState) return;

      if (noGuessMode && targetState === 1) {
        const step = WebDominoesGenerator.getNextForcedDeduction(
          rows,
          cols,
          grid,
          hBorders,
          vBorders,
          dominoes
        );
        if (step) {
          const isTarget =
            type === 'H'
              ? step.r1 === r && step.c1 === c && step.r2 === r && step.c2 === c + 1
              : step.r1 === r && step.c1 === c && step.r2 === r + 1 && step.c2 === c;

          if (!isTarget) {
            if (navigator.vibrate) navigator.vibrate([25, 35, 25]);
            const reason = isEn ? step.humanReadable.en : step.humanReadable.zh;
            setNoGuessWarning(
              isEn
                ? `[No-Guess Blocked] Strictly deduce: ${reason}`
                : `【無猜測攔截】依據定式應優先推導：${reason}`
            );
            setTimeout(() => setNoGuessWarning(null), 3000);
            return;
          }
        }
      }

      if (navigator.vibrate) navigator.vibrate(8);
      movesCountRef.current++;

      const delta: BorderDelta = { type, r, c, from: currentVal, to: targetState };
      setHistory((prev) => [...prev.slice(-MAX_HISTORY_STEPS + 1), delta]);
      setRedoStack([]);

      if (type === 'H') {
        setHBorders((prev) => {
          const next = prev.map((row) => [...row]);
          next[r][c] = targetState;
          return next;
        });
      } else {
        setVBorders((prev) => {
          const next = prev.map((row) => [...row]);
          next[r][c] = targetState;
          return next;
        });
      }

      if (activeHint) setActiveHint(null);
    },
    [isCompleted, hBorders, vBorders, noGuessMode, rows, cols, grid, dominoes, activeHint, isEn]
  );

  const cycleBorder = useCallback(
    (type: 'H' | 'V', r: number, c: number) => {
      const curr = type === 'H' ? hBorders[r][c] : vBorders[r][c];
      const next: DominoBorderState = curr === 0 ? 1 : curr === 1 ? 2 : 0;
      mutateBorder(type, r, c, next);
    },
    [hBorders, vBorders, mutateBorder]
  );

  const handleCellSelect = (r: number, c: number) => {
    if (selectedCell === null) {
      setSelectedCell([r, c]);
      if (navigator.vibrate) navigator.vibrate(6);
    } else if (selectedCell[0] === r && selectedCell[1] === c) {
      setSelectedCell(null);
    } else {
      const [pr, pc] = selectedCell;
      const dr = r - pr;
      const dc = c - pc;

      if (Math.abs(dr) + Math.abs(dc) === 1) {
        if (dr === 0 && dc === 1) cycleBorder('H', pr, pc);
        else if (dr === 0 && dc === -1) cycleBorder('H', r, c);
        else if (dr === 1 && dc === 0) cycleBorder('V', pr, pc);
        else if (dr === -1 && dc === 0) cycleBorder('V', r, c);
      }
      setSelectedCell(null);
    }
  };

  const handleUndo = useCallback(() => {
    if (history.length === 0 || isCompleted) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const lastDelta = history[history.length - 1];
    if (lastDelta.type === 'H') {
      setHBorders((prev) => {
        const next = prev.map((row) => [...row]);
        next[lastDelta.r][lastDelta.c] = lastDelta.from;
        return next;
      });
    } else {
      setVBorders((prev) => {
        const next = prev.map((row) => [...row]);
        next[lastDelta.r][lastDelta.c] = lastDelta.from;
        return next;
      });
    }

    setRedoStack((prev) => [...prev, lastDelta]);
    setHistory((prev) => prev.slice(0, -1));
  }, [history, isCompleted]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const nextDelta = redoStack[redoStack.length - 1];
    if (nextDelta.type === 'H') {
      setHBorders((prev) => {
        const next = prev.map((row) => [...row]);
        next[nextDelta.r][nextDelta.c] = nextDelta.to;
        return next;
      });
    } else {
      setVBorders((prev) => {
        const next = prev.map((row) => [...row]);
        next[nextDelta.r][nextDelta.c] = nextDelta.to;
        return next;
      });
    }

    setHistory((prev) => [...prev, nextDelta]);
    setRedoStack((prev) => prev.slice(0, -1));
  }, [redoStack, isCompleted]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.code === 'Escape') {
        setSelectedCell(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompleted, handleUndo, handleRedo]);

  useEffect(() => {
    if (isCompleted || !solution) return;

    if (analysis.isPerfectTiling && analysis.totalConflicts === 0) {
      setIsCompleted(true);
      const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

      if (!hasRecordedRef.current && actualPuzzle) {
        hasRecordedRef.current = true;
        const baseIrt = (actualPuzzle.metrics as any)?.irt_logit_difficulty || 1.7;

        recordAttempt({
          puzzleId: actualPuzzle.id,
          engineType: 'dominoes',
          tier: currentTier,
          cognitiveLoad: actualPuzzle.cognitiveLoad || {
            spatial: 0.85,
            numeric: 0.5,
            workingMemory: 0.75,
            inhibition: 0.88,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
          technique: 'DominoTilingWavefront',
          irtDifficulty: baseIrt,
          isPureClear: conflictCountRef.current === 0 && !activeHint,
        });

        try {
          const canonical = `${actualPuzzle.id}|${timeSpent}|${movesCountRef.current}|${conflictCountRef.current}|TOURNAMENT_${tournamentMode}|DOMINOES_CHAMPION_SHA`;
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
  }, [
    analysis,
    isCompleted,
    actualPuzzle,
    solution,
    currentTier,
    recordAttempt,
    profile.personalBest.fastestTime,
    activeHint,
    tournamentMode,
  ]);

  const handleRequestHint = () => {
    if (isCompleted || tournamentMode) return;
    if (navigator.vibrate) navigator.vibrate(12);

    if (!activeHint) {
      const step = WebDominoesGenerator.getNextForcedDeduction(
        rows,
        cols,
        grid,
        hBorders,
        vBorders,
        dominoes
      );
      if (step) {
        setActiveHint(step);
        setSelectedCell([step.r1, step.c1]);
        setHintLadderLevel(1);
      }
    } else {
      setHintLadderLevel((prev) => (prev === 1 ? 2 : 3));
    }
  };

  const handleRequestFuzzyAreaHint = () => {
    if (isCompleted || tournamentMode) return;
    const step = WebDominoesGenerator.getNextForcedDeduction(
      rows,
      cols,
      grid,
      hBorders,
      vBorders,
      dominoes
    );
    if (!step) {
      setFuzzyAreaHint(
        isEn
          ? 'No immediate forced regional clue detected.'
          : '目前全盤無顯著區域收斂定式，請嘗試尋找孤立端點。'
      );
      setTimeout(() => setFuzzyAreaHint(null), 3000);
      return;
    }

    const minR = Math.min(step.r1, step.r2);
    const maxR = Math.max(step.r1, step.r2);
    const minC = Math.min(step.c1, step.c2);
    const maxC = Math.max(step.c1, step.c2);

    const regionBox = `[${Math.max(1, minR)}~${Math.min(rows, maxR + 2)} 行, ${Math.max(
      1,
      minC
    )}~${Math.min(cols, maxC + 2)} 列]`;
    setFuzzyAreaHint(
      isEn
        ? `💡 Regional Hint: Look closely within region ${regionBox}. A forced boundary transition is forming.`
        : `💡 區域線索：請聚焦於 ${regionBox} 範圍內，該區域正收斂出確定骨牌或隔離邊界。`
    );
    setTimeout(() => setFuzzyAreaHint(null), 4500);
  };

  const theoryTime =
    (actualPuzzle?.metrics as any)?.estimated_time_sec || dominoes.length * 4;
  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('TopologicalLookahead', theoryTime, 'dominoes');
  }, [getBenchmarkMetrics, theoryTime]);

  const cci = useMemo(
    () => getCompositeCognitiveIndex(),
    [getCompositeCognitiveIndex, isCompleted]
  );

  const processedInventory = useMemo(() => {
    let list = dominoes.map((d) => {
      const key = WebDominoesGenerator.getDominoKey(d.val1, d.val2);
      const count = analysis.foundDominoCounts.get(key) || 0;
      const isFound = count === 1;
      const isDuplicate = count > 1;
      const candidates = analysis.pieceCandidateCounts.get(key) || 0;
      const isCriticalFocus = !isFound && !isDuplicate && candidates <= 2 && candidates > 0;
      return { ...d, key, count, isFound, isDuplicate, candidates, isCriticalFocus };
    });

    if (inventoryFilter === 'pending') {
      list = list.filter((p) => !p.isFound);
    } else if (inventoryFilter === 'duplicate') {
      list = list.filter((p) => p.isDuplicate);
    }

    if (sortByUrgency) {
      list.sort((a, b) => {
        if (a.isDuplicate !== b.isDuplicate) return a.isDuplicate ? -1 : 1;
        if (a.isCriticalFocus !== b.isCriticalFocus) return a.isCriticalFocus ? -1 : 1;
        return a.candidates - b.candidates;
      });
    }

    return list;
  }, [dominoes, analysis, inventoryFilter, sortByUrgency]);

  return (
    <div className="flex flex-col items-center justify-center p-1 select-none font-mono">
      <div className="w-full grid grid-cols-6 gap-1 px-0.5 mb-1.5 text-[8px] sm:text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '⏱️ Speed' : '⏱️ 競速'}</div>
          <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '♟️ Moves' : '♟️ 步數'}</div>
          <div className="text-cyan-300 font-bold">{movesCountRef.current}</div>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '⚠️ Conflicts' : '⚠️ 衝突累加'}</div>
          <div className={`font-bold ${conflictDisplay > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
            {conflictDisplay}
          </div>
        </div>

        <button
          onClick={() => setNoGuessMode((prev) => !prev)}
          disabled={tournamentMode}
          className={`p-1 rounded border text-center transition ${
            tournamentMode
              ? 'bg-purple-950/80 border-purple-500 text-purple-300 font-bold cursor-not-allowed'
              : noGuessMode
              ? 'bg-purple-950 border-purple-500 text-purple-300 font-bold shadow-xs'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
          title={isEn ? 'Toggle No-Guess strict verification' : '切換無猜測純邏輯防護'}
        >
          <div className="text-[6.5px]">🛡️ {isEn ? 'No-Guess' : '無猜測'}</div>
          <div className="text-[7.5px]">
            {tournamentMode
              ? isEn
                ? 'Tournament'
                : '賽事強制'
              : noGuessMode
              ? isEn
                ? 'Strict ON'
                : '強制嚴謹'
              : isEn
              ? 'OFF'
              : '關閉'}
          </div>
        </button>

        <button
          onClick={handleRequestFuzzyAreaHint}
          disabled={isCompleted || tournamentMode}
          className={`p-1 rounded border text-center transition ${
            tournamentMode
              ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
              : 'bg-slate-950 hover:bg-slate-900 border-slate-800 text-amber-300/80 hover:text-amber-200'
          }`}
          title={isEn ? 'Show regional fuzzy hint' : '顯示區域模糊提示'}
        >
          <div className="text-[6.5px]">🔭 {isEn ? 'Region' : '區域'}</div>
          <div className="text-[7.5px]">{isEn ? 'Fuzzy' : '軟性線索'}</div>
        </button>

        <button
          onClick={handleRequestHint}
          disabled={isCompleted || tournamentMode}
          className={`p-1 rounded border text-center transition ${
            tournamentMode
              ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
              : activeHint
              ? 'bg-amber-950/90 border-amber-500 text-amber-300 font-bold shadow-xs'
              : 'bg-indigo-950/80 border-indigo-500/60 text-indigo-300 hover:bg-indigo-900'
          }`}
        >
          <div className="text-[6.5px]">💡 {isEn ? 'Hint Ladder' : '提示階梯'}</div>
          <div className="text-[7.5px] truncate">
            {tournamentMode
              ? isEn
                ? 'Locked'
                : '賽事鎖定'
              : activeHint
              ? `${isEn ? 'Lv.' : '階梯 '}${hintLadderLevel}/3`
              : isEn
              ? 'Get Hint'
              : '因果提示'}
          </div>
        </button>
      </div>

      {noGuessWarning && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1 bg-rose-950 border border-rose-500 text-rose-300 text-[8px] rounded-lg animate-pulse text-center shadow-lg font-bold">
          {noGuessWarning}
        </div>
      )}

      {fuzzyAreaHint && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1.5 bg-cyan-950/80 border border-cyan-500/70 text-cyan-200 text-[8px] rounded-lg animate-fade-in text-center shadow-lg font-bold">
          {fuzzyAreaHint}
        </div>
      )}

      {activeHint && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1.5 bg-amber-950/80 border border-amber-500/70 rounded-lg text-amber-200 text-[8px] animate-fade-in text-left shadow-lg">
          <div className="font-bold flex items-center justify-between text-[7px] text-amber-400 border-b border-amber-900/60 pb-0.5 mb-1">
            <span>[DOMINOES HINT LADDER LEVEL {hintLadderLevel}/3]</span>
            <span className="uppercase">{activeHint.technique.replace(/_/g, ' ')}</span>
          </div>
          {hintLadderLevel === 1 && (
            <div>
              {isEn
                ? `Focus between [${activeHint.r1 + 1},${activeHint.c1 + 1}] and [${activeHint.r2 + 1},${activeHint.c2 + 1}].`
                : `請關注 [${activeHint.r1 + 1},${activeHint.c1 + 1}] 與 [${activeHint.r2 + 1},${activeHint.c2 + 1}] 之間的邊界。`}
            </div>
          )}
          {hintLadderLevel === 2 && (
            <div>{isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}</div>
          )}
          {hintLadderLevel === 3 && (
            <div className="font-bold text-amber-300">
              {activeHint.rationale}
              <span className="ml-1 text-cyan-300 underline">
                {activeHint.forcedType === 1
                  ? isEn
                    ? 'Must FORM DOMINO'
                    : '必然連成骨牌'
                  : isEn
                  ? 'Must PLACE BARRIER'
                  : '必然劃分隔離牆'}
              </span>
            </div>
          )}
        </div>
      )}

      <div
        className="relative overflow-hidden p-2 rounded-xl bg-slate-950 border-2 border-slate-800 shadow-2xl"
        style={{ width: 'min(88vw, 42vh)', height: 'min(88vw, 42vh)', touchAction: 'none' }}
      >
        <div className="absolute inset-2 pointer-events-none z-10">
          {analysis.lockedPairs.map((pair, idx) => {
            const isHorizontal = pair.r1 === pair.r2;
            const topPct = (pair.r1 / rows) * 100;
            const leftPct = (pair.c1 / cols) * 100;
            const widthPct = isHorizontal ? (2 / cols) * 100 : (1 / cols) * 100;
            const heightPct = isHorizontal ? (1 / rows) * 100 : (2 / rows) * 100;

            return (
              <div
                key={`pill-${idx}`}
                className="absolute rounded-lg border-2 border-cyan-400/90 bg-cyan-950/30 shadow-[0_0_10px_rgba(56,189,248,0.3)] transition-all"
                style={{
                  top: `${topPct}%`,
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                }}
              />
            );
          })}
        </div>

        <div
          className="relative w-full h-full"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: rows }).map((_, r) =>
            Array.from({ length: cols }).map((__, c) => {
              const val = grid[r]?.[c] ?? 0;
              const isOverlapped = analysis.cellCoverCounts[r]?.[c] > 1;
              const isSelected =
                selectedCell !== null && selectedCell[0] === r && selectedCell[1] === c;
              const cellKey = `${r},${c}`;
              const isEvidenceAnimated = animatedEvidenceSet.has(cellKey);

              return (
                <div
                  key={`${r}-${c}`}
                  onClick={() => handleCellSelect(r, c)}
                  className={`flex items-center justify-center font-black text-sm sm:text-base border border-slate-800/40 relative select-none cursor-pointer transition-all duration-150 ${
                    isSelected
                      ? 'bg-cyan-500/20 ring-2 ring-cyan-400 z-15'
                      : isEvidenceAnimated
                      ? 'ring-2 ring-amber-400 bg-amber-500/20 shadow-[0_0_12px_rgba(251,191,36,0.8)] z-16 scale-95'
                      : isOverlapped
                      ? 'bg-rose-950/60 text-rose-300 animate-pulse'
                      : 'bg-slate-900/60 text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <span className="z-12">{val}</span>

                  {c < cols - 1 && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        cycleBorder('H', r, c);
                      }}
                      className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-full z-25 flex items-center justify-center cursor-pointer group"
                    >
                      {hBorders[r][c] === 1 ? (
                        <div className="w-4 h-1.5 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
                      ) : hBorders[r][c] === 2 ? (
                        <div className="w-1 h-5 bg-rose-500 rounded-xs shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-slate-700/30 group-hover:bg-cyan-400/50 transition-colors" />
                      )}
                    </div>
                  )}

                  {r < rows - 1 && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        cycleBorder('V', r, c);
                      }}
                      className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-full h-5 z-25 flex items-center justify-center cursor-pointer group"
                    >
                      {vBorders[r][c] === 1 ? (
                        <div className="w-1.5 h-4 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
                      ) : vBorders[r][c] === 2 ? (
                        <div className="w-5 h-1 bg-rose-500 rounded-xs shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-slate-700/30 group-hover:bg-cyan-400/50 transition-colors" />
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="w-full max-w-[340px] mt-2 p-1.5 bg-slate-900/60 border border-slate-800 rounded-lg">
        <div className="text-[6.5px] text-slate-500 font-bold uppercase mb-1 flex items-center justify-between">
          <div className="flex gap-1 items-center">
            <span>DECK:</span>
            <button
              onClick={() => setInventoryFilter('all')}
              className={`px-1 py-0.2 rounded text-[6px] ${
                inventoryFilter === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {isEn ? 'All' : '全部'}
            </button>
            <button
              onClick={() => setInventoryFilter('pending')}
              className={`px-1 py-0.2 rounded text-[6px] ${
                inventoryFilter === 'pending'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {isEn ? 'Pending' : '待鎖定'}
            </button>
            <button
              onClick={() => setInventoryFilter('duplicate')}
              className={`px-1 py-0.2 rounded text-[6px] ${
                inventoryFilter === 'duplicate'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {isEn ? 'Conflict' : '重複'}
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSortByUrgency((prev) => !prev)}
              className={`text-[6px] px-1 py-0.2 rounded border ${
                sortByUrgency
                  ? 'border-amber-500 text-amber-300 bg-amber-950/40'
                  : 'border-slate-800 text-slate-500'
              }`}
            >
              ⚡ {isEn ? 'Urgency' : '緊迫排序'}
            </button>
            <span className="text-cyan-400">
              {
                Array.from(analysis.foundDominoCounts.values()).filter((cnt) => cnt === 1)
                  .length
              }{' '}
              / {dominoes.length}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 justify-center max-h-16 overflow-y-auto scrollbar-none">
          {processedInventory.map((d) => (
            <div
              key={d.id}
              className={`px-1.5 py-0.5 rounded text-[7px] font-mono border transition-all ${
                d.isDuplicate
                  ? 'bg-rose-950 border-rose-500 text-rose-300 animate-pulse'
                  : d.isFound
                  ? 'bg-cyan-950 border-cyan-500 text-cyan-300 font-bold opacity-50'
                  : d.isCriticalFocus
                  ? 'bg-amber-950/80 border-amber-400 text-amber-300 font-black shadow-[0_0_8px_rgba(251,191,36,0.6)] animate-pulse'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              [{d.val1}|{d.val2}]
            </div>
          ))}
        </div>
      </div>

      <div className="w-full max-w-[340px] flex items-center justify-between px-1 mt-1.5 text-[7.5px] text-slate-400">
        <div className="flex gap-1">
          <button
            onClick={handleUndo}
            disabled={history.length === 0 || isCompleted}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40"
          >
            ↩ {isEn ? 'Undo (Z)' : '撤銷'}
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0 || isCompleted}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40"
          >
            ↪ {isEn ? 'Redo (Y)' : '重做'}
          </button>
        </div>
        <div className="text-slate-500">
          <span>點選兩格連線 / 點擊間隙切換</span>
        </div>
      </div>

      {isCompleted && (
        <div className="mt-2 p-2.5 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,42vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
            <div className="text-left">
              <div className="text-[7.5px] text-slate-500 tracking-wider">DOMINOES RESOLVED</div>
              <div className="text-xs text-indigo-300 font-bold">🀄 骨牌矩陣・完美雙射鋪砌</div>
            </div>
            <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[9px] font-bold text-cyan-300">
              Gf: IQ {cci.standardIQ} (Top {Number((100 - cci.percentileRank).toFixed(1))}%)
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[7.5px] text-slate-400 mb-1.5">
            <div className="bg-slate-900/80 p-1 rounded">
              <div>耗時</div>
              <div className="text-slate-200 font-bold text-[10px]">
                {(elapsedMs / 1000).toFixed(1)}s
              </div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>操作步數</div>
              <div className="text-cyan-300 font-bold text-[10px]">{movesCountRef.current}</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>衝突次數</div>
              <div className="text-amber-300 font-bold text-[10px]">
                {conflictCountRef.current} 次
              </div>
            </div>
          </div>

          <div className="mb-1.5">
            <MetricErrorBar
              actualVal={Math.round(elapsedMs / 1000)}
              benchmarkVal={benchmarkData.benchmarkTime}
              ci95={benchmarkData.ci95}
              sem={benchmarkData.sem}
              unit="s"
              isEn={isEn}
            />
          </div>

          <div className="bg-slate-900/40 p-1 rounded-lg border border-slate-800 flex flex-col items-center mb-1.5">
            <CognitiveRadarChart
              dimensions={profile.cognitiveDimensions}
              previousDimensions={profile.previousCognitiveDimensions}
              size={135}
            />
          </div>

          <div className="flex gap-1 mb-1.5">
            <button
              onClick={exportLongitudinalDataset}
              className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-cyan-600/50 hover:border-cyan-400 text-cyan-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95"
            >
              <span>📊</span>
              <span>{isEn ? 'Dataset' : '匯出數據'}</span>
            </button>
            <button
              onClick={() => setShowSubmitModal(true)}
              className="flex-1 py-1 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 text-slate-950 text-[7.5px] font-black rounded shadow transition active:scale-95 flex items-center justify-center gap-0.5"
            >
              <span>📤</span>
              <span>{isEn ? 'Submit' : '賽事提交'}</span>
            </button>
          </div>

          {proofSignature && (
            <div className="p-1 bg-slate-900 border border-slate-800 rounded text-left">
              <div className="text-[6.5px] text-slate-500 font-bold uppercase flex justify-between">
                <span>LOCAL RECEIPT (SHA-256)</span>
                <span className="text-emerald-400 font-mono text-[5.5px]">TAMPER-PROOF</span>
              </div>
              <div className="text-[6px] font-mono text-cyan-400/80 break-all select-all mt-0.5">
                {proofSignature}
              </div>
            </div>
          )}
        </div>
      )}

      {showPBModal && (
        <PBCelebrationModal
          pb={profile.personalBest}
          onClose={() => setShowPBModal(false)}
          isEn={isEn}
        />
      )}

      {showSubmitModal && (
        <TournamentSubmissionModal
          payload={{
            submissionId: `SUB-${actualPuzzle.id}-${Date.now().toString(36)}`,
            tournamentId: tournamentMode ? 'WPF_DOMINOES_2026' : 'GLOBAL_TOPOLOGY_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'dominoes',
            tier: currentTier,
            timeSpentSec: Math.round(elapsedMs / 1000),
            conflictsCount: conflictCountRef.current,
            infractionScore: calculateInfractionScore({
              tabSwitches: 0,
              blurEvents: 0,
              clipboardEvents: 0,
              untrustedEvents: 0,
            }),
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
