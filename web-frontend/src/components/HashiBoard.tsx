// web-frontend/src/components/HashiBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity } from '../generated';
import { useLearnerProfile, TierKey } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { HashiIsland, HashiHintStep, HashiBridge } from '../engines/hashiGenerator';
import { MetricErrorBar } from './MetricErrorBar';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

interface HintLogEntry {
  timestamp: number;
  secFromStart: number;
  level: number;
  targetIslandId: number;
}

export const HashiBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const {
    recordAttempt,
    saveBookmark,
    removeBookmark,
    getBenchmarkMetrics,
    profile,
    getCompositeCognitiveIndex,
    exportLongitudinalDataset,
  } = useLearnerProfile();

  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const [internalAssessment, setInternalAssessment] = useState<boolean>(false);
  const isAssessmentMode = tournamentMode || internalAssessment;

  const [isPureMode, setIsPureMode] = useState<boolean>(false);

  const spec = actualPuzzle?.puzzle as any;
  const size: number = spec?.size || 9;
  const islands: HashiIsland[] = useMemo(() => spec?.islands || [], [spec]);
  const hints: HashiHintStep[] = useMemo(() => spec?.hints || [], [spec]);
  const solutionBridges: HashiBridge[] = useMemo(() => (actualPuzzle?.solution as HashiBridge[]) || [], [actualPuzzle]);
  const metrics = (actualPuzzle?.metrics as any) || {};
  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';
  const theoryTime = metrics.estimated_time_sec || 120;
  const standardTimeLimit = currentTier === 'kids' ? 180 : currentTier === 'intermediate' ? 300 : 480;

  // 自適應冷卻
  const calculatedBaseCooldown = useMemo(() => {
    const tierMap: Record<TierKey, number> = {
      kids: 15,
      intermediate: 20,
      expert: 30,
      master: 45,
    };
    const base = tierMap[currentTier] || 25;
    const stat = profile.techniqueStats?.['GraphTopologyInference'];
    if (stat && stat.accuracy >= 0.9) return Math.max(10, Math.round(base * 0.8));
    return base;
  }, [currentTier, profile.techniqueStats]);

  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('GraphTopologyInference', theoryTime);
  }, [getBenchmarkMetrics, theoryTime]);

  const [bridges, setBridges] = useState<Map<string, number>>(new Map());
  const [selectedIslandId, setSelectedIslandId] = useState<number | null>(null);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isResigned, setIsResigned] = useState<boolean>(false);
  const [isTimedOut, setIsTimedOut] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);
  const [bookmarkToast, setBookmarkToast] = useState<string | null>(null);

  // 提示狀態
  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHintText, setActiveHintText] = useState<string | null>(null);
  const [hintCooldown, setHintCooldown] = useState<number>(calculatedBaseCooldown);

  const lastMatchSummaryRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);
  const hintUsageLogRef = useRef<HintLogEntry[]>([]);

  const getBridgeKey = (id1: number, id2: number) => {
    return id1 < id2 ? `${id1}_${id2}` : `${id2}_${id1}`;
  };

  useEffect(() => {
    const bookmark = profile.bookmarks[actualPuzzle?.id || ''];
    if (bookmark) {
      setBridges(new Map(bookmark.savedBridges));
      setElapsedSec(bookmark.elapsedSec);
      setBookmarkToast(isEn ? 'Restored bookmarked progress' : '已自動恢復上次暫存進度');
      setTimeout(() => setBookmarkToast(null), 2500);
    } else {
      setBridges(new Map());
      setElapsedSec(0);
    }

    setSelectedIslandId(null);
    setIsCompleted(false);
    setIsResigned(false);
    setIsTimedOut(false);
    setProofSignature(null);
    setHintLevel(0);
    setActiveHintText(null);
    setHintCooldown(calculatedBaseCooldown);
    startTimeRef.current = Date.now() - (bookmark?.elapsedSec ? bookmark.elapsedSec * 1000 : 0);
    conflictCountRef.current = 0;
    hasRecordedRef.current = false;
    hintUsageLogRef.current = [];
  }, [actualPuzzle?.id, calculatedBaseCooldown, profile.bookmarks, isEn]);

  useEffect(() => {
    if (isCompleted || isTimedOut || isResigned) return;
    const timer = setInterval(() => {
      const cur = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSec(cur);

      setHintCooldown((prev) => (prev > 0 ? prev - 1 : 0));

      if (isAssessmentMode && cur >= standardTimeLimit) {
        setIsTimedOut(true);
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          lastMatchSummaryRef.current = '⏱️ TIMED OUT';
          recordAttempt({
            puzzleId: actualPuzzle?.id || 'unknown',
            engineType: 'hashi',
            tier: currentTier,
            cognitiveLoad: actualPuzzle?.cognitiveLoad || { spatial: 0.8, numeric: 0.5, workingMemory: 0.7, inhibition: 0.8 },
            isSuccess: false,
            timeSpentSec: standardTimeLimit,
            conflictsCount: conflictCountRef.current,
            technique: 'GraphTopologyInference',
            isPureModeAttempt: isPureMode,
            isPureClear: false,
            hintLogs: hintUsageLogRef.current,
          });
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isCompleted, isTimedOut, isResigned, isAssessmentMode, isPureMode, standardTimeLimit, actualPuzzle, currentTier, recordAttempt]);

  const currentIslandCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    islands.forEach((isl) => (counts[isl.id] = 0));
    bridges.forEach((count, key) => {
      const [id1, id2] = key.split('_').map(Number);
      counts[id1] = (counts[id1] || 0) + count;
      counts[id2] = (counts[id2] || 0) + count;
    });
    return counts;
  }, [islands, bridges]);

  const connectedComponentsCount = useMemo(() => {
    if (islands.length === 0) return 0;
    const adj = new Map<number, number[]>();
    islands.forEach((i) => adj.set(i.id, []));

    bridges.forEach((count, key) => {
      if (count > 0) {
        const [id1, id2] = key.split('_').map(Number);
        adj.get(id1)!.push(id2);
        adj.get(id2)!.push(id1);
      }
    });

    const visited = new Set<number>();
    let compCount = 0;

    for (const isl of islands) {
      if (!visited.has(isl.id)) {
        compCount++;
        const q = [isl.id];
        visited.add(isl.id);
        while (q.length > 0) {
          const c = q.shift()!;
          for (const nxt of adj.get(c) || []) {
            if (!visited.has(nxt)) {
              visited.add(nxt);
              q.push(nxt);
            }
          }
        }
      }
    }
    return compCount;
  }, [islands, bridges]);

  const checkVictory = useCallback(
    async (nextBridges: Map<string, number>) => {
      const counts: Record<number, number> = {};
      islands.forEach((isl) => (counts[isl.id] = 0));
      nextBridges.forEach((count, key) => {
        const [id1, id2] = key.split('_').map(Number);
        counts[id1] = (counts[id1] || 0) + count;
        counts[id2] = (counts[id2] || 0) + count;
      });

      const allMet = islands.every((isl) => counts[isl.id] === isl.expectedCount);
      if (!allMet || connectedComponentsCount !== 1) return;

      setIsCompleted(true);
      if (!hasRecordedRef.current) {
        hasRecordedRef.current = true;
        const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        const pureClear = isPureMode || hintUsageLogRef.current.length === 0;
        lastMatchSummaryRef.current = pureClear ? '🔥 PURE CLEAR' : `💡 WARM-UP (HINTS ×${hintUsageLogRef.current.length})`;

        removeBookmark(actualPuzzle?.id || '');

        recordAttempt({
          puzzleId: actualPuzzle?.id || 'hashi',
          engineType: 'hashi',
          tier: currentTier,
          cognitiveLoad: actualPuzzle?.cognitiveLoad || { spatial: 0.8, numeric: 0.5, workingMemory: 0.7, inhibition: 0.8 },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
          technique: 'GraphTopologyInference',
          isPureModeAttempt: isPureMode,
          isPureClear: pureClear,
          hintLogs: hintUsageLogRef.current,
        });

        try {
          const pureFlag = pureClear ? `PURE_STREAK_${profile.pureStreak + 1}` : `WARMUP_${hintUsageLogRef.current.length}_HINTS`;
          const canonical = `${actualPuzzle?.id}|${timeSpent}|${conflictCountRef.current}|${pureFlag}|HASHI_VERIFIED`;
          const enc = new TextEncoder();
          const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(canonical));
          const hex = Array.from(new Uint8Array(buf))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          setProofSignature(`VERIFIED_${hex.slice(0, 24).toUpperCase()}`);
        } catch {
          setProofSignature(`LOCAL_${Date.now()}`);
        }

        if (benchmarkData.isNewPB) {
          setShowPBModal(true);
        }
      }
    },
    [islands, connectedComponentsCount, actualPuzzle, currentTier, recordAttempt, removeBookmark, benchmarkData.isNewPB, isPureMode, profile.pureStreak]
  );

  const handleBookmarkPuzzle = useCallback(() => {
    if (isCompleted || isTimedOut || isResigned || !actualPuzzle) return;
    saveBookmark({
      puzzleId: actualPuzzle.id,
      engineType: 'hashi',
      tier: currentTier,
      savedBridges: Array.from(bridges.entries()),
      elapsedSec,
      bookmarkedAt: new Date().toISOString(),
    });
    setBookmarkToast(isEn ? '📌 Progress bookmarked for later' : '📌 已暫存此局進度，可隨時接續');
    setTimeout(() => setBookmarkToast(null), 2500);
    if (navigator.vibrate) navigator.vibrate([25, 40]);
  }, [isCompleted, isTimedOut, isResigned, actualPuzzle, currentTier, bridges, elapsedSec, saveBookmark, isEn]);

  const handleGracefulResign = useCallback(() => {
    if (isCompleted || isTimedOut || isResigned) return;
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);

    setIsResigned(true);
    hasRecordedRef.current = true;
    lastMatchSummaryRef.current = isPureMode ? '🕊️ PURE RESIGNED' : '🕊️ RESIGNED';

    removeBookmark(actualPuzzle?.id || '');

    const solutionMap = new Map<string, number>();
    solutionBridges.forEach((b) => {
      solutionMap.set(getBridgeKey(b.fromId, b.toId), b.count);
    });
    setBridges(solutionMap);

    const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    recordAttempt({
      puzzleId: actualPuzzle?.id || 'hashi',
      engineType: 'hashi',
      tier: currentTier,
      cognitiveLoad: actualPuzzle?.cognitiveLoad || { spatial: 0.8, numeric: 0.5, workingMemory: 0.7, inhibition: 0.8 },
      isSuccess: false,
      timeSpentSec: timeSpent,
      conflictsCount: conflictCountRef.current,
      technique: 'GraphTopologyInference',
      partialCompletionRatio: 0.5,
      isPureModeAttempt: isPureMode,
      isPureClear: false,
      hintLogs: hintUsageLogRef.current,
    });
  }, [isCompleted, isTimedOut, isResigned, isPureMode, solutionBridges, actualPuzzle, currentTier, recordAttempt, removeBookmark]);

  const canConnect = (islA: HashiIsland, islB: HashiIsland): boolean => {
    if (islA.x !== islB.x && islA.y !== islB.y) return false;

    if (islA.x === islB.x) {
      const minY = Math.min(islA.y, islB.y);
      const maxY = Math.max(islA.y, islB.y);
      if (islands.some((i) => i.id !== islA.id && i.id !== islB.id && i.x === islA.x && i.y > minY && i.y < maxY)) {
        return false;
      }
    } else {
      const minX = Math.min(islA.x, islB.x);
      const maxX = Math.max(islA.x, islB.x);
      if (islands.some((i) => i.id !== islA.id && i.id !== islB.id && i.y === islA.y && i.x > minX && i.x < maxX)) {
        return false;
      }
    }
    return true;
  };

  const currentHintStep = hints.find((h) => h.level === hintLevel);

  const handleIslandClick = (clickedId: number) => {
    if (isCompleted || isTimedOut || isResigned) return;

    if (selectedIslandId === null) {
      setSelectedIslandId(clickedId);
      if (navigator.vibrate) navigator.vibrate(15);
      return;
    }

    if (selectedIslandId === clickedId) {
      setSelectedIslandId(null);
      return;
    }

    const islA = islands.find((i) => i.id === selectedIslandId)!;
    const islB = islands.find((i) => i.id === clickedId)!;

    if (canConnect(islA, islB)) {
      const key = getBridgeKey(islA.id, islB.id);
      const curCount = bridges.get(key) || 0;
      const nextCount = (curCount + 1) % 3;

      const nextBridges = new Map(bridges);
      if (nextCount === 0) nextBridges.delete(key);
      else nextBridges.set(key, nextCount);

      if (
        hintLevel === 3 &&
        currentHintStep &&
        ((islA.id === currentHintStep.targetIslandId && islB.id === currentHintStep.neighborIslandId) ||
          (islB.id === currentHintStep.targetIslandId && islA.id === currentHintStep.neighborIslandId))
      ) {
        setHintLevel(0);
        setActiveHintText(isEn ? '✨ Strategic step confirmed!' : '✨ 必然推理步已由您手動確認！');
        setTimeout(() => setActiveHintText(null), 3000);
      }

      setBridges(nextBridges);
      checkVictory(nextBridges);
      if (navigator.vibrate) navigator.vibrate(25);
    } else {
      conflictCountRef.current += 1;
      if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    }

    setSelectedIslandId(null);
  };

  const triggerHintLadder = () => {
    if (isPureMode || hintCooldown > 0 || hints.length === 0 || isCompleted || isTimedOut || isResigned) return;

    const nextLevel = Math.min(3, hintLevel + 1);
    const hintData = hints.find((h) => h.level === nextLevel) || hints[hints.length - 1];

    setHintLevel(nextLevel);
    setActiveHintText(isEn ? hintData.messageEn : hintData.messageZh);

    hintUsageLogRef.current.push({
      timestamp: Date.now(),
      secFromStart: elapsedSec,
      level: nextLevel,
      targetIslandId: hintData.targetIslandId,
    });

    if (nextLevel === 1 || nextLevel === 2) {
      setSelectedIslandId(hintData.targetIslandId);
    } else if (nextLevel === 3) {
      setSelectedIslandId(null);
    }

    if (navigator.vibrate) navigator.vibrate(30);
  };

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);
  const remainingTime = Math.max(0, standardTimeLimit - elapsedSec);

  const highlightedTargetId = currentHintStep?.targetIslandId;
  const highlightedNeighborId = currentHintStep?.neighborIslandId;

  // 提示長期趨勢計算
  const trendTotal = profile.hintTrend.totalCalls || 1;
  const t1Pct = Math.round((profile.hintTrend.t1Count / trendTotal) * 100);
  const t2Pct = Math.round((profile.hintTrend.t2Count / trendTotal) * 100);
  const t3Pct = Math.round((profile.hintTrend.t3Count / trendTotal) * 100);

  return (
    <div className="flex flex-col items-center w-full select-none py-1 font-mono">
      {/* 暫存氣泡提示 */}
      {bookmarkToast && (
        <div className="fixed top-2 z-50 px-3 py-1.5 bg-indigo-600 border border-indigo-400 text-white font-bold text-xs rounded-full shadow-2xl animate-bounce">
          {bookmarkToast}
        </div>
      )}

      {/* 頂部施測、純挑戰模式、PURE STREAK、HUD */}
      <div className="w-[min(90vw,46vh)] flex items-center justify-between text-[8px] text-slate-500 mb-1 px-1">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setInternalAssessment((prev) => !prev)}
            className={`px-1.5 py-0.5 rounded border transition text-[7px] font-bold ${
              isAssessmentMode
                ? 'bg-rose-950/80 border-rose-600 text-rose-300'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {isAssessmentMode ? (isEn ? '● ASSESSMENT' : '● 標準施測') : (isEn ? '○ TRAINING' : '○ 自由訓練')}
          </button>

          <button
            onClick={() => {
              setIsPureMode((prev) => !prev);
              setHintLevel(0);
              setActiveHintText(null);
            }}
            className={`px-1.5 py-0.5 rounded border transition text-[7px] font-bold flex items-center gap-0.5 ${
              isPureMode
                ? 'bg-amber-950/90 border-amber-500 text-amber-300 shadow-xs shadow-amber-500/50'
                : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            <span>🔥</span>
            <span>{isEn ? 'PURE' : '純挑戰'}</span>
          </button>

          {/* 💎 PURE STREAK 連勝徽章 (附帶 Streak Shield 提示) */}
          {profile.pureStreak >= 2 && (
            <span
              className="px-1.5 py-0.2 bg-gradient-to-r from-amber-950 to-purple-950 border border-amber-500 text-amber-300 rounded text-[6.5px] font-bold flex items-center gap-0.5 animate-pulse"
              title={!isPureMode ? 'Streak Shield Active: Warm-up mode will not break your streak.' : 'Pure Streak Active'}
            >
              <span>💎</span>
              <span>STREAK ×{profile.pureStreak}</span>
              {!isPureMode && <span className="text-[5.5px] text-emerald-400 ml-0.5">🛡️</span>}
            </span>
          )}

          {lastMatchSummaryRef.current && (
            <span className="px-1 py-0.2 bg-slate-900 border border-slate-800 text-slate-400 rounded text-[6.5px]">
              {lastMatchSummaryRef.current}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {!isCompleted && !isTimedOut && !isResigned && (
            <button
              onClick={handleBookmarkPuzzle}
              className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 text-[7px] rounded transition"
              title={isEn ? 'Bookmark progress' : '暫存此局進度'}
            >
              📌 {isEn ? 'Save' : '暫存'}
            </button>
          )}

          {!isCompleted && !isTimedOut && !isResigned && (
            <button
              onClick={handleGracefulResign}
              className="px-1.5 py-0.5 bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-700 text-slate-400 hover:text-rose-300 text-[7px] rounded transition"
              title={isEn ? 'Resign & Reveal Solution' : '優雅投降並覆盤官方解答'}
            >
              🕊️ {isEn ? 'Resign' : '投降'}
            </button>
          )}

          {!isCompleted && !isTimedOut && !isResigned && !isPureMode && (
            <button
              onClick={triggerHintLadder}
              disabled={hintCooldown > 0}
              className={`px-2 py-0.5 border text-[7px] font-bold rounded flex items-center gap-1 transition shadow active:scale-95 ${
                hintCooldown > 0
                  ? 'bg-slate-900/60 border-slate-800 text-slate-600 cursor-not-allowed'
                  : 'bg-amber-950 hover:bg-amber-900 border-amber-500 text-amber-300'
              }`}
            >
              <span>💡</span>
              <span>
                {hintCooldown > 0
                  ? `⏳ ${hintCooldown}s`
                  : hintLevel === 0
                  ? isEn ? 'Hint 1' : '提示一'
                  : hintLevel === 1
                  ? isEn ? 'Hint 2' : '提示二'
                  : isEn ? 'Hint 3' : '提示三'}
              </span>
            </button>
          )}

          {isAssessmentMode ? (
            <span className="text-rose-400 font-bold">
              ⏱️ {String(Math.floor(remainingTime / 60)).padStart(2, '0')}:{String(remainingTime % 60).padStart(2, '0')}
            </span>
          ) : (
            <span>
              Target: <strong className="text-amber-300">{benchmarkData.benchmarkTime}s</strong>
            </span>
          )}
        </div>
      </div>

      {/* 提示訊息橫條 */}
      {!isPureMode && activeHintText && (
        <div className="w-[min(90vw,46vh)] bg-amber-950/90 border border-amber-500 text-amber-200 text-[7.5px] px-2 py-1.5 rounded-lg mb-1 animate-fade-in flex items-start justify-between gap-1 shadow-lg">
          <div className="flex items-start gap-1">
            <span className="text-amber-400 font-bold">L{hintLevel}</span>
            <span className="leading-snug">{activeHintText}</span>
          </div>
          <button onClick={() => setActiveHintText(null)} className="text-amber-400 shrink-0 font-bold ml-1">✕</button>
        </div>
      )}

      {/* 核心網格與 SVG 橋樑 */}
      <div
        className={`relative bg-slate-950 border rounded-xl shadow-2xl p-2 transition-colors ${
          isResigned ? 'border-rose-900/60 bg-rose-950/20' : 'border-slate-800'
        }`}
        style={{ width: 'min(90vw, 46vh)', height: 'min(90vw, 46vh)' }}
      >
        <svg className="absolute inset-0 w-full h-full pointer-events-none p-2" viewBox={`0 0 ${size} ${size}`}>
          {!isPureMode && !isResigned && hintLevel === 2 && highlightedTargetId !== undefined && highlightedNeighborId !== undefined && (
            (() => {
              const islA = islands.find((i) => i.id === highlightedTargetId);
              const islB = islands.find((i) => i.id === highlightedNeighborId);
              if (!islA || !islB) return null;
              return (
                <line
                  x1={islA.x + 0.5}
                  y1={islA.y + 0.5}
                  x2={islB.x + 0.5}
                  y2={islB.y + 0.5}
                  stroke="#f59e0b"
                  strokeWidth="0.12"
                  strokeDasharray="0.2 0.15"
                  className="animate-pulse"
                />
              );
            })()
          )}

          {!isPureMode && !isResigned && hintLevel === 3 && highlightedTargetId !== undefined && highlightedNeighborId !== undefined && (
            (() => {
              const islA = islands.find((i) => i.id === highlightedTargetId);
              const islB = islands.find((i) => i.id === highlightedNeighborId);
              if (!islA || !islB) return null;
              return (
                <g className="animate-pulse">
                  <line
                    x1={islA.x + 0.5}
                    y1={islA.y + 0.5}
                    x2={islB.x + 0.5}
                    y2={islB.y + 0.5}
                    stroke="#10b981"
                    strokeWidth="0.16"
                    strokeDasharray="0.25 0.15"
                    strokeLinecap="round"
                  />
                </g>
              );
            })()
          )}

          {Array.from(bridges.entries()).map(([key, count]) => {
            const [id1, id2] = key.split('_').map(Number);
            const islA = islands.find((i) => i.id === id1);
            const islB = islands.find((i) => i.id === id2);
            if (!islA || !islB) return null;

            const isHoriz = islA.y === islB.y;
            const offset = 0.12;

            if (count === 1) {
              return (
                <line
                  key={key}
                  x1={islA.x + 0.5}
                  y1={islA.y + 0.5}
                  x2={islB.x + 0.5}
                  y2={islB.y + 0.5}
                  stroke={isResigned ? '#f43f5e' : '#38bdf8'}
                  strokeWidth="0.12"
                  strokeLinecap="round"
                />
              );
            } else if (count === 2) {
              return (
                <g key={key}>
                  <line
                    x1={islA.x + 0.5 + (isHoriz ? 0 : -offset)}
                    y1={islA.y + 0.5 + (isHoriz ? -offset : 0)}
                    x2={islB.x + 0.5 + (isHoriz ? 0 : -offset)}
                    y2={islB.y + 0.5 + (isHoriz ? -offset : 0)}
                    stroke={isResigned ? '#fb7185' : '#818cf8'}
                    strokeWidth="0.09"
                    strokeLinecap="round"
                  />
                  <line
                    x1={islA.x + 0.5 + (isHoriz ? 0 : offset)}
                    y1={islA.y + 0.5 + (isHoriz ? offset : 0)}
                    x2={islB.x + 0.5 + (isHoriz ? 0 : offset)}
                    y2={islB.y + 0.5 + (isHoriz ? offset : 0)}
                    stroke={isResigned ? '#fb7185' : '#818cf8'}
                    strokeWidth="0.09"
                    strokeLinecap="round"
                  />
                </g>
              );
            }
            return null;
          })}
        </svg>

        {islands.map((isl) => {
          const curCount = currentIslandCounts[isl.id] || 0;
          const isSelected = selectedIslandId === isl.id;
          const isSatisfied = curCount === isl.expectedCount;
          const isOver = curCount > isl.expectedCount;
          const isHintTarget = !isPureMode && !isResigned && hintLevel >= 1 && highlightedTargetId === isl.id;
          const isLevel3Partner = !isPureMode && !isResigned && hintLevel === 3 && highlightedNeighborId === isl.id;

          return (
            <button
              key={isl.id}
              onClick={() => handleIslandClick(isl.id)}
              style={{
                left: `${((isl.x + 0.5) / size) * 100}%`,
                top: `${((isl.y + 0.5) / size) * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
              className={`absolute w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center font-bold text-xs sm:text-sm border-2 transition-transform active:scale-90 ${
                isResigned
                  ? 'bg-rose-950 border-rose-500 text-rose-200'
                  : isLevel3Partner || (hintLevel === 3 && isHintTarget)
                  ? 'bg-emerald-900 border-emerald-400 text-emerald-200 ring-4 ring-emerald-500/80 z-30 animate-pulse'
                  : isHintTarget
                  ? 'bg-amber-600 border-amber-300 text-white ring-4 ring-amber-400/80 z-30 animate-pulse'
                  : isSelected
                  ? 'bg-indigo-600 border-indigo-300 text-white ring-4 ring-indigo-500/40 z-20'
                  : isOver
                  ? 'bg-rose-950 border-rose-500 text-rose-200 z-10 animate-pulse'
                  : isSatisfied
                  ? 'bg-emerald-950/90 border-emerald-400 text-emerald-300 z-10 shadow-sm shadow-emerald-500/30'
                  : 'bg-slate-900 border-slate-600 text-slate-200 hover:border-slate-400 z-10'
              }`}
            >
              {isl.expectedCount}
            </button>
          );
        })}
      </div>

      <div className="text-[8px] text-slate-500 mt-2 text-center">
        {isResigned
          ? isEn ? '🕊️ Official solution revealed for strategic review.' : '🕊️ 已揭曉官方正解以供覆盤研究。'
          : !isPureMode && hintLevel === 3
          ? isEn ? '👉 Tap both green-highlighted islands to confirm the deduction.' : '👉 請親自點選兩座綠色高亮島嶼完成架橋'
          : selectedIslandId !== null
          ? isEn ? 'Click aligned island to bridge (1/2/Remove)' : '點選目標島嶼架設（循環切換 單線 / 雙線 / 清除）'
          : isEn ? 'Tap island to select connection' : '點選島嶼開始拓撲架設'}
      </div>

      {/* 賽事級反思面板 */}
      {(isCompleted || isResigned) && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(90vw,46vh)] shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
            <div className="text-left">
              <div className="text-[8px] text-slate-500 tracking-wider flex items-center gap-1">
                <span>GRAPH SPANNING TOPOLOGY</span>
                {isPureMode ? (
                  <span className="text-[6.5px] px-1 py-0.2 bg-amber-950 border border-amber-500 text-amber-300 font-bold rounded">
                    🔥 PURE CHALLENGE
                  </span>
                ) : (
                  <span className="text-[6.5px] px-1 py-0.2 bg-slate-900 border border-slate-700 text-slate-400 rounded">
                    WARM-UP / SHIELDED
                  </span>
                )}
                {profile.pureStreak >= 2 && (
                  <span className="text-[6.5px] px-1 py-0.2 bg-purple-950 border border-purple-500 text-purple-300 font-bold rounded">
                    💎 STREAK ×{profile.pureStreak}
                  </span>
                )}
              </div>
              <div className="text-xs text-indigo-300 font-bold">
                {isResigned
                  ? '🕊️ Resigned (Solution Master Analysis)'
                  : isPureMode || hintUsageLogRef.current.length === 0
                  ? '🏆 Pure Autonomous Master Clear'
                  : '✨ Spanning Topology Verified'}
              </div>
            </div>

            <div className="flex flex-col items-end">
              <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[10px] font-bold text-cyan-300">
                IQ {cci.standardIQ} (95% CI: [{cci.ci95IQ[0]}-{cci.ci95IQ[1]}])
              </div>
              <span className="text-[6.5px] text-slate-400 mt-0.5">
                年齡層 ({cci.ageNorm.cohort}): {cci.ageNorm.ageAdjustedZ >= 0 ? `+${cci.ageNorm.ageAdjustedZ}` : cci.ageNorm.ageAdjustedZ} SD (Top {Number((100 - cci.ageNorm.agePercentile).toFixed(1))}%)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[8px] text-slate-400 mb-2">
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>耗時</div>
              <div className="text-slate-200 font-bold text-xs">{elapsedSec}s</div>
              <div className="text-[7px] text-slate-500">Benchmark: {benchmarkData.benchmarkTime}s</div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>純挑戰認證</div>
              <div className="text-amber-300 font-bold text-xs">
                {isResigned
                  ? '🕊️ Resigned'
                  : isPureMode
                  ? `🔥 Streak ×${profile.pureStreak}`
                  : hintUsageLogRef.current.length === 0
                  ? '0 Hints'
                  : '🛡️ Warm-up'}
              </div>
              <div className="text-[7px] text-slate-500">
                {isResigned ? 'Full Reviewed' : isPureMode ? 'Locked Ladder' : 'Shield Preserved'}
              </div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>架設衝突</div>
              <div className="text-amber-300 font-bold text-xs">{conflictCountRef.current} 次</div>
              <div className="text-[7px] text-slate-500">IRT: {metrics.irt_logit_difficulty ?? 0.0}</div>
            </div>
          </div>

          {/* 📈 長期提示時段趨勢分析 HUD */}
          {profile.hintTrend.totalCalls > 0 && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2 mb-2 text-left text-[7px]">
              <div className="flex justify-between items-center text-slate-400 font-bold mb-1 uppercase tracking-wider">
                <span>📈 LONGITUDINAL BOTTLENECK PROFILE</span>
                <span className="text-cyan-400 font-mono">{profile.hintTrend.totalCalls} calls</span>
              </div>
              <div className="w-full h-1.5 bg-slate-950 rounded-full flex overflow-hidden border border-slate-800 mb-1">
                <div style={{ width: `${t1Pct}%` }} className="bg-emerald-500 h-full" title={`T1 (0-30s): ${t1Pct}%`} />
                <div style={{ width: `${t2Pct}%` }} className="bg-amber-500 h-full" title={`T2 (30-60s): ${t2Pct}%`} />
                <div style={{ width: `${t3Pct}%` }} className="bg-rose-500 h-full" title={`T3 (60s+): ${t3Pct}%`} />
              </div>
              <div className="flex justify-between text-[6.5px] text-slate-500">
                <span>T1 初步 ({t1Pct}%)</span>
                <span>T2 中期 ({t2Pct}%)</span>
                <span>T3 深水 ({t3Pct}%)</span>
              </div>
            </div>
          )}

          {/* 該局提示調用時間軸 */}
          {hintUsageLogRef.current.length > 0 && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2 mb-2 text-left text-[7px]">
              <div className="text-slate-500 font-bold mb-1 uppercase tracking-wider">
                ⏳ SESSION HINT TIMELINE ({hintUsageLogRef.current.length} calls)
              </div>
              <div className="flex flex-wrap gap-1">
                {hintUsageLogRef.current.map((log, idx) => (
                  <span
                    key={idx}
                    className="px-1.5 py-0.5 bg-slate-950 border border-amber-600/40 text-amber-300 rounded font-mono"
                  >
                    T+{log.secFromStart}s (Lv{log.level})
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mb-2">
            <MetricErrorBar
              actualVal={elapsedSec}
              benchmarkVal={benchmarkData.benchmarkTime}
              ci95={benchmarkData.ci95}
              sem={benchmarkData.sem}
              unit="s"
              isEn={isEn}
            />
          </div>

          <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800 flex flex-col items-center mb-2">
            <CognitiveRadarChart
              dimensions={profile.cognitiveDimensions}
              previousDimensions={profile.previousCognitiveDimensions}
              size={150}
            />
          </div>

          <div className="flex gap-1.5 mb-2">
            <button
              onClick={exportLongitudinalDataset}
              className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 border border-cyan-600/50 hover:border-cyan-400 text-cyan-300 text-[8px] font-bold rounded-lg transition shadow flex items-center justify-center gap-1 active:scale-95"
            >
              <span>📊</span>
              <span>{isEn ? 'Export Dataset & Vault (JSON)' : '匯出個人縱向數據集與書籤庫 (JSON)'}</span>
            </button>
          </div>

          {proofSignature && (
            <div className="p-1.5 bg-slate-900 border border-slate-800 rounded text-left">
              <div className="text-[7px] text-slate-500 font-bold uppercase flex justify-between">
                <span>LOCAL RECEIPT (SHA-256)</span>
                <span className="text-emerald-400 font-mono text-[6px]">
                  {isPureMode ? 'PURE HARDCORE' : 'TAMPER-PROOF'}
                </span>
              </div>
              <div className="text-[6.5px] font-mono text-cyan-400/80 break-all select-all mt-0.5">
                {proofSignature}
              </div>
            </div>
          )}
        </div>
      )}

      {showPBModal && (
        <PBCelebrationModal pb={profile.personalBest} onClose={() => setShowPBModal(false)} isEn={isEn} />
      )}
    </div>
  );
};
