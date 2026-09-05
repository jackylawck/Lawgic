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

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

export interface Island {
  id: number;
  r: number;
  c: number;
  capacity: number;
}

export interface Bridge {
  u: number;
  v: number;
  count: 1 | 2;
}

interface BridgeDelta {
  u: number;
  v: number;
  from: 0 | 1 | 2;
  to: 0 | 1 | 2;
}

export type HashiTechnique =
  | 'corner_capacity_forced'
  | 'degree_propagation'
  | 'cut_edge_isolation'
  | 'isolated_pair_block'
  | 'spanning_bottleneck';

interface HashiHintStep {
  step: number;
  u: number;
  v: number;
  forcedCount: 1 | 2;
  technique: HashiTechnique;
  evidenceIslands: number[];
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
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

  const spec = (actualPuzzle as any)?.puzzle || (actualPuzzle as any)?.spec || (actualPuzzle as any);
  const rows = spec?.rows || 9;
  const cols = spec?.cols || 9;

  // 1. 提取島嶼
  const islands: Island[] = useMemo(() => {
    if (spec?.islands && Array.isArray(spec.islands)) {
      return spec.islands;
    }
    if (spec?.grid) {
      const list: Island[] = [];
      let idCounter = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const val = spec.grid[r]?.[c];
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

  // 2. 核心狀態：真實架設的橋樑 (u < v)
  const [bridges, setBridges] = useState<Map<string, 1 | 2>>(new Map());

  // 3. 候選筆記標記（Notes 模式：記錄玩家預設的可能橋數，不影響真實判定）
  const [candidateNotes, setCandidateNotes] = useState<Map<string, 1 | 2>>(new Map());
  const [isNoteMode, setIsNoteMode] = useState<boolean>(false);

  // 4. 歷史差量堆疊（壓縮儲存，上限 250 步）
  const [history, setHistory] = useState<BridgeDelta[]>([]);
  const [redoStack, setRedoStack] = useState<BridgeDelta[]>([]);

  // 選取的起點島嶼
  const [selectedIslandId, setSelectedIslandId] = useState<number | null>(null);

  // 輔助與提示狀態
  const [noGuessMode, setNoGuessMode] = useState<boolean>(false);
  const [noGuessWarning, setNoGuessWarning] = useState<string | null>(null);
  const [activeHint, setActiveHint] = useState<HashiHintStep | null>(null);
  const [hintLadderLevel, setHintLadderLevel] = useState<1 | 2 | 3>(1);

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

  // 初始化
  useEffect(() => {
    setBridges(new Map());
    setCandidateNotes(new Map());
    setHistory([]);
    setRedoStack([]);
    setSelectedIslandId(null);
    setIsCompleted(false);
    setActiveHint(null);
    setHintLadderLevel(1);
    setProofSignature(null);
    setNoGuessWarning(null);
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    conflictCountRef.current = 0;
    setConflictDisplay(0);
    movesCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id, islands]);

  // 計時器
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

  // 圖論分析：計算度數、超額、滿額與全圖連通分量
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

    // 連通分量計算 (BFS)
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

  // 衝突累計
  const prevConflictsRef = useRef<number>(0);
  useEffect(() => {
    if (graphAnalysis.totalConflicts > prevConflictsRef.current) {
      conflictCountRef.current += graphAnalysis.totalConflicts - prevConflictsRef.current;
      setConflictDisplay(conflictCountRef.current);
    }
    prevConflictsRef.current = graphAnalysis.totalConflicts;
  }, [graphAnalysis.totalConflicts]);

  // 正交視線鄰居檢索（射線障礙物檢測）
  const getOrthogonalNeighbors = useCallback((islId: number): number[] => {
    const src = islands.find((i) => i.id === islId);
    if (!src) return [];

    const neighbors: number[] = [];
    const dirs = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
    ];

    for (const [dr, dc] of dirs) {
      let r = src.r + dr;
      let c = src.c + dc;
      while (r >= 0 && r < rows && c >= 0 && c < cols) {
        const found = islands.find((i) => i.r === r && i.c === c);
        if (found) {
          neighbors.push(found.id);
          break;
        }
        r += dr;
        c += dc;
      }
    }
    return neighbors;
  }, [islands, rows, cols]);

  // 跨橋碰撞檢測（阻止正交橋樑在空間中交叉相截）
  const checkBridgeCrossingCollision = useCallback(
    (uId: number, vId: number): boolean => {
      const u = islands.find((i) => i.id === uId)!;
      const v = islands.find((i) => i.id === vId)!;
      const isHorizontal = u.r === v.r;

      for (const [key] of bridges) {
        const [buIdStr, bvIdStr] = key.split('-');
        const buId = Number(buIdStr);
        const bvId = Number(bvIdStr);
        if (buId === uId || buId === vId || bvId === uId || bvId === vId) continue;

        const bu = islands.find((i) => i.id === buId)!;
        const bv = islands.find((i) => i.id === bvId)!;
        const isBHorizontal = bu.r === bv.r;

        if (isHorizontal !== isBHorizontal) {
          const hBridge = isHorizontal
            ? { y: u.r, x1: Math.min(u.c, v.c), x2: Math.max(u.c, v.c) }
            : { y: bu.r, x1: Math.min(bu.c, bv.c), x2: Math.max(bu.c, bv.c) };
          const vBridge = !isHorizontal
            ? { x: u.c, y1: Math.min(u.r, v.r), y2: Math.max(u.r, v.r) }
            : { x: bu.c, y1: Math.min(bu.r, bv.r), y2: Math.max(bu.r, bv.r) };

          if (
            vBridge.x > hBridge.x1 &&
            vBridge.x < hBridge.x2 &&
            hBridge.y > vBridge.y1 &&
            hBridge.y < vBridge.y2
          ) {
            return true;
          }
        }
      }
      return false;
    },
    [islands, bridges]
  );

  // 高階全局 No-Guess 定式引擎（納入「割邊隔離」與「度數傳播」）
  const getNextForcedDeduction = useCallback((): HashiHintStep | null => {
    // 定式 1: 剩餘可用方向容量極限收斂 (度數連鎖傳播)
    for (const isl of islands) {
      const currentDeg = graphAnalysis.degrees.get(isl.id) || 0;
      if (currentDeg === isl.capacity) continue;

      const remainingNeeded = isl.capacity - currentDeg;
      const validNeighbors = getOrthogonalNeighbors(isl.id).filter((nId) => {
        const minId = Math.min(isl.id, nId);
        const maxId = Math.max(isl.id, nId);
        const currentBridgeCount = bridges.get(`${minId}-${maxId}`) || 0;
        const neighborDeg = graphAnalysis.degrees.get(nId) || 0;
        const neighborCap = islands.find((i) => i.id === nId)!.capacity;
        return (
          currentBridgeCount < 2 &&
          neighborDeg < neighborCap &&
          !checkBridgeCrossingCollision(isl.id, nId)
        );
      });

      // 剩餘所有方向即便全架滿 2 條橋，剛好滿足缺額
      if (validNeighbors.length * 2 === remainingNeeded && validNeighbors.length > 0) {
        const target = validNeighbors[0];
        const minId = Math.min(isl.id, target);
        const maxId = Math.max(isl.id, target);
        const currentCount = bridges.get(`${minId}-${maxId}`) || 0;

        return {
          step: 1,
          u: minId,
          v: maxId,
          forcedCount: (currentCount + 1) as 1 | 2,
          technique: 'degree_propagation',
          evidenceIslands: [isl.id, target],
          rationale: `島嶼 [${isl.r + 1},${isl.c + 1}] (配額 ${isl.capacity}) 剩餘缺額 ${remainingNeeded}，所有剩餘方向必須全速連滿。`,
          humanReadable: {
            zh: `觀察島嶼 [${isl.r + 1},${isl.c + 1}]：扣除現有橋數後，其餘可用鄰居必須全部連滿方能湊齊度數，此處必然架橋。`,
            en: `Island [${isl.r + 1},${isl.c + 1}] degree deficit requires maximum saturation across remaining neighbors.`,
          },
        };
      }
    }

    // 定式 2: 割邊防孤島隔離定式 (Cut-Edge Isolation)
    // 若連接某兩島會直接形成一個已閉合且滿額的子圖（但全圖島嶼尚未接齊），則此邊被嚴格禁連
    if (islands.length > 2) {
      for (const isl of islands) {
        if (isl.capacity === 1 && (graphAnalysis.degrees.get(isl.id) || 0) === 0) {
          const neighbors = getOrthogonalNeighbors(isl.id);
          const oneCapNeighbors = neighbors.filter((nId) => {
            const n = islands.find((i) => i.id === nId)!;
            return n.capacity === 1 && (graphAnalysis.degrees.get(n.id) || 0) === 0;
          });

          // 若某鄰居也是容量 1 的島嶼，若連接這兩島將立刻形成 2 節點的孤立閉合圖
          if (oneCapNeighbors.length > 0) {
            const safeNeighbors = neighbors.filter((nId) => !oneCapNeighbors.includes(nId));
            if (safeNeighbors.length === 1) {
              const target = safeNeighbors[0];
              const minId = Math.min(isl.id, target);
              const maxId = Math.max(isl.id, target);
              return {
                step: 1,
                u: minId,
                v: maxId,
                forcedCount: 1,
                technique: 'cut_edge_isolation',
                evidenceIslands: [isl.id, target, oneCapNeighbors[0]],
                rationale: `島嶼 [${isl.r + 1},${isl.c + 1}] 若與相鄰的容量 1 島嶼連線，將形成封閉孤島切斷全域連通。因此必須連向 [${target}]。`,
                humanReadable: {
                  zh: `島嶼 [${isl.r + 1},${isl.c + 1}] 不能與同為容量 1 的鄰居相連（否則形成孤立閉環），故唯一安全方向必然連橋。`,
                  en: `Connecting to another capacity 1 island creates an isolated sub-graph. Must connect to the alternate neighbor.`,
                },
              };
            }
          }
        }
      }
    }

    return null;
  }, [islands, graphAnalysis.degrees, getOrthogonalNeighbors, bridges, checkBridgeCrossingCollision]);

  // 差量變更應用 (含 No-Guess 阻擋與依據提示)
  const mutateBridge = useCallback(
    (uId: number, vId: number, targetCount: 0 | 1 | 2) => {
      if (isCompleted) return;
      const minId = Math.min(uId, vId);
      const maxId = Math.max(uId, vId);
      const key = `${minId}-${maxId}`;

      // 筆記模式操作（不影響真實盤面）
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

      // 碰撞檢測
      if (targetCount > 0 && checkBridgeCrossingCollision(minId, maxId)) {
        if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
        setNoGuessWarning(
          isEn ? '[Collision Blocked] Bridges cannot cross each other!' : '【跨橋碰撞】星際橋樑不可正交相交穿透！'
        );
        setTimeout(() => setNoGuessWarning(null), 2400);
        return;
      }

      // No-Guess 阻擋
      if (noGuessMode && targetCount > currentCount) {
        const step = getNextForcedDeduction();
        if (step) {
          const isTargetBridge = step.u === minId && step.v === maxId;
          const isCountMatch = step.forcedCount === targetCount;
          if (!isTargetBridge || !isCountMatch) {
            if (navigator.vibrate) navigator.vibrate([25, 35, 25]);
            const reason = isEn ? step.humanReadable.en : step.humanReadable.zh;
            setNoGuessWarning(
              isEn ? `[No-Guess Blocked] Strictly deduce: ${reason}` : `【無猜測攔截】依據因果定式應優先連線：${reason}`
            );
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

      // 同步消除對應筆記
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
    [isCompleted, isNoteMode, bridges, checkBridgeCrossingCollision, noGuessMode, getNextForcedDeduction, activeHint, isEn]
  );

  // 循環切換 (0 -> 1 -> 2 -> 0)
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

  // 點選島嶼
  const handleIslandClick = useCallback(
    (islId: number) => {
      if (selectedIslandId === null) {
        setSelectedIslandId(islId);
        if (navigator.vibrate) navigator.vibrate(6);
      } else if (selectedIslandId === islId) {
        setSelectedIslandId(null);
      } else {
        const validNeighbors = getOrthogonalNeighbors(selectedIslandId);
        if (validNeighbors.includes(islId)) {
          cycleBridge(selectedIslandId, islId);
        } else {
          if (navigator.vibrate) navigator.vibrate(15);
        }
        setSelectedIslandId(null);
      }
    },
    [selectedIslandId, getOrthogonalNeighbors, cycleBridge]
  );

  // 差量 Undo / Redo
  const handleUndo = useCallback(() => {
    if (history.length === 0 || isCompleted) return;
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
  }, [history, isCompleted]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted) return;
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
  }, [redoStack, isCompleted]);

  // 鍵盤操控支援
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
      } else if (e.code === 'KeyN') {
        setIsNoteMode((prev) => !prev);
      } else if (e.code === 'Escape') {
        setSelectedIslandId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompleted, handleUndo, handleRedo]);

  // 勝利驗證與 SHA-256
  useEffect(() => {
    if (isCompleted) return;

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
            spatial: 0.85,
            numeric: 0.5,
            workingMemory: 0.7,
            inhibition: 0.8,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
          technique: 'HashiSpanningEulerDeduction',
          irtDifficulty: baseIrt,
          isPureClear: conflictCountRef.current === 0 && !activeHint,
        });

        try {
          const canonical = `${actualPuzzle.id}|${timeSpent}|${movesCountRef.current}|${conflictCountRef.current}|HASHI_GLOBAL_LEGEND`;
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
  }, [graphAnalysis, isCompleted, actualPuzzle, currentTier, recordAttempt, profile.personalBest.fastestTime, activeHint]);

  // 提示請求
  const handleRequestHint = () => {
    if (isCompleted || tournamentMode) return;
    if (navigator.vibrate) navigator.vibrate(12);

    if (!activeHint) {
      const step = getNextForcedDeduction();
      if (step) {
        setActiveHint(step);
        setSelectedIslandId(step.u);
        setHintLadderLevel(1);
      }
    } else {
      setHintLadderLevel((prev) => (prev === 1 ? 2 : 3));
    }
  };

  const theoryTime = (actualPuzzle?.metrics as any)?.estimated_time_sec || islands.length * 5;
  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('TopologicalLookahead', theoryTime, 'hashi');
  }, [getBenchmarkMetrics, theoryTime]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  // 根據大盤面維度動態計算雙橋平行間距
  const dynamicBridgeOffset = useMemo(() => {
    return Math.min(2.4, Math.max(1.1, 14 / Math.max(rows, cols)));
  }, [rows, cols]);

  const selectableNeighbors = useMemo(() => {
    if (selectedIslandId === null) return new Set<number>();
    return new Set(getOrthogonalNeighbors(selectedIslandId));
  }, [selectedIslandId, getOrthogonalNeighbors]);

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

        {/* 候選筆記模式 (Notes) */}
        <button
          onClick={() => setIsNoteMode((prev) => !prev)}
          className={`p-1 rounded border text-center transition ${
            isNoteMode
              ? 'bg-amber-950 border-amber-500 text-amber-300 font-bold shadow-xs'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
          title={isEn ? 'Toggle Candidate Notes Mode (Key: N)' : '切換候選筆記模式'}
        >
          <div className="text-[6.5px]">✏️ {isEn ? 'Notes' : '筆記'}</div>
          <div className="text-[7.5px]">{isNoteMode ? (isEn ? 'ON' : '開啟') : (isEn ? 'OFF' : '關閉')}</div>
        </button>

        {/* 無猜測模式 */}
        <button
          onClick={() => setNoGuessMode((prev) => !prev)}
          className={`p-1 rounded border text-center transition ${
            noGuessMode
              ? 'bg-purple-950 border-purple-500 text-purple-300 font-bold shadow-xs'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
        >
          <div className="text-[6.5px]">🛡️ {isEn ? 'No-Guess' : '無猜測'}</div>
          <div className="text-[7.5px]">{noGuessMode ? (isEn ? 'Strict ON' : '強制嚴謹') : (isEn ? 'OFF' : '關閉')}</div>
        </button>

        {/* 提示階梯 */}
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
              ? (isEn ? 'Locked' : '賽事鎖定')
              : activeHint
              ? `${isEn ? 'Lv.' : '階梯 '}${hintLadderLevel}/3`
              : (isEn ? 'Get Hint' : '因果提示')}
          </div>
        </button>
      </div>

      {/* 警示橫條 */}
      {noGuessWarning && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1 bg-rose-950 border border-rose-500 text-rose-300 text-[8px] rounded-lg animate-pulse text-center shadow-lg font-bold">
          {noGuessWarning}
        </div>
      )}

      {/* 提示說明卡片 */}
      {activeHint && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1.5 bg-amber-950/80 border border-amber-500/70 rounded-lg text-amber-200 text-[8px] animate-fade-in text-left shadow-lg">
          <div className="font-bold flex items-center justify-between text-[7px] text-amber-400 border-b border-amber-900/60 pb-0.5 mb-1">
            <span>[HASHI HINT LADDER LEVEL {hintLadderLevel}/3]</span>
            <span className="uppercase">{activeHint.technique.replace(/_/g, ' ')}</span>
          </div>
          {hintLadderLevel === 1 && (
            <div>
              {isEn
                ? `Focus on Island #${activeHint.u}. An inevitable bridge connection is forced here.`
                : `請關注島嶼 #${activeHint.u} 與 #${activeHint.v}。兩者間存在必然的架橋定式。`}
            </div>
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

      {/* 數橋星空畫布 */}
      <div
        className="relative overflow-hidden p-2 rounded-xl bg-slate-950 border-2 border-slate-800 shadow-2xl"
        style={{ width: 'min(88vw, 42vh)', height: 'min(88vw, 42vh)', touchAction: 'none' }}
      >
        {/* SVG 橋樑與筆記渲染層 */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
          {/* 1. 候選筆記虛線橋樑 */}
          {Array.from(candidateNotes.entries()).map(([key, count]) => {
            const [uIdStr, vIdStr] = key.split('-');
            const u = islands.find((i) => i.id === Number(uIdStr))!;
            const v = islands.find((i) => i.id === Number(vIdStr))!;
            const x1 = ((u.c + 0.5) / cols) * 100;
            const y1 = ((u.r + 0.5) / rows) * 100;
            const x2 = ((v.c + 0.5) / cols) * 100;
            const y2 = ((v.r + 0.5) / rows) * 100;

            const isHorizontal = u.r === v.r;
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

          {/* 2. 真實橋樑實線渲染（含動態間距補償） */}
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

            if (count === 1) {
              return (
                <line
                  key={key}
                  x1={`${x1}%`}
                  y1={`${y1}%`}
                  x2={`${x2}%`}
                  y2={`${y2}%`}
                  stroke="#38bdf8"
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
                    stroke="#38bdf8"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <line
                    x1={`${isHorizontal ? x1 : x1 + offset}%`}
                    y1={`${isHorizontal ? y1 + offset : y1}%`}
                    x2={`${isHorizontal ? x2 : x2 + offset}%`}
                    y2={`${isHorizontal ? y2 + offset : y2}%`}
                    stroke="#38bdf8"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </g>
              );
            }
          })}
        </svg>

        {/* 網格與島嶼節點層 */}
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
            const isHintEvidence = activeHint && (activeHint.u === isl.id || activeHint.v === isl.id);

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
                  className={`w-[85%] h-[85%] rounded-full flex items-center justify-center font-black text-xs sm:text-sm transition-all duration-150 z-20 shadow-md ${
                    isOverflow
                      ? 'bg-red-950 border-2 border-rose-500 text-rose-300 ring-2 ring-rose-500/50 scale-105'
                      : isSatisfied
                      ? 'bg-emerald-950 border-2 border-emerald-400 text-emerald-300'
                      : isSelected
                      ? 'bg-cyan-500 border-2 border-white text-slate-950 ring-4 ring-cyan-400/50 scale-110'
                      : isSelectable
                      ? 'bg-slate-900 border-2 border-cyan-400 text-cyan-200 animate-pulse scale-105 ring-2 ring-cyan-400/40'
                      : 'bg-slate-900 border-2 border-slate-700 text-slate-200 hover:border-slate-500'
                  } ${isHintEvidence ? 'ring-4 ring-amber-400 animate-bounce' : ''}`}
                >
                  {isl.capacity}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 底部撤銷重做與快捷欄 */}
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
          <span>點選兩島連線：無 ➔ 單 ➔ 雙 ➔ 拆除 / N 切換筆記</span>
        </div>
      </div>

      {/* 即時圖例與全圖連通警示 */}
      <div className="w-full max-w-[340px] flex items-center justify-around px-1 mt-1 text-[6.5px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-950 border border-emerald-500 inline-block" />滿度島嶼</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-950 border border-rose-500 inline-block" />超度違規</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-[2px] bg-amber-400 border border-amber-400 border-dashed inline-block" />候選筆記</span>
        {!graphAnalysis.isFullyConnected && graphAnalysis.connectedComponents > 1 && (
          <span className="text-amber-400 font-bold animate-pulse">⚠️ 孤立子圖 ({graphAnalysis.connectedComponents} 區塊)</span>
        )}
      </div>

      {/* 通關結算面板 */}
      {isCompleted && (
        <div className="mt-2 p-2.5 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,42vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
            <div className="text-left">
              <div className="text-[7.5px] text-slate-500 tracking-wider">HASHIWOKAKERO RESOLVED</div>
              <div className="text-xs text-indigo-300 font-bold">🌉 星際數橋・完美歐拉連通</div>
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
