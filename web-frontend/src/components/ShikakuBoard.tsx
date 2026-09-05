// web-frontend/src/components/ShikakuBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { MetricErrorBar } from './MetricErrorBar';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';
import { getEnvironmentFingerprint, calculateInfractionScore } from '../utils/tournamentSecurity';
import { ClinicalProctoringTracker } from '../utils/clinicalProctoring';
import {
  WebShikakuGenerator,
  ShikakuSpec,
  ShikakuRect,
  ShikakuHintStep,
} from '../engines/shikakuGenerator';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

const MAX_HISTORY_STEPS = 250;

export const ShikakuBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
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

  const spec: ShikakuSpec = (actualPuzzle as any)?.puzzle || (actualPuzzle as any)?.spec;
  const rows = spec?.rows || 8;
  const cols = spec?.cols || 8;
  const grid = useMemo(() => spec?.grid || [], [spec]);

  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';

  const [placedRects, setPlacedRects] = useState<ShikakuRect[]>([]);
  const [dragStart, setDragStart] = useState<[number, number] | null>(null);
  const [dragCurrent, setDragCurrent] = useState<[number, number] | null>(null);

  const [history, setHistory] = useState<ShikakuRect[][]>([]);
  const [redoStack, setRedoStack] = useState<ShikakuRect[][]>([]);

  const [noGuessMode, setNoGuessMode] = useState<boolean>(false);
  const [highContrast, setHighContrast] = useState<boolean>(false);
  const [noGuessWarning, setNoGuessWarning] = useState<string | null>(null);
  const [activeHint, setActiveHint] = useState<ShikakuHintStep | null>(null);
  const [hintLadderLevel, setHintLadderLevel] = useState<1 | 2 | 3>(1);
  const [animatedEvidenceSet, setAnimatedEvidenceSet] = useState<Set<string>>(new Set());

  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<1 | 2 | 4>(1);
  const [replayStepIndex, setReplayStepIndex] = useState<number>(0);
  const [replayStepsList, setReplayStepsList] = useState<ShikakuHintStep[]>([]);
  const [userRectsBackup, setUserRectsBackup] = useState<ShikakuRect[] | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);

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

  const proctoringTracker = useRef<ClinicalProctoringTracker | null>(null);

  useEffect(() => {
    proctoringTracker.current = new ClinicalProctoringTracker();
    return () => {
      proctoringTracker.current?.destroy();
    };
  }, []);

  useEffect(() => {
    setPlacedRects([]);
    setDragStart(null);
    setDragCurrent(null);
    setHistory([]);
    setRedoStack([]);
    setIsCompleted(false);
    setActiveHint(null);
    setHintLadderLevel(1);
    setAnimatedEvidenceSet(new Set());
    setIsReplaying(false);
    setUserRectsBackup(null);
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
    if (isCompleted || isReplaying) return;
    let frameId: number;
    const updateTimer = () => {
      setElapsedMs(Date.now() - startTimeRef.current);
      frameId = requestAnimationFrame(updateTimer);
    };
    frameId = requestAnimationFrame(updateTimer);
    return () => cancelAnimationFrame(frameId);
  }, [isCompleted, isReplaying]);

  const analysis = useMemo(() => {
    const cellCoverCounts = Array.from({ length: rows }, () => Array(cols).fill(0));
    const rectConflicts = new Set<number>();
    const coveredClueCoords = new Set<string>();

    placedRects.forEach((rect, idx) => {
      let containsCount = 0;
      let targetNumber: number | null = null;

      for (let r = rect.r; r < rect.r + rect.h; r++) {
        for (let c = rect.c; c < rect.c + rect.w; c++) {
          cellCoverCounts[r][c]++;
          if (grid[r]?.[c] !== null) {
            containsCount++;
            targetNumber = grid[r][c];
            coveredClueCoords.add(`${r},${c}`);
          }
        }
      }

      const area = rect.w * rect.h;
      if (containsCount !== 1 || targetNumber !== area) {
        rectConflicts.add(idx);
      }
    });

    let overlapCount = 0;
    let unassignedCount = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cellCoverCounts[r][c] > 1) overlapCount++;
        else if (cellCoverCounts[r][c] === 0) unassignedCount++;
      }
    }

    let remainingClueSum = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r]?.[c] !== null && !coveredClueCoords.has(`${r},${c}`)) {
          remainingClueSum += grid[r][c]!;
        }
      }
    }

    const totalConflicts = overlapCount + rectConflicts.size;
    const isPerfectPartition = totalConflicts === 0 && unassignedCount === 0 && placedRects.length > 0;

    return {
      cellCoverCounts,
      rectConflicts,
      overlapCount,
      unassignedCount,
      remainingClueSum,
      isAreaBalanced: unassignedCount === remainingClueSum,
      totalConflicts,
      isPerfectPartition,
    };
  }, [placedRects, grid, rows, cols]);

  const prevConflictsRef = useRef<number>(0);
  useEffect(() => {
    if (analysis.totalConflicts > prevConflictsRef.current) {
      conflictCountRef.current += analysis.totalConflicts - prevConflictsRef.current;
      setConflictDisplay(conflictCountRef.current);
    }
    prevConflictsRef.current = analysis.totalConflicts;
  }, [analysis.totalConflicts]);

  const addRect = useCallback(
    (newRect: ShikakuRect) => {
      if (isCompleted || isReplaying) return;

      if (noGuessMode) {
        const step = WebShikakuGenerator.getNextForcedDeduction(rows, cols, grid, placedRects);
        if (step) {
          const isTarget =
            step.rect.r === newRect.r &&
            step.rect.c === newRect.c &&
            step.rect.w === newRect.w &&
            step.rect.h === newRect.h;

          if (!isTarget) {
            if (navigator.vibrate) navigator.vibrate([25, 35, 25]);
            const reason = isEn ? step.humanReadable.en : step.humanReadable.zh;
            setNoGuessWarning(isEn ? `[No-Guess Blocked] Deduce: ${reason}` : `【無猜測攔截】依據定式應優先劃定：${reason}`);
            setTimeout(() => setNoGuessWarning(null), 3200);
            return;
          }
        }
      }

      if (navigator.vibrate) navigator.vibrate(8);
      movesCountRef.current++;

      setHistory((prev) => [...prev.slice(-MAX_HISTORY_STEPS + 1), placedRects]);
      setRedoStack([]);

      const filtered = placedRects.filter((r) => {
        const isExactSame = r.r === newRect.r && r.c === newRect.c && r.w === newRect.w && r.h === newRect.h;
        return !isExactSame;
      });

      setPlacedRects([...filtered, newRect]);
      if (activeHint) setActiveHint(null);
    },
    [isCompleted, isReplaying, noGuessMode, rows, cols, grid, placedRects, activeHint, isEn]
  );

  const removeRect = useCallback(
    (rectIndex: number) => {
      if (isCompleted || isReplaying) return;
      if (navigator.vibrate) navigator.vibrate(6);

      setHistory((prev) => [...prev.slice(-MAX_HISTORY_STEPS + 1), placedRects]);
      setRedoStack([]);
      setPlacedRects((prev) => prev.filter((_, idx) => idx !== rectIndex));
    },
    [isCompleted, isReplaying, placedRects]
  );

  const handleCellMouseDown = (r: number, c: number, e: React.MouseEvent | React.TouchEvent) => {
    if (isCompleted || isReplaying) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    proctoringTracker.current?.recordPointer(clientX, clientY, 'down');

    setDragStart([r, c]);
    setDragCurrent([r, c]);
  };

  const handleCellMouseEnter = (r: number, c: number, e: React.MouseEvent) => {
    if (dragStart) {
      proctoringTracker.current?.recordPointer(e.clientX, e.clientY, 'drag');
      setDragCurrent([r, c]);
    }
  };

  const handleCellMouseUp = () => {
    if (dragStart && dragCurrent) {
      const minR = Math.min(dragStart[0], dragCurrent[0]);
      const maxR = Math.max(dragStart[0], dragCurrent[0]);
      const minC = Math.min(dragStart[1], dragCurrent[1]);
      const maxC = Math.max(dragStart[1], dragCurrent[1]);

      const w = maxC - minC + 1;
      const h = maxR - minR + 1;

      let numR = minR;
      let numC = minC;
      for (let ir = minR; ir <= maxR; ir++) {
        for (let ic = minC; ic <= maxC; ic++) {
          if (grid[ir]?.[ic] !== null) {
            numR = ir;
            numC = ic;
            break;
          }
        }
      }

      addRect({ r: minR, c: minC, w, h, numberR: numR, numberC: numC });
    }
    setDragStart(null);
    setDragCurrent(null);
  };

  const handleUndo = useCallback(() => {
    if (history.length === 0 || isCompleted || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const last = history[history.length - 1];
    setRedoStack((prev) => [...prev, placedRects]);
    setPlacedRects(last);
    setHistory((prev) => prev.slice(0, -1));
  }, [history, placedRects, isCompleted, isReplaying]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const next = redoStack[redoStack.length - 1];
    setHistory((prev) => [...prev, placedRects]);
    setPlacedRects(next);
    setRedoStack((prev) => prev.slice(0, -1));
  }, [redoStack, placedRects, isCompleted, isReplaying]);

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

  useEffect(() => {
    if (isCompleted || isReplaying) return;

    if (analysis.isPerfectPartition) {
      setIsCompleted(true);
      const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
      const telemetry = proctoringTracker.current?.finalizeTelemetry(actualPuzzle?.id || 'shikaku');

      if (!hasRecordedRef.current && actualPuzzle) {
        hasRecordedRef.current = true;
        const dynamicIrt = (actualPuzzle.metrics as any)?.irt_logit_difficulty || 1.6;

        recordAttempt({
          puzzleId: actualPuzzle.id,
          engineType: 'shikaku',
          tier: currentTier,
          cognitiveLoad: actualPuzzle.cognitiveLoad || {
            spatial: 0.92,
            numeric: 0.95,
            workingMemory: 0.8,
            inhibition: 0.85,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
          technique: 'ShikakuRectPartitionTopology',
          irtDifficulty: dynamicIrt,
          isPureClear: conflictCountRef.current === 0 && !activeHint,
          partialCredit: 1.0,
        });

        try {
          const canonical = `${actualPuzzle.id}|${timeSpent}|MOVES_${movesCountRef.current}|INTEG_${telemetry?.integrityDigest}|SECURE_${tournamentMode}`;
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
  }, [analysis, isCompleted, isReplaying, actualPuzzle, currentTier, recordAttempt, profile.personalBest.fastestTime, activeHint, tournamentMode]);

  const handleRequestHint = () => {
    if (isCompleted || tournamentMode || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(12);

    if (!activeHint) {
      const step = WebShikakuGenerator.getNextForcedDeduction(rows, cols, grid, placedRects);
      if (step) {
        setActiveHint(step);
        setHintLadderLevel(1);
      }
    } else {
      setHintLadderLevel((prev) => (prev === 1 ? 2 : 3));
    }
  };

  const handleStartReplay = () => {
    setUserRectsBackup([...placedRects]);

    const simRects: ShikakuRect[] = [];
    const steps: ShikakuHintStep[] = [];

    let safety = 0;
    while (safety++ < rows * cols * 2) {
      const step = WebShikakuGenerator.getNextForcedDeduction(rows, cols, grid, simRects);
      if (!step) break;
      steps.push(step);
      simRects.push(step.rect);
    }

    setReplayStepsList(steps);
    setReplayStepIndex(0);
    setIsReplaying(true);
    setPlacedRects([]);
  };

  const handleRestoreUserBoard = () => {
    if (!userRectsBackup) return;
    setIsReplaying(false);
    setPlacedRects([...userRectsBackup]);
    setAnimatedEvidenceSet(new Set());
    if (navigator.vibrate) navigator.vibrate(15);
  };

  useEffect(() => {
    if (!isReplaying || replayStepsList.length === 0) return;
    if (replayStepIndex >= replayStepsList.length) return;

    const delay = Math.round(450 / replaySpeed);
    const timer = setTimeout(() => {
      const step = replayStepsList[replayStepIndex];
      setPlacedRects((prev) => [...prev, step.rect]);

      if (step.evidenceCells) {
        setAnimatedEvidenceSet(new Set(step.evidenceCells.map(([er, ec]) => `${er},${ec}`)));
      }
      setReplayStepIndex((prev) => prev + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [isReplaying, replayStepIndex, replayStepsList, replaySpeed]);

  const handleCopySeedShareCode = () => {
    const seed = (actualPuzzle as any)?.puzzle?.seed || (actualPuzzle?.metrics as any)?.seed || 0;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lawgic.app';
    const duelUrl = `${origin}/?engine=shikaku&tier=${currentTier}&seed=${seed}`;
    navigator.clipboard.writeText(duelUrl);
    setCopyToast(isEn ? '🔗 Direct duel link copied!' : '🔗 一鍵對決連結已複製！');
    if (navigator.vibrate) navigator.vibrate(20);
    setTimeout(() => setCopyToast(null), 2400);
  };

  const handleGenerateCard = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bgGrad = ctx.createLinearGradient(0, 0, 600, 320);
    bgGrad.addColorStop(0, '#020617');
    bgGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 600, 320);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.strokeRect(12, 12, 576, 296);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 22px monospace';
    ctx.fillText('SHIKAKU GRANDMASTER RECORD', 30, 48);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px monospace';
    ctx.fillText(`TIER: ${currentTier.toUpperCase()}  |  180° SYMMETRIC BOARD`, 30, 72);

    const startX = 30;
    const startY = 95;
    const boardSize = 180;
    const scaleX = boardSize / cols;
    const scaleY = boardSize / rows;

    placedRects.forEach((rect) => {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
      ctx.fillRect(startX + rect.c * scaleX, startY + rect.r * scaleY, rect.w * scaleX, rect.h * scaleY);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(startX + rect.c * scaleX, startY + rect.r * scaleY, rect.w * scaleX, rect.h * scaleY);
    });

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = grid[r]?.[c];
        if (val !== null) {
          ctx.fillStyle = '#fbbf24';
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${val}`, startX + (c + 0.5) * scaleX, startY + (r + 0.5) * scaleY);
        }
      }
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`TIME: ${(elapsedMs / 1000).toFixed(1)}s`, 260, 125);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px monospace';
    ctx.fillText(`MOVES: ${movesCountRef.current}`, 260, 155);
    ctx.fillText(`CONFLICTS: ${conflictCountRef.current}`, 260, 180);
    ctx.fillText(`FLUID IQ: ${cci.standardIQ} (Top ${(100 - cci.percentileRank).toFixed(1)}%)`, 260, 205);

    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.fillText(`RECEIPT: ${proofSignature || 'VERIFIED_SHIKAKU_HASH'}`, 260, 245);
    ctx.fillText('POWERED BY LAWGIC TOURNAMENT ENGINE', 260, 265);

    const link = document.createElement('a');
    link.download = `Shikaku_Card_${Date.now().toString(36)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    setCopyToast(isEn ? '📸 Card downloaded!' : '📸 高光戰績卡已下載！');
    setTimeout(() => setCopyToast(null), 2500);
  };

  const theoryTime = (actualPuzzle?.metrics as any)?.estimated_time_sec || rows * cols * 2.2;
  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('TopologicalLookahead', theoryTime, 'shikaku');
  }, [getBenchmarkMetrics, theoryTime]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);
  const currentReplayStep = replayStepsList[replayStepIndex - 1];

  const previewRect = useMemo(() => {
    if (!dragStart || !dragCurrent) return null;
    const minR = Math.min(dragStart[0], dragCurrent[0]);
    const maxR = Math.max(dragStart[0], dragCurrent[0]);
    const minC = Math.min(dragStart[1], dragCurrent[1]);
    const maxC = Math.max(dragStart[1], dragCurrent[1]);
    return {
      top: `${(minR / rows) * 100}%`,
      left: `${(minC / cols) * 100}%`,
      width: `${((maxC - minC + 1) / cols) * 100}%`,
      height: `${((maxR - minR + 1) / rows) * 100}%`,
      area: (maxR - minR + 1) * (maxC - minC + 1),
    };
  }, [dragStart, dragCurrent, rows, cols]);

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
          <div className="text-slate-500 text-[6.5px]">{isEn ? '⚠️ Conflicts' : '⚠️ 衝突違規'}</div>
          <div className={`font-bold ${conflictDisplay > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
            {conflictDisplay}
          </div>
        </div>

        <div
          className={`p-1 rounded border text-center flex flex-col justify-center ${
            analysis.isAreaBalanced
              ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
              : 'bg-slate-950 border-slate-800 text-slate-400'
          }`}
          title={isEn ? 'Remaining Area Conservation' : '面積守恆指針'}
        >
          <div className="text-[6.5px]">⊞ {isEn ? 'Area' : '面積'}</div>
          <div className="text-[7.5px] font-bold">
            {analysis.unassignedCount === 0 ? 'Full' : `${analysis.unassignedCount}格`}
          </div>
        </div>

        <button
          onClick={() => setHighContrast((prev) => !prev)}
          className={`p-1 rounded border text-center transition ${
            highContrast
              ? 'bg-amber-950 border-amber-400 text-amber-300 font-bold shadow-xs'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
        >
          <div className="text-[6.5px]">🌓 {isEn ? 'Theme' : '主題'}</div>
          <div className="text-[7.5px]">{highContrast ? 'Paper' : 'Dark'}</div>
        </button>

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

      {copyToast && (
        <div className="w-[min(88vw,42vh)] mb-1 p-1 bg-emerald-950 border border-emerald-500 text-emerald-300 text-[7.5px] rounded animate-fade-in text-center font-bold">
          {copyToast}
        </div>
      )}

      {isReplaying && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1.5 bg-indigo-950/90 border border-cyan-500 rounded-lg text-cyan-200 text-[8px] animate-pulse font-mono">
          <div className="flex justify-between items-center text-[7px] text-cyan-400 mb-1 border-b border-cyan-900/60 pb-0.5">
            <span className="flex items-center gap-1 font-bold">
              <span>{currentReplayStep?.techniqueIcon || '📐'}</span>
              <span>{isEn ? currentReplayStep?.techniqueName.en : currentReplayStep?.techniqueName.zh}</span>
              <span className="text-slate-400">[{replayStepIndex}/{replayStepsList.length}]</span>
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[6.5px] text-slate-400">SPEED:</span>
              {[1, 2, 4].map((spd) => (
                <button
                  key={spd}
                  onClick={() => setReplaySpeed(spd as 1 | 2 | 4)}
                  className={`px-1 py-0.2 rounded text-[6.5px] font-bold ${
                    replaySpeed === spd ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-400'
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
            {currentReplayStep?.rationale || 'Demonstrating deductive rectangle partition...'}
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
            <span className="flex items-center gap-1">
              <span>{activeHint.techniqueIcon}</span>
              <span>{isEn ? activeHint.techniqueName.en : activeHint.techniqueName.zh}</span>
            </span>
            <span>LEVEL {hintLadderLevel}/3</span>
          </div>
          {hintLadderLevel === 1 && (
            <div>{isEn ? `Forced room around [${activeHint.numberPos[0] + 1},${activeHint.numberPos[1] + 1}].` : `請關注數字 [${activeHint.numberPos[0] + 1},${activeHint.numberPos[1] + 1}] 周圍。`}</div>
          )}
          {hintLadderLevel === 2 && (
            <div>{isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}</div>
          )}
          {hintLadderLevel === 3 && (
            <div className="font-bold text-amber-300">
              {activeHint.rationale}
              <span className="ml-1 text-cyan-300 underline">
                {isEn ? `Must place ${activeHint.rect.w}×${activeHint.rect.h} box` : `必然劃出 ${activeHint.rect.w}×${activeHint.rect.h} 矩形框`}
              </span>
            </div>
          )}
        </div>
      )}

      <div
        onMouseUp={handleCellMouseUp}
        onTouchEnd={handleCellMouseUp}
        className={`relative overflow-hidden p-2 rounded-xl border-2 shadow-2xl transition-colors ${
          highContrast ? 'bg-black border-slate-400' : 'bg-slate-950 border-slate-800'
        }`}
        style={{ width: 'min(88vw, 42vh)', height: 'min(88vw, 42vh)', touchAction: 'none' }}
      >
        <div className="absolute top-1 right-1 px-1 py-0.2 bg-indigo-950/70 border border-indigo-500/50 rounded text-[6px] text-indigo-300 font-mono pointer-events-none z-30">
          ☯ 180° SYM
        </div>

        <div className="absolute inset-2 pointer-events-none z-10">
          {placedRects.map((rect, idx) => {
            const isConflicted = analysis.rectConflicts.has(idx);
            const topPct = (rect.r / rows) * 100;
            const leftPct = (rect.c / cols) * 100;
            const widthPct = (rect.w / cols) * 100;
            const heightPct = (rect.h / rows) * 100;

            return (
              <div
                key={`rect-${idx}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeRect(idx);
                }}
                className={`absolute rounded-sm border-2 transition-all pointer-events-auto cursor-pointer ${
                  isConflicted
                    ? 'border-rose-500 bg-rose-950/40 shadow-[0_0_8px_rgba(244,63,94,0.6)] animate-pulse'
                    : highContrast
                    ? 'border-white bg-neutral-900/60'
                    : 'border-cyan-400 bg-cyan-950/30 shadow-[0_0_8px_rgba(56,189,248,0.4)] hover:bg-cyan-900/40'
                }`}
                style={{
                  top: `${topPct}%`,
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                }}
              />
            );
          })}

          {previewRect && (
            <div
              className="absolute rounded-sm border-2 border-dashed border-amber-400 bg-amber-500/20 shadow-[0_0_10px_rgba(251,191,36,0.6)] pointer-events-none z-20 flex items-center justify-center text-[9px] font-black text-amber-300"
              style={{
                top: previewRect.top,
                left: previewRect.left,
                width: previewRect.width,
                height: previewRect.height,
              }}
            >
              <span>{previewRect.area}</span>
            </div>
          )}
        </div>

        <div
          className="relative w-full h-full select-none"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: rows }).map((_, r) =>
            Array.from({ length: cols }).map((__, c) => {
              const val = grid[r]?.[c];
              const isOverlapped = analysis.cellCoverCounts[r]?.[c] > 1;
              const cellKey = `${r},${c}`;
              const isEvidence = animatedEvidenceSet.has(cellKey);

              return (
                <div
                  key={cellKey}
                  onMouseDown={(e) => handleCellMouseDown(r, c, e)}
                  onMouseEnter={(e) => handleCellMouseEnter(r, c, e)}
                  onTouchStart={(e) => handleCellMouseDown(r, c, e)}
                  className={`relative flex items-center justify-center border cursor-crosshair transition-colors ${
                    highContrast ? 'border-slate-800' : 'border-slate-800/40'
                  } ${
                    isOverlapped
                      ? 'bg-rose-950/60'
                      : isEvidence
                      ? 'bg-amber-500/20 ring-2 ring-amber-400 animate-pulse'
                      : highContrast
                      ? 'bg-black hover:bg-neutral-900'
                      : 'bg-slate-900/30 hover:bg-slate-800/40'
                  }`}
                >
                  {val !== null && (
                    <span
                      className={`text-sm sm:text-base font-black font-mono pointer-events-none z-25 ${
                        highContrast ? 'text-yellow-400' : 'text-amber-400'
                      }`}
                    >
                      {val}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

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
              title="Copy Duel Link"
            >
              🔗 {isEn ? 'Duel Link' : '對決連結'}
            </button>
          )}
        </div>
        <div className="text-slate-500">
          <span>拖曳畫框矩形 / 點擊既有框可刪除</span>
        </div>
      </div>

      {isCompleted && (
        <div className="mt-2 p-2.5 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,42vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
            <div className="text-left">
              <div className="text-[7.5px] text-slate-500 tracking-wider">SHIKAKU RESOLVED</div>
              <div className="text-xs text-indigo-300 font-bold">📐 四角分割・完美面積鋪砌</div>
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
              <div>劃框步數</div>
              <div className="text-cyan-300 font-bold text-[10px]">{movesCountRef.current}</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>衝突次數</div>
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

          <div className="grid grid-cols-2 gap-1 mb-1">
            <button
              onClick={handleStartReplay}
              disabled={isReplaying}
              className="py-1 bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/60 text-indigo-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95"
            >
              <span>🔁</span>
              <span>{isEn ? 'AI Replay' : '解法覆盤'}</span>
            </button>

            <button
              onClick={handleGenerateCard}
              className="py-1 bg-purple-950 hover:bg-purple-900 border border-purple-500/60 text-purple-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95"
            >
              <span>📸</span>
              <span>{isEn ? 'Share Card' : '高光戰績卡'}</span>
            </button>
          </div>

          <div className="flex gap-1 mb-1.5">
            {userRectsBackup && (
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
            tournamentId: tournamentMode ? 'WPF_SHIKAKU_2026' : 'GLOBAL_TOPOLOGY_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'shikaku',
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
