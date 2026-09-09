// web-frontend/src/hooks/useSkyscraperGame.ts
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from './useLearnerProfile';
import {
  WebSkyscraperGenerator,
  SkyscraperClues,
  MetacognitiveHint,
} from '../engines/skyscraperGenerator';

export type SpatialStrategy = 'MentalRotator' | 'ProgressiveEliminator' | 'GlobalPlanner';

interface HistorySnapshot {
  grid: number[][];
  pencilMarks: Set<number>[][];
}

export interface SplitPacingMetrics {
  openingSec: number;
  midgameSec: number;
  endgameSec: number;
}

export interface PreflightProjection {
  impactedRays: { direction: 'top' | 'bottom' | 'left' | 'right'; index: number }[];
  predictedOutcome: 'SAFE' | 'WILL_VIOLATE' | 'WILL_SATISFY';
}

export const QWERTY_NUMBER_MAP: Record<string, number> = {
  q: 1, w: 2, e: 3, r: 4, t: 5, y: 6, u: 7, i: 8, o: 9,
  a: 1, s: 2, d: 3, f: 4, g: 5, h: 6, j: 7, k: 8, l: 9,
};

export const useSkyscraperGame = ({
  puzzle,
  tournamentMode = false,
  isEn,
}: {
  puzzle: PuzzleEntity;
  tournamentMode?: boolean;
  isEn: boolean;
}) => {
  const { recordAttempt, saveBookmark, removeBookmark, getBenchmarkMetrics, profile } = useLearnerProfile();

  const spec = puzzle.puzzle as any;
  const size: number = spec?.size || 4;
  const clues: SkyscraperClues = spec?.clues || { top: [], bottom: [], left: [], right: [] };
  const solutionGrid = useMemo(() => (puzzle.solution as number[][]) || [], [puzzle]);
  const currentTier = (puzzle.tier as TierKey) || 'kids';
  const theoryTime = puzzle.metrics?.estimated_time_sec || 120;
  const standardTimeLimit = size === 4 ? 360 : 540;

  const initialGrid = useMemo(() => {
    if (spec?.grid && Array.isArray(spec.grid)) {
      return spec.grid.map((row: number[]) => [...row]);
    }
    return Array.from({ length: size }, () => Array(size).fill(0));
  }, [spec, size]);

  const [internalAssessment, setInternalAssessment] = useState<boolean>(false);
  const isAssessmentMode = tournamentMode || internalAssessment;

  // 1. 雙層數值與候選狀態
  const [grid, setGrid] = useState<number[][]>(initialGrid);
  const [pencilMarks, setPencilMarks] = useState<Set<number>[][]>(() =>
    Array.from({ length: size }, () => Array.from({ length: size }, () => new Set<number>()))
  );
  const [isPencilMode, setIsPencilMode] = useState<boolean>(false);

  // 2. 焦點與預測性沙盤
  const [selected, setSelected] = useState<[number, number] | null>([0, 0]);
  const [preflightPreview, setPreflightPreview] = useState<PreflightProjection | null>(null);

  // 3. 撤銷 / 重做歷史棧
  const historyStackRef = useRef<HistorySnapshot[]>([]);
  const redoStackRef = useRef<HistorySnapshot[]>([]);

  // 4. 遊戲生命週期
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isResigned, setIsResigned] = useState<boolean>(false);
  const [isTimedOut, setIsTimedOut] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  // 5. 三幕式分段節奏模型
  const [splitPacing, setSplitPacing] = useState<SplitPacingMetrics>({ openingSec: 0, midgameSec: 0, endgameSec: 0 });

  // 6. 漸進式戰略提示
  const [activeHint, setActiveHint] = useState<MetacognitiveHint | null>(null);
  const [hintTierLevel, setHintTierLevel] = useState<number>(0);

  // 7. 視線衝突診斷氣泡
  const [lineDiagnostic, setLineDiagnostic] = useState<string | null>(null);

  // 8. 遙測與防作弊簽章
  const [proofSignature, setProofSignature] = useState<string | null>(null);
  const [bookmarkToast, setBookmarkToast] = useState<string | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const hypothesisAttemptsRef = useRef<number>(0);
  const moveSequenceRef = useRef<{ r: number; c: number; time: number }[]>([]);
  const hasRecordedRef = useRef<boolean>(false);

  // 歷史快照推進
  const pushHistorySnapshot = useCallback(() => {
    const cloneMarks = pencilMarks.map((row) => row.map((set) => new Set(set)));
    historyStackRef.current.push({
      grid: grid.map((r) => [...r]),
      pencilMarks: cloneMarks,
    });
    redoStackRef.current = [];
  }, [grid, pencilMarks]);

  const undo = useCallback(() => {
    if (historyStackRef.current.length === 0 || isCompleted || isResigned || isTimedOut) return;
    const previous = historyStackRef.current.pop()!;
    const currentCloneMarks = pencilMarks.map((row) => row.map((set) => new Set(set)));
    redoStackRef.current.push({
      grid: grid.map((r) => [...r]),
      pencilMarks: currentCloneMarks,
    });
    setGrid(previous.grid);
    setPencilMarks(previous.pencilMarks);
    hypothesisAttemptsRef.current += 1;
  }, [grid, pencilMarks, isCompleted, isResigned, isTimedOut]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0 || isCompleted || isResigned || isTimedOut) return;
    const next = redoStackRef.current.pop()!;
    const currentCloneMarks = pencilMarks.map((row) => row.map((set) => new Set(set)));
    historyStackRef.current.push({
      grid: grid.map((r) => [...r]),
      pencilMarks: currentCloneMarks,
    });
    setGrid(next.grid);
    setPencilMarks(next.pencilMarks);
  }, [grid, pencilMarks, isCompleted, isResigned, isTimedOut]);

  const detectedStrategy = useMemo<SpatialStrategy>(() => {
    const seq = moveSequenceRef.current;
    if (seq.length < 3) return 'GlobalPlanner';
    let axisSwitches = 0;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].r !== seq[i - 1].r && seq[i].c !== seq[i - 1].c) axisSwitches++;
    }
    if (axisSwitches / seq.length > 0.65) return 'MentalRotator';
    if (hypothesisAttemptsRef.current >= 3) return 'GlobalPlanner';
    return 'ProgressiveEliminator';
  }, [moveSequenceRef.current.length, hypothesisAttemptsRef.current]);

  const countVisible = useCallback((line: number[]): number => {
    let count = 0;
    let max = 0;
    for (const val of line) {
      if (val > max) {
        count++;
        max = val;
      }
    }
    return count;
  }, []);

  // 視線約束與前綴剪枝衝突分析 (含可解釋性診斷文本)
  const lineValidityStatus = useMemo(() => {
    const checkLineWithDiagnostic = (line: number[], clue: number, label: string) => {
      if (clue === 0) return { satisfied: true, violated: false, reason: '' };
      const isFull = line.every((v) => v > 0);
      const visible = countVisible(line);

      if (isFull) {
        const isOk = visible === clue;
        return {
          satisfied: isOk,
          violated: !isOk,
          reason: !isOk
            ? (isEn
                ? `${label}: currently sees ${visible} buildings, but clue specifies ${clue}.`
                : `${label}：目前視線可見 ${visible} 棟，但外圍線索要求 ${clue} 棟。`)
            : '',
        };
      }

      let maxH = 0;
      let currVis = 0;
      let emptyCount = 0;
      for (const h of line) {
        if (h === 0) emptyCount++;
        else if (h > maxH) {
          currVis++;
          maxH = h;
        }
      }

      if (currVis > clue) {
        return {
          satisfied: null,
          violated: true,
          reason: isEn
            ? `${label}: already exceeds visible limit (${currVis} > ${clue}) before completion.`
            : `${label}：未填滿前可見樓層已超標 (${currVis} > ${clue})。`,
        };
      }
      if (currVis + emptyCount < clue) {
        return {
          satisfied: null,
          violated: true,
          reason: isEn
            ? `${label}: maximum possible visibility cannot reach ${clue}.`
            : `${label}：即便剩餘空格全數遞增，亦無法達到線索要求的 ${clue} 棟。`,
        };
      }

      return { satisfied: null, violated: false, reason: '' };
    };

    const top = clues.top.map((target, c) => checkLineWithDiagnostic(grid.map((r) => r[c]), target, `Col ${c + 1} ↓`));
    const bottom = clues.bottom.map((target, c) => checkLineWithDiagnostic(grid.map((r) => r[c]).reverse(), target, `Col ${c + 1} ↑`));
    const left = clues.left.map((target, r) => checkLineWithDiagnostic(grid[r], target, `Row ${r + 1} →`));
    const right = clues.right.map((target, r) => checkLineWithDiagnostic([...grid[r]].reverse(), target, `Row ${r + 1} ←`));

    return { top, bottom, left, right };
  }, [grid, clues, countVisible, isEn]);

  // 重複數值衝突檢測
  const duplicateConflictSet = useMemo(() => {
    const dupes = new Set<string>();
    for (let r = 0; r < size; r++) {
      const seen = new Map<number, number[]>();
      for (let c = 0; c < size; c++) {
        const val = grid[r][c];
        if (val !== 0) {
          if (!seen.has(val)) seen.set(val, []);
          seen.get(val)!.push(c);
        }
      }
      seen.forEach((cols) => {
        if (cols.length > 1) cols.forEach((c) => dupes.add(`${r},${c}`));
      });
    }

    for (let c = 0; c < size; c++) {
      const seen = new Map<number, number[]>();
      for (let r = 0; r < size; r++) {
        const val = grid[r][c];
        if (val !== 0) {
          if (!seen.has(val)) seen.set(val, []);
          seen.get(val)!.push(r);
        }
      }
      seen.forEach((rows) => {
        if (rows.length > 1) rows.forEach((r) => dupes.add(`${r},${c}`));
      });
    }
    return dupes;
  }, [grid, size]);

  // 獲勝狀態確認
  const checkVictory = useCallback(
    async (currentGrid: number[][]) => {
      if (!solutionGrid.length) return;
      let isMatch = true;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (currentGrid[r][c] !== solutionGrid[r][c]) {
            isMatch = false;
            break;
          }
        }
      }

      if (isMatch) {
        setIsCompleted(true);
        removeBookmark(puzzle.id);

        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
          recordAttempt({
            puzzleId: puzzle.id,
            engineType: 'skyscraper',
            tier: currentTier,
            cognitiveLoad: puzzle.cognitiveLoad || { spatial: 0.85, numeric: 0.4, workingMemory: 0.8, inhibition: 0.6 },
            isSuccess: true,
            timeSpentSec: timeSpent,
            conflictsCount: conflictCountRef.current,
            technique: detectedStrategy,
            partialCompletionRatio: 1.0,
            isPureClear: conflictCountRef.current === 0 && hintTierLevel === 0,
          });

          try {
            const canonical = [puzzle.id, currentTier, timeSpent, conflictCountRef.current, 'WPC_COCKPIT_VALIDATED'].join('|');
            const enc = new TextEncoder();
            const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(canonical));
            const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
            setProofSignature(`VERIFIED_${hex.slice(0, 24).toUpperCase()}`);
          } catch {
            setProofSignature(`LOCAL_${Date.now()}`);
          }
        }
      }
    },
    [solutionGrid, size, puzzle, currentTier, detectedStrategy, hintTierLevel, recordAttempt, removeBookmark]
  );

  // 預測性虛擬沙盤透視運算 (Pre-flight Sandbox)
  const computePreflightRayImpact = useCallback(
    (r: number, c: number, testVal: number): PreflightProjection => {
      const ghost = grid.map((row) => [...row]);
      ghost[r][c] = testVal;

      const rowLine = ghost[r];
      const colLine = ghost.map((rowArr) => rowArr[c]);

      const testLine = (line: number[], clue: number) => {
        if (clue === 0) return true;
        let maxH = 0;
        let currVis = 0;
        let emptyCount = 0;
        for (const h of line) {
          if (h === 0) emptyCount++;
          else if (h > maxH) {
            currVis++;
            maxH = h;
          }
        }
        if (currVis > clue || currVis + emptyCount < clue) return false;
        if (emptyCount === 0 && currVis !== clue) return false;
        return true;
      };

      const topOk = testLine(colLine, clues.top[c]);
      const botOk = testLine([...colLine].reverse(), clues.bottom[c]);
      const leftOk = testLine(rowLine, clues.left[r]);
      const rightOk = testLine([...rowLine].reverse(), clues.right[r]);

      const willViolate = !topOk || !botOk || !leftOk || !rightOk;

      return {
        impactedRays: [
          { direction: 'left', index: r },
          { direction: 'right', index: r },
          { direction: 'top', index: c },
          { direction: 'bottom', index: c },
        ],
        predictedOutcome: willViolate ? 'WILL_VIOLATE' : 'SAFE',
      };
    },
    [grid, clues]
  );

  // 輸入落子與鉛筆候選切換
  const handleNumberInput = useCallback(
    (num: number, explicitPencil?: boolean) => {
      if (!selected || isCompleted || isTimedOut || isResigned) return;
      const [r, c] = selected;
      if (initialGrid[r][c] !== 0) return;

      pushHistorySnapshot();
      const targetPencil = explicitPencil !== undefined ? explicitPencil : isPencilMode;

      if (targetPencil && num !== 0) {
        setPencilMarks((prev) => {
          const next = prev.map((row) => row.map((s) => new Set(s)));
          if (next[r][c].has(num)) {
            next[r][c].delete(num);
          } else {
            next[r][c].add(num);
          }
          return next;
        });
        setPreflightPreview(null);
        return;
      }

      if (num !== 0 && solutionGrid[r] && solutionGrid[r][c] !== num) {
        conflictCountRef.current += 1;
      }

      if (num !== 0) {
        moveSequenceRef.current.push({ r, c, time: Date.now() });
      }

      const nextGrid = grid.map((row) => [...row]);
      nextGrid[r][c] = num;
      setGrid(nextGrid);
      setPreflightPreview(null);

      // 自動清除正交關聯候選數
      if (num !== 0) {
        setPencilMarks((prev) => {
          const next = prev.map((row) => row.map((s) => new Set(s)));
          next[r][c].clear();
          for (let i = 0; i < size; i++) {
            next[r][i].delete(num);
            next[i][c].delete(num);
          }
          return next;
        });
      }

      // 三幕式節奏切分追蹤
      const filled = nextGrid.flat().filter((v) => v !== 0).length;
      const total = size * size;
      const nowSec = Math.floor((Date.now() - startTimeRef.current) / 1000);
      if (filled >= total * 0.25 && splitPacing.openingSec === 0) {
        setSplitPacing((p) => ({ ...p, openingSec: nowSec }));
      } else if (filled >= total * 0.75 && splitPacing.midgameSec === 0) {
        setSplitPacing((p) => ({ ...p, midgameSec: nowSec - splitPacing.openingSec }));
      } else if (filled === total && splitPacing.endgameSec === 0) {
        setSplitPacing((p) => ({ ...p, endgameSec: nowSec - (splitPacing.openingSec + splitPacing.midgameSec) }));
      }

      checkVictory(nextGrid);
    },
    [selected, isCompleted, isTimedOut, isResigned, initialGrid, isPencilMode, solutionGrid, grid, size, splitPacing, pushHistorySnapshot, checkVictory]
  );

  const moveCursor = useCallback(
    (dr: number, dc: number) => {
      if (!selected) {
        setSelected([0, 0]);
        return;
      }
      const [r, c] = selected;
      const nr = Math.max(0, Math.min(size - 1, r + dr));
      const nc = Math.max(0, Math.min(size - 1, c + dc));
      setSelected([nr, nc]);
      setPreflightPreview(null);
    },
    [selected, size]
  );

  // 漸進式元認知提示梯隊
  const advanceMetacognitiveHint = useCallback(() => {
    if (isCompleted || isTimedOut || isResigned) return;

    if (!activeHint) {
      const dynamicHints = WebSkyscraperGenerator.getNextDynamicHint(grid, clues, solutionGrid, size);
      if (dynamicHints.length === 0) return;

      const firstH = dynamicHints[0];
      const constructedHint: MetacognitiveHint = {
        macro: {
          focusArea: 'ROW',
          targetIndex: firstH.row ?? 0,
          strategicIntentZh: `觀察該交集區域視線瓶頸，藉由邊界線索與鄰近已填樓層鎖定唯一候選。`,
          strategicIntentEn: `Inspect sightline occlusion at this intersection zone.`,
          estimatedTimeSec: 20,
        },
        tactical: {
          technique: 'Orthogonal Elimination & Line-CSP',
          reasoningMechanismZh: firstH.messageZh,
          reasoningMechanismEn: firstH.messageEn,
        },
        micro: {
          targetCell: [firstH.row ?? 0, firstH.col ?? 0],
          action: 'SET_NUMBER',
          val: firstH.targetNum ?? solutionGrid[firstH.row ?? 0][firstH.col ?? 0],
        },
      };
      setActiveHint(constructedHint);
      setHintTierLevel(1);
      setSelected([constructedHint.micro.targetCell[0], constructedHint.micro.targetCell[1]]);
      return;
    }

    if (hintTierLevel < 3) {
      setHintTierLevel((prev) => prev + 1);
    } else {
      setHintTierLevel(0);
      setActiveHint(null);
    }
  }, [activeHint, hintTierLevel, grid, clues, solutionGrid, size, isCompleted, isTimedOut, isResigned]);

  useEffect(() => {
    if (isCompleted || isTimedOut || isResigned) return;
    const timer = setInterval(() => {
      const currentElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSec(currentElapsed);
      if (isAssessmentMode && currentElapsed >= standardTimeLimit) {
        setIsTimedOut(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isCompleted, isTimedOut, isResigned, isAssessmentMode, standardTimeLimit]);

  return {
    size,
    clues,
    grid,
    pencilMarks,
    isPencilMode,
    setIsPencilMode,
    selected,
    setSelected,
    preflightPreview,
    setPreflightPreview,
    computePreflightRayImpact,
    isCompleted,
    isResigned,
    isTimedOut,
    elapsedSec,
    theoryTime,
    splitPacing,
    standardTimeLimit,
    remainingTime: Math.max(0, standardTimeLimit - elapsedSec),
    isAssessmentMode,
    setInternalAssessment,
    detectedStrategy,
    lineValidityStatus,
    duplicateConflictSet,
    proofSignature,
    bookmarkToast,
    activeHint,
    hintTierLevel,
    lineDiagnostic,
    setLineDiagnostic,
    advanceMetacognitiveHint,
    undo,
    redo,
    moveCursor,
    handleNumberInput,
    handleBookmarkPuzzle: () => {
      saveBookmark({
        puzzleId: puzzle.id,
        engineType: 'skyscraper',
        tier: currentTier,
        boardState: grid,
        elapsedSec,
        bookmarkedAt: new Date().toISOString(),
      });
      setBookmarkToast(isEn ? '📌 Progress bookmarked' : '📌 已暫存當前進度');
      setTimeout(() => setBookmarkToast(null), 2500);
    },
    handleGracefulResign: () => {
      setIsResigned(true);
      hasRecordedRef.current = true;
      removeBookmark(puzzle.id);
      setGrid(solutionGrid.map((r) => [...r]));
    },
    benchmarkData: getBenchmarkMetrics('PerspectiveDeduction', theoryTime, 'skyscraper'),
    replayScript: (puzzle.puzzle as any)?.replayScript || [],
  };
};
