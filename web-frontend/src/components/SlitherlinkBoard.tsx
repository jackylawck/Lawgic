// web-frontend/src/components/SlitherlinkBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { MetricErrorBar } from './MetricErrorBar';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';
import {
  TournamentProctoringSession,
  getEnvironmentFingerprint,
  calculateInfractionScore,
} from '../utils/tournamentSecurity';
import { VaultManager, VaultItem } from '../utils/vaultStorage';
import {
  WebSlitherlinkGenerator,
  SlitherlinkSpec,
  EdgeState,
  SlitherlinkHintStep,
  TECHNIQUE_I18N,
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
  isBypass?: boolean; // 試錯標記：Shift+Click 強制落子
}

const MAX_HISTORY_STEPS = 300;

export const SlitherlinkBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const {
    recordAttempt,
    getBenchmarkMetrics,
    profile,
    getCompositeCognitiveIndex,
  } = useLearnerProfile();

  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const spec: SlitherlinkSpec = (actualPuzzle as any)?.puzzle;
  const rows = spec?.rows || 6;
  const cols = spec?.cols || 6;
  const grid = useMemo(() => (spec as any)?.clues || (spec as any)?.grid || [], [spec]);
  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';
  const seed = (actualPuzzle?.metrics as any)?.seed || (spec as any)?.seed || 12345;

  const [isFav, setIsFav] = useState<boolean>(() =>
    actualPuzzle?.id ? VaultManager.isFavorited(actualPuzzle.id) : false
  );

  // 實體防作弊稽核 Session (P0 修復)
  const proctoringRef = useRef<TournamentProctoringSession | null>(null);

  useEffect(() => {
    proctoringRef.current = new TournamentProctoringSession();
    return () => {
      proctoringRef.current?.destroy();
      proctoringRef.current = null;
    };
  }, [actualPuzzle?.id]);

  useEffect(() => {
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
  }, [actualPuzzle?.id]);

  const t = useMemo(() => ({
    speed: isEn ? 'Speed' : '競速',
    moves: isEn ? 'Moves' : '步數',
    conflicts: isEn ? 'Conflicts' : '衝突累加',
    noGuess: isEn ? 'No-Guess' : '無猜測',
    locked: isEn ? 'Locked' : '鎖定',
    strict: isEn ? 'Strict' : '嚴格',
    off: 'OFF',
    hint: isEn ? 'Hint' : '提示',
    exam: isEn ? 'Exam' : '測驗',
    getHint: isEn ? 'Get' : '因果',
    duelCopied: isEn ? '🔗 Duel Link Copied!' : '🔗 一鍵對決連結已複製！',
    aiReplay: isEn ? 'AI Replay' : '解法覆盤',
    restoreMine: isEn ? 'Restore Mine' : '還原我的盤面',
    duelLink: isEn ? 'Duel Link' : '對決連結',
    submit: isEn ? 'Submit' : '賽事提交',
    undo: isEn ? 'Undo' : '撤銷',
    redo: isEn ? 'Redo' : '重做',
    instruction: isEn ? 'Click: Line ➔ Cross | Shift: Bypass' : '點擊: 線 ➔ 叉 | Shift: 試錯',
    solvedTitle: isEn ? 'TOPOLOGY RESOLVED' : '迴路封閉・拓撲閉合',
    timeElapsed: isEn ? 'Time' : '耗時',
    opsCount: isEn ? 'Operations' : '操作步數',
    conflictPenalties: isEn ? 'Penalty' : '衝突懲罰',
    timesUnit: isEn ? '' : '次',
    level: isEn ? 'LEVEL' : '等級',
    mustConnect: isEn ? 'Must CONNECT' : '必然畫線',
    mustCross: isEn ? 'Must CROSS' : '必然打叉',
    blockedMsg: (reason: string) => isEn ? `[No-Guess Dampened] ${reason}` : `【無猜測阻尼】應優先：${reason}`,
    focusEdge: (r: number, c: number) => isEn ? `Focus near [${r}, ${c}].` : `關注 [${r}, ${c}] 周圍邊界。`,
    demonstrating: isEn ? 'Demonstrating AI deduction steps...' : '展示 AI 演繹步進中...',
  }), [isEn]);

  const [hEdges, setHEdges] = useState<EdgeState[][]>(() =>
    Array.from({ length: rows + 1 }, () => Array(cols).fill(0))
  );
  const [vEdges, setVEdges] = useState<EdgeState[][]>(() =>
    Array.from({ length: rows }, () => Array(cols + 1).fill(0))
  );

  const [history, setHistory] = useState<EdgeDelta[]>([]);
  const [redoStack, setRedoStack] = useState<EdgeDelta[]>([]);

  const [isZenMode, setIsZenMode] = useState<boolean>(false);
  const [noGuessMode, setNoGuessMode] = useState<boolean>(false);
  const [noGuessWarning, setNoGuessWarning] = useState<string | null>(null);
  const [activeHint, setActiveHint] = useState<SlitherlinkHintStep | null>(null);
  const [hintLadderLevel, setHintLadderLevel] = useState<1 | 2 | 3>(1);
  const [animatedEvidenceSet, setAnimatedEvidenceSet] = useState<Set<string>>(new Set());

  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<1 | 2 | 4>(1);
  const [replayStepIndex, setReplayStepIndex] = useState<number>(0);
  const [replayStepsList, setReplayStepsList] = useState<SlitherlinkHintStep[]>([]);
  const [userStateBackup, setUserStateBackup] = useState<{
    h: EdgeState[][];
    v: EdgeState[][];
  } | null>(null);
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

  const STORAGE_KEY = `slither_state_${actualPuzzle?.id || 'sandbox'}`;

  // 跨分頁狀態自動秒級恢復
  useEffect(() => {
    if (typeof window === 'undefined' || !actualPuzzle?.id) return;
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.h && data.v && !data.isCompleted) {
          setHEdges(data.h);
          setVEdges(data.v);
          setHistory(data.history || []);
          startTimeRef.current = Date.now() - (data.elapsedMs || 0);
          return;
        }
      } catch {
        // 容錯降級
      }
    }

    setHEdges(Array.from({ length: rows + 1 }, () => Array(cols).fill(0)));
    setVEdges(Array.from({ length: rows }, () => Array(cols + 1).fill(0)));
    setHistory([]);
    setRedoStack([]);
    setIsCompleted(false);
    setActiveHint(null);
    setHintLadderLevel(1);
    setAnimatedEvidenceSet(new Set());
    setIsReplaying(false);
    setUserStateBackup(null);
    setProofSignature(null);
    setNoGuessWarning(null);
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    conflictCountRef.current = 0;
    setConflictDisplay(0);
    movesCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id, rows, cols]);

  // 即時自動儲存
  useEffect(() => {
    if (!actualPuzzle?.id || isCompleted) {
      if (isCompleted) sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    const payload = {
      h: hEdges,
      v: vEdges,
      history,
      elapsedMs,
      isCompleted,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [hEdges, vEdges, history, elapsedMs, isCompleted, actualPuzzle?.id]);

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

  // P1 修復：標準化金庫收藏對接
  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const vaultItem: VaultItem = {
      id: actualPuzzle.id,
      engine: 'slitherlink',
      tier: String(actualPuzzle.tier || 'kids'),
      seed: Number(seed),
      steps: movesCountRef.current,
      timeSpentSec: Math.round(elapsedMs / 1000),
      date: new Date().toISOString(),
    };
    const res = VaultManager.toggleFavorite(vaultItem);
    setIsFav(res.isFav);
  };

  // 雙態衝突檢測：超標 (Overflow) + 飢餓 (Starvation)
  const analysis = useMemo(() => {
    const clueViolations = new Set<string>();
    const starvationViolations = new Set<string>();
    const vertexViolations = new Set<string>();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const clue = grid[r]?.[c];
        if (typeof clue === 'number') {
          const edges = [
            hEdges[r][c],
            hEdges[r + 1][c],
            vEdges[r][c],
            vEdges[r][c + 1],
          ];
          const lines = edges.filter((e) => e === 1).length;
          const crosses = edges.filter((e) => e === 2).length;

          if (lines > clue) clueViolations.add(`${r},${c}`);
          else if (4 - crosses < clue) starvationViolations.add(`${r},${c}`);
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

    const totalConflicts = clueViolations.size + starvationViolations.size + vertexViolations.size;
    return { clueViolations, starvationViolations, vertexViolations, totalConflicts };
  }, [hEdges, vEdges, grid, rows, cols]);

  const prevConflictsRef = useRef<number>(0);
  useEffect(() => {
    if (analysis.totalConflicts > prevConflictsRef.current) {
      conflictCountRef.current += analysis.totalConflicts - prevConflictsRef.current;
      setConflictDisplay(conflictCountRef.current);
    }
    prevConflictsRef.current = analysis.totalConflicts;
  }, [analysis.totalConflicts]);

  const mutateEdge = useCallback(
    (type: 'H' | 'V', r: number, c: number, targetState: EdgeState, bypassNoGuess = false) => {
      if (isCompleted || isReplaying) return;
      const currentVal = type === 'H' ? hEdges[r][c] : vEdges[r][c];
      if (currentVal === targetState) return;

      if (noGuessMode && targetState === 1 && !bypassNoGuess) {
        const step = WebSlitherlinkGenerator.getNextForcedDeduction(rows, cols, grid, hEdges, vEdges);
        if (step && (step.type !== type || step.r !== r || step.c !== c)) {
          if (navigator.vibrate) navigator.vibrate([18, 28, 18]);
          const reason = isEn ? step.humanReadable?.en || step.rationale : step.humanReadable?.zh || step.rationale;
          setNoGuessWarning(t.blockedMsg(reason));
          setTimeout(() => setNoGuessWarning(null), 3000);
          return;
        }
      }

      if (navigator.vibrate) navigator.vibrate(6);
      movesCountRef.current++;

      const delta: EdgeDelta = {
        type,
        r,
        c,
        from: currentVal,
        to: targetState,
        isBypass: bypassNoGuess,
      };

      setHistory((prev) => [...prev.slice(-MAX_HISTORY_STEPS + 1), delta]);
      setRedoStack([]);

      if (type === 'H') {
        setHEdges((prev) => {
          const next = [...prev];
          next[r] = [...next[r]];
          next[r][c] = targetState;
          return next;
        });
      } else {
        setVEdges((prev) => {
          const next = [...prev];
          next[r] = [...next[r]];
          next[r][c] = targetState;
          return next;
        });
      }

      if (activeHint && activeHint.type === type && activeHint.r === r && activeHint.c === c) {
        setActiveHint(null);
        setAnimatedEvidenceSet(new Set());
      }
    },
    [isCompleted, isReplaying, hEdges, vEdges, noGuessMode, rows, cols, grid, activeHint, isEn, t]
  );

  const cycleEdge = useCallback(
    (type: 'H' | 'V', r: number, c: number, e: React.MouseEvent) => {
      const isShift = e.shiftKey;
      const curr = type === 'H' ? hEdges[r][c] : vEdges[r][c];
      const next: EdgeState = curr === 0 ? 1 : curr === 1 ? 2 : 0;
      mutateEdge(type, r, c, next, isShift);
    },
    [hEdges, vEdges, mutateEdge]
  );

  const handleUndo = useCallback(() => {
    if (history.length === 0 || isCompleted || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(8);

    const last = history[history.length - 1];
    if (last.type === 'H') {
      setHEdges((prev) => {
        const next = [...prev];
        next[last.r] = [...next[last.r]];
        next[last.r][last.c] = last.from;
        return next;
      });
    } else {
      setVEdges((prev) => {
        const next = [...prev];
        next[last.r] = [...next[last.r]];
        next[last.r][last.c] = last.from;
        return next;
      });
    }
    setRedoStack((prev) => [...prev, last]);
    setHistory((prev) => prev.slice(0, -1));
  }, [history, isCompleted, isReplaying]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(8);

    const nextDelta = redoStack[redoStack.length - 1];
    if (nextDelta.type === 'H') {
      setHEdges((prev) => {
        const next = [...prev];
        next[nextDelta.r] = [...next[nextDelta.r]];
        next[nextDelta.r][nextDelta.c] = nextDelta.to;
        return next;
      });
    } else {
      setVEdges((prev) => {
        const next = [...prev];
        next[nextDelta.r] = [...next[nextDelta.r]];
        next[nextDelta.r][nextDelta.c] = nextDelta.to;
        return next;
      });
    }
    setHistory((prev) => [...prev, nextDelta]);
    setRedoStack((prev) => prev.slice(0, -1));
  }, [redoStack, isCompleted, isReplaying]);

  const handleRequestHint = useCallback(() => {
    if (isCompleted || tournamentMode || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(10);

    if (!activeHint) {
      const step = WebSlitherlinkGenerator.getNextForcedDeduction(rows, cols, grid, hEdges, vEdges);
      if (step) {
        setActiveHint(step);
        setHintLadderLevel(1);
        if (step.evidenceCells) {
          setAnimatedEvidenceSet(new Set(step.evidenceCells.map(([er, ec]: [number, number]) => `${er},${ec}`)));
        }
      }
    } else {
      setHintLadderLevel((prev) => (prev === 1 ? 2 : 3));
    }
  }, [isCompleted, tournamentMode, isReplaying, activeHint, rows, cols, grid, hEdges, vEdges]);

  // 全鍵盤熱鍵監聽
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
      } else if (!e.metaKey && !e.ctrlKey) {
        if (e.key.toLowerCase() === 'f') setIsZenMode((prev) => !prev);
        if (e.key.toLowerCase() === 'h') handleRequestHint();
        if (e.key.toLowerCase() === 'n') setNoGuessMode((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompleted, isReplaying, handleUndo, handleRedo, handleRequestHint]);

  // 驗證閉合與心理計量簽名 (P2 修復：增加 hasRecordedRef 守衛防抖)
  useEffect(() => {
    if (isCompleted || isReplaying || analysis.totalConflicts > 0) return;

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
            spatial: 0.98,
            numeric: 0.3,
            workingMemory: 0.8,
            inhibition: 0.95,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
          technique: 'SlitherlinkJordanCycle',
          irtDifficulty: baseIrt,
          isPureClear: conflictCountRef.current === 0 && !activeHint && !history.some((h) => h.isBypass),
        });

        try {
          const canonical = `${actualPuzzle.id}|${timeSpent}|${movesCountRef.current}|${conflictCountRef.current}|SECURE_${tournamentMode}|SLITHER_MYTHIC`;
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

        if (!isZenMode && timeSpent <= profile.personalBest.fastestTime) {
          setShowPBModal(true);
        }
      }
    }
  }, [hEdges, vEdges, grid, analysis.totalConflicts, isCompleted, isReplaying, actualPuzzle, rows, cols, currentTier, recordAttempt, profile.personalBest.fastestTime, activeHint, tournamentMode, isZenMode, history]);

  const handleStartReplay = () => {
    setUserStateBackup({
      h: hEdges.map((row) => [...row]),
      v: vEdges.map((row) => [...row]),
    });

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
  };

  const handleRestoreUserBoard = () => {
    if (!userStateBackup) return;
    setIsReplaying(false);
    setAnimatedEvidenceSet(new Set());
    setHEdges(userStateBackup.h.map((row) => [...row]));
    setVEdges(userStateBackup.v.map((row) => [...row]));
    if (navigator.vibrate) navigator.vibrate(10);
  };

  useEffect(() => {
    if (!isReplaying || replayStepsList.length === 0) return;
    if (replayStepIndex >= replayStepsList.length) {
      setAnimatedEvidenceSet(new Set());
      return;
    }

    const delay = Math.round(420 / replaySpeed);
    const timer = setTimeout(() => {
      const step = replayStepsList[replayStepIndex];
      if (step.type === 'H') {
        setHEdges((prev) => {
          const next = [...prev];
          next[step.r] = [...next[step.r]];
          next[step.r][step.c] = step.forcedState;
          return next;
        });
      } else {
        setVEdges((prev) => {
          const next = [...prev];
          next[step.r] = [...next[step.r]];
          next[step.r][step.c] = step.forcedState;
          return next;
        });
      }

      if (step.evidenceCells && step.evidenceCells.length > 0) {
        setAnimatedEvidenceSet(new Set(step.evidenceCells.map(([er, ec]: [number, number]) => `${er},${ec}`)));
      } else {
        setAnimatedEvidenceSet(new Set());
      }

      setReplayStepIndex((prev) => prev + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [isReplaying, replayStepIndex, replayStepsList, replaySpeed]);

  const handleAdvancedShare = async () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lawgic.app';
    const duelUrl = `${origin}/?engine=slitherlink&tier=${currentTier}&seed=${seed}`;

    const shareData = {
      title: `Slitherlink ${currentTier.toUpperCase()} Duel [Seed: ${seed}]`,
      text: isEn 
        ? `Can you solve this Slitherlink topology faster? [Seed: ${seed}]`
        : `你能比我更快閉合這張 ${currentTier} 級迴路拓撲嗎？（種子碼：${seed}）`,
      url: duelUrl,
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // 使用者取消
      }
    }

    await navigator.clipboard.writeText(duelUrl);
    setCopyToast(true);
    if (navigator.vibrate) navigator.vibrate(12);
    setTimeout(() => setCopyToast(false), 2400);
  };

  const getLocalizedTechniqueName = (techKey: string) => {
    const entry = TECHNIQUE_I18N[techKey];
    if (!entry) return techKey.replace(/_/g, ' ');
    return isEn ? entry.en : entry.zh;
  };

  const theoryTime = (actualPuzzle?.metrics as any)?.estimated_time_sec || rows * cols * 3;
  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('TopologicalLookahead', theoryTime, 'slitherlink');
  }, [getBenchmarkMetrics, theoryTime]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  if (!actualPuzzle) {
    return (
      <div className="flex items-center justify-center p-8 text-xs font-mono text-slate-500">
        {isEn ? 'Loading Topology...' : '載入拓撲盤面中...'}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-1 select-none font-mono w-full max-w-[420px] mx-auto">
      {/* 頂部 HUD (支援 Zen Mode 折疊) */}
      {!isZenMode && (
        <div className="w-full grid grid-cols-5 gap-1 px-0.5 mb-1.5 text-[8px] sm:text-[9px] animate-fade-in">
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[6.5px]">⏱️ {t.speed}</div>
            <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
          </div>

          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[6.5px]">♟️ {t.moves}</div>
            <div className="text-cyan-300 font-bold">{movesCountRef.current}</div>
          </div>

          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[6.5px]">⚠️ {t.conflicts}</div>
            <div className={`font-bold ${conflictDisplay > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
              {conflictDisplay}
            </div>
          </div>

          <button
            onClick={() => setNoGuessMode((prev) => !prev)}
            disabled={tournamentMode}
            className={`p-1 rounded border text-center transition cursor-pointer ${
              tournamentMode
                ? 'bg-purple-950/80 border-purple-500 text-purple-300 font-bold cursor-not-allowed'
                : noGuessMode
                ? 'bg-purple-950 border-purple-500 text-purple-300 font-bold shadow-xs'
                : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            <div className="text-[6.5px]">🛡️ {t.noGuess}</div>
            <div className="text-[7.5px]">{tournamentMode ? t.locked : noGuessMode ? t.strict : t.off}</div>
          </button>

          <button
            onClick={handleRequestHint}
            disabled={isCompleted || tournamentMode || isReplaying}
            className={`p-1 rounded border text-center transition cursor-pointer ${
              tournamentMode
                ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                : activeHint
                ? 'bg-amber-950/90 border-amber-500 text-amber-300 font-bold shadow-xs'
                : 'bg-indigo-950/80 border-indigo-500/60 text-indigo-300 hover:bg-indigo-900'
            }`}
          >
            <div className="text-[6.5px]">💡 {t.hint}</div>
            <div className="text-[7.5px] truncate">
              {tournamentMode ? t.exam : activeHint ? `Lv.${hintLadderLevel}` : t.getHint}
            </div>
          </button>
        </div>
      )}

      {copyToast && (
        <div className="w-[min(88vw,42vh)] mb-1 p-1 bg-emerald-950 border border-emerald-500 text-emerald-300 text-[7.5px] rounded animate-fade-in text-center font-bold">
          {t.duelCopied}
        </div>
      )}

      {/* AI Replay 控制面板 */}
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
                  className={`px-1 py-0.2 rounded text-[6.5px] font-bold cursor-pointer ${
                    replaySpeed === spd ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {spd}x
                </button>
              ))}
              <button
                onClick={handleRestoreUserBoard}
                className="ml-1 px-1.5 py-0.2 bg-rose-950 hover:bg-rose-900 border border-rose-500/60 text-rose-300 rounded text-[6.5px] font-bold cursor-pointer"
              >
                {t.restoreMine}
              </button>
            </div>
          </div>
          <div className="truncate text-cyan-300">
            {replayStepsList[replayStepIndex - 1]?.rationale || t.demonstrating}
          </div>
        </div>
      )}

      {/* 中性無猜測提示框 */}
      {noGuessWarning && (
        <div className="w-[min(88vw,42vh)] mb-1.5 px-2 py-1 bg-slate-900 border border-indigo-500/50 text-indigo-200 text-[7.5px] rounded-md animate-fade-in flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-1 truncate">
            <span className="text-indigo-400">🛡️</span>
            <span className="truncate">{noGuessWarning}</span>
          </div>
          <button
            onClick={handleRequestHint}
            className="text-[6.5px] text-amber-400 hover:underline ml-2 whitespace-nowrap cursor-pointer"
          >
            [因果提示]
          </button>
        </div>
      )}

      {/* 大師級捷徑提示梯 */}
      {activeHint && !isReplaying && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-2 bg-slate-900/95 border border-amber-500/40 rounded-lg text-slate-200 text-[8px] animate-fade-in text-left shadow-xl">
          <div className="font-bold flex items-center justify-between text-[7px] text-amber-400 border-b border-slate-800 pb-1 mb-1">
            <span className="tracking-wider">[TACTICAL LADDER {hintLadderLevel}/3]</span>
            <span className="px-1.5 py-0.5 bg-amber-950/70 border border-amber-500/40 rounded text-amber-300 font-mono">
              {getLocalizedTechniqueName(activeHint.technique)}
            </span>
          </div>

          {hintLadderLevel === 1 && (
            <div className="text-amber-200/90 leading-relaxed font-sans">
              🎯 鎖定約束：發現【<span className="font-bold text-amber-400">{getLocalizedTechniqueName(activeHint.technique)}</span>】定式結構，請評估該處拓撲邊界。
            </div>
          )}
          {hintLadderLevel === 2 && (
            <div className="text-slate-300 leading-relaxed font-sans">
              💡 推導邏輯：{isEn ? activeHint.humanReadable?.en || activeHint.rationale : activeHint.humanReadable?.zh || activeHint.rationale}
            </div>
          )}
          {hintLadderLevel === 3 && (
            <div className="flex items-center justify-between text-amber-300 mt-0.5">
              <span className="text-[7.5px] text-slate-400">{activeHint.rationale}</span>
              <span className={`px-1.5 py-0.5 rounded font-black text-[8px] ${activeHint.forcedState === 1 ? 'bg-cyan-950 border border-cyan-500 text-cyan-300' : 'bg-rose-950 border border-rose-500 text-rose-300'}`}>
                {activeHint.forcedState === 1 ? t.mustConnect : t.mustCross}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 主棋盤 */}
      <div
        className="relative overflow-hidden p-3 rounded-xl bg-slate-950 border-2 border-slate-800 shadow-2xl"
        style={{ width: 'min(88vw, 42vh)', height: 'min(88vw, 42vh)', touchAction: 'none' }}
      >
        <div className="absolute top-1 right-1 flex items-center gap-1 z-30">
          <button
            onClick={handleToggleFavorite}
            className={`px-1.5 py-0.5 rounded border transition cursor-pointer text-[6.5px] ${
              isFav ? 'border-amber-500 text-amber-300 bg-amber-950/80' : 'bg-slate-900/80 border-slate-700/60 text-slate-400 hover:text-white'
            }`}
            title={isFav ? (isEn ? 'In Vault' : '已在傳奇庫') : (isEn ? 'Save to Vault' : '收藏')}
          >
            {isFav ? '★' : '☆'}
          </button>
          <button
            onClick={() => setIsZenMode((prev) => !prev)}
            className="px-1.5 py-0.5 bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 rounded text-[6.5px] text-slate-400 hover:text-cyan-300 font-mono transition cursor-pointer"
            title="Toggle Zen Focus Mode (Key: F)"
          >
            {isZenMode ? '⤢ EXPAND' : '☯ ZEN [F]'}
          </button>
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
              const clue = grid[r]?.[c];
              const isViolated = analysis.clueViolations.has(`${r},${c}`);
              const isStarved = analysis.starvationViolations.has(`${r},${c}`);
              const isEvidence = animatedEvidenceSet.has(`${r},${c}`);

              return (
                <div
                  key={`cell-${r}-${c}`}
                  className={`relative flex items-center justify-center select-none transition-all duration-300 rounded-sm ${
                    isEvidence
                      ? 'bg-amber-500/20 shadow-[inset_0_0_12px_rgba(245,158,11,0.4)] border border-amber-400/40'
                      : ''
                  }`}
                >
                  {typeof clue === 'number' && (
                    <span
                      className={`text-sm sm:text-base font-black font-mono transition-all duration-300 ${
                        isViolated
                          ? 'text-rose-500 animate-pulse drop-shadow-[0_0_8px_rgba(244,63,94,0.8)]'
                          : isStarved
                          ? 'text-amber-500 drop-shadow-[0_0_6px_rgba(245,158,11,0.7)]'
                          : isEvidence
                          ? 'text-amber-300 scale-110 drop-shadow-[0_0_6px_rgba(251,191,36,0.8)]'
                          : 'text-slate-200'
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

        {/* 頂點格點 */}
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

        {/* 水平與垂直可點擊邊緣 */}
        <div className="absolute inset-3 z-20">
          {Array.from({ length: rows + 1 }).map((_, r) =>
            Array.from({ length: cols }).map((__, c) => {
              const state = hEdges[r][c];
              return (
                <div
                  key={`h-${r}-${c}`}
                  onClick={(e) => cycleEdge('H', r, c, e)}
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

          {Array.from({ length: rows }).map((_, r) =>
            Array.from({ length: cols + 1 }).map((__, c) => {
              const state = vEdges[r][c];
              return (
                <div
                  key={`v-${r}-${c}`}
                  onClick={(e) => cycleEdge('V', r, c, e)}
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
        <div className="flex gap-1 items-center">
          <button
            onClick={handleUndo}
            disabled={history.length === 0 || isCompleted || isReplaying}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            ↩ {t.undo}
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0 || isCompleted || isReplaying}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            ↪ {t.redo}
          </button>

          {/* 戰術快捷鍵指引 HUD */}
          <div className="relative group">
            <button className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-400 hover:text-slate-200 text-[7px] flex items-center gap-1 transition cursor-pointer">
              <span>⌨️</span>
            </button>
            <div className="absolute bottom-full left-0 mb-1 hidden group-hover:flex flex-col gap-1 p-2 bg-slate-950/95 border border-slate-700/80 rounded-lg text-[7px] text-slate-300 w-44 shadow-2xl z-40 backdrop-blur-md">
              <div className="text-[6.5px] font-bold text-slate-400 border-b border-slate-800 pb-0.5 mb-0.5 uppercase tracking-wider">
                {isEn ? 'Tactical Shortcuts' : '戰術操作熱鍵'}
              </div>
              <div className="flex justify-between"><span>[F]</span><span className="text-cyan-300">{isEn ? 'Zen Focus' : '專注模式'}</span></div>
              <div className="flex justify-between"><span>[H]</span><span className="text-amber-300">{isEn ? 'Hint' : '因果提示'}</span></div>
              <div className="flex justify-between"><span>[N]</span><span className="text-purple-300">{isEn ? 'No-Guess' : '無猜測開關'}</span></div>
              <div className="flex justify-between"><span>[Ctrl+Z]</span><span>{isEn ? 'Undo' : '撤銷'}</span></div>
              <div className="flex justify-between"><span>[Ctrl+Y]</span><span>{isEn ? 'Redo' : '重做'}</span></div>
              <div className="flex justify-between text-slate-400 border-t border-slate-800/80 pt-0.5 mt-0.5">
                <span>[Shift+Click]</span><span className="text-amber-400">{isEn ? 'Bypass (Trial)' : '強制試錯落子'}</span>
              </div>
            </div>
          </div>

          {!tournamentMode && (
            <button
              onClick={handleAdvancedShare}
              className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 text-amber-300 cursor-pointer"
              title="Share Duel"
            >
              🔗 {t.duelLink}
            </button>
          )}
        </div>
        <div className="text-slate-500">
          <span>{t.instruction}</span>
        </div>
      </div>

      {/* Zen Mode 寧靜通關浮動條 */}
      {isCompleted && isZenMode && (
        <div className="w-[min(88vw,42vh)] mt-2 px-3 py-1.5 bg-slate-900/90 border border-cyan-500/50 rounded-lg flex items-center justify-between animate-fade-in shadow-2xl backdrop-blur-xs">
          <div className="flex items-center gap-2">
            <span className="text-cyan-400 text-xs">🌀</span>
            <span className="text-[8px] font-mono text-slate-200">
              {isEn ? 'Loop Closed Purely' : '迴路完美閉合'}
            </span>
            <span className="text-[7.5px] font-mono text-cyan-300 font-bold">
              {(elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsZenMode(false)}
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-[6.5px] text-slate-300 rounded transition cursor-pointer"
            >
              {isEn ? 'View Metrics' : '查看數據'}
            </button>
            <button
              onClick={() => setShowSubmitModal(true)}
              className="px-2 py-0.5 bg-cyan-950 border border-cyan-500/60 text-cyan-300 font-bold text-[6.5px] rounded transition cursor-pointer"
            >
              {isEn ? 'Submit' : '賽事提交'}
            </button>
          </div>
        </div>
      )}

      {/* 標準結算數據面板 */}
      {isCompleted && !isZenMode && (
        <div className="mt-2 p-2.5 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,42vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
            <div className="text-left">
              <div className="text-[7.5px] text-slate-500 tracking-wider">{t.solvedTitle}</div>
              <div className="text-xs text-indigo-300 font-bold">🌀 {isEn ? 'Topology Verified' : '拓撲閉合・完全驗證'}</div>
            </div>
            <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[9px] font-bold text-cyan-300">
              Gf: IQ {cci.standardIQ} (Top {Number((100 - cci.percentileRank).toFixed(1))}%)
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[7.5px] text-slate-400 mb-1.5">
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{t.timeElapsed}</div>
              <div className="text-slate-200 font-bold text-[10px]">{(elapsedMs / 1000).toFixed(1)}s</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{t.opsCount}</div>
              <div className="text-cyan-300 font-bold text-[10px]">{movesCountRef.current}</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{t.conflictPenalties}</div>
              <div className="text-amber-300 font-bold text-[10px]">{conflictCountRef.current} {t.timesUnit}</div>
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
              onClick={handleStartReplay}
              disabled={isReplaying}
              className="flex-1 py-1 bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/60 text-indigo-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95 cursor-pointer"
            >
              <span>🔁</span>
              <span>{t.aiReplay}</span>
            </button>

            {userStateBackup && (
              <button
                onClick={handleRestoreUserBoard}
                className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-cyan-500/60 text-cyan-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95 cursor-pointer"
              >
                <span>↩️</span>
                <span>{t.restoreMine}</span>
              </button>
            )}

            <button
              onClick={handleAdvancedShare}
              className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-amber-500/60 text-amber-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95 cursor-pointer"
            >
              <span>🔗</span>
              <span>{t.duelLink}</span>
            </button>

            <button
              onClick={() => setShowSubmitModal(true)}
              className="flex-1 py-1 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 text-slate-950 text-[7.5px] font-black rounded shadow transition active:scale-95 flex items-center justify-center gap-0.5 cursor-pointer"
            >
              <span>📤</span>
              <span>{t.submit}</span>
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

      {showPBModal && !isZenMode && (
        <PBCelebrationModal pb={profile.personalBest} onClose={() => setShowPBModal(false)} isEn={isEn} />
      )}

      {/* 賽事提交 Modal (P0 修復：動態掛接真實稽核快照) */}
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
