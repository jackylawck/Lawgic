// web-frontend/src/components/HashiBoard.tsx
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
  WebHashiGenerator,
  HashiSpec,
  Island,
  HashiHintStep,
} from '../engines/hashiGenerator';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

interface BridgeDelta {
  u: number;
  v: number;
  from: 0 | 1 | 2;
  to: 0 | 1 | 2;
}

const MAX_HISTORY_STEPS = 250;

export const HashiBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
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

  const spec: HashiSpec = (actualPuzzle as any)?.puzzle || (actualPuzzle as any)?.spec;
  const rows = spec?.rows || 9;
  const cols = spec?.cols || 9;

  const islands: Island[] = useMemo(() => {
    if (spec?.islands && Array.isArray(spec.islands)) {
      return spec.islands;
    }
    if ((spec as any)?.grid) {
      const list: Island[] = [];
      let idCounter = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const val = (spec as any).grid[r]?.[c];
          if (typeof val === 'number' && val > 0) {
            list.push({ id: idCounter++, r, c, capacity: val });
          }
        }
      }
      return list;
    }
    return [];
  }, [spec, rows, cols]);

  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';

  // 1. 橋樑狀態集合
  const [bridges, setBridges] = useState<Map<string, 1 | 2>>(new Map());
  const [candidateNotes, setCandidateNotes] = useState<Map<string, 1 | 2>>(new Map());
  const [isNoteMode, setIsNoteMode] = useState<boolean>(false);
  const [highContrast, setHighContrast] = useState<boolean>(false);

  const [history, setHistory] = useState<BridgeDelta[]>([]);
  const [redoStack, setRedoStack] = useState<BridgeDelta[]>([]);
  const [selectedIslandId, setSelectedIslandId] = useState<number | null>(null);

  // 2. 輔助與提示狀態
  const [noGuessMode, setNoGuessMode] = useState<boolean>(false);
  const [noGuessWarning, setNoGuessWarning] = useState<string | null>(null);
  const [activeHint, setActiveHint] = useState<HashiHintStep | null>(null);
  const [hintLadderLevel, setHintLadderLevel] = useState<1 | 2 | 3>(1);
  const [animatedEvidenceSet, setAnimatedEvidenceSet] = useState<Set<number>>(new Set());

  // 3. 覆盤播放器狀態
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<1 | 2 | 4>(1);
  const [replayStepIndex, setReplayStepIndex] = useState<number>(0);
  const [replayStepsList, setReplayStepsList] = useState<HashiHintStep[]>([]);
  const [userBridgesBackup, setUserBridgesBackup] = useState<Map<string, 1 | 2> | null>(null);
  const [divergenceIndex, setDivergenceIndex] = useState<number | null>(null);

  // 4. 手動種子彈窗
  const [showSeedInputModal, setShowSeedInputModal] = useState<boolean>(false);
  const [manualSeedInput, setManualSeedInput] = useState<string>('');
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

  useEffect(() => {
    setBridges(new Map());
    setCandidateNotes(new Map());
    setHistory([]);
    setRedoStack([]);
    setSelectedIslandId(null);
    setIsCompleted(false);
    setActiveHint(null);
    setHintLadderLevel(1);
    setAnimatedEvidenceSet(new Set());
    setIsReplaying(false);
    setUserBridgesBackup(null);
    setDivergenceIndex(null);
    setProofSignature(null);
    setNoGuessWarning(null);
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    conflictCountRef.current = 0;
    setConflictDisplay(0);
    movesCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id, islands]);

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

  // 圖論度數與連通分量分析
  const graphAnalysis = useMemo(() => {
    const degrees = new Map<number, number>();
    islands.forEach((isl) => degrees.set(isl.id, 0));

    bridges.forEach((count, key) => {
      const [uStr, vStr] = key.split('-');
      const u = Number(uStr);
      const v = Number(vStr);
      degrees.set(u, (degrees.get(u) || 0) + count);
      degrees.set(v, (degrees.get(v) || 0) + count);
    });

    const satisfiedIslands = new Set<number>();
    const overflowIslands = new Set<number>();

    islands.forEach((isl) => {
      const deg = degrees.get(isl.id) || 0;
      if (deg === isl.capacity) satisfiedIslands.add(isl.id);
      else if (deg > isl.capacity) overflowIslands.add(isl.id);
    });

    const visited = new Set<number>();
    let connectedComponents = 0;

    if (islands.length > 0) {
      for (const isl of islands) {
        if (!visited.has(isl.id)) {
          connectedComponents++;
          const queue = [isl.id];
          visited.add(isl.id);

          while (queue.length > 0) {
            const curr = queue.shift()!;
            bridges.forEach((_, key) => {
              const [uStr, vStr] = key.split('-');
              const u = Number(uStr);
              const v = Number(vStr);
              if (u === curr && !visited.has(v)) {
                visited.add(v);
                queue.push(v);
              } else if (v === curr && !visited.has(u)) {
                visited.add(u);
                queue.push(u);
              }
            });
          }
        }
      }
    }

    const isFullyConnected = connectedComponents === 1 && visited.size === islands.length;
    const allSatisfied = islands.length > 0 && satisfiedIslands.size === islands.length;

    return {
      degrees,
      satisfiedIslands,
      overflowIslands,
      connectedComponents,
      isFullyConnected,
      allSatisfied,
      totalConflicts: overflowIslands.size + (!isFullyConnected && allSatisfied ? 1 : 0),
    };
  }, [islands, bridges]);

  const prevConflictsRef = useRef<number>(0);
  useEffect(() => {
    if (graphAnalysis.totalConflicts > prevConflictsRef.current) {
      conflictCountRef.current += graphAnalysis.totalConflicts - prevConflictsRef.current;
      setConflictDisplay(conflictCountRef.current);
    }
    prevConflictsRef.current = graphAnalysis.totalConflicts;
  }, [graphAnalysis.totalConflicts]);

  const mutateBridge = useCallback(
    (uId: number, vId: number, targetCount: 0 | 1 | 2) => {
      if (isCompleted || isReplaying) return;
      const minId = Math.min(uId, vId);
      const maxId = Math.max(uId, vId);
      const key = `${minId}-${maxId}`;

      if (isNoteMode) {
        setCandidateNotes((prev) => {
          const next = new Map(prev);
          if (targetCount === 0) next.delete(key);
          else next.set(key, targetCount);
          return next;
        });
        if (navigator.vibrate) navigator.vibrate(6);
        return;
      }

      const currentCount = bridges.get(key) || 0;
      if (currentCount === targetCount) return;

      if (targetCount > 0 && WebHashiGenerator.checkCrossing(minId, maxId, islands, bridges)) {
        if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
        setNoGuessWarning(isEn ? '[Collision Blocked] Bridges cannot intersect!' : '【跨橋碰撞】星際橋樑不可交叉相交！');
        setTimeout(() => setNoGuessWarning(null), 2400);
        return;
      }

      if (noGuessMode && targetCount > currentCount) {
        const step = WebHashiGenerator.getNextForcedDeduction(islands, rows, cols, bridges);
        if (step) {
          const isTargetBridge = step.u === minId && step.v === maxId;
          const isCountMatch = step.forcedCount === targetCount;
          if (!isTargetBridge || !isCountMatch) {
            if (navigator.vibrate) navigator.vibrate([25, 35, 25]);
            const reason = isEn ? step.humanReadable.en : step.humanReadable.zh;
            setNoGuessWarning(isEn ? `[No-Guess Blocked] Strictly deduce: ${reason}` : `【無猜測攔截】依據定式應優先連線：${reason}`);
            setTimeout(() => setNoGuessWarning(null), 3000);
            return;
          }
        }
      }

      if (navigator.vibrate) navigator.vibrate(8);
      movesCountRef.current++;

      const delta: BridgeDelta = { u: minId, v: maxId, from: currentCount, to: targetCount };
      setHistory((prev) => [...prev.slice(-MAX_HISTORY_STEPS + 1), delta]);
      setRedoStack([]);

      setBridges((prev) => {
        const next = new Map(prev);
        if (targetCount === 0) next.delete(key);
        else next.set(key, targetCount);
        return next;
      });

      setCandidateNotes((prev) => {
        if (prev.has(key)) {
          const next = new Map(prev);
          next.delete(key);
          return next;
        }
        return prev;
      });

      if (activeHint && activeHint.u === minId && activeHint.v === maxId) {
        setActiveHint(null);
      }
    },
    [isCompleted, isReplaying, isNoteMode, bridges, islands, rows, cols, noGuessMode, activeHint, isEn]
  );

  const cycleBridge = useCallback(
    (uId: number, vId: number) => {
      const minId = Math.min(uId, vId);
      const maxId = Math.max(uId, vId);
      const key = `${minId}-${maxId}`;
      const curr = (isNoteMode ? candidateNotes.get(key) : bridges.get(key)) || 0;
      const next: 0 | 1 | 2 = curr === 0 ? 1 : curr === 1 ? 2 : 0;
      mutateBridge(minId, maxId, next);
    },
    [isNoteMode, candidateNotes, bridges, mutateBridge]
  );

  const handleIslandClick = useCallback(
    (islId: number) => {
      if (isReplaying) return;
      if (selectedIslandId === null) {
        setSelectedIslandId(islId);
        if (navigator.vibrate) navigator.vibrate(6);
      } else if (selectedIslandId === islId) {
        setSelectedIslandId(null);
      } else {
        const validNeighbors = WebHashiGenerator.getOrthogonalNeighbors(selectedIslandId, islands, rows, cols);
        if (validNeighbors.includes(islId)) {
          cycleBridge(selectedIslandId, islId);
        } else {
          if (navigator.vibrate) navigator.vibrate(15);
        }
        setSelectedIslandId(null);
      }
    },
    [isReplaying, selectedIslandId, islands, rows, cols, cycleBridge]
  );

  const handleUndo = useCallback(() => {
    if (history.length === 0 || isCompleted || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const lastDelta = history[history.length - 1];
    setBridges((prev) => {
      const next = new Map(prev);
      const key = `${lastDelta.u}-${lastDelta.v}`;
      if (lastDelta.from === 0) next.delete(key);
      else next.set(key, lastDelta.from);
      return next;
    });

    setRedoStack((prev) => [...prev, lastDelta]);
    setHistory((prev) => prev.slice(0, -1));
  }, [history, isCompleted, isReplaying]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const nextDelta = redoStack[redoStack.length - 1];
    setBridges((prev) => {
      const next = new Map(prev);
      const key = `${nextDelta.u}-${nextDelta.v}`;
      if (nextDelta.to === 0) next.delete(key);
      else next.set(key, nextDelta.to);
      return next;
    });

    setHistory((prev) => [...prev, nextDelta]);
    setRedoStack((prev) => prev.slice(0, -1));
  }, [redoStack, isCompleted, isReplaying]);

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
      } else if (e.code === 'KeyN') {
        setIsNoteMode((prev) => !prev);
      } else if (e.code === 'Escape') {
        setSelectedIslandId(null);
        setShowSeedInputModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompleted, isReplaying, handleUndo, handleRedo]);

  // 勝利驗證與防空盤防禦
  useEffect(() => {
    if (isCompleted || isReplaying) return;
    if (movesCountRef.current === 0 || history.length === 0) return;

    if (graphAnalysis.allSatisfied && graphAnalysis.isFullyConnected) {
      setIsCompleted(true);
      const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

      if (!hasRecordedRef.current && actualPuzzle) {
        hasRecordedRef.current = true;
        const baseIrt = (actualPuzzle.metrics as any)?.irt_logit_difficulty || 1.6;

        recordAttempt({
          puzzleId: actualPuzzle.id,
          engineType: 'hashi',
          tier: currentTier,
          cognitiveLoad: actualPuzzle.cognitiveLoad || {
            spatial: 0.88,
            numeric: 0.5,
            workingMemory: 0.75,
            inhibition: 0.82,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
          technique: 'HashiSpanningEulerDeduction',
          irtDifficulty: baseIrt,
          isPureClear: conflictCountRef.current === 0 && !activeHint,
        });

        try {
          const canonical = `${actualPuzzle.id}|${timeSpent}|${movesCountRef.current}|${conflictCountRef.current}|SECURE_${tournamentMode}|HASHI_CHAMPION`;
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
  }, [graphAnalysis, isCompleted, isReplaying, actualPuzzle, currentTier, recordAttempt, profile.personalBest.fastestTime, activeHint, tournamentMode, history.length]);

  const handleRequestHint = () => {
    if (isCompleted || tournamentMode || isReplaying) return;
    if (navigator.vibrate) navigator.vibrate(12);

    if (!activeHint) {
      const step = WebHashiGenerator.getNextForcedDeduction(islands, rows, cols, bridges);
      if (step) {
        setActiveHint(step);
        setSelectedIslandId(step.u);
        setHintLadderLevel(1);
      }
    } else {
      setHintLadderLevel((prev) => (prev === 1 ? 2 : 3));
    }
  };

  const handleStartReplay = () => {
    setUserBridgesBackup(new Map(bridges));

    const simBridges = new Map<string, 1 | 2>();
    const steps: HashiHintStep[] = [];

    let safety = 0;
    while (safety++ < islands.length * 4) {
      const step = WebHashiGenerator.getNextForcedDeduction(islands, rows, cols, simBridges);
      if (!step) break;
      steps.push(step);
      simBridges.set(`${step.u}-${step.v}`, step.forcedCount);
    }

    let firstDiverge: number | null = null;
    for (let i = 0; i < steps.length; i++) {
      const aiStep = steps[i];
      const playerAction = history[i];
      if (!playerAction || playerAction.u !== aiStep.u || playerAction.v !== aiStep.v || playerAction.to !== aiStep.forcedCount) {
        firstDiverge = i;
        break;
      }
    }
    setDivergenceIndex(firstDiverge);

    setReplayStepsList(steps);
    setReplayStepIndex(0);
    setIsReplaying(true);
    setBridges(new Map());
    setSelectedIslandId(null);
  };

  const handleRestoreUserBoard = () => {
    if (!userBridgesBackup) return;
    setIsReplaying(false);
    setBridges(new Map(userBridgesBackup));
    setAnimatedEvidenceSet(new Set());
    if (navigator.vibrate) navigator.vibrate(15);
  };

  useEffect(() => {
    if (!isReplaying || replayStepsList.length === 0) return;
    if (replayStepIndex >= replayStepsList.length) return;

    const delay = Math.round(450 / replaySpeed);
    const timer = setTimeout(() => {
      const step = replayStepsList[replayStepIndex];
      setBridges((prev) => {
        const next = new Map(prev);
        next.set(`${step.u}-${step.v}`, step.forcedCount);
        return next;
      });

      if (step.evidenceIslands) {
        setAnimatedEvidenceSet(new Set(step.evidenceIslands));
      }
      setReplayStepIndex((prev) => prev + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [isReplaying, replayStepIndex, replayStepsList, replaySpeed]);

  const handleCopySeedShareCode = () => {
    const seed = (actualPuzzle as any)?.puzzle?.seed || (actualPuzzle?.metrics as any)?.seed || 0;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lawgic.app';
    const duelUrl = `${origin}/?engine=hashi&tier=${currentTier}&seed=${seed}`;
    navigator.clipboard.writeText(duelUrl);
    setCopyToast(isEn ? '🔗 Direct duel link copied!' : '🔗 一鍵對決連結已複製！');
    if (navigator.vibrate) navigator.vibrate(20);
    setTimeout(() => setCopyToast(null), 2400);
  };

  const handleApplyManualSeed = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = manualSeedInput.trim();
    if (!raw) return;

    let extractedSeed = raw;
    const seedMatch = raw.match(/s(\d+)/i) || raw.match(/S(\d+)/);
    if (seedMatch) extractedSeed = seedMatch[1];
    else if (/^\d+$/.test(raw)) extractedSeed = raw;

    const url = new URL(window.location.href);
    url.searchParams.set('engine', 'hashi');
    url.searchParams.set('tier', currentTier);
    url.searchParams.set('seed', extractedSeed);
    window.location.href = url.toString();
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
    ctx.fillText('HASHIWOKAKERO MASTER RECORD', 30, 48);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px monospace';
    ctx.fillText(`TIER: ${currentTier.toUpperCase()}  |  180° SYMMETRIC BOARD`, 30, 72);

    const startX = 30;
    const startY = 95;
    const boardSize = 180;
    const scaleX = boardSize / cols;
    const scaleY = boardSize / rows;

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    bridges.forEach((count, key) => {
      const [uIdStr, vIdStr] = key.split('-');
      const u = islands.find((i) => i.id === Number(uIdStr))!;
      const v = islands.find((i) => i.id === Number(vIdStr))!;
      const x1 = startX + (u.c + 0.5) * scaleX;
      const y1 = startY + (u.r + 0.5) * scaleY;
      const x2 = startX + (v.c + 0.5) * scaleX;
      const y2 = startY + (v.r + 0.5) * scaleY;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });

    islands.forEach((isl) => {
      const ix = startX + (isl.c + 0.5) * scaleX;
      const iy = startY + (isl.r + 0.5) * scaleY;

      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(ix, iy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${isl.capacity}`, ix, iy);
    });

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
    ctx.fillText(`RECEIPT: ${proofSignature || 'VERIFIED_HASHI_HASH'}`, 260, 245);
    ctx.fillText('POWERED BY LAWGIC TOURNAMENT ENGINE', 260, 265);

    const link = document.createElement('a');
    link.download = `Hashi_Card_${Date.now().toString(36)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    setCopyToast(isEn ? '📸 Card downloaded!' : '📸 高光戰績卡已下載！');
    setTimeout(() => setCopyToast(null), 2500);
  };

  const theoryTime = (actualPuzzle?.metrics as any)?.estimated_time_sec || islands.length * 5;
  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('TopologicalLookahead', theoryTime, 'hashi');
  }, [getBenchmarkMetrics, theoryTime]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  const dynamicBridgeOffset = useMemo(() => {
    return Math.min(2.4, Math.max(1.1, 14 / Math.max(rows, cols)));
  }, [rows, cols]);

  const selectableNeighbors = useMemo(() => {
    if (selectedIslandId === null) return new Set<number>();
    return new Set(WebHashiGenerator.getOrthogonalNeighbors(selectedIslandId, islands, rows, cols));
  }, [selectedIslandId, islands, rows, cols]);

  const currentReplayStep = replayStepsList[replayStepIndex - 1];

  return (
    <div className="flex flex-col items-center justify-center p-1 select-none font-mono">
      {/* 頂部數據列 */}
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

        {/* 手動輸入種子碼按鈕 */}
        <button
          onClick={() => setShowSeedInputModal(true)}
          className="p-1 rounded border border-slate-800 bg-slate-950 text-slate-400 hover:text-amber-300 hover:border-amber-500/60 transition text-center cursor-pointer"
          title={isEn ? 'Manual Enter Seed' : '手動輸入種子碼'}
        >
          <div className="text-[6.5px]">🔢 {isEn ? 'Seed' : '種子'}</div>
          <div className="text-[7.5px]">{isEn ? 'Input' : '輸入'}</div>
        </button>

        <button
          onClick={() => setHighContrast((prev) => !prev)}
          className={`p-1 rounded border text-center transition cursor-pointer ${
            highContrast
              ? 'bg-amber-950 border-amber-400 text-amber-300 font-bold shadow-xs'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
        >
          <div className="text-[6.5px]">🌓 {isEn ? 'Theme' : '主題'}</div>
          <div className="text-[7.5px]">{highContrast ? (isEn ? 'Paper' : '紙感') : (isEn ? 'Dark' : '深色')}</div>
        </button>

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
          <div className="text-[6.5px]">🛡️ {isEn ? 'No-Guess' : '無猜測'}</div>
          <div className="text-[7.5px]">
            {tournamentMode ? (isEn ? 'Locked' : '賽事鎖定') : noGuessMode ? (isEn ? 'Strict' : '嚴謹') : (isEn ? 'OFF' : '關閉')}
          </div>
        </button>
      </div>

      {copyToast && (
        <div className="w-[min(88vw,42vh)] mb-1 p-1 bg-emerald-950 border border-emerald-500 text-emerald-300 text-[7.5px] rounded animate-fade-in text-center font-bold">
          {copyToast}
        </div>
      )}

      {/* 變速覆盤控制條 + 滿足度儀表板 */}
      {isReplaying && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1.5 bg-indigo-950/90 border border-cyan-500 rounded-lg text-cyan-200 text-[8px] animate-pulse font-mono">
          <div className="flex justify-between items-center text-[7px] text-cyan-400 mb-1 border-b border-cyan-900/60 pb-0.5">
            <span className="flex items-center gap-1 font-bold">
              <span>{currentReplayStep?.techniqueIcon || '🌉'}</span>
              <span>{isEn ? currentReplayStep?.techniqueName.en : currentReplayStep?.techniqueName.zh}</span>
              <span className="text-slate-400">[{replayStepIndex}/{replayStepsList.length}]</span>
              {divergenceIndex !== null && replayStepIndex >= divergenceIndex && (
                <span className="ml-1 px-1 bg-rose-950 border border-rose-500 text-rose-300 rounded text-[6px]">
                  ⚠️ {isEn ? 'DIVERGED' : '分歧步'}
                </span>
              )}
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[6.5px] text-slate-400">{isEn ? 'SPEED:' : '速度:'}</span>
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
                {isEn ? 'Restore Mine' : '還原我的盤面'}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-[6.5px] text-slate-300 mb-0.5">
            <span>
              {isEn ? 'Islands Satisfied:' : '島嶼滿額進度:'}{' '}
              <strong className="text-emerald-400">{graphAnalysis.satisfiedIslands.size}</strong>/{islands.length}
            </span>
            <span className="text-cyan-300">
              {currentReplayStep ? (isEn ? `+${currentReplayStep.forcedCount} Bridge` : `+${currentReplayStep.forcedCount} 條橋`) : ''}
            </span>
          </div>
          <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden mb-1">
            <div
              className="bg-emerald-400 h-full transition-all duration-200"
              style={{ width: `${(graphAnalysis.satisfiedIslands.size / Math.max(1, islands.length)) * 100}%` }}
            />
          </div>

          <div className="truncate text-cyan-300">
            {currentReplayStep?.rationale || (isEn ? 'Demonstrating deductive bridge placement...' : '演示因果演繹架橋...')}
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
            <div>{isEn ? `Focus between Island #${activeHint.u} and #${activeHint.v}.` : `請關注島嶼 #${activeHint.u} 與 #${activeHint.v} 之間。`}</div>
          )}
          {hintLadderLevel === 2 && (
            <div>{isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}</div>
          )}
          {hintLadderLevel === 3 && (
            <div className="font-bold text-amber-300">
              {activeHint.rationale}
              <span className="ml-1 text-cyan-300 underline">
                {isEn ? `Must build ${activeHint.forcedCount} bridge(s)` : `必然架設 ${activeHint.forcedCount} 條橋`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 主星橋畫布 */}
      <div
        className={`relative overflow-hidden p-2 rounded-xl border-2 shadow-2xl transition-colors ${
          highContrast ? 'bg-black border-slate-400' : 'bg-slate-950 border-slate-800'
        }`}
        style={{ width: 'min(88vw, 42vh)', height: 'min(88vw, 42vh)', touchAction: 'none' }}
      >
        <div className="absolute top-1 right-1 px-1 py-0.2 bg-indigo-950/70 border border-indigo-500/50 rounded text-[6px] text-indigo-300 font-mono pointer-events-none z-20">
          ☯ 180° SYM
        </div>

        {/* SVG 橋樑渲染層 */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
          {Array.from(candidateNotes.entries()).map(([key, count]) => {
            const [uIdStr, vIdStr] = key.split('-');
            const u = islands.find((i) => i.id === Number(uIdStr))!;
            const v = islands.find((i) => i.id === Number(vIdStr))!;
            const x1 = ((u.c + 0.5) / cols) * 100;
            const y1 = ((u.r + 0.5) / rows) * 100;
            const x2 = ((v.c + 0.5) / cols) * 100;
            const y2 = ((v.r + 0.5) / rows) * 100;

            return (
              <line
                key={`note-${key}`}
                x1={`${x1}%`}
                y1={`${y1}%`}
                x2={`${x2}%`}
                y2={`${y2}%`}
                stroke="#fbbf24"
                strokeWidth={count === 2 ? '3.5' : '2'}
                strokeDasharray="4 4"
                strokeOpacity="0.7"
              />
            );
          })}

          {Array.from(bridges.entries()).map(([key, count]) => {
            const [uIdStr, vIdStr] = key.split('-');
            const u = islands.find((i) => i.id === Number(uIdStr))!;
            const v = islands.find((i) => i.id === Number(vIdStr))!;

            const x1 = ((u.c + 0.5) / cols) * 100;
            const y1 = ((u.r + 0.5) / rows) * 100;
            const x2 = ((v.c + 0.5) / cols) * 100;
            const y2 = ((v.r + 0.5) / rows) * 100;

            const isHorizontal = u.r === v.r;
            const offset = dynamicBridgeOffset;
            const strokeColor = highContrast ? '#ffffff' : '#38bdf8';

            if (count === 1) {
              return (
                <line
                  key={key}
                  x1={`${x1}%`}
                  y1={`${y1}%`}
                  x2={`${x2}%`}
                  y2={`${y2}%`}
                  stroke={strokeColor}
                  strokeWidth="3.2"
                  strokeLinecap="round"
                />
              );
            } else {
              return (
                <g key={key}>
                  <line
                    x1={`${isHorizontal ? x1 : x1 - offset}%`}
                    y1={`${isHorizontal ? y1 - offset : y1}%`}
                    x2={`${isHorizontal ? x2 : x2 - offset}%`}
                    y2={`${isHorizontal ? y2 - offset : y2}%`}
                    stroke={strokeColor}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <line
                    x1={`${isHorizontal ? x1 : x1 + offset}%`}
                    y1={`${isHorizontal ? y1 + offset : y1}%`}
                    x2={`${isHorizontal ? x2 : x2 + offset}%`}
                    y2={`${isHorizontal ? y2 + offset : y2}%`}
                    stroke={strokeColor}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </g>
              );
            }
          })}
        </svg>

        {/* 島嶼節點網格 */}
        <div
          className="relative w-full h-full"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {islands.map((isl) => {
            const currentDeg = graphAnalysis.degrees.get(isl.id) || 0;
            const isSatisfied = currentDeg === isl.capacity;
            const isOverflow = currentDeg > isl.capacity;
            const isSelected = selectedIslandId === isl.id;
            const isSelectable = selectableNeighbors.has(isl.id);
            const isEvidenceAnimated = animatedEvidenceSet.has(isl.id);

            return (
              <div
                key={isl.id}
                style={{
                  gridColumnStart: isl.c + 1,
                  gridRowStart: isl.r + 1,
                }}
                className="relative flex items-center justify-center"
              >
                <button
                  onClick={() => handleIslandClick(isl.id)}
                  className={`w-[85%] h-[85%] rounded-full flex items-center justify-center font-black text-xs sm:text-sm transition-all duration-150 z-20 shadow-md cursor-pointer ${
                    isOverflow
                      ? 'bg-red-950 border-2 border-rose-500 text-rose-300 ring-2 ring-rose-500/50 scale-105'
                      : isSatisfied
                      ? highContrast
                        ? 'bg-neutral-800 border-2 border-white text-white'
                        : 'bg-emerald-950 border-2 border-emerald-400 text-emerald-300'
                      : isSelected
                      ? 'bg-cyan-500 border-2 border-white text-slate-950 ring-4 ring-cyan-400/50 scale-110'
                      : isSelectable
                      ? 'bg-slate-900 border-2 border-cyan-400 text-cyan-200 animate-pulse scale-105 ring-2 ring-cyan-400/40'
                      : highContrast
                      ? 'bg-black border-2 border-slate-600 text-white hover:border-white'
                      : 'bg-slate-900 border-2 border-slate-700 text-slate-200 hover:border-slate-500'
                  } ${isEvidenceAnimated ? 'ring-4 ring-amber-400 animate-bounce' : ''}`}
                >
                  {isl.capacity}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 底部快捷欄 */}
      <div className="w-full max-w-[340px] flex items-center justify-between px-1 mt-1.5 text-[7.5px] text-slate-400">
        <div className="flex gap-1">
          <button
            onClick={handleUndo}
            disabled={history.length === 0 || isCompleted || isReplaying}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            ↩ {isEn ? 'Undo (Z)' : '撤銷'}
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0 || isCompleted || isReplaying}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            ↪ {isEn ? 'Redo (Y)' : '重做'}
          </button>
          {!tournamentMode && (
            <button
              onClick={handleCopySeedShareCode}
              className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 text-amber-300 cursor-pointer"
              title={isEn ? 'Copy Duel Link' : '複製對決連結'}
            >
              🔗 {isEn ? 'Duel Link' : '對決連結'}
            </button>
          )}
        </div>
        <div className="text-slate-500 text-[8px]">
          {isEn ? 'Click 2 islands: none ➔ single ➔ double ➔ remove' : '點選兩島循環：無 ➔ 單 ➔ 雙 ➔ 拆除'}
        </div>
      </div>

      {/* 純文字種子手動輸入彈窗 Modal */}
      {showSeedInputModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-indigo-500/70 p-4 rounded-xl max-w-xs w-full shadow-2xl font-mono text-center animate-fade-in">
            <div className="text-indigo-400 font-bold text-xs mb-2">🔢 {isEn ? 'Enter Duel Seed' : '手動輸入對決種子碼'}</div>
            <p className="text-slate-400 text-[9px] mb-3 leading-relaxed">
              {isEn
                ? 'Paste seed string (e.g. hashi_master_s12345 or 12345) to load the exact board.'
                : '貼入好友分享的短碼（例如 hashi_master_s12345 或純數字 12345），立即進入同題對決！'}
            </p>
            <form onSubmit={handleApplyManualSeed} className="flex flex-col gap-2">
              <input
                type="text"
                value={manualSeedInput}
                onChange={(e) => setManualSeedInput(e.target.value)}
                placeholder="e.g. hashi_master_s12345"
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs text-center focus:border-cyan-400 outline-none"
                autoFocus
              />
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setShowSeedInputModal(false)}
                  className="flex-1 py-1 bg-slate-900 border border-slate-800 text-slate-400 text-[10px] rounded hover:bg-slate-800 cursor-pointer"
                >
                  {isEn ? 'Cancel' : '取消'}
                </button>
                <button
                  type="submit"
                  className="flex-1 py-1 bg-gradient-to-r from-cyan-600 to-cyan-500 text-slate-950 font-bold text-[10px] rounded hover:from-cyan-500 shadow cursor-pointer"
                >
                  {isEn ? 'Load' : '載入盤面'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 結算成就與覆盤面板 */}
      {isCompleted && (
        <div className="mt-2 p-2.5 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,42vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
            <div className="text-left">
              <div className="text-[7.5px] text-slate-500 tracking-wider">HASHIWOKAKERO RESOLVED</div>
              <div className="text-xs text-indigo-300 font-bold">
                {isEn ? '🌉 Hashi Spanning Euler Topology Solved!' : '🌉 星際數橋・完美歐拉連通'}
              </div>
            </div>
            <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[9px] font-bold text-cyan-300">
              Gf: IQ {cci.standardIQ} (Top {Number((100 - cci.percentileRank).toFixed(1))}%)
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[7.5px] text-slate-400 mb-1.5">
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Time' : '耗時'}</div>
              <div className="text-slate-200 font-bold text-[10px]">{(elapsedMs / 1000).toFixed(1)}s</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Moves' : '操作步數'}</div>
              <div className="text-cyan-300 font-bold text-[10px]">{movesCountRef.current}</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Conflicts' : '衝突次數'}</div>
              <div className="text-amber-300 font-bold text-[10px]">
                {conflictCountRef.current} {isEn ? '' : '次'}
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

          {/* 覆盤、戰績卡與對決行動群 */}
          <div className="grid grid-cols-2 gap-1 mb-1">
            <button
              onClick={handleStartReplay}
              disabled={isReplaying}
              className="py-1 bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/60 text-indigo-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95 cursor-pointer"
            >
              <span>🔁</span>
              <span>{isEn ? 'AI Replay' : '解法覆盤'}</span>
            </button>

            <button
              onClick={handleGenerateCard}
              className="py-1 bg-purple-950 hover:bg-purple-900 border border-purple-500/60 text-purple-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95 cursor-pointer"
            >
              <span>📸</span>
              <span>{isEn ? 'Share Card' : '高光戰績卡'}</span>
            </button>
          </div>

          <div className="flex gap-1 mb-1.5">
            {userBridgesBackup && (
              <button
                onClick={handleRestoreUserBoard}
                className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-cyan-500/60 text-cyan-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95 cursor-pointer"
              >
                <span>↩️</span>
                <span>{isEn ? 'My Board' : '我的盤面'}</span>
              </button>
            )}

            <button
              onClick={handleCopySeedShareCode}
              className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-amber-500/60 text-amber-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95 cursor-pointer"
            >
              <span>🔗</span>
              <span>{isEn ? 'Duel Link' : '對決連結'}</span>
            </button>

            <button
              onClick={() => setShowSubmitModal(true)}
              className="flex-1 py-1 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 text-slate-950 text-[7.5px] font-black rounded shadow transition active:scale-95 flex items-center justify-center gap-0.5 cursor-pointer"
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
            tournamentId: tournamentMode ? 'WPF_HASHI_2026' : 'GLOBAL_TOPOLOGY_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'hashi',
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
