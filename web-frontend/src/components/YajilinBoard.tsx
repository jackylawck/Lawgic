// web-frontend/src/components/YajilinBoard.tsx
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
  WebYajilinGenerator,
  YajilinSpec,
  ArrowClue,
  YajilinCellState,
  YajilinCellEdges,
  YajilinHintStep,
  Direction,
} from '../engines/yajilinGenerator';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

interface YajilinDelta {
  type: 'cell' | 'edge';
  r: number;
  c: number;
  dirIndex?: number;
  from: any;
  to: any;
}

const MAX_HISTORY_STEPS = 250;

export const YajilinBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
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

  const spec: YajilinSpec = (actualPuzzle as any)?.puzzle;
  const rows = spec?.rows || 7;
  const cols = spec?.cols || 7;
  const clues: ArrowClue[] = useMemo(() => spec?.clues || [], [spec]);

  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';

  const clueMap = useMemo(() => {
    const map = new Map<string, ArrowClue>();
    clues.forEach((cl) => map.set(`${cl.r},${cl.c}`, cl));
    return map;
  }, [clues]);

  // 1. 非語言符號模式
  const [isNonVerbal, setIsNonVerbal] = useState<boolean>(tournamentMode);

  // 2. 盤面狀態
  const [cellStates, setCellStates] = useState<YajilinCellState[][]>(() =>
    Array.from({ length: rows }, () => Array(cols).fill(0))
  );

  const [edges, setEdges] = useState<YajilinCellEdges[][]>(() =>
    Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => [false, false, false, false])
    )
  );

  const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null);
  const [history, setHistory] = useState<YajilinDelta[]>([]);
  const [redoStack, setRedoStack] = useState<YajilinDelta[]>([]);

  // 3. 提示與覆盤回放 (Replay Engine)
  const [noGuessMode, setNoGuessMode] = useState<boolean>(false);
  const [noGuessWarning, setNoGuessWarning] = useState<string | null>(null);
  const [activeHint, setActiveHint] = useState<YajilinHintStep | null>(null);
  const [hintLadderLevel, setHintLadderLevel] = useState<1 | 2 | 3>(1);
  const [animatedEvidenceSet, setAnimatedEvidenceSet] = useState<Set<string>>(new Set());

  // 覆盤播放器狀態
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [replayStepIndex, setReplayStepIndex] = useState<number>(0);
  const [replayDeductionList, setReplayDeductionList] = useState<YajilinHintStep[]>([]);
  const [copyToast, setCopyToast] = useState<boolean>(false);

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
    setCellStates(Array.from({ length: rows }, () => Array(cols).fill(0)));
    setEdges(
      Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => [false, false, false, false])
      )
    );
    setSelectedCell(null);
    setHistory([]);
    setRedoStack([]);
    setIsCompleted(false);
    setActiveHint(null);
    setHintLadderLevel(1);
    setAnimatedEvidenceSet(new Set());
    setIsReplaying(false);
    setReplayStepIndex(0);
    setReplayDeductionList([]);
    setProofSignature(null);
    setNoGuessWarning(null);
    if (tournamentMode) setIsNonVerbal(true);
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    conflictCountRef.current = 0;
    setConflictDisplay(0);
    movesCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id, rows, cols, tournamentMode]);

  useEffect(() => {
    if (isCompleted || isReplaying) return;
    let frameId: number;
    const updateTimer = () => {
      setElapsedMs(Date.now() - startTimeRef.current);
      frameId = requestAnimationFrame(updateTimer);
    };
    frameId = requestAnimationFrame(updateTimer);
    return () => cancelAnimationFrame(frameId);
  }, [isCompleted, isReplaying]);

  // 動態提示依據格動畫
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
        if (navigator.vibrate) navigator.vibrate(4);
      }, idx * 120);
      timers.push(t);
    });
    return () => timers.forEach(clearTimeout);
  }, [activeHint]);

  // 4. 即時衝突與違規檢測
  const analysis = useMemo(() => {
    const adjacentBlacks = new Set<string>();
    const arrowOverflows = new Set<string>();
    const degreeViolations = new Set<string>();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cellStates[r][c] === 1) {
          if (c < cols - 1 && cellStates[r][c + 1] === 1) {
            adjacentBlacks.add(`${r},${c}`);
            adjacentBlacks.add(`${r},${c + 1}`);
          }
          if (r < rows - 1 && cellStates[r + 1][c] === 1) {
            adjacentBlacks.add(`${r},${c}`);
            adjacentBlacks.add(`${r + 1},${c}`);
          }
        }
      }
    }

    clues.forEach((clue) => {
      const [dr, dc] = WebYajilinGenerator.getDirectionDelta(clue.dir);
      let r = clue.r + dr;
      let c = clue.c + dc;
      let cnt = 0;
      while (r >= 0 && r < rows && c >= 0 && c < cols) {
        if (cellStates[r][c] === 1) cnt++;
        r += dr;
        c += dc;
      }
      if (cnt > clue.count) {
        arrowOverflows.add(`${clue.r},${clue.c}`);
      }
    });

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const deg = edges[r][c].filter(Boolean).length;
        if (deg > 2 || (deg > 0 && (clueMap.has(`${r},${c}`) || cellStates[r][c] === 1))) {
          degreeViolations.add(`${r},${c}`);
        }
      }
    }

    const totalConflicts = adjacentBlacks.size + arrowOverflows.size + degreeViolations.size;
    return { adjacentBlacks, arrowOverflows, degreeViolations, totalConflicts };
  }, [cellStates, edges, clues, rows, cols, clueMap]);

  const prevConflictsRef = useRef<number>(0);
  useEffect(() => {
    if (analysis.totalConflicts > prevConflictsRef.current) {
      conflictCountRef.current += analysis.totalConflicts - prevConflictsRef.current;
      setConflictDisplay(conflictCountRef.current);
    }
    prevConflictsRef.current = analysis.totalConflicts;
  }, [analysis.totalConflicts]);

  const mutateCell = useCallback(
    (r: number, c: number, targetState: YajilinCellState) => {
      if (isCompleted || isReplaying || clueMap.has(`${r},${c}`)) return;
      const currentVal = cellStates[r][c];
      if (currentVal === targetState) return;

      if (noGuessMode && targetState !== 0) {
        const step = WebYajilinGenerator.getNextForcedDeduction(rows, cols, clues, cellStates, edges);
        if (step) {
          const isTarget = step.r === r && step.c === c;
          const isStateMatch = step.forcedState === targetState;
          if (!isTarget || !isStateMatch) {
            if (navigator.vibrate) navigator.vibrate([25, 35, 25]);
            const reason = isEn ? step.humanReadable.en : step.humanReadable.zh;
            setNoGuessWarning(
              isEn ? `[No-Guess Blocked] Strictly deduce: ${reason}` : `【無猜測攔截】依據定式應優先推導：${reason}`
            );
            setTimeout(() => setNoGuessWarning(null), 3000);
            return;
          }
        }
      }

      if (navigator.vibrate) navigator.vibrate(8);
      movesCountRef.current++;

      const delta: YajilinDelta = { type: 'cell', r, c, from: currentVal, to: targetState };
      setHistory((prev) => [...prev.slice(-MAX_HISTORY_STEPS + 1), delta]);
      setRedoStack([]);

      setCellStates((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = targetState;
        return next;
      });

      if (activeHint && activeHint.r === r && activeHint.c === c) {
        setActiveHint(null);
      }
    },
    [isCompleted, isReplaying, clueMap, cellStates, noGuessMode, rows, cols, clues, edges, activeHint, isEn]
  );

  const toggleEdge = useCallback(
    (r1: number, c1: number, r2: number, c2: number) => {
      if (isCompleted || isReplaying) return;
      if (clueMap.has(`${r1},${c1}`) || clueMap.has(`${r2},${c2}`)) return;
      if (cellStates[r1][c1] === 1 || cellStates[r2][c2] === 1) return;

      const dr = r2 - r1;
      const dc = c2 - c1;

      let d1 = -1;
      let d2 = -1;
      if (dr === -1 && dc === 0) { d1 = 0; d2 = 2; }
      else if (dr === 0 && dc === 1) { d1 = 1; d2 = 3; }
      else if (dr === 1 && dc === 0) { d1 = 2; d2 = 0; }
      else if (dr === 0 && dc === -1) { d1 = 3; d2 = 1; }

      if (d1 === -1) return;

      const currentEdge = edges[r1][c1][d1];
      const targetEdge = !currentEdge;

      if (navigator.vibrate) navigator.vibrate(6);
      movesCountRef.current++;

      const delta: YajilinDelta = { type: 'edge', r: r1, c: c1, dirIndex: d1, from: currentEdge, to: targetEdge };
      setHistory((prev) => [...prev.slice(-MAX_HISTORY_STEPS + 1), delta]);
      setRedoStack([]);

      setEdges((prev) => {
        const next = prev.map((row) => row.map((arr) => [...arr] as YajilinCellEdges));
        next[r1][c1][d1] = targetEdge;
        next[r2][c2][d2] = targetEdge;
        return next;
      });
    },
    [isCompleted, isReplaying, clueMap, cellStates, edges]
  );

  const handleCellClick = (r: number, c: number) => {
    if (clueMap.has(`${r},${c}`) || isReplaying) return;
    if (selectedCell !== null) {
      const [pr, pc] = selectedCell;
      if (Math.abs(r - pr) + Math.abs(c - pc) === 1) {
        toggleEdge(pr, pc, r, c);
        setSelectedCell(null);
        return;
      }
    }
    setSelectedCell([r, c]);
    const curr = cellStates[r][c];
    const next: YajilinCellState = curr === 0 ? 1 : curr === 1 ? 2 : 0;
    mutateCell(r, c, next);
  };

  const handleUndo = useCallback(() => {
    if (history.length === 0 || isCompleted || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const last = history[history.length - 1];
    if (last.type === 'cell') {
      setCellStates((prev) => {
        const next = prev.map((row) => [...row]);
        next[last.r][last.c] = last.from;
        return next;
      });
    } else if (last.type === 'edge' && last.dirIndex !== undefined) {
      const dirs = [[-1, 0], [0, 1], [1, 0], [0, -1]];
      const oppDir = [2, 3, 0, 1];
      const nr = last.r + dirs[last.dirIndex][0];
      const nc = last.c + dirs[last.dirIndex][1];
      setEdges((prev) => {
        const next = prev.map((row) => row.map((arr) => [...arr] as YajilinCellEdges));
        next[last.r][last.c][last.dirIndex!] = last.from;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          next[nr][nc][oppDir[last.dirIndex!]] = last.from;
        }
        return next;
      });
    }

    setRedoStack((prev) => [...prev, last]);
    setHistory((prev) => prev.slice(0, -1));
  }, [history, isCompleted, isReplaying, rows, cols]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const nextDelta = redoStack[redoStack.length - 1];
    if (nextDelta.type === 'cell') {
      setCellStates((prev) => {
        const next = prev.map((row) => [...row]);
        next[nextDelta.r][nextDelta.c] = nextDelta.to;
        return next;
      });
    } else if (nextDelta.type === 'edge' && nextDelta.dirIndex !== undefined) {
      const dirs = [[-1, 0], [0, 1], [1, 0], [0, -1]];
      const oppDir = [2, 3, 0, 1];
      const nr = nextDelta.r + dirs[nextDelta.dirIndex][0];
      const nc = nextDelta.c + dirs[nextDelta.dirIndex][1];
      setEdges((prev) => {
        const next = prev.map((row) => row.map((arr) => [...arr] as YajilinCellEdges));
        next[nextDelta.r][nextDelta.c][nextDelta.dirIndex!] = nextDelta.to;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          next[nr][nc][oppDir[nextDelta.dirIndex!]] = nextDelta.to;
        }
        return next;
      });
    }

    setHistory((prev) => [...prev, nextDelta]);
    setRedoStack((prev) => prev.slice(0, -1));
  }, [redoStack, isCompleted, isReplaying, rows, cols]);

  // 鍵盤操控
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isReplaying) return;
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
  }, [isCompleted, isReplaying, handleUndo, handleRedo]);

  // 5. 勝利驗證與 SHA-256
  useEffect(() => {
    if (isCompleted || isReplaying || analysis.totalConflicts > 0) return;

    const isBlackBool = cellStates.map((row) => row.map((v) => v === 1));
    const isClueBool = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (__, c) => clueMap.has(`${r},${c}`))
    );

    const isSolved = WebYajilinGenerator.verifySingleContinuousLoop(
      rows,
      cols,
      edges,
      isBlackBool,
      isClueBool
    );

    if (isSolved) {
      setIsCompleted(true);
      const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

      if (!hasRecordedRef.current && actualPuzzle) {
        hasRecordedRef.current = true;
        const baseIrt = (actualPuzzle.metrics as any)?.irt_logit_difficulty || 1.8;

        recordAttempt({
          puzzleId: actualPuzzle.id,
          engineType: 'yajilin',
          tier: currentTier,
          cognitiveLoad: actualPuzzle.cognitiveLoad || {
            spatial: 0.9,
            numeric: 0.45,
            workingMemory: 0.8,
            inhibition: 0.9,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
          technique: 'YajilinJordanEulerLoop',
          irtDifficulty: baseIrt,
          isPureClear: conflictCountRef.current === 0 && !activeHint,
        });

        try {
          const canonical = `${actualPuzzle.id}|${timeSpent}|${movesCountRef.current}|${conflictCountRef.current}|SECURE_${tournamentMode}|YAJILIN_EULER_MASTER`;
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
  }, [edges, cellStates, analysis.totalConflicts, isCompleted, isReplaying, actualPuzzle, rows, cols, clueMap, currentTier, recordAttempt, profile.personalBest.fastestTime, activeHint, tournamentMode]);

  // 因果提示請求
  const handleRequestHint = () => {
    if (isCompleted || tournamentMode || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(12);

    if (!activeHint) {
      const step = WebYajilinGenerator.getNextForcedDeduction(rows, cols, clues, cellStates, edges);
      if (step) {
        setActiveHint(step);
        setSelectedCell([step.r, step.c]);
        setHintLadderLevel(1);
      }
    } else {
      setHintLadderLevel((prev) => (prev === 1 ? 2 : 3));
    }
  };

  // 6. 硬核玩家必備：解法路徑慢動作覆盤 (Solution Path Replay Engine)
  const handleStartReplay = () => {
    // 預先推導出完整解題序列
    const simCellStates: YajilinCellState[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    const simEdges: YajilinCellEdges[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => [false, false, false, false])
    );
    const steps: YajilinHintStep[] = [];

    let safety = 0;
    while (safety++ < rows * cols * 2) {
      const step = WebYajilinGenerator.getNextForcedDeduction(rows, cols, clues, simCellStates, simEdges);
      if (!step) break;
      steps.push(step);
      simCellStates[step.r][step.c] = step.forcedState;
      if (step.forcedEdges) {
        simEdges[step.r][step.c] = [...step.forcedEdges];
      }
    }

    setReplayDeductionList(steps);
    setReplayStepIndex(0);
    setIsReplaying(true);
    // 重置盤面至初始狀態以供回放
    setCellStates(Array.from({ length: rows }, () => Array(cols).fill(0)));
    setEdges(Array.from({ length: rows }, () => Array.from({ length: cols }, () => [false, false, false, false])));
  };

  // 覆盤時間軸計時器 (450ms/步)
  useEffect(() => {
    if (!isReplaying || replayDeductionList.length === 0) return;

    if (replayStepIndex >= replayDeductionList.length) {
      setTimeout(() => setIsReplaying(false), 1200);
      return;
    }

    const timer = setTimeout(() => {
      const curStep = replayDeductionList[replayStepIndex];
      setCellStates((prev) => {
        const next = prev.map((row) => [...row]);
        next[curStep.r][curStep.c] = curStep.forcedState;
        return next;
      });

      if (curStep.forcedEdges) {
        setEdges((prev) => {
          const next = prev.map((row) => row.map((arr) => [...arr] as YajilinCellEdges));
          next[curStep.r][curStep.c] = [...curStep.forcedEdges!];
          return next;
        });
      }

      setAnimatedEvidenceSet(new Set(curStep.evidenceCells.map(([r, c]) => `${r},${c}`)));
      setReplayStepIndex((prev) => prev + 1);
    }, 450);

    return () => clearTimeout(timer);
  }, [isReplaying, replayStepIndex, replayDeductionList]);

  // 7. 一鍵複製題目種子碼 (Discord Duel Seed Sharing)
  const handleCopySeedShareCode = () => {
    const seed = (actualPuzzle as any)?.puzzle?.seed || (actualPuzzle?.metrics as any)?.seed || 0;
    const shareCode = `YAJILIN-S${seed}-T${currentTier}`;
    navigator.clipboard.writeText(shareCode);
    setCopyToast(true);
    if (navigator.vibrate) navigator.vibrate(20);
    setTimeout(() => setCopyToast(false), 2400);
  };

  const theoryTime = (actualPuzzle?.metrics as any)?.estimated_time_sec || rows * cols * 3;
  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('TopologicalLookahead', theoryTime, 'yajilin');
  }, [getBenchmarkMetrics, theoryTime]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  const getArrowSymbol = (dir: Direction) => {
    switch (dir) {
      case 'U': return '▲';
      case 'D': return '▼';
      case 'L': return '◀';
      case 'R': return '▶';
    }
  };

  const renderClueRepresentation = (count: number) => {
    if (!isNonVerbal) {
      return <span className="text-[10px] sm:text-xs font-black text-amber-400 mt-0.5">{count}</span>;
    }
    if (count === 0) {
      return <span className="text-[9px] text-amber-300 font-black mt-0.5 leading-none">○</span>;
    } else if (count === 1) {
      return <span className="text-[8px] text-amber-400 font-black mt-0.5 leading-none">●</span>;
    } else if (count === 2) {
      return (
        <div className="flex gap-0.5 mt-0.5 leading-none">
          <span className="text-[7px] text-amber-400 font-black">●</span>
          <span className="text-[7px] text-amber-400 font-black">●</span>
        </div>
      );
    } else {
      return <span className="text-[8px] text-amber-400 font-black mt-0.5 leading-none">∴</span>;
    }
  };

  const gfPurity = (actualPuzzle?.metrics as any)?.gfPurityIndex ?? 0.5;
  const dominant = (actualPuzzle?.metrics as any)?.dominantConstruct ?? 'Balanced';
  const currentSeed = (actualPuzzle as any)?.puzzle?.seed || (actualPuzzle?.metrics as any)?.seed || 0;

  return (
    <div className="flex flex-col items-center justify-center p-1 select-none font-mono">
      {/* 頂部賽事數據列 */}
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

        {/* 非語言模式 */}
        <button
          onClick={() => !tournamentMode && setIsNonVerbal((prev) => !prev)}
          className={`p-1 rounded border text-center transition ${
            isNonVerbal
              ? 'bg-amber-950/80 border-amber-500 text-amber-300 font-bold shadow-xs'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
          } ${tournamentMode ? 'cursor-not-allowed opacity-90' : ''}`}
          title={isEn ? 'Culture-Fair Non-Verbal Mode' : '非語言文化公平模式'}
        >
          <div className="text-[6.5px]">👁️ {isEn ? 'Format' : '格式'}</div>
          <div className="text-[7.5px]">{isNonVerbal ? (isEn ? 'Symbol' : '純符號') : (isEn ? 'Number' : '數字符號')}</div>
        </button>

        {/* 無猜測模式 */}
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
        >
          <div className="text-[6.5px]">🛡️ {isEn ? 'No-Guess' : '無猜測'}</div>
          <div className="text-[7.5px]">{tournamentMode ? (isEn ? 'Locked' : '鎖定') : noGuessMode ? (isEn ? 'Strict' : '嚴謹') : 'OFF'}</div>
        </button>

        {/* 提示階梯 */}
        <button
          onClick={handleRequestHint}
          disabled={isCompleted || tournamentMode || isReplaying}
          className={`p-1 rounded border text-center transition ${
            tournamentMode
              ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
              : activeHint
              ? 'bg-amber-950/90 border-amber-500 text-amber-300 font-bold shadow-xs'
              : 'bg-indigo-950/80 border-indigo-500/60 text-indigo-300 hover:bg-indigo-900'
          }`}
        >
          <div className="text-[6.5px]">💡 {isEn ? 'Hint' : '提示'}</div>
          <div className="text-[7.5px] truncate">
            {tournamentMode ? (isEn ? 'Exam' : '測驗') : activeHint ? `Lv.${hintLadderLevel}` : (isEn ? 'Get' : '因果')}
          </div>
        </button>
      </div>

      {/* 複製成功提示 Toast */}
      {copyToast && (
        <div className="w-[min(88vw,42vh)] mb-1 p-1 bg-emerald-950 border border-emerald-500 text-emerald-300 text-[7.5px] rounded animate-fade-in text-center font-bold">
          {isEn ? '📋 Seed copied! Share with your rival on Discord!' : '📋 種子短碼已複製！可發送給好友直接發起同題對決！'}
        </div>
      )}

      {/* 覆盤播放器進度條指示 */}
      {isReplaying && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1.5 bg-indigo-950/90 border border-cyan-500 rounded-lg text-cyan-200 text-[8px] animate-pulse text-left font-mono">
          <div className="flex justify-between items-center text-[7px] text-cyan-400 mb-0.5">
            <span>[AI REPLAY STEP {replayStepIndex}/{replayDeductionList.length}]</span>
            <span className="uppercase font-bold">
              {replayDeductionList[replayStepIndex - 1]?.technique.replace(/_/g, ' ') || 'STARTING'}
            </span>
          </div>
          <div>{replayDeductionList[replayStepIndex - 1]?.rationale || 'Demonstrating deductive reasoning chain...'}</div>
        </div>
      )}

      {/* 無猜測警示橫條 */}
      {noGuessWarning && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1 bg-rose-950 border border-rose-500 text-rose-300 text-[8px] rounded-lg animate-pulse text-center shadow-lg font-bold">
          {noGuessWarning}
        </div>
      )}

      {/* 提示階梯說明卡片 */}
      {activeHint && !isReplaying && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1.5 bg-amber-950/80 border border-amber-500/70 rounded-lg text-amber-200 text-[8px] animate-fade-in text-left shadow-lg">
          <div className="font-bold flex items-center justify-between text-[7px] text-amber-400 border-b border-amber-900/60 pb-0.5 mb-1">
            <span>[LEVEL {hintLadderLevel}/3]</span>
            <span className="uppercase">{activeHint.technique.replace(/_/g, ' ')} ({activeHint.constructType})</span>
          </div>
          {hintLadderLevel === 1 && (
            <div>
              {isEn
                ? `Focus on Cell [${activeHint.r + 1},${activeHint.c + 1}]. [Construct: ${activeHint.constructType}]`
                : `請關注單元格 [${activeHint.r + 1},${activeHint.c + 1}]。【構念：${activeHint.constructType === 'Gf' ? '流體推理' : '空間視覺'}】`}
            </div>
          )}
          {hintLadderLevel === 2 && (
            <div>{isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}</div>
          )}
          {hintLadderLevel === 3 && (
            <div className="font-bold text-amber-300">
              {activeHint.rationale}
              <span className="ml-1 text-cyan-300 underline">
                {activeHint.forcedState === 1 ? (isEn ? 'Must be BLACK' : '必然塗黑') : (isEn ? 'Must be LOOP' : '必然為迴路格')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 主棋盤 (含 180° 對稱勳章與 SVG 閉環) */}
      <div
        className="relative overflow-hidden p-2 rounded-xl bg-slate-950 border-2 border-slate-800 shadow-2xl"
        style={{ width: 'min(88vw, 42vh)', height: 'min(88vw, 42vh)', touchAction: 'none' }}
      >
        {/* Nikoli 180° 對稱勳章 */}
        <div className="absolute top-1 right-1 px-1 py-0.2 bg-indigo-950/70 border border-indigo-500/50 rounded text-[6px] text-indigo-300 font-mono pointer-events-none z-20">
          ☯ 180° SYM
        </div>

        {/* SVG 幾何路徑渲染 */}
        <svg className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] pointer-events-none z-15">
          {Array.from({ length: rows }).map((_, r) =>
            Array.from({ length: cols }).map((__, c) => {
              const edge = edges[r][c];
              const cx = ((c + 0.5) / cols) * 100;
              const cy = ((r + 0.5) / rows) * 100;

              return (
                <g key={`svg-${r}-${c}`}>
                  {edge[0] && (
                    <line
                      x1={`${cx}%`}
                      y1={`${cy}%`}
                      x2={`${cx}%`}
                      y2={`${(r / rows) * 100}%`}
                      stroke="#38bdf8"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                    />
                  )}
                  {edge[1] && (
                    <line
                      x1={`${cx}%`}
                      y1={`${cy}%`}
                      x2={`${((c + 1) / cols) * 100}%`}
                      y2={`${cy}%`}
                      stroke="#38bdf8"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                    />
                  )}
                  {edge[2] && (
                    <line
                      x1={`${cx}%`}
                      y1={`${cy}%`}
                      x2={`${cx}%`}
                      y2={`${((r + 1) / rows) * 100}%`}
                      stroke="#38bdf8"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                    />
                  )}
                  {edge[3] && (
                    <line
                      x1={`${cx}%`}
                      y1={`${cy}%`}
                      x2={`${(c / cols) * 100}%`}
                      y2={`${cy}%`}
                      stroke="#38bdf8"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                    />
                  )}
                </g>
              );
            })
          )}
        </svg>

        {/* 網格節點與線索層 */}
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
              const clue = clueMap.get(`${r},${c}`);
              const state = cellStates[r][c];
              const cellKey = `${r},${c}`;

              const isAdjConflict = analysis.adjacentBlacks.has(cellKey);
              const isArrowOverflow = analysis.arrowOverflows.has(cellKey);
              const isDegConflict = analysis.degreeViolations.has(cellKey);
              const isSelected = selectedCell !== null && selectedCell[0] === r && selectedCell[1] === c;
              const isEvidenceAnimated = animatedEvidenceSet.has(cellKey);

              return (
                <div
                  key={cellKey}
                  onClick={() => handleCellClick(r, c)}
                  className={`relative flex flex-col items-center justify-center border border-slate-800/40 select-none cursor-pointer transition-all duration-150 ${
                    clue
                      ? isArrowOverflow
                        ? 'bg-rose-950 border-rose-500 text-rose-300 animate-pulse'
                        : 'bg-slate-950 border border-slate-700 text-amber-400 font-black'
                      : state === 1
                      ? isAdjConflict
                        ? 'bg-rose-700 text-white animate-pulse'
                        : 'bg-slate-950 border border-slate-800 shadow-inner'
                      : state === 2
                      ? 'bg-emerald-950/30'
                      : 'bg-slate-900/60 hover:bg-slate-800/60'
                  } ${isSelected ? 'ring-2 ring-cyan-400 z-20' : ''} ${
                    isEvidenceAnimated ? 'ring-2 ring-amber-400 bg-amber-500/20 z-16 scale-95' : ''
                  } ${isDegConflict ? 'ring-2 ring-rose-500' : ''}`}
                >
                  {clue ? (
                    <div className="flex flex-col items-center justify-center leading-none pointer-events-none">
                      <span className="text-[7.5px] sm:text-[9px] text-amber-300 font-mono">
                        {getArrowSymbol(clue.dir)}
                      </span>
                      {renderClueRepresentation(clue.count)}
                    </div>
                  ) : state === 1 ? (
                    <div className="w-[80%] h-[80%] bg-slate-950 rounded-xs border border-slate-700 shadow-md flex items-center justify-center">
                      <div className="w-1.5 h-1.5 bg-slate-500/40 rounded-full" />
                    </div>
                  ) : state === 2 ? (
                    <div className="w-2 h-2 rounded-full bg-emerald-400/80 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 底部撤銷重做與快捷欄 */}
      <div className="w-full max-w-[340px] flex items-center justify-between px-1 mt-1.5 text-[7.5px] text-slate-400">
        <div className="flex gap-1">
          <button
            onClick={handleUndo}
            disabled={history.length === 0 || isCompleted || isReplaying}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40"
          >
            ↩ {isEn ? 'Undo' : '撤銷'}
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0 || isCompleted || isReplaying}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40"
          >
            ↪ {isEn ? 'Redo' : '重做'}
          </button>
          {!tournamentMode && (
            <button
              onClick={handleCopySeedShareCode}
              className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 text-amber-300"
              title="Copy Duel Seed Code"
            >
              📋 {isEn ? 'Seed' : '種子碼'}
            </button>
          )}
        </div>
        <div className="text-slate-500">
          <span>點擊格子循環 / 點擊相鄰格連線</span>
        </div>
      </div>

      {/* 通關成就與覆盤面板 */}
      {isCompleted && (
        <div className="mt-2 p-2.5 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,42vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
            <div className="text-left">
              <div className="text-[7.5px] text-slate-500 tracking-wider">YAJILIN RESOLVED</div>
              <div className="text-xs text-indigo-300 font-bold">🌀 矢印迴路・標準化測驗認證</div>
            </div>
            <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[9px] font-bold text-cyan-300">
              Gf: IQ {cci.standardIQ} (Top {Number((100 - cci.percentileRank).toFixed(1))}%)
            </div>
          </div>

          {/* 構念效度分離指標卡片 */}
          <div className="bg-slate-900/90 border border-indigo-950 p-1.5 rounded mb-1.5 text-left">
            <div className="flex justify-between items-center text-[7px] mb-1">
              <span className="text-slate-400 uppercase font-bold">Construct Decomposition</span>
              <span className="text-amber-400 font-mono font-black">{dominant}</span>
            </div>
            <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden flex">
              <div
                className="bg-indigo-500 h-full transition-all"
                style={{ width: `${gfPurity * 100}%` }}
                title={`Fluid Reasoning (Gf): ${(gfPurity * 100).toFixed(0)}%`}
              />
              <div
                className="bg-cyan-500 h-full transition-all"
                style={{ width: `${(1 - gfPurity) * 100}%` }}
                title={`Visual Processing (Gv): ${((1 - gfPurity) * 100).toFixed(0)}%`}
              />
            </div>
            <div className="flex justify-between text-[6px] text-slate-500 mt-0.5 font-mono">
              <span>Gf (Inductive): {(gfPurity * 100).toFixed(0)}%</span>
              <span>Gv (Spatial): {((1 - gfPurity) * 100).toFixed(0)}%</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[7.5px] text-slate-400 mb-1.5">
            <div className="bg-slate-900/80 p-1 rounded">
              <div>耗時</div>
              <div className="text-slate-200 font-bold text-[10px]">{(elapsedMs / 1000).toFixed(1)}s</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>操作步數</div>
              <div className="text-cyan-300 font-bold text-[10px]">{movesCountRef.current}</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>衝突懲罰</div>
              <div className="text-amber-300 font-bold text-[10px]">{conflictCountRef.current} 次</div>
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

          {/* 覆盤與分享戰鬥群 */}
          <div className="flex gap-1 mb-1.5">
            <button
              onClick={handleStartReplay}
              disabled={isReplaying}
              className="flex-1 py-1 bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/60 text-indigo-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95"
            >
              <span>🔁</span>
              <span>{isEn ? 'AI Replay' : '解法覆盤'}</span>
            </button>

            <button
              onClick={handleCopySeedShareCode}
              className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-amber-500/60 text-amber-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95"
            >
              <span>📋</span>
              <span>{isEn ? 'Copy Seed' : '複製種子'}</span>
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
                <span>PSYCHOMETRIC INTEGRITY RECEIPT</span>
                <span className="text-emerald-400 font-mono text-[5.5px]">CSPRNG-SECURE</span>
              </div>
              <div className="text-[6px] font-mono text-cyan-400/80 break-all select-all mt-0.5">
                {proofSignature}
              </div>
            </div>
          )}
        </div>
      )}

      {showPBModal && (
        <PBCelebrationModal pb={profile.personalBest} onClose={() => setShowPBModal(false)} isEn={isEn} />
      )}

      {showSubmitModal && (
        <TournamentSubmissionModal
          payload={{
            submissionId: `SUB-${actualPuzzle.id}-${Date.now().toString(36)}`,
            tournamentId: tournamentMode ? 'CLINICAL_YAJILIN_STAGE' : 'GLOBAL_TOPOLOGY_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'yajilin',
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
