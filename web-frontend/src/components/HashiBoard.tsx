// web-frontend/src/components/HashiBoard.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  HashiSpec,
  HashiIsland,
  HashiHintStep,
  WebHashiGenerator,
} from '../engines/hashiGenerator';
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

export const HashiBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, profile, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as HashiSpec;
  const rows = spec?.rows || 9;
  const cols = spec?.cols || 9;
  const islands: HashiIsland[] = spec?.islands || [];
  const solvingSteps: HashiHintStep[] = spec?.solvingSteps || [];
  const seed = (actualPuzzle?.metrics as any)?.seed || spec?.seed || 12345;

  // 橋樑狀態映射表：key: `${r1},${c1}_${r2},${c2}` -> count: 1 | 2
  const [bridges, setBridges] = useState<Map<string, number>>(new Map());
  const [selectedIsland, setSelectedIsland] = useState<HashiIsland | null>(null);

  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [isFav, setIsFav] = useState<boolean>(() =>
    actualPuzzle?.id ? VaultManager.isFavorited(actualPuzzle.id) : false
  );
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);

  // 提示與反證鏈展開
  const [activeHint, setActiveHint] = useState<HashiHintStep | null>(null);
  const [hintLevel, setHintLevel] = useState<number>(0);
  const [showContradictionDetail, setShowContradictionDetail] = useState<boolean>(false);

  // 自由無猜模式
  const [noGuessMode, setNoGuessMode] = useState<boolean>(false);
  const [blockAlert, setBlockAlert] = useState<string | null>(null);

  // 覆盤重播狀態與分歧點錨定
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [replayIndex, setReplayIndex] = useState<number>(0);
  const [replayDivergenceStep, setReplayDivergenceStep] = useState<number | null>(null);

  // 撤銷堆疊
  const [undoStack, setUndoStack] = useState<Map<string, number>[]>([]);

  // 工程配方抽屜
  const [showRecipePanel, setShowRecipePanel] = useState<boolean>(false);

  // 防重錄守衛
  const hasRecordedRef = useRef<boolean>(false);

  // 實體防作弊稽核 Session
  const proctoringRef = useRef<TournamentProctoringSession | null>(null);

  useEffect(() => {
    proctoringRef.current = new TournamentProctoringSession();
    return () => {
      proctoringRef.current?.destroy();
      proctoringRef.current = null;
    };
  }, [actualPuzzle?.id]);

  useEffect(() => {
    setBridges(new Map());
    setSelectedIsland(null);
    setIsCompleted(false);
    setElapsedMs(0);
    setStartTime(Date.now());
    setActiveHint(null);
    setHintLevel(0);
    setShowContradictionDetail(false);
    setBlockAlert(null);
    setIsReplaying(false);
    setReplayIndex(0);
    setReplayDivergenceStep(null);
    setUndoStack([]);
    setShowRecipePanel(false);
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id]);

  useEffect(() => {
    if (isCompleted || isReplaying) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted, isReplaying, startTime]);

  const getEdgeKey = (r1: number, c1: number, r2: number, c2: number): string =>
    r1 < r2 || (r1 === r2 && c1 < c2) ? `${r1},${c1}_${r2},${c2}` : `${r2},${c2}_${r1},${c1}`;

  // 計算各島嶼已連接橋樑數
  const currentCapacities = useMemo(() => {
    const caps = new Map<number, number>();
    for (const isl of islands) caps.set(isl.id, 0);

    for (const [key, count] of bridges.entries()) {
      const [pA, pB] = key.split('_');
      const [r1, c1] = pA.split(',').map(Number);
      const [r2, c2] = pB.split(',').map(Number);
      const u = islands.find((i) => i.r === r1 && i.c === c1);
      const v = islands.find((i) => i.r === r2 && i.c === c2);
      if (u) caps.set(u.id, (caps.get(u.id) || 0) + count);
      if (v) caps.set(v.id, (caps.get(v.id) || 0) + count);
    }

    return caps;
  }, [islands, bridges]);

  // 衝突分析解耦
  const conflictReport = useMemo(() => {
    let overflowCount = 0;
    for (const isl of islands) {
      const cur = currentCapacities.get(isl.id) || 0;
      if (cur > isl.capacity) overflowCount++;
    }

    let prematureDisconnection = false;
    const allSatisfied = islands.every((isl) => (currentCapacities.get(isl.id) || 0) === isl.capacity);
    if (allSatisfied && islands.length > 0) {
      const visited = new Set<number>();
      const queue = [islands[0]];
      visited.add(islands[0].id);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const isl of islands) {
          if (!visited.has(isl.id)) {
            const k = getEdgeKey(curr.r, curr.c, isl.r, isl.c);
            if ((bridges.get(k) || 0) > 0) {
              visited.add(isl.id);
              queue.push(isl);
            }
          }
        }
      }
      if (visited.size < islands.length) {
        prematureDisconnection = true;
      }
    }

    return { overflowCount, prematureDisconnection };
  }, [islands, currentCapacities, bridges]);

  // 動態反證樹連動高亮集合：從文本解析 [r, c] 座標
  const contradictionHighlightCells = useMemo(() => {
    if (!showContradictionDetail || !activeHint?.structuredContradiction) {
      return new Set<string>();
    }
    const set = new Set<string>();
    const textToScan = [
      activeHint.structuredContradiction.hypothesis,
      ...activeHint.structuredContradiction.deductionChain,
      activeHint.structuredContradiction.conflictReason,
    ].join(' ');

    const matches = textToScan.matchAll(/\[(\d+),\s*(\d+)\]/g);
    for (const m of matches) {
      const r = parseInt(m[1], 10) - 1;
      const c = parseInt(m[2], 10) - 1;
      set.add(`${r},${c}`);
    }
    return set;
  }, [showContradictionDetail, activeHint]);

  // 勝利驗證
  const checkVictory = useCallback(() => {
    if (islands.length === 0) return false;
    for (const isl of islands) {
      if ((currentCapacities.get(isl.id) || 0) !== isl.capacity) return false;
    }

    const visited = new Set<number>();
    const queue = [islands[0]];
    visited.add(islands[0].id);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const isl of islands) {
        if (!visited.has(isl.id)) {
          const k = getEdgeKey(curr.r, curr.c, isl.r, isl.c);
          if ((bridges.get(k) || 0) > 0) {
            visited.add(isl.id);
            queue.push(isl);
          }
        }
      }
    }

    return visited.size === islands.length;
  }, [islands, currentCapacities, bridges]);

  // 橋樑切換
  const toggleBridgeBetween = useCallback(
    (u: HashiIsland, v: HashiIsland) => {
      if (isCompleted || isReplaying) return;

      const visible = WebHashiGenerator.getOrthogonalNeighbors(islands, u, rows, cols);
      if (!visible.some((vis) => vis.id === v.id)) return;

      const edgeKey = getEdgeKey(u.r, u.c, v.r, v.c);
      const curCount = bridges.get(edgeKey) || 0;
      const nextCount = (curCount + 1) % 3;

      if (nextCount > 0) {
        for (const [k, c] of bridges.entries()) {
          if (c > 0 && k !== edgeKey) {
            const [pA, pB] = k.split('_');
            const [er1, ec1] = pA.split(',').map(Number);
            const [er2, ec2] = pB.split(',').map(Number);
            if (
              WebHashiGenerator.checkCrossing(
                { r1: u.r, c1: u.c, r2: v.r, c2: v.c },
                { r1: er1, c1: ec1, r2: er2, c2: ec2 }
              )
            ) {
              setBlockAlert(isEn ? 'Bridges cannot cross each other!' : '橋樑不可在非島嶼處交叉！');
              return;
            }
          }
        }
      }

      if (noGuessMode && nextCount > curCount) {
        const forcedList = WebHashiGenerator.getAllForcedDeductions(spec, bridges);
        if (forcedList.length > 0) {
          const matched = forcedList.find(
            (f) =>
              (f.r1 === u.r && f.c1 === u.c && f.r2 === v.r && f.c2 === v.c) ||
              (f.r1 === v.r && f.c1 === v.c && f.r2 === u.r && f.c2 === u.c)
          );
          if (!matched) {
            setBlockAlert(
              isEn
                ? 'Action blocked: This move is not in the current forced deduction pool.'
                : '【純推導攔截】此操作不在當前可強制鎖定列表內，請重新審視角落或割邊！'
            );
            return;
          }
        }
      }

      setBlockAlert(null);
      setUndoStack((prev) => [...prev.slice(-49), new Map(bridges)]);

      setBridges((prev) => {
        const next = new Map(prev);
        if (nextCount === 0) next.delete(edgeKey);
        else next.set(edgeKey, nextCount);
        return next;
      });

      setSelectedIsland(null);
    },
    [isCompleted, isReplaying, islands, rows, cols, bridges, noGuessMode, spec, isEn]
  );

  // P2 修復：加入 hasRecordedRef 守衛防重錄
  useEffect(() => {
    if (!isCompleted && !hasRecordedRef.current && checkVictory()) {
      hasRecordedRef.current = true;
      setIsCompleted(true);
      const timeSpent = Math.max(1, Math.round((Date.now() - startTime) / 1000));
      if (actualPuzzle) {
        recordAttempt({
          puzzleId: actualPuzzle.id,
          engineType: 'hashi',
          tier: (actualPuzzle.tier as TierKey) || 'kids',
          cognitiveLoad: actualPuzzle.cognitiveLoad || {
            spatial: 0.96,
            numeric: 0.85,
            workingMemory: 0.8,
            inhibition: 0.9,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictReport.overflowCount,
          technique: spec?.highestTechnique || 'TarjanCutEdgeSatisfaction',
          isPureClear: conflictReport.overflowCount === 0 && !conflictReport.prematureDisconnection,
        });
      }
    }
  }, [
    bridges,
    isCompleted,
    checkVictory,
    startTime,
    actualPuzzle,
    recordAttempt,
    spec?.highestTechnique,
    conflictReport,
  ]);

  const handleIslandClick = (isl: HashiIsland) => {
    if (isCompleted || isReplaying) return;

    if (!selectedIsland) {
      setSelectedIsland(isl);
    } else if (selectedIsland.id === isl.id) {
      setSelectedIsland(null);
    } else {
      toggleBridgeBetween(selectedIsland, isl);
    }
  };

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0 || isCompleted || isReplaying) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setBridges(last);
    setSelectedIsland(null);
  }, [undoStack, isCompleted, isReplaying]);

  const handleRequestHint = useCallback(() => {
    if (isCompleted || tournamentMode) return;
    const forced = WebHashiGenerator.getNextForcedDeduction(spec, bridges);
    if (!forced) return;

    if (!activeHint || activeHint.step !== forced.step) {
      setActiveHint(forced);
      setHintLevel(1);
      setShowContradictionDetail(false);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, tournamentMode, spec, bridges, activeHint]);

  // P0 修復：標準化金庫收藏對接
  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const vaultItem: VaultItem = {
      id: actualPuzzle.id,
      engine: 'hashi',
      tier: String(actualPuzzle.tier || 'kids'),
      seed: Number(seed),
      steps: islands.length,
      timeSpentSec: Math.round(elapsedMs / 1000),
      date: new Date().toISOString(),
    };
    const res = VaultManager.toggleFavorite(vaultItem);
    setIsFav(res.isFav);
  };

  // 覆盤：動態捕捉第一個分歧點 (Divergence Step) 並暫停展示
  const handleStartReplay = () => {
    if (isReplaying) return;
    setIsReplaying(true);
    setBridges(new Map());
    setReplayIndex(0);
    setReplayDivergenceStep(null);

    const stepsToPlay = solvingSteps.length > 0 ? solvingSteps : [];
    let curIdx = 0;

    const interval = setInterval(() => {
      if (curIdx >= stepsToPlay.length) {
        clearInterval(interval);
        setIsReplaying(false);
        return;
      }
      const st = stepsToPlay[curIdx];
      const k = getEdgeKey(st.r1, st.c1, st.r2, st.c2);

      if (st.isFirstGuessAnchor && replayDivergenceStep === null) {
        setReplayDivergenceStep(curIdx + 1);
      }

      setBridges((prev) => new Map(prev).set(k, st.forcedBridges));
      setReplayIndex(curIdx + 1);
      curIdx++;
    }, 450);
  };

  // P2 修復：鍵盤盲操完整依賴注入
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key.toLowerCase()) {
        case 'z':
          e.preventDefault();
          handleUndo();
          break;
        case 'h':
          e.preventDefault();
          handleRequestHint();
          break;
        case 'n':
          e.preventDefault();
          setNoGuessMode((prev) => !prev);
          break;
        case 'escape':
          e.preventDefault();
          setSelectedIsland(null);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRequestHint]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);
  const cellSize = Math.min(320 / Math.max(rows, cols), 36);

  // SVG 橋樑渲染向量記憶化
  const renderedBridges = useMemo(() => {
    const list: React.ReactNode[] = [];

    for (const [key, count] of bridges.entries()) {
      const [pA, pB] = key.split('_');
      const [r1, c1] = pA.split(',').map(Number);
      const [r2, c2] = pB.split(',').map(Number);

      const x1 = c1 * cellSize + cellSize / 2;
      const y1 = r1 * cellSize + cellSize / 2;
      const x2 = c2 * cellSize + cellSize / 2;
      const y2 = r2 * cellSize + cellSize / 2;

      const isVert = c1 === c2;

      if (count === 1) {
        list.push(
          <line
            key={key}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#22d3ee"
            strokeWidth="3"
            strokeLinecap="round"
            className="drop-shadow-[0_0_6px_rgba(34,211,238,0.7)] pointer-events-none"
          />
        );
      } else if (count === 2) {
        const offset = 3.5;
        list.push(
          <g key={key} className="pointer-events-none">
            <line
              x1={isVert ? x1 - offset : x1}
              y1={isVert ? y1 : y1 - offset}
              x2={isVert ? x2 - offset : x2}
              y2={isVert ? y2 : y2 - offset}
              stroke="#22d3ee"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="drop-shadow-[0_0_6px_rgba(34,211,238,0.7)]"
            />
            <line
              x1={isVert ? x1 + offset : x1}
              y1={isVert ? y1 : y1 + offset}
              x2={isVert ? x2 + offset : x2}
              y2={isVert ? y2 : y2 + offset}
              stroke="#22d3ee"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="drop-shadow-[0_0_6px_rgba(34,211,238,0.7)]"
            />
          </g>
        );
      }
    }
    return list;
  }, [bridges, cellSize]);

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono outline-none touch-none w-full max-w-[420px] mx-auto">
      {/* 數據看板 */}
      <div className="w-full max-w-[340px] mb-2 flex flex-col gap-1 text-[9px]">
        <div className="flex items-center justify-between px-1 text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="text-cyan-400 font-bold">
              {spec.highestTechnique === 'tarjan_cut_edge_isolation' ? '🌉 Tarjan 割邊咽喉' : '🌀 視覺平衡拓撲'}
            </span>
            <button
              onClick={handleToggleFavorite}
              className={`px-1.5 py-0.5 rounded border transition cursor-pointer ${
                isFav ? 'border-amber-500 text-amber-300 bg-amber-950' : 'border-slate-700 text-slate-500'
              }`}
              title={isFav ? (isEn ? 'In Vault' : '已在傳奇庫') : (isEn ? 'Save to Vault' : '收藏')}
            >
              {isFav ? '★' : '☆'}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-amber-400 font-bold">
              ★ {spec.logicalComplexityScore > 200 ? '★★★★★' : spec.logicalComplexityScore > 120 ? '★★★★☆' : '★★★☆☆'}
            </span>
            <span className="text-slate-500 text-[8px]">
              Tension: {spec.directionalUniformity || 0.85}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Speed' : '耗時'}</div>
            <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Status' : '推導純度'}</div>
            <div className="text-emerald-400 font-bold">
              {spec.solverStatus === 'LOGICALLY_SOLVED'
                ? '100% 純演繹'
                : `反證深度 ${spec.requiredGuessDepth || 1} (${Math.round((spec.pureDeductionRate || 0.8) * 100)}%)`}
            </div>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Conflicts' : '溢出 / 斷環'}</div>
            <div className={`font-bold ${conflictReport.overflowCount > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
              {conflictReport.overflowCount} / {conflictReport.prematureDisconnection ? '死鎖' : '正常'}
            </div>
          </div>
        </div>
      </div>

      {/* 畫布主體 */}
      <div className="relative p-2 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl flex flex-col items-center">
        <div
          className="relative bg-slate-900/60 rounded border border-slate-800 overflow-hidden"
          style={{ width: cols * cellSize, height: rows * cellSize }}
        >
          {/* SVG 橋樑層 */}
          <svg className="absolute inset-0 w-full h-full z-10">{renderedBridges}</svg>

          {/* 島嶼節點層 */}
          {islands.map((isl) => {
            const cur = currentCapacities.get(isl.id) || 0;
            const isFull = cur === isl.capacity;
            const isOverflow = cur > isl.capacity;
            const isSelected = selectedIsland?.id === isl.id;
            const isHintFocus =
              activeHint &&
              ((activeHint.r1 === isl.r && activeHint.c1 === isl.c) ||
                (activeHint.r2 === isl.r && activeHint.c2 === isl.c));
            const isProofContradictionCell = contradictionHighlightCells.has(`${isl.r},${isl.c}`);

            return (
              <div
                key={`isl-${isl.id}`}
                onClick={() => handleIslandClick(isl)}
                style={{
                  left: isl.c * cellSize + cellSize / 2 - 21,
                  top: isl.r * cellSize + cellSize / 2 - 21,
                  width: 42,
                  height: 42,
                }}
                className="absolute flex items-center justify-center cursor-pointer z-20 group"
              >
                {/* 實際島嶼核心圓盤 */}
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-xs transition-all duration-150 shadow-lg select-none ${
                    isOverflow
                      ? 'bg-rose-600 text-white ring-2 ring-rose-400 animate-pulse'
                      : isSelected
                      ? 'bg-amber-400 text-black ring-4 ring-amber-300 scale-110'
                      : isProofContradictionCell
                      ? 'bg-purple-600 text-white ring-4 ring-purple-400 animate-pulse scale-110 shadow-[0_0_12px_rgba(168,85,247,0.9)]'
                      : isHintFocus
                      ? 'bg-cyan-500 text-black ring-4 ring-cyan-300 animate-pulse'
                      : isFull
                      ? 'bg-emerald-600 text-white border-2 border-emerald-400'
                      : 'bg-slate-800 text-cyan-300 border border-slate-600 group-hover:bg-slate-700'
                  }`}
                  style={{
                    textShadow: '0 1px 2px rgba(0,0,0,0.9)',
                  }}
                >
                  {isl.capacity}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 攔截警告卡片 */}
      {blockAlert && (
        <div className="w-full max-w-[340px] mt-2 p-2 bg-rose-950/90 border border-rose-500/80 rounded-lg text-[8px] text-rose-200 animate-fade-in font-mono flex items-center justify-between">
          <span>{blockAlert}</span>
          <button
            onClick={() => setBlockAlert(null)}
            className="px-1.5 py-0.5 bg-rose-900 text-rose-200 rounded text-[7px] ml-1 cursor-pointer"
          >
            確定
          </button>
        </div>
      )}

      {/* 階梯因果提示面板 */}
      {hintLevel > 0 && activeHint && (
        <div className="mt-2 p-2 bg-slate-900/90 border border-cyan-500/60 rounded-xl text-center w-full max-w-[340px] shadow-lg animate-fade-in font-mono">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[7.5px] font-bold text-cyan-300 tracking-wider uppercase">
              {activeHint.technique} 階梯推導
            </span>
            <div className="flex gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${hintLevel >= 1 ? 'bg-cyan-400' : 'bg-slate-700'}`} />
              <span className={`w-1.5 h-1.5 rounded-full ${hintLevel >= 2 ? 'bg-cyan-400' : 'bg-slate-700'}`} />
              <span
                className={`w-1.5 h-1.5 rounded-full ${hintLevel >= 3 ? 'bg-rose-500 animate-ping' : 'bg-slate-700'}`}
              />
            </div>
          </div>
          <div className="py-0.5 text-[8px] text-slate-200">
            {hintLevel === 1 && (
              <span className="text-amber-300">
                🔍 請檢視島嶼 [{activeHint.r1 + 1}, {activeHint.c1 + 1}] 與 [{activeHint.r2 + 1}, {activeHint.c2 + 1}] 的正交視線。
              </span>
            )}
            {hintLevel === 2 && (
              <span className="text-cyan-300 font-bold">⚡ {activeHint.rationale}</span>
            )}
            {hintLevel === 3 && (
              <div>
                <span className="text-emerald-400 font-black">
                  🎯 {isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}
                </span>
                {activeHint.structuredContradiction && (
                  <div className="mt-1 text-left">
                    <button
                      onClick={() => setShowContradictionDetail((p) => !p)}
                      className="text-[7px] text-purple-400 underline cursor-pointer hover:text-purple-300"
                    >
                      {showContradictionDetail ? '收合反證因果樹' : '查看反證因果樹 (含盤面動態高亮)'}
                    </button>
                    {showContradictionDetail && (
                      <div className="mt-1 p-1.5 bg-slate-950 border border-purple-500/50 rounded text-[7px] text-purple-200 space-y-0.5 shadow-inner">
                        <div className="font-bold text-purple-300">假設: {activeHint.structuredContradiction.hypothesis}</div>
                        {activeHint.structuredContradiction.deductionChain.map((c, idx) => (
                          <div key={idx} className="text-slate-400 pl-2">↳ {c}</div>
                        ))}
                        <div className="text-rose-400 font-bold pt-0.5">💥 矛盾根源: {activeHint.structuredContradiction.conflictReason}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 控制按鈕群 */}
      <div className="flex items-center justify-between w-full max-w-[340px] mt-2 gap-1 text-[8.5px] font-bold">
        <button
          onClick={handleUndo}
          disabled={undoStack.length === 0 || isReplaying}
          className={`flex-1 py-1.5 rounded-lg border transition ${
            undoStack.length > 0
              ? 'bg-slate-900 text-slate-200 border-slate-700 cursor-pointer'
              : 'bg-slate-950 text-slate-600 border-slate-900'
          }`}
        >
          ↩ 復原
        </button>
        <button
          onClick={() => setNoGuessMode((p) => !p)}
          className={`flex-1 py-1.5 rounded-lg border transition cursor-pointer ${
            noGuessMode
              ? 'bg-cyan-600 text-black border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]'
              : 'bg-slate-900 text-slate-400 border-slate-800'
          }`}
        >
          {noGuessMode ? '🛡️ 無猜模式' : '自由模式'}
        </button>
        {isCompleted && (
          <button
            onClick={handleStartReplay}
            disabled={isReplaying}
            className="flex-1 py-1.5 rounded-lg border bg-slate-900 border-purple-500/50 text-purple-300 hover:bg-purple-950/40 transition cursor-pointer flex items-center justify-center gap-1"
          >
            {isReplaying ? (
              <>
                <span>覆盤中 {replayIndex}/{solvingSteps.length}</span>
                {replayDivergenceStep && replayIndex >= replayDivergenceStep && (
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" title="分歧點" />
                )}
              </>
            ) : (
              '📜 覆盤演示'
            )}
          </button>
        )}
        {!tournamentMode && (
          <button
            onClick={handleRequestHint}
            className="flex-1 py-1.5 rounded-lg border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition cursor-pointer"
          >
            💡 提示
          </button>
        )}
      </div>

      {/* 盲操熱鍵速查與工程配方反查抽屜 */}
      <div className="w-full max-w-[340px] mt-2 flex items-center justify-between px-1 text-[7px] text-slate-500 font-mono">
        <span>[Z] 復原 | [H] 提示 | [N] 無猜模式 | [ESC] 取消選取</span>
        <button
          onClick={() => setShowRecipePanel((p) => !p)}
          className="text-cyan-400/80 hover:text-cyan-300 underline cursor-pointer"
        >
          {showRecipePanel ? '收合配方' : '工程配方反查'}
        </button>
      </div>

      {showRecipePanel && (
        <div className="w-full max-w-[340px] mt-1 p-2 bg-slate-950/90 border border-slate-800 rounded-lg text-[7.5px] text-slate-400 space-y-0.5 animate-fade-in font-mono">
          <div className="text-cyan-400 font-bold">🧬 數橋拓撲生成配方 (Topology Recipe)</div>
          <div>島嶼規模: {islands.length} 顆 | 網格規格: {rows} &times; {cols}</div>
          <div>視距熵值: {spec.visualEntropy} | 正交張力均勻度: {spec.directionalUniformity}</div>
          <div>種子簽名: <span className="text-slate-300">{actualPuzzle?.id}</span></div>
        </div>
      )}

      {/* 勝利通關面板 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border-2 border-emerald-500/90 rounded-2xl text-center w-full max-w-[340px] shadow-2xl animate-fade-in font-mono">
          <div className="text-emerald-400 font-black text-sm uppercase tracking-widest animate-pulse">
            HASHI TOPOLOGY RESOLVED!
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 mb-2">
            Time: {(elapsedMs / 1000).toFixed(2)}s | Gf: IQ {cci.standardIQ}
          </div>
          <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-lg text-[8px] text-slate-300 text-left space-y-1 mb-2">
            <div className="flex justify-between">
              <span className="text-slate-400">邏輯複雜度評分:</span>
              <span className="text-cyan-300 font-bold">{spec.logicalComplexityScore}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">最高定式技術:</span>
              <span className="text-amber-300 font-bold">{spec.highestTechnique}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">正交方向張力:</span>
              <span className="text-emerald-400 font-bold">{spec.directionalUniformity}</span>
            </div>
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
            tournamentId: tournamentMode ? 'WPF_HASHI_2026' : 'GLOBAL_BRIDGE_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'hashi',
            tier: (actualPuzzle.tier as string) || 'kids',
            timeSpentSec: Math.round(elapsedMs / 1000),
            conflictsCount: conflictReport.overflowCount,
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
