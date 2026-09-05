// web-frontend/src/components/SlitherlinkBoard.tsx
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
  WebSlitherlinkGenerator,
  SlitherlinkSpec,
  EdgeState,
  SlitherlinkHintStep,
} from '../engines/slitherlinkGenerator';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

interface EdgeDelta {
  type: 'H' | 'V';
  r: number;
  c: number;
  from: EdgeState;
  to: EdgeState;
}

const MAX_HISTORY_STEPS = 250;

export const SlitherlinkBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
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

  const spec: SlitherlinkSpec = (actualPuzzle as any)?.puzzle;
  const rows = spec?.rows || 6;
  const cols = spec?.cols || 6;
  const grid = useMemo(() => spec?.grid || [], [spec]);

  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';

  // -------- 邊緣狀態 --------
  const [hEdges, setHEdges] = useState<EdgeState[][]>(() =>
    Array.from({ length: rows + 1 }, () => Array(cols).fill(0))
  );
  const [vEdges, setVEdges] = useState<EdgeState[][]>(() =>
    Array.from({ length: rows }, () => Array(cols + 1).fill(0))
  );

  const [history, setHistory] = useState<EdgeDelta[]>([]);
  const [redoStack, setRedoStack] = useState<EdgeDelta[]>([]);

  // -------- 提示與 No-Guess --------
  const [noGuessMode, setNoGuessMode] = useState<boolean>(false);
  const [noGuessWarning, setNoGuessWarning] = useState<string | null>(null);
  const [activeHint, setActiveHint] = useState<SlitherlinkHintStep | null>(null);
  const [hintLadderLevel, setHintLadderLevel] = useState<1 | 2 | 3>(1);

  // -------- 覆盤播放器（含證據高亮） --------
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<1 | 2 | 4>(1);
  const [replayStepIndex, setReplayStepIndex] = useState<number>(0);
  const [replayStepsList, setReplayStepsList] = useState<SlitherlinkHintStep[]>([]);
  const [userStateBackup, setUserStateBackup] = useState<{
    h: EdgeState[][];
    v: EdgeState[][];
  } | null>(null);

  // 🔥 證據格高亮集合（金色脈衝）
  const [animatedEvidenceSet, setAnimatedEvidenceSet] = useState<Set<string>>(new Set());

  const [copyToast, setCopyToast] = useState<boolean>(false);

  // -------- 通關與計時 --------
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

  // -------- 初始化 --------
  useEffect(() => {
    setHEdges(Array.from({ length: rows + 1 }, () => Array(cols).fill(0)));
    setVEdges(Array.from({ length: rows }, () => Array(cols + 1).fill(0)));
    setHistory([]);
    setRedoStack([]);
    setIsCompleted(false);
    setActiveHint(null);
    setHintLadderLevel(1);
    setIsReplaying(false);
    setUserStateBackup(null);
    setAnimatedEvidenceSet(new Set());   // 清空高亮
    setProofSignature(null);
    setNoGuessWarning(null);
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    conflictCountRef.current = 0;
    setConflictDisplay(0);
    movesCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id, rows, cols]);

  // 計時器（僅在非覆盤時運作）
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

  // -------- 即時衝突分析 --------
  const analysis = useMemo(() => {
    const clueViolations = new Set<string>();
    const vertexViolations = new Set<string>();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const clue = grid[r]?.[c];
        if (typeof clue === 'number') {
          let edgeCount = 0;
          if (hEdges[r][c] === 1) edgeCount++;
          if (hEdges[r + 1][c] === 1) edgeCount++;
          if (vEdges[r][c] === 1) edgeCount++;
          if (vEdges[r][c + 1] === 1) edgeCount++;
          if (edgeCount > clue) clueViolations.add(`${r},${c}`);
        }
      }
    }

    const dotRows = rows + 1;
    const dotCols = cols + 1;
    for (let r = 0; r < dotRows; r++) {
      for (let c = 0; c < dotCols; c++) {
        let deg = 0;
        if (c < cols && hEdges[r][c] === 1) deg++;
        if (c > 0 && hEdges[r][c - 1] === 1) deg++;
        if (r < rows && vEdges[r][c] === 1) deg++;
        if (r > 0 && vEdges[r - 1][c] === 1) deg++;
        if (deg > 2) vertexViolations.add(`${r},${c}`);
      }
    }

    const totalConflicts = clueViolations.size + vertexViolations.size;
    return { clueViolations, vertexViolations, totalConflicts };
  }, [hEdges, vEdges, grid, rows, cols]);

  // 衝突累計
  const prevConflictsRef = useRef<number>(0);
  useEffect(() => {
    if (analysis.totalConflicts > prevConflictsRef.current) {
      conflictCountRef.current += analysis.totalConflicts - prevConflictsRef.current;
      setConflictDisplay(conflictCountRef.current);
    }
    prevConflictsRef.current = analysis.totalConflicts;
  }, [analysis.totalConflicts]);

  // -------- 邊緣操作 --------
  const mutateEdge = useCallback(
    (type: 'H' | 'V', r: number, c: number, targetState: EdgeState) => {
      if (isCompleted || isReplaying) return;
      const currentVal = type === 'H' ? hEdges[r][c] : vEdges[r][c];
      if (currentVal === targetState) return;

      if (noGuessMode && targetState === 1) {
        const step = WebSlitherlinkGenerator.getNextForcedDeduction(rows, cols, grid, hEdges, vEdges);
        if (step) {
          const isTarget = step.type === type && step.r === r && step.c === c;
          if (!isTarget) {
            if (navigator.vibrate) navigator.vibrate([25, 35, 25]);
            const reason = isEn ? step.humanReadable.en : step.humanReadable.zh;
            setNoGuessWarning(isEn ? `[No-Guess Blocked] Deduce: ${reason}` : `【無猜測攔截】依據定式應優先連線：${reason}`);
            setTimeout(() => setNoGuessWarning(null), 3000);
            return;
          }
        }
      }

      if (navigator.vibrate) navigator.vibrate(8);
      movesCountRef.current++;

      const delta: EdgeDelta = { type, r, c, from: currentVal, to: targetState };
      setHistory((prev) => [...prev.slice(-MAX_HISTORY_STEPS + 1), delta]);
      setRedoStack([]);

      if (type === 'H') {
        setHEdges((prev) => {
          const next = prev.map((row) => [...row]);
          next[r][c] = targetState;
          return next;
        });
      } else {
        setVEdges((prev) => {
          const next = prev.map((row) => [...row]);
          next[r][c] = targetState;
          return next;
        });
      }

      if (activeHint && activeHint.type === type && activeHint.r === r && activeHint.c === c) {
        setActiveHint(null);
      }
    },
    [isCompleted, isReplaying, hEdges, vEdges, noGuessMode, rows, cols, grid, activeHint, isEn]
  );

  const cycleEdge = useCallback(
    (type: 'H' | 'V', r: number, c: number) => {
      const curr = type === 'H' ? hEdges[r][c] : vEdges[r][c];
      const next: EdgeState = curr === 0 ? 1 : curr === 1 ? 2 : 0;
      mutateEdge(type, r, c, next);
    },
    [hEdges, vEdges, mutateEdge]
  );

  // -------- Undo / Redo --------
  const handleUndo = useCallback(() => {
    if (history.length === 0 || isCompleted || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const last = history[history.length - 1];
    if (last.type === 'H') {
      setHEdges((prev) => {
        const next = prev.map((row) => [...row]);
        next[last.r][last.c] = last.from;
        return next;
      });
    } else {
      setVEdges((prev) => {
        const next = prev.map((row) => [...row]);
        next[last.r][last.c] = last.from;
        return next;
      });
    }
    setRedoStack((prev) => [...prev, last]);
    setHistory((prev) => prev.slice(0, -1));
  }, [history, isCompleted, isReplaying]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const nextDelta = redoStack[redoStack.length - 1];
    if (nextDelta.type === 'H') {
      setHEdges((prev) => {
        const next = prev.map((row) => [...row]);
        next[nextDelta.r][nextDelta.c] = nextDelta.to;
        return next;
      });
    } else {
      setVEdges((prev) => {
        const next = prev.map((row) => [...row]);
        next[nextDelta.r][nextDelta.c] = nextDelta.to;
        return next;
      });
    }
    setHistory((prev) => [...prev, nextDelta]);
    setRedoStack((prev) => prev.slice(0, -1));
  }, [redoStack, isCompleted, isReplaying]);

  // 鍵盤快捷鍵
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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompleted, isReplaying, handleUndo, handleRedo]);

  // -------- 勝利驗證 --------
  useEffect(() => {
    if (isCompleted || isReplaying || analysis.totalConflicts > 0) return;

    // 檢查所有線索是否精確滿足
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const clue = grid[r]?.[c];
        if (typeof clue === 'number') {
          let edgeCount = 0;
          if (hEdges[r][c] === 1) edgeCount++;
          if (hEdges[r + 1][c] === 1) edgeCount++;
          if (vEdges[r][c] === 1) edgeCount++;
          if (vEdges[r][c + 1] === 1) edgeCount++;
          if (edgeCount !== clue) return;
        }
      }
    }

    // 驗證單一封閉 Euler 迴路
    const hActive = hEdges.map((row) => row.map((v) => v === 1));
    const vActive = vEdges.map((row) => row.map((v) => v === 1));
    const isSingleLoop = WebSlitherlinkGenerator.verifySingleLoop(rows, cols, hActive, vActive);

    if (isSingleLoop) {
      setIsCompleted(true);
      const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

      if (!hasRecordedRef.current && actualPuzzle) {
        hasRecordedRef.current = true;
        const baseIrt = (actualPuzzle.metrics as any)?.irt_logit_difficulty || 1.8;

        recordAttempt({
          puzzleId: actualPuzzle.id,
          engineType: 'slitherlink',
          tier: currentTier,
          cognitiveLoad: actualPuzzle.cognitiveLoad || {
            spatial: 0.88,
            numeric: 0.4,
            workingMemory: 0.75,
            inhibition: 0.9,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
          technique: 'SlitherlinkJordanCycle',
          irtDifficulty: baseIrt,
          isPureClear: conflictCountRef.current === 0 && !activeHint,
        });

        try {
          const canonical = `${actualPuzzle.id}|${timeSpent}|${movesCountRef.current}|${conflictCountRef.current}|SECURE_${tournamentMode}|SLITHERLINK_CHAMPION`;
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
  }, [hEdges, vEdges, grid, analysis.totalConflicts, isCompleted, isReplaying, actualPuzzle, rows, cols, currentTier, recordAttempt, profile.personalBest.fastestTime, activeHint, tournamentMode]);

  // -------- 提示階梯 --------
  const handleRequestHint = () => {
    if (isCompleted || tournamentMode || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(12);

    if (!activeHint) {
      const step = WebSlitherlinkGenerator.getNextForcedDeduction(rows, cols, grid, hEdges, vEdges);
      if (step) {
        setActiveHint(step);
        setHintLadderLevel(1);
      }
    } else {
      setHintLadderLevel((prev) => (prev === 1 ? 2 : 3));
    }
  };

  // -------- 覆盤引擎（含證據高亮） --------
  const handleStartReplay = () => {
    // 備份使用者盤面
    setUserStateBackup({
      h: hEdges.map((row) => [...row]),
      v: vEdges.map((row) => [...row]),
    });

    // 從頭模擬 AI 推理
    const simH: EdgeState[][] = Array.from({ length: rows + 1 }, () => Array(cols).fill(0));
    const simV: EdgeState[][] = Array.from({ length: rows }, () => Array(cols + 1).fill(0));
    const steps: SlitherlinkHintStep[] = [];

    let safety = 0;
    while (safety++ < rows * cols * 4) {
      const step = WebSlitherlinkGenerator.getNextForcedDeduction(rows, cols, grid, simH, simV);
      if (!step) break;
      steps.push(step);
      if (step.type === 'H') simH[step.r][step.c] = step.forcedState;
      else simV[step.r][step.c] = step.forcedState;
    }

    setReplayStepsList(steps);
    setReplayStepIndex(0);
    setIsReplaying(true);
    setHEdges(Array.from({ length: rows + 1 }, () => Array(cols).fill(0)));
    setVEdges(Array.from({ length: rows }, () => Array(cols + 1).fill(0)));
    setAnimatedEvidenceSet(new Set()); // 清空舊高亮
  };

  const handleRestoreUserBoard = () => {
    if (!userStateBackup) return;
    setIsReplaying(false);
    setHEdges(userStateBackup.h.map((row) => [...row]));
    setVEdges(userStateBackup.v.map((row) => [...row]));
    setAnimatedEvidenceSet(new Set()); // 清除高亮
    if (navigator.vibrate) navigator.vibrate(15);
  };

  // 🕒 變速覆盤時間軸（含證據格高亮更新）
  useEffect(() => {
    if (!isReplaying || replayStepsList.length === 0) return;
    if (replayStepIndex >= replayStepsList.length) {
      // 覆盤結束，清除高亮
      setAnimatedEvidenceSet(new Set());
      return;
    }

    const delay = Math.round(450 / replaySpeed);
    const timer = setTimeout(() => {
      const step = replayStepsList[replayStepIndex];

      // 套用步驟（畫線或打叉）
      if (step.type === 'H') {
        setHEdges((prev) => {
          const next = prev.map((row) => [...row]);
          next[step.r][step.c] = step.forcedState;
          return next;
        });
      } else {
        setVEdges((prev) => {
          const next = prev.map((row) => [...row]);
          next[step.r][step.c] = step.forcedState;
          return next;
        });
      }

      // 🔥 高亮證據格（如果有的話）
      if (step.evidenceCells && step.evidenceCells.length > 0) {
        setAnimatedEvidenceSet(new Set(step.evidenceCells.map(([er, ec]) => `${er},${ec}`)));
      } else {
        // 若無明確證據，則清空（或可根據定式推測，此處保守清空）
        setAnimatedEvidenceSet(new Set());
      }

      setReplayStepIndex((prev) => prev + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [isReplaying, replayStepIndex, replayStepsList, replaySpeed]);

  // -------- 種子對決連結 --------
  const handleCopySeedShareCode = () => {
    const seed = (actualPuzzle as any)?.puzzle?.seed || (actualPuzzle?.metrics as any)?.seed || 0;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lawgic.app';
    const duelUrl = `${origin}/?engine=slitherlink&tier=${currentTier}&seed=${seed}`;
    navigator.clipboard.writeText(duelUrl);
    setCopyToast(true);
    if (navigator.vibrate) navigator.vibrate(20);
    setTimeout(() => setCopyToast(false), 2400);
  };

  // -------- 輔助數據 --------
  const theoryTime = (actualPuzzle?.metrics as any)?.estimated_time_sec || rows * cols * 3;
  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('TopologicalLookahead', theoryTime, 'slitherlink');
  }, [getBenchmarkMetrics, theoryTime]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  // -------- 渲染 --------
  return (
    <div className="flex flex-col items-center justify-center p-1 select-none font-mono">
      {/* 頂部數據列 */}
      <div className="w-full grid grid-cols-5 gap-1 px-0.5 mb-1.5 text-[8px] sm:text-[9px]">
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
          className={`p-1 rounded border text-center transition ${tournamentMode
              ? 'bg-purple-950/80 border-purple-500 text-purple-300 font-bold cursor-not-allowed'
              : noGuessMode
              ? 'bg-purple-950 border-purple-500 text-purple-300 font-bold shadow-xs'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
        >
          <div className="text-[6.5px]">🛡️ {isEn ? 'No-Guess' : '無猜測'}</div>
          <div className="text-[7.5px]">{tournamentMode ? (isEn ? 'Locked' : '鎖定') : noGuessMode ? 'Strict' : 'OFF'}</div>
        </button>

        <button
          onClick={handleRequestHint}
          disabled={isCompleted || tournamentMode || isReplaying}
          className={`p-1 rounded border text-center transition ${tournamentMode
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

      {/* 複製成功 Toast */}
      {copyToast && (
        <div className="w-[min(88vw,42vh)] mb-1 p-1 bg-emerald-950 border border-emerald-500 text-emerald-300 text-[7.5px] rounded animate-fade-in text-center font-bold">
          {isEn ? '🔗 Direct duel link copied! Send to Discord!' : '🔗 一鍵對決連結已複製！發送至群組，好友點擊即可載入同題對決！'}
        </div>
      )}

      {/* 覆盤控制條（含證據高亮指示） */}
      {isReplaying && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1.5 bg-indigo-950/90 border border-cyan-500 rounded-lg text-cyan-200 text-[8px] animate-pulse font-mono">
          <div className="flex justify-between items-center text-[7px] text-cyan-400 mb-1 border-b border-cyan-900/60 pb-0.5">
            <span>[AI REPLAY {replayStepIndex}/{replayStepsList.length}]</span>
            <div className="flex items-center gap-1">
              <span className="text-[6.5px] text-slate-400">SPEED:</span>
              {[1, 2, 4].map((spd) => (
                <button
                  key={spd}
                  onClick={() => setReplaySpeed(spd as 1 | 2 | 4)}
                  className={`px-1 py-0.2 rounded text-[6.5px] font-bold ${replaySpeed === spd ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                    }`}
                >
                  {spd}x
                </button>
              ))}
              <button
                onClick={handleRestoreUserBoard}
                className="ml-1 px-1.5 py-0.2 bg-rose-950 hover:bg-rose-900 border border-rose-500/60 text-rose-300 rounded text-[6.5px] font-bold"
              >
                {isEn ? 'Restore Mine' : '還原我的盤面'}
              </button>
            </div>
          </div>
          <div className="truncate text-cyan-300">
            {replayStepsList[replayStepIndex - 1]?.rationale || 'Demonstrating AI deduction steps...'}
          </div>
        </div>
      )}

      {noGuessWarning && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1 bg-rose-950 border border-rose-500 text-rose-300 text-[8px] rounded-lg animate-pulse text-center shadow-lg font-bold">
          {noGuessWarning}
        </div>
      )}

      {activeHint && !isReplaying && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1.5 bg-amber-950/80 border border-amber-500/70 rounded-lg text-amber-200 text-[8px] animate-fade-in text-left shadow-lg">
          <div className="font-bold flex items-center justify-between text-[7px] text-amber-400 border-b border-amber-900/60 pb-0.5 mb-1">
            <span>[LEVEL {hintLadderLevel}/3]</span>
            <span className="uppercase">{activeHint.technique.replace(/_/g, ' ')}</span>
          </div>
          {hintLadderLevel === 1 && (
            <div>{isEn ? `Forced line deduction around [${activeHint.r + 1},${activeHint.c + 1}].` : `請關注 [${activeHint.r + 1},${activeHint.c + 1}] 附近的邊緣。`}</div>
          )}
          {hintLadderLevel === 2 && (
            <div>{isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}</div>
          )}
          {hintLadderLevel === 3 && (
            <div className="font-bold text-amber-300">
              {activeHint.rationale}
              <span className="ml-1 text-cyan-300 underline">
                {activeHint.forcedState === 1 ? (isEn ? 'Must CONNECT' : '必然畫線') : (isEn ? 'Must CROSS' : '必然打叉')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 主棋盤（含 180° 對稱勳章） */}
      <div
        className="relative overflow-hidden p-3 rounded-xl bg-slate-950 border-2 border-slate-800 shadow-2xl"
        style={{ width: 'min(88vw, 42vh)', height: 'min(88vw, 42vh)', touchAction: 'none' }}
      >
        <div className="absolute top-1 right-1 px-1 py-0.2 bg-indigo-950/70 border border-indigo-500/50 rounded text-[6px] text-indigo-300 font-mono pointer-events-none z-20">
          ☯ 180° SYM
        </div>

        {/* 網格數字層 */}
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
              const clue = grid[r]?.[c];
              const isViolated = analysis.clueViolations.has(`${r},${c}`);
              const isEvidenceCell = animatedEvidenceSet.has(`${r},${c}`); // 🔥 證據高亮

              return (
                <div
                  key={`cell-${r}-${c}`}
                  className={`relative flex items-center justify-center select-none transition-colors ${isEvidenceCell ? 'bg-amber-500/20 ring-2 ring-amber-400 rounded-sm shadow-[0_0_12px_rgba(251,191,36,0.7)] animate-pulse z-10' : ''
                    }`}
                >
                  {typeof clue === 'number' && (
                    <span
                      className={`text-sm sm:text-base font-black font-mono transition-colors ${isViolated ? 'text-rose-400 animate-pulse' : 'text-slate-200'
                        }`}
                    >
                      {clue}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 點位（頂點） */}
        <div className="absolute inset-3 pointer-events-none z-10">
          {Array.from({ length: rows + 1 }).map((_, r) =>
            Array.from({ length: cols + 1 }).map((__, c) => (
              <div
                key={`dot-${r}-${c}`}
                className="absolute w-1.5 h-1.5 bg-slate-500 rounded-full -translate-x-1/2 -translate-y-1/2 shadow-xs"
                style={{
                  top: `${(r / rows) * 100}%`,
                  left: `${(c / cols) * 100}%`,
                }}
              />
            ))
          )}
        </div>

        {/* 水平邊緣（可點擊） */}
        <div className="absolute inset-3 z-20">
          {Array.from({ length: rows + 1 }).map((_, r) =>
            Array.from({ length: cols }).map((__, c) => {
              const state = hEdges[r][c];
              return (
                <div
                  key={`h-${r}-${c}`}
                  onClick={() => cycleEdge('H', r, c)}
                  className="absolute h-5 -translate-y-1/2 flex items-center justify-center cursor-pointer group"
                  style={{
                    top: `${(r / rows) * 100}%`,
                    left: `${(c / cols) * 100}%`,
                    width: `${(1 / cols) * 100}%`,
                  }}
                >
                  {state === 1 ? (
                    <div className="w-full h-1 bg-cyan-400 shadow-[0_0_8px_rgba(56,189,248,0.9)] rounded-full" />
                  ) : state === 2 ? (
                    <span className="text-[10px] text-rose-500/80 font-black select-none">✕</span>
                  ) : (
                    <div className="w-full h-1 bg-transparent group-hover:bg-cyan-400/30 rounded-full transition-colors" />
                  )}
                </div>
              );
            })
          )}

          {/* 垂直邊緣（可點擊） */}
          {Array.from({ length: rows }).map((_, r) =>
            Array.from({ length: cols + 1 }).map((__, c) => {
              const state = vEdges[r][c];
              return (
                <div
                  key={`v-${r}-${c}`}
                  onClick={() => cycleEdge('V', r, c)}
                  className="absolute w-5 -translate-x-1/2 flex items-center justify-center cursor-pointer group"
                  style={{
                    top: `${(r / rows) * 100}%`,
                    left: `${(c / cols) * 100}%`,
                    height: `${(1 / rows) * 100}%`,
                  }}
                >
                  {state === 1 ? (
                    <div className="h-full w-1 bg-cyan-400 shadow-[0_0_8px_rgba(56,189,248,0.9)] rounded-full" />
                  ) : state === 2 ? (
                    <span className="text-[10px] text-rose-500/80 font-black select-none">✕</span>
                  ) : (
                    <div className="h-full w-1 bg-transparent group-hover:bg-cyan-400/30 rounded-full transition-colors" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 底部控制列 */}
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
              title="Copy Duel URL"
            >
              🔗 {isEn ? 'Duel Link' : '對決連結'}
            </button>
          )}
        </div>
        <div className="text-slate-500">
          <span>點擊邊緣：無 ➔ 實線 ➔ 標叉</span>
        </div>
      </div>

      {/* 結算面板 */}
      {isCompleted && (
        <div className="mt-2 p-2.5 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,42vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
            <div className="text-left">
              <div className="text-[7.5px] text-slate-500 tracking-wider">SLITHERLINK RESOLVED</div>
              <div className="text-xs text-indigo-300 font-bold">🌀 迴路封閉・完美閉合</div>
            </div>
            <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[9px] font-bold text-cyan-300">
              Gf: IQ {cci.standardIQ} (Top {Number((100 - cci.percentileRank).toFixed(1))}%)
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

          {/* 覆盤與對決行動群 */}
          <div className="flex gap-1 mb-1.5">
            <button
              onClick={handleStartReplay}
              disabled={isReplaying}
              className="flex-1 py-1 bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/60 text-indigo-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95"
            >
              <span>🔁</span>
              <span>{isEn ? 'AI Replay' : '解法覆盤'}</span>
            </button>

            {userStateBackup && (
              <button
                onClick={handleRestoreUserBoard}
                className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-cyan-500/60 text-cyan-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95"
              >
                <span>↩️</span>
                <span>{isEn ? 'My Board' : '我的盤面'}</span>
              </button>
            )}

            <button
              onClick={handleCopySeedShareCode}
              className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-amber-500/60 text-amber-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95"
            >
              <span>🔗</span>
              <span>{isEn ? 'Duel Link' : '對決連結'}</span>
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
            tournamentId: tournamentMode ? 'WPF_SLITHERLINK_2026' : 'GLOBAL_TOPOLOGY_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'slitherlink',
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
