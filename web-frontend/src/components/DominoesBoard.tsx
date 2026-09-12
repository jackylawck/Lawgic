// web-frontend/src/components/DominoesBoard.tsx
import React, { useState, useEffect, useCallback, useMemo, useDeferredValue, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  DominoesSpec,
  DominoBorderState,
  DominoHintStep,
  DominoPlacement,
  WebDominoesGenerator,
} from '../engines/dominoesGenerator';
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

interface UserAction {
  type: 'hBorder' | 'vBorder';
  r: number;
  c: number;
  prev: DominoBorderState;
  next: DominoBorderState;
  isHypothesis: boolean;
  descZh: string;
  descEn: string;
}

export const DominoesBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, profile, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as DominoesSpec;
  const rows = spec?.rows || 4;
  const cols = spec?.cols || 5;
  const maxPip = spec?.maxPip || 3;
  const grid = spec?.grid || [];
  const dominoDeck = spec?.dominoes || [];
  const pinnedPlacements = spec?.pinnedPlacements || [];
  const seed = (actualPuzzle?.metrics as any)?.seed || spec?.seed || 12345;

  // 水平邊界 (rows - 1, cols) & 垂直邊界 (rows, cols - 1)
  const [hBorders, setHBorders] = useState<DominoBorderState[][]>(() =>
    Array.from({ length: Math.max(0, rows - 1) }, () => Array(cols).fill('unknown'))
  );
  const [vBorders, setVBorders] = useState<DominoBorderState[][]>(() =>
    Array.from({ length: rows }, () => Array(Math.max(0, cols - 1)).fill('unknown'))
  );

  // 試探性假設集合（紫光標記）
  const [hypothesisHBorders, setHypothesisHBorders] = useState<Set<string>>(new Set());
  const [hypothesisVBorders, setHypothesisVBorders] = useState<Set<string>>(new Set());

  // 懸停候選視角
  const [hoveredCell, setHoveredCell] = useState<[number, number] | null>(null);
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>([0, 0]);

  // 物理卷面視角轉換（旋轉與水平翻轉）
  const [rotationDeg, setRotationDeg] = useState<number>(0);
  const [isFlippedH, setIsFlippedH] = useState<boolean>(false);

  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [isFav, setIsFav] = useState<boolean>(() =>
    actualPuzzle?.id ? VaultManager.isFavorited(actualPuzzle.id) : false
  );
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);

  // 操作棋譜紀錄
  const [history, setHistory] = useState<UserAction[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [showMoveHistory, setShowMoveHistory] = useState<boolean>(false);

  // 階梯提示
  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<DominoHintStep | null>(null);
  const [tacticalMetaHint, setTacticalMetaHint] = useState<string | null>(null);

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

  // 初始化預置釘定線索
  useEffect(() => {
    const initH: DominoBorderState[][] = Array.from({ length: Math.max(0, rows - 1) }, () =>
      Array(cols).fill('unknown')
    );
    const initV: DominoBorderState[][] = Array.from({ length: rows }, () =>
      Array(Math.max(0, cols - 1)).fill('unknown')
    );

    for (let i = 0; i < pinnedPlacements.length; i++) {
      const p = pinnedPlacements[i];
      if (p.r1 === p.r2) {
        const r = p.r1;
        const minC = Math.min(p.c1, p.c2);
        if (initV[r]) initV[r][minC] = 'open';
      } else if (p.c1 === p.c2) {
        const c = p.c1;
        const minR = Math.min(p.r1, p.r2);
        if (initH[minR]) initH[minR][c] = 'open';
      }
    }

    setHBorders(initH);
    setVBorders(initV);
    setHypothesisHBorders(new Set());
    setHypothesisVBorders(new Set());
    setHoveredCell(null);
    setSelectedCell([0, 0]);
    setIsCompleted(false);
    setElapsedMs(0);
    setStartTime(Date.now());
    setHistory([]);
    setHistoryIndex(-1);
    setHintLevel(0);
    setActiveHint(null);
    setTacticalMetaHint(null);
    setRotationDeg(0);
    setIsFlippedH(false);
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id, rows, cols, pinnedPlacements]);

  useEffect(() => {
    if (isCompleted) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, [isCompleted, startTime]);

  // 非同步延遲分析：保障高幀率點擊優先渲染
  const deferredHBorders = useDeferredValue(hBorders);
  const deferredVBorders = useDeferredValue(vBorders);

  // 骨牌提取與庫存對帳
  const identifiedDominoes = useMemo(() => {
    const list: DominoPlacement[] = [];
    const usedCounts = new Map<string, number>();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (deferredVBorders[r]?.[c] === 'open') {
          const v1 = grid[r][c];
          const v2 = grid[r][c + 1];
          const key = WebDominoesGenerator.getDominoKey(v1, v2);
          list.push({ r1: r, c1: c, r2: r, c2: c + 1, val1: v1, val2: v2 });
          usedCounts.set(key, (usedCounts.get(key) || 0) + 1);
        }
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        if (deferredHBorders[r]?.[c] === 'open') {
          const v1 = grid[r][c];
          const v2 = grid[r + 1][c];
          const key = WebDominoesGenerator.getDominoKey(v1, v2);
          list.push({ r1: r, c1: c, r2: r + 1, c2: c, val1: v1, val2: v2 });
          usedCounts.set(key, (usedCounts.get(key) || 0) + 1);
        }
      }
    }

    return { list, usedCounts };
  }, [rows, cols, grid, deferredHBorders, deferredVBorders]);

  // 被動懸停候選高亮計算
  const candidateNeighborsOfHovered = useMemo(() => {
    if (!hoveredCell || isCompleted) return new Set<string>();
    const [hr, hc] = hoveredCell;
    const valH = grid[hr]?.[hc];
    if (valH === undefined) return new Set<string>();

    const validKeys = new Set<string>();
    const dirs = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];

    for (const [dr, dc] of dirs) {
      const nr = hr + dr;
      const nc = hc + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        let isWall = false;
        if (dr === 0) {
          const minC = Math.min(hc, nc);
          isWall = vBorders[hr]?.[minC] === 'wall';
        } else {
          const minR = Math.min(hr, nr);
          isWall = hBorders[minR]?.[hc] === 'wall';
        }

        if (!isWall) {
          const key = WebDominoesGenerator.getDominoKey(valH, grid[nr][nc]);
          const currentUsage = identifiedDominoes.usedCounts.get(key) || 0;
          if (currentUsage === 0) {
            validKeys.add(`${nr},${nc}`);
          }
        }
      }
    }

    return validKeys;
  }, [hoveredCell, isCompleted, grid, rows, cols, vBorders, hBorders, identifiedDominoes.usedCounts]);

  const checkVictory = useCallback(() => {
    const totalNeeded = ((maxPip + 1) * (maxPip + 2)) / 2;
    if (identifiedDominoes.list.length !== totalNeeded) return false;

    for (const count of identifiedDominoes.usedCounts.values()) {
      if (count !== 1) return false;
    }

    const cellDegree = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = 0; i < identifiedDominoes.list.length; i++) {
      const p = identifiedDominoes.list[i];
      cellDegree[p.r1][p.c1]++;
      cellDegree[p.r2][p.c2]++;
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cellDegree[r][c] !== 1) return false;
      }
    }

    return true;
  }, [identifiedDominoes, maxPip, rows, cols]);

  const toggleHBorder = (r: number, c: number) => {
    if (isCompleted) return;

    const forced = WebDominoesGenerator.getNextForcedDeduction(spec, hBorders, vBorders);
    const isForcedStep = forced && forced.c1 === c && (forced.r1 === r || forced.r2 === r);
    const isHypothesis = !isForcedStep;

    const states: DominoBorderState[] = ['unknown', 'open', 'wall'];
    const cur = hBorders[r][c];
    const next = states[(states.indexOf(cur) + 1) % states.length];

    setHBorders((prev) => {
      const updated = prev.map((row) => [...row]);
      updated[r][c] = next;
      return updated;
    });

    const edgeId = `${r},${c}`;
    setHypothesisHBorders((prev) => {
      const nextSet = new Set(prev);
      if (isHypothesis && next === 'open') nextSet.add(edgeId);
      else nextSet.delete(edgeId);
      return nextSet;
    });

    const action: UserAction = {
      type: 'hBorder',
      r,
      c,
      prev: cur,
      next,
      isHypothesis,
      descZh: `水平邊界 (${r + 1},${c + 1}): ${cur} ➔ ${next} ${isHypothesis ? '【試探】' : ''}`,
      descEn: `H-Border (${r + 1},${c + 1}): ${cur} -> ${next} ${isHypothesis ? '[Hypothesis]' : ''}`,
    };
    setHistory((h) => [...h.slice(0, historyIndex + 1), action]);
    setHistoryIndex((idx) => idx + 1);
  };

  const toggleVBorder = (r: number, c: number) => {
    if (isCompleted) return;

    const forced = WebDominoesGenerator.getNextForcedDeduction(spec, hBorders, vBorders);
    const isForcedStep = forced && forced.r1 === r && (forced.c1 === c || forced.c2 === c);
    const isHypothesis = !isForcedStep;

    const states: DominoBorderState[] = ['unknown', 'open', 'wall'];
    const cur = vBorders[r][c];
    const next = states[(states.indexOf(cur) + 1) % states.length];

    setVBorders((prev) => {
      const updated = prev.map((row) => [...row]);
      updated[r][c] = next;
      return updated;
    });

    const edgeId = `${r},${c}`;
    setHypothesisVBorders((prev) => {
      const nextSet = new Set(prev);
      if (isHypothesis && next === 'open') nextSet.add(edgeId);
      else nextSet.delete(edgeId);
      return nextSet;
    });

    const action: UserAction = {
      type: 'vBorder',
      r,
      c,
      prev: cur,
      next,
      isHypothesis,
      descZh: `垂直邊界 (${r + 1},${c + 1}): ${cur} ➔ ${next} ${isHypothesis ? '【試探】' : ''}`,
      descEn: `V-Border (${r + 1},${c + 1}): ${cur} -> ${next} ${isHypothesis ? '[Hypothesis]' : ''}`,
    };
    setHistory((h) => [...h.slice(0, historyIndex + 1), action]);
    setHistoryIndex((idx) => idx + 1);
  };

  // P2 修復：加入 hasRecordedRef 防禦，防止重複提交 attempt
  useEffect(() => {
    if (!isCompleted && !hasRecordedRef.current && checkVictory()) {
      hasRecordedRef.current = true;
      setIsCompleted(true);
      const timeSpent = Math.max(1, Math.round((Date.now() - startTime) / 1000));
      const totalHypotheses = hypothesisHBorders.size + hypothesisVBorders.size;
      const pureClear = totalHypotheses === 0;

      if (actualPuzzle) {
        recordAttempt({
          puzzleId: actualPuzzle.id,
          engineType: 'dominoes',
          tier: (actualPuzzle.tier as TierKey) || 'kids',
          cognitiveLoad: actualPuzzle.cognitiveLoad || {
            spatial: 0.95,
            numeric: 0.9,
            workingMemory: 0.85,
            inhibition: 0.9,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: totalHypotheses,
          technique: spec?.highestTechnique || 'BipartiteParitySatisfaction',
          isPureClear: pureClear,
        });
      }
    }
  }, [
    hBorders,
    vBorders,
    isCompleted,
    checkVictory,
    startTime,
    actualPuzzle,
    recordAttempt,
    spec?.highestTechnique,
    hypothesisHBorders.size,
    hypothesisVBorders.size,
  ]);

  const handleUndo = () => {
    if (historyIndex < 0 || isCompleted) return;
    const act = history[historyIndex];
    if (act.type === 'hBorder') {
      setHBorders((prev) => {
        const u = prev.map((row) => [...row]);
        u[act.r][act.c] = act.prev;
        return u;
      });
      setHypothesisHBorders((prev) => {
        const n = new Set(prev);
        n.delete(`${act.r},${act.c}`);
        return n;
      });
    } else {
      setVBorders((prev) => {
        const u = prev.map((row) => [...row]);
        u[act.r][act.c] = act.prev;
        return u;
      });
      setHypothesisVBorders((prev) => {
        const n = new Set(prev);
        n.delete(`${act.r},${act.c}`);
        return n;
      });
    }
    setHistoryIndex((idx) => idx - 1);
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1 || isCompleted) return;
    const act = history[historyIndex + 1];
    if (act.type === 'hBorder') {
      setHBorders((prev) => {
        const u = prev.map((row) => [...row]);
        u[act.r][act.c] = act.next;
        return u;
      });
      if (act.isHypothesis && act.next === 'open') {
        setHypothesisHBorders((prev) => new Set(prev).add(`${act.r},${act.c}`));
      }
    } else {
      setVBorders((prev) => {
        const u = prev.map((row) => [...row]);
        u[act.r][act.c] = act.next;
        return u;
      });
      if (act.isHypothesis && act.next === 'open') {
        setHypothesisVBorders((prev) => new Set(prev).add(`${act.r},${act.c}`));
      }
    }
    setHistoryIndex((idx) => idx + 1);
  };

  const handleRequestHint = () => {
    if (isCompleted || tournamentMode) return;
    const forced = WebDominoesGenerator.getNextForcedDeduction(spec, hBorders, vBorders);
    if (!forced) return;

    if (!activeHint || activeHint.step !== forced.step) {
      setActiveHint(forced);
      setHintLevel(1);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  };

  const handleRequestTacticalMetaHint = () => {
    if (isCompleted || tournamentMode) return;
    const forced = WebDominoesGenerator.getNextForcedDeduction(spec, hBorders, vBorders);
    if (!forced) {
      setTacticalMetaHint(
        isEn ? 'No immediate forced step found.' : '目前全盤暫無單一定式約束，請檢驗連通二分匹配。'
      );
      return;
    }

    setTacticalMetaHint(
      isEn
        ? `[Tactical Insight] ${forced.rationale}. Target focus at row ${forced.r1 + 1}, column ${forced.c1 + 1}.`
        : `【戰術分析】${forced.rationale}。建議聚焦第 ${forced.r1 + 1} 行、第 ${forced.c1 + 1} 列直交區域。`
    );
  };

  // P0 修復：標準化金庫收藏對接
  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const vaultItem: VaultItem = {
      id: actualPuzzle.id,
      engine: 'dominoes',
      tier: String(actualPuzzle.tier || 'kids'),
      seed: Number(seed),
      steps: history.length,
      timeSpentSec: Math.round(elapsedMs / 1000),
      date: new Date().toISOString(),
    };
    const res = VaultManager.toggleFavorite(vaultItem);
    setIsFav(res.isFav);
  };

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);
  const cellSize = Math.min(300 / Math.max(rows, cols), 36);

  return (
    <div className="flex flex-col items-center justify-center p-2 select-none font-mono outline-none touch-none w-full max-w-[420px] mx-auto">
      {/* 頂部看板 */}
      <div className="w-full max-w-[340px] mb-2 flex flex-col gap-1 text-[9px]">
        <div className="flex items-center justify-between px-1 text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="text-amber-400 font-bold">Double-{maxPip} 套裝骨牌</span>
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
            {hypothesisHBorders.size + hypothesisVBorders.size > 0 && (
              <span className="text-purple-400 font-bold animate-pulse">
                ⚠️ 試探中: {hypothesisHBorders.size + hypothesisVBorders.size}
              </span>
            )}
            <span className="text-slate-500 text-[8px]">
              Placed: {identifiedDominoes.list.length} / {((maxPip + 1) * (maxPip + 2)) / 2}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Speed' : '耗時'}</div>
            <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Complexity' : '邏輯複雜度'}</div>
            <div className="text-cyan-300 font-bold">{spec.logicalComplexityScore || 120}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
            <div className="text-slate-500 text-[7px]">{isEn ? 'Pure Deduction' : '純推導判定'}</div>
            <div
              className={`font-bold ${
                hypothesisHBorders.size + hypothesisVBorders.size > 0 ? 'text-purple-400' : 'text-emerald-400'
              }`}
            >
              {hypothesisHBorders.size + hypothesisVBorders.size > 0 ? '試探標記' : '100% 潔癖'}
            </div>
          </div>
        </div>
      </div>

      {/* 棋盤主體（支援物理卷面變換：旋轉與翻轉） */}
      <div className="relative p-3 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl flex flex-col items-center">
        <div
          style={{
            transform: `rotate(${rotationDeg}deg) scaleX(${isFlippedH ? -1 : 1})`,
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
          className="grid gap-[2px] bg-slate-900/90 p-[3px] rounded border border-slate-800 relative"
        >
          <div
            className="grid gap-[2px]"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {grid.map((row, r) =>
              row.map((val, c) => {
                const isSelected = selectedCell?.[0] === r && selectedCell?.[1] === c;
                const isCandidateNeighbor = candidateNeighborsOfHovered.has(`${r},${c}`);
                const isHintHighlight =
                  activeHint &&
                  ((activeHint.r1 === r && activeHint.c1 === c) ||
                    (activeHint.r2 === r && activeHint.c2 === c));

                return (
                  <div
                    key={`cell-${r}-${c}`}
                    style={{ width: cellSize, height: cellSize }}
                    onMouseEnter={() => setHoveredCell([r, c])}
                    onMouseLeave={() => setHoveredCell(null)}
                    onClick={() => setSelectedCell([r, c])}
                    className={`flex items-center justify-center font-black text-xs rounded transition-all duration-100 relative cursor-pointer ${
                      isHintHighlight
                        ? 'bg-amber-500/40 text-amber-200 ring-2 ring-amber-400 animate-pulse z-10'
                        : isCandidateNeighbor
                        ? 'bg-cyan-950/80 text-cyan-300 ring-1 ring-cyan-500/80 shadow-[0_0_8px_rgba(6,182,212,0.4)] z-10'
                        : isSelected
                        ? 'bg-slate-800 text-cyan-300 ring-1 ring-cyan-400'
                        : 'bg-slate-950 text-slate-300 hover:bg-slate-900'
                    }`}
                  >
                    <span style={{ transform: `scaleX(${isFlippedH ? -1 : 1}) rotate(${-rotationDeg}deg)` }}>
                      {val}
                    </span>

                    {/* 32px 擴展命中熱區：垂直邊界 */}
                    {c < cols - 1 && (
                      <div
                        style={{ width: 32, height: cellSize }}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVBorder(r, c);
                        }}
                        className="absolute -right-4 top-0 z-20 flex items-center justify-center cursor-pointer group"
                      >
                        <div
                          className={`w-[3px] h-[80%] rounded-full transition-all ${
                            vBorders[r]?.[c] === 'wall'
                              ? 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.8)]'
                              : vBorders[r]?.[c] === 'open'
                              ? hypothesisVBorders.has(`${r},${c}`)
                                ? 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.9)] animate-pulse'
                                : 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]'
                              : 'bg-transparent group-hover:bg-slate-700/60'
                          }`}
                        />
                      </div>
                    )}

                    {/* 32px 擴展命中熱區：水平邊界 */}
                    {r < rows - 1 && (
                      <div
                        style={{ width: cellSize, height: 32 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleHBorder(r, c);
                        }}
                        className="absolute left-0 -bottom-4 z-20 flex items-center justify-center cursor-pointer group"
                      >
                        <div
                          className={`h-[3px] w-[80%] rounded-full transition-all ${
                            hBorders[r]?.[c] === 'wall'
                              ? 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.8)]'
                              : hBorders[r]?.[c] === 'open'
                              ? hypothesisHBorders.has(`${r},${c}`)
                                ? 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.9)] animate-pulse'
                                : 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]'
                              : 'bg-transparent group-hover:bg-slate-700/60'
                          }`}
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 戰術提示卡片 */}
      {tacticalMetaHint && (
        <div className="w-full max-w-[340px] mt-2 p-2 bg-slate-900 border border-cyan-500/60 rounded-lg text-[8px] text-cyan-200 animate-fade-in font-mono flex items-center justify-between">
          <span>{tacticalMetaHint}</span>
          <button
            onClick={() => setTacticalMetaHint(null)}
            className="px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded text-[7px] ml-1 cursor-pointer"
          >
            關閉
          </button>
        </div>
      )}

      {/* 階梯因果提示面板 */}
      {hintLevel > 0 && activeHint && (
        <div className="mt-2 p-2 bg-slate-900/90 border border-amber-500/60 rounded-xl text-center w-full max-w-[340px] shadow-lg animate-fade-in font-mono">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[7.5px] font-bold text-amber-300 tracking-wider">
              {activeHint.technique.toUpperCase()} 階梯提示
            </span>
            <div className="flex gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${hintLevel >= 1 ? 'bg-amber-400' : 'bg-slate-700'}`} />
              <span className={`w-1.5 h-1.5 rounded-full ${hintLevel >= 2 ? 'bg-amber-400' : 'bg-slate-700'}`} />
              <span
                className={`w-1.5 h-1.5 rounded-full ${hintLevel >= 3 ? 'bg-rose-500 animate-ping' : 'bg-slate-700'}`}
              />
            </div>
          </div>
          <div className="py-0.5 text-[8px] text-slate-200">
            {hintLevel === 1 && (
              <span className="text-amber-300">
                🔍 請檢驗坐標 [{activeHint.r1 + 1}, {activeHint.c1 + 1}] 與 [{activeHint.r2 + 1}, {activeHint.c2 + 1}] 的正交關聯。
              </span>
            )}
            {hintLevel === 2 && (
              <span className="text-cyan-300 font-bold">⚡ {activeHint.rationale}</span>
            )}
            {hintLevel === 3 && (
              <span className="text-rose-400 font-black">
                🎯 {isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 控制按鈕群 */}
      <div className="flex items-center justify-between w-full max-w-[340px] mt-2 gap-1 text-[8.5px] font-bold">
        <button
          onClick={handleUndo}
          disabled={historyIndex < 0}
          className={`flex-1 py-1.5 rounded-lg border transition ${
            historyIndex >= 0
              ? 'bg-slate-900 text-slate-200 border-slate-700 cursor-pointer'
              : 'bg-slate-950 text-slate-600 border-slate-900'
          }`}
        >
          ↩ 復原
        </button>
        <button
          onClick={handleRedo}
          disabled={historyIndex >= history.length - 1}
          className={`flex-1 py-1.5 rounded-lg border transition ${
            historyIndex < history.length - 1
              ? 'bg-slate-900 text-slate-200 border-slate-700 cursor-pointer'
              : 'bg-slate-950 text-slate-600 border-slate-900'
          }`}
        >
          ↪ 重做
        </button>
        <button
          onClick={() => setRotationDeg((deg) => (deg + 90) % 360)}
          className="px-2 py-1.5 rounded-lg border bg-slate-900 border-slate-700 text-slate-300 hover:text-cyan-300 transition cursor-pointer"
          title={isEn ? 'Rotate Board 90°' : '盤面旋轉 90°'}
        >
          ↻ 旋轉
        </button>
        <button
          onClick={() => setIsFlippedH((prev) => !prev)}
          className={`px-2 py-1.5 rounded-lg border transition cursor-pointer ${
            isFlippedH ? 'bg-cyan-950 border-cyan-500 text-cyan-300' : 'bg-slate-900 border-slate-700 text-slate-300'
          }`}
          title={isEn ? 'Flip Board Horizontally' : '水平鏡像翻轉'}
        >
          ⇄ 翻轉
        </button>
        <button
          onClick={handleRequestTacticalMetaHint}
          className="flex-1 py-1.5 rounded-lg border bg-slate-900 border-cyan-500/50 text-cyan-300 hover:bg-cyan-950/40 transition cursor-pointer"
        >
          📐 戰術
        </button>
        {!tournamentMode && (
          <button
            onClick={handleRequestHint}
            className="flex-1 py-1.5 rounded-lg border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition cursor-pointer"
          >
            💡 提示
          </button>
        )}
      </div>

      {/* 骨牌庫存檢核盤 */}
      <div className="w-full max-w-[340px] mt-2 p-2 bg-slate-950 border border-slate-800 rounded-lg">
        <div className="text-[7.5px] text-slate-500 font-bold mb-1 flex items-center justify-between">
          <span>骨牌庫存檢驗 (Domino Inventory)</span>
          <button
            onClick={() => setShowMoveHistory((prev) => !prev)}
            className="text-cyan-400 underline cursor-pointer"
          >
            {showMoveHistory ? '隱藏棋譜' : '展開操作棋譜'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {dominoDeck.map(([v1, v2]: [number, number], idx: number) => {
            const key = WebDominoesGenerator.getDominoKey(v1, v2);
            const count = identifiedDominoes.usedCounts.get(key) || 0;
            const isDuplicate = count > 1;
            const isUsed = count === 1;

            return (
              <span
                key={`deck-${idx}`}
                className={`px-1 py-0.5 rounded text-[7.5px] font-mono border transition ${
                  isDuplicate
                    ? 'bg-rose-950 border-rose-500 text-rose-300 animate-pulse font-bold'
                    : isUsed
                    ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                    : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}
              >
                [{v1}|{v2}]
              </span>
            );
          })}
        </div>
      </div>

      {/* 可折疊操作棋譜樹 */}
      {showMoveHistory && (
        <div className="w-full max-w-[340px] mt-2 p-2 bg-slate-900/90 border border-slate-700 rounded-lg max-h-36 overflow-y-auto text-[7.5px] font-mono text-slate-300 space-y-0.5">
          <div className="text-slate-400 font-bold mb-1">📜 歷史操作棋譜 ({history.length} 步)</div>
          {history.map((act: UserAction, i: number) => (
            <div
              key={`hist-${i}`}
              className={`px-1 py-0.5 rounded flex justify-between ${
                i === historyIndex ? 'bg-cyan-950 text-cyan-300 font-bold' : 'hover:bg-slate-800'
              } ${act.isHypothesis ? 'text-purple-300' : ''}`}
            >
              <span>
                #{i + 1} {isEn ? act.descEn : act.descZh}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 勝利通關面板 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border-2 border-emerald-500/90 rounded-2xl text-center w-full max-w-[340px] shadow-2xl animate-fade-in font-mono">
          <div className="text-emerald-400 font-black text-sm uppercase tracking-widest animate-pulse">
            DOMINO GRID RESOLVED!
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
              <span className="text-slate-400">DAG 推導關鍵深度:</span>
              <span className="text-amber-300 font-bold">{spec.criticalPathDepth} 階</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">推導純度:</span>
              <span
                className={`font-bold ${
                  hypothesisHBorders.size + hypothesisVBorders.size > 0 ? 'text-purple-400' : 'text-emerald-400'
                }`}
              >
                {hypothesisHBorders.size + hypothesisVBorders.size > 0
                  ? `包含 ${hypothesisHBorders.size + hypothesisVBorders.size} 步試探`
                  : '100% 絕對純邏輯'}
              </span>
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
            tournamentId: tournamentMode ? 'WPF_DOMINOES_2026' : 'GLOBAL_DOMINO_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'dominoes',
            tier: (actualPuzzle.tier as string) || 'kids',
            timeSpentSec: Math.round(elapsedMs / 1000),
            conflictsCount: hypothesisHBorders.size + hypothesisVBorders.size,
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
