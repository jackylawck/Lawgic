// web-frontend/src/components/MasyuBoard.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  MasyuSpec,
  MasyuHintStep,
  WebMasyuGenerator,
  generateMasyuSignature,
  GenesisFrame,
} from '../engines/masyuGenerator';
import { MasyuReservoirManager } from '../engines/masyuClient';
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

interface BoardSnapshot {
  edges: Set<string>;
  blockedEdges: Set<string>;
}

export const MasyuBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, profile, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as MasyuSpec;
  const size = spec?.size || 5;
  const grid = spec?.grid || [];
  const seed = (actualPuzzle?.metrics as any)?.seed || 12345;
  const motif = spec?.blueprint?.motif || (actualPuzzle?.metrics as any)?.motif || 'geometric_harmony';
  const paradigm = spec?.blueprint?.paradigm || (actualPuzzle?.metrics as any)?.paradigm || 'archimedean_spiral';
  const coverageRatio = spec?.coverageRatio || (actualPuzzle?.metrics as any)?.coverageRatio || 0.72;
  const lipschitz = spec?.lipschitzScore || (actualPuzzle?.metrics as any)?.lipschitzScore || 0.96;
  const genesisFrames: GenesisFrame[] = spec?.genesisFrames || [];

  const boardRef = useRef<HTMLDivElement>(null);
  const [boardState, setBoardState] = useState<BoardSnapshot>({
    edges: new Set(),
    blockedEdges: new Set(),
  });

  const [dragStart, setDragStart] = useState<[number, number] | null>(null);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isTimeOut, setIsTimeOut] = useState<boolean>(false);
  const [isFav, setIsFav] = useState<boolean>(() =>
    VaultManager.isFavorited(actualPuzzle?.id || '')
  );
  const [sanctionedSig, setSanctionedSig] = useState<string>('');
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);

  const [isBoardFocused, setIsBoardFocused] = useState<boolean>(true);

  const dragTransactionRef = useRef<{
    initialSnapshot: BoardSnapshot;
    intermediateSnapshots: BoardSnapshot[];
    lastVector: [number, number] | null;
  } | null>(null);

  const undoCountRef = useRef<number>(0);
  const hintCountRef = useRef<number>(0);
  const movesCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  // 賽事即時行為稽核 Session
  const proctoringRef = useRef<TournamentProctoringSession | null>(null);

  useEffect(() => {
    proctoringRef.current = new TournamentProctoringSession();
    return () => {
      proctoringRef.current?.destroy();
      proctoringRef.current = null;
    };
  }, [actualPuzzle?.id]);

  const [isReplayingGenesis, setIsReplayingGenesis] = useState<boolean>(false);
  const [replayFrameIndex, setReplayFrameIndex] = useState<number>(0);

  const [history, setHistory] = useState<BoardSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<BoardSnapshot[]>([]);

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<MasyuHintStep | null>(null);

  const timeLimit = actualPuzzle?.metrics?.estimated_time_sec || 150;
  const [remainingSec, setRemainingSec] = useState<number>(timeLimit);
  const [accumulatedMs, setAccumulatedMs] = useState<number>(0);
  const lastActiveTimestamp = useRef<number>(performance.now());
  const isPageVisible = useRef<boolean>(true);

  useEffect(() => {
    setBoardState({ edges: new Set(), blockedEdges: new Set() });
    setHistory([]);
    setRedoStack([]);
    setDragStart(null);
    dragTransactionRef.current = null;
    setIsCompleted(false);
    setIsTimeOut(false);
    setIsReplayingGenesis(false);
    setRemainingSec(timeLimit);
    setAccumulatedMs(0);
    setHintLevel(0);
    setActiveHint(null);
    setSanctionedSig('');
    undoCountRef.current = 0;
    hintCountRef.current = 0;
    movesCountRef.current = 0;
    hasRecordedRef.current = false;
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
    lastActiveTimestamp.current = performance.now();
    requestAnimationFrame(() => boardRef.current?.focus());
  }, [actualPuzzle?.id, size, timeLimit]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      isPageVisible.current = document.visibilityState === 'visible';
      if (isPageVisible.current) lastActiveTimestamp.current = performance.now();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (isCompleted || isTimeOut) {
      return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }

    const timer = setInterval(() => {
      if (!isPageVisible.current) return;
      const now = performance.now();
      const delta = now - lastActiveTimestamp.current;
      lastActiveTimestamp.current = now;

      setAccumulatedMs((prev) => {
        const next = prev + delta;
        if (tournamentMode) {
          const spent = Math.floor(next / 1000);
          const left = Math.max(0, timeLimit - spent);
          setRemainingSec(left);
          if (left === 0) setIsTimeOut(true);
        }
        return next;
      });
    }, 100);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isCompleted, isTimeOut, tournamentMode, timeLimit]);

  useEffect(() => {
    if (!isReplayingGenesis || genesisFrames.length === 0) return;
    const interval = setInterval(() => {
      setReplayFrameIndex((prev) => {
        if (prev + 1 >= genesisFrames.length) {
          setIsReplayingGenesis(false);
          return 0;
        }
        return prev + 1;
      });
    }, 110);
    return () => clearInterval(interval);
  }, [isReplayingGenesis, genesisFrames]);

  const nodeDegrees = useMemo(() => {
    const degMap = new Map<string, number>();
    boardState.edges.forEach((key) => {
      const [u, v] = key.split('-');
      degMap.set(u, (degMap.get(u) || 0) + 1);
      degMap.set(v, (degMap.get(v) || 0) + 1);
    });
    return degMap;
  }, [boardState.edges]);

  const verifyCompletion = useCallback(
    (currentEdges: Set<string>) => {
      if (hasRecordedRef.current || isCompleted) return;

      if (WebMasyuGenerator.validateSolution(grid, currentEdges, size)) {
        setIsCompleted(true);
        hasRecordedRef.current = true;
        const spent = Math.max(1, Math.round(accumulatedMs / 1000));
        generateMasyuSignature(`APEX-WPC-${actualPuzzle?.id}-${spent}-${seed}`).then(setSanctionedSig);

        MasyuReservoirManager.getInstance().reportTelemetry({
          tier: (actualPuzzle?.tier as TierKey) || 'kids',
          timeSpentSec: spent,
          expectedTimeSec: timeLimit,
          undoCount: undoCountRef.current,
          hintCount: hintCountRef.current,
        });

        if (actualPuzzle) {
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: 'masyu_wpc_apex_v10',
            tier: (actualPuzzle.tier as TierKey) || 'kids',
            cognitiveLoad: actualPuzzle.cognitiveLoad || {
              spatial: 0.98,
              numeric: 0.05,
              workingMemory: 0.88,
              inhibition: 0.99,
            },
            isSuccess: true,
            timeSpentSec: spent,
            conflictsCount: 0,
            technique: 'EulerianTopologicalClosure',
            isPureClear: hintCountRef.current === 0,
          });
        }
      }
    },
    [accumulatedMs, actualPuzzle, grid, isCompleted, recordAttempt, seed, size, timeLimit]
  );

  const commitMutation = useCallback(
    (nextSnapshot: BoardSnapshot, snapshotsToArchive: BoardSnapshot[]) => {
      movesCountRef.current++;
      setHistory((prev) => [...prev.slice(-40), ...snapshotsToArchive]);
      setRedoStack([]);
      setBoardState(nextSnapshot);
      verifyCompletion(nextSnapshot.edges);
    },
    [verifyCompletion]
  );

  const handleUndo = useCallback(() => {
    if (history.length === 0 || isCompleted || isTimeOut) return;
    undoCountRef.current++;
    const previous = history[history.length - 1];
    setRedoStack((prev) => [...prev, boardState]);
    setHistory((prev) => prev.slice(0, -1));
    setBoardState(previous);
  }, [history, boardState, isCompleted, isTimeOut]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted || isTimeOut) return;
    const nextState = redoStack[redoStack.length - 1];
    setHistory((prev) => [...prev, boardState]);
    setRedoStack((prev) => prev.slice(0, -1));
    setBoardState(nextState);
    verifyCompletion(nextState.edges);
  }, [redoStack, boardState, verifyCompletion, isCompleted, isTimeOut]);

  const handleRequestHint = useCallback(() => {
    if (isCompleted || isTimeOut || tournamentMode) return;
    hintCountRef.current++;
    const step = WebMasyuGenerator.getWpcHint(grid, boardState.edges, size);
    if (!step) return;

    if (!activeHint || activeHint.r !== step.r || activeHint.c !== step.c) {
      setActiveHint(step);
      setHintLevel(1);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, isTimeOut, tournamentMode, grid, boardState.edges, size, activeHint]);

  // 金庫收藏切換（取用 res.isFav 防止型別錯誤）
  const handleToggleFavorite = () => {
    if (!actualPuzzle) return;
    const vaultItem: VaultItem = {
      id: actualPuzzle.id,
      engine: 'masyu',
      tier: (actualPuzzle.tier as string) || 'kids',
      seed: typeof seed === 'number' ? seed : 12345,
      steps: movesCountRef.current,
      timeSpentSec: Math.round(accumulatedMs / 1000),
      iqScore: cci.standardIQ,
      date: new Date().toISOString(),
    };
    const res = VaultManager.toggleFavorite(vaultItem);
    setIsFav(res.isFav);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!boardRef.current || !boardRef.current.contains(document.activeElement)) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key.toLowerCase() === 'h' && !tournamentMode) {
        e.preventDefault();
        handleRequestHint();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleRequestHint, tournamentMode]);

  const handlePointerDown = (r: number, c: number, e: React.PointerEvent) => {
    if (e.button === 2 || isCompleted || isTimeOut) return;
    boardRef.current?.focus();
    dragTransactionRef.current = {
      initialSnapshot: {
        edges: new Set(boardState.edges),
        blockedEdges: new Set(boardState.blockedEdges),
      },
      intermediateSnapshots: [],
      lastVector: null,
    };
    setDragStart([r, c]);
  };

  const handlePointerEnter = (r: number, c: number) => {
    if (!dragStart || !dragTransactionRef.current) return;
    const [sr, sc] = dragStart;
    const dr = r - sr;
    const dc = c - sc;

    if (Math.abs(dr) + Math.abs(dc) === 1) {
      const key = WebMasyuGenerator.makeEdgeKey(sr, sc, r, c);
      const tx = dragTransactionRef.current;

      if (tx.lastVector) {
        const [prevDr, prevDc] = tx.lastVector;
        if (prevDr !== dr || prevDc !== dc) {
          tx.intermediateSnapshots.push({
            edges: new Set(boardState.edges),
            blockedEdges: new Set(boardState.blockedEdges),
          });
        }
      }
      tx.lastVector = [dr, dc];

      setBoardState((prev) => {
        const nextEdges = new Set(prev.edges);
        const nextBlocked = new Set(prev.blockedEdges);
        if (nextEdges.has(key)) nextEdges.delete(key);
        else nextEdges.add(key);
        nextBlocked.delete(key);
        return { edges: nextEdges, blockedEdges: nextBlocked };
      });

      setDragStart([r, c]);
    }
  };

  const handlePointerUp = () => {
    const tx = dragTransactionRef.current;
    if (!tx) return;
    dragTransactionRef.current = null;
    setDragStart(null);

    const init = tx.initialSnapshot;
    const isEdgesChanged =
      init.edges.size !== boardState.edges.size ||
      Array.from(init.edges).some((e) => !boardState.edges.has(e));
    const isBlockedChanged =
      init.blockedEdges.size !== boardState.blockedEdges.size ||
      Array.from(init.blockedEdges).some((e) => !boardState.blockedEdges.has(e));

    if (isEdgesChanged || isBlockedChanged) {
      const archives = [init, ...tx.intermediateSnapshots];
      commitMutation(boardState, archives);
    }
  };

  const handleContextMenuClick = (r: number, c: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (isCompleted || isTimeOut || c + 1 >= size) return;
    boardRef.current?.focus();

    const key = WebMasyuGenerator.makeEdgeKey(r, c, r, c + 1);
    const nextBlocked = new Set(boardState.blockedEdges);
    const nextEdges = new Set(boardState.edges);

    if (nextBlocked.has(key)) nextBlocked.delete(key);
    else nextBlocked.add(key);
    nextEdges.delete(key);

    const nextSnapshot: BoardSnapshot = { edges: nextEdges, blockedEdges: nextBlocked };
    commitMutation(nextSnapshot, [boardState]);
  };

  const cellSize = Math.min(280 / size, size >= 9 ? 30 : 42);
  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  const contradictionDepth = activeHint?.contradictionTree?.branchChain.length || 0;
  const isDeepConflict = contradictionDepth >= 5;

  const contradictionEdges = useMemo(() => {
    if (!activeHint?.contradictionTree || hintLevel < 2) return [];
    return activeHint.contradictionTree.branchChain.map((node) => node.edge);
  }, [activeHint, hintLevel]);

  const replayActiveEdges = useMemo(() => {
    if (!isReplayingGenesis || !genesisFrames[replayFrameIndex]) return null;
    const path = genesisFrames[replayFrameIndex].path;
    const frameEdges = new Set<string>();
    for (let i = 0; i < path.length; i++) {
      const nxt = path[(i + 1) % path.length];
      frameEdges.add(WebMasyuGenerator.makeEdgeKey(path[i][0], path[i][1], nxt[0], nxt[1]));
    }
    return frameEdges;
  }, [isReplayingGenesis, genesisFrames, replayFrameIndex]);

  const totalTimelineSteps = history.length + redoStack.length;
  const currentStepIndex = history.length;

  return (
    <div
      ref={boardRef}
      onPointerUp={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
      onFocus={() => setIsBoardFocused(true)}
      onBlur={() => setIsBoardFocused(false)}
      tabIndex={0}
      className={`relative flex flex-col items-center justify-center p-2 select-none font-mono outline-none w-full max-w-[420px] mx-auto rounded-2xl transition-all duration-300 ${
        isBoardFocused ? 'ring-1 ring-cyan-500/30' : 'ring-1 ring-slate-800'
      }`}
    >
      {/* 頂部看板 */}
      <div className="w-full flex items-center justify-between gap-1 mb-2 px-1 text-[8px]">
        <div className="flex items-center gap-1.5">
          <div className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-center">
            <span className="text-slate-500">{tournamentMode ? 'CD' : 'TIME'}: </span>
            <span
              className={`font-bold ${
                tournamentMode && remainingSec <= 30 ? 'text-rose-400 animate-pulse' : 'text-slate-200'
              }`}
            >
              {tournamentMode ? `${remainingSec}s` : `${(accumulatedMs / 1000).toFixed(1)}s`}
            </span>
          </div>

          <span className="bg-purple-950/80 border border-purple-800/80 text-purple-300 font-bold px-1.5 py-0.5 rounded text-[7.5px] uppercase tracking-tighter">
            🎨 {motif.replace(/_/g, ' ')}
          </span>

          {hintCountRef.current === 0 && !isCompleted && (
            <span className="bg-emerald-950/90 border border-emerald-800/80 text-emerald-400 font-bold px-1.5 py-0.5 rounded text-[7px] animate-pulse">
              ✨ PURE
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-slate-400 font-semibold">
          <button
            onClick={handleToggleFavorite}
            className={`px-1.5 py-0.5 rounded border transition cursor-pointer ${
              isFav
                ? 'border-amber-500/80 bg-amber-950/60 text-amber-300 font-bold'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
            title={isEn ? 'Toggle Favorite' : '收藏謎題'}
          >
            {isFav ? '★' : '☆'}
          </button>
          <button
            onClick={handleUndo}
            disabled={history.length === 0 || isCompleted}
            className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900 text-slate-300 disabled:opacity-30 hover:border-slate-500 cursor-pointer transition-colors"
            title="Atom Undo (Ctrl+Z)"
          >
            ⟲
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0 || isCompleted}
            className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900 text-slate-300 disabled:opacity-30 hover:border-slate-500 cursor-pointer transition-colors"
            title="Redo (Ctrl+Y)"
          >
            ⟳
          </button>
          <span className="text-cyan-400 font-bold">
            {size}&times;{size}
          </span>
        </div>
      </div>

      {/* 棋盤主體 */}
      <div className="relative p-3 bg-slate-950 border-2 border-slate-800 rounded-xl shadow-2xl flex flex-col items-center overflow-hidden">
        {!isBoardFocused && !isCompleted && (
          <div
            onClick={() => boardRef.current?.focus()}
            className="absolute inset-0 bg-slate-950/75 backdrop-blur-[0.5px] z-30 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 group"
          >
            <div className="text-[9px] text-cyan-300 font-bold tracking-widest uppercase py-1 px-3 bg-slate-900 border border-cyan-500/40 rounded-full shadow-lg group-hover:scale-105 transition-transform flex items-center gap-1.5">
              <span>🔒</span>
              <span>{isEn ? 'Click to Arm Controls' : '點擊棋盤以啟用戰鬥模式'}</span>
            </div>
          </div>
        )}

        <div
          className="relative grid gap-0 bg-slate-900/90 border border-slate-800 select-none touch-none"
          style={{
            gridTemplateColumns: `repeat(${size}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${size}, ${cellSize}px)`,
          }}
        >
          {Array.from({ length: size }).map((_, r) =>
            Array.from({ length: size }).map((__, c) => {
              const cellCoordKey = `${r},${c}`;
              const deg = nodeDegrees.get(cellCoordKey) || 0;
              const hasBranchError = deg > 2;
              const pearl = grid[r]?.[c] || 'none';
              const isPearlIsolated = pearl !== 'none' && deg === 0 && boardState.edges.size > 4;

              const rightKey = WebMasyuGenerator.makeEdgeKey(r, c, r, c + 1);
              const bottomKey = WebMasyuGenerator.makeEdgeKey(r, c, r + 1, c);

              const hasRightEdge = isReplayingGenesis
                ? replayActiveEdges?.has(rightKey)
                : boardState.edges.has(rightKey);
              const hasBottomEdge = isReplayingGenesis
                ? replayActiveEdges?.has(bottomKey)
                : boardState.edges.has(bottomKey);

              const isRightBlocked = !isReplayingGenesis && boardState.blockedEdges.has(rightKey);
              const isBottomBlocked = !isReplayingGenesis && boardState.blockedEdges.has(bottomKey);

              const isHintTarget = activeHint?.r === r && activeHint?.c === c && hintLevel > 0;
              const isConflictEpicenter =
                activeHint?.contradictionTree?.conflictLocation[0] === r &&
                activeHint?.contradictionTree?.conflictLocation[1] === c &&
                hintLevel >= 2;

              const isRightContradiction = contradictionEdges.includes(rightKey);
              const isBottomContradiction = contradictionEdges.includes(bottomKey);

              return (
                <div
                  key={`cell-${r}-${c}`}
                  onPointerDown={(e) => !isReplayingGenesis && handlePointerDown(r, c, e)}
                  onPointerEnter={() => !isReplayingGenesis && handlePointerEnter(r, c)}
                  onContextMenu={(e) => !isReplayingGenesis && handleContextMenuClick(r, c, e)}
                  className={`relative flex items-center justify-center border border-slate-800/40 cursor-crosshair ${
                    isHintTarget ? 'ring-2 ring-amber-400/90 bg-amber-950/20' : ''
                  }`}
                  style={{ width: cellSize, height: cellSize }}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      hasBranchError
                        ? 'bg-rose-500 scale-150 ring-4 ring-rose-500/50'
                        : isPearlIsolated
                        ? 'bg-amber-400/80 ring-2 ring-amber-400/30'
                        : 'bg-slate-700/50'
                    }`}
                  />

                  {pearl === 'white' && (
                    <div
                      className="absolute rounded-full border-2 border-slate-200 bg-white shadow-[0_0_10px_rgba(255,255,255,0.85)] z-10 pointer-events-none"
                      style={{ width: cellSize * 0.58, height: cellSize * 0.58 }}
                    />
                  )}
                  {pearl === 'black' && (
                    <div
                      className="absolute rounded-full border-2 border-slate-500 bg-slate-950 shadow-[0_0_10px_rgba(0,0,0,0.95)] z-10 pointer-events-none"
                      style={{ width: cellSize * 0.58, height: cellSize * 0.58 }}
                    />
                  )}

                  {hasRightEdge && (
                    <div
                      className={`absolute left-1/2 top-1/2 -translate-y-1/2 z-0 pointer-events-none transition-all ${
                        isReplayingGenesis
                          ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.9)]'
                          : 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]'
                      }`}
                      style={{ width: cellSize, height: 3.5 }}
                    />
                  )}

                  {isRightContradiction && !hasRightEdge && (
                    <div
                      className={`absolute left-1/2 top-1/2 -translate-y-1/2 z-0 pointer-events-none transition-all ${
                        isDeepConflict
                          ? 'bg-rose-600/40 blur-[1px] shadow-[0_0_14px_rgba(225,29,72,0.95)] animate-pulse'
                          : 'bg-amber-500/30 blur-[1.5px] shadow-[0_0_8px_rgba(245,158,11,0.8)]'
                      }`}
                      style={{ width: cellSize, height: isDeepConflict ? 6 : 4 }}
                    />
                  )}

                  {isRightBlocked && (
                    <div className="absolute left-full top-1/2 -translate-x-1/2 -translate-y-1/2 text-rose-500 font-bold text-xs pointer-events-none z-10">
                      ✕
                    </div>
                  )}

                  {hasBottomEdge && (
                    <div
                      className={`absolute left-1/2 top-1/2 -translate-x-1/2 z-0 pointer-events-none transition-all ${
                        isReplayingGenesis
                          ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.9)]'
                          : 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]'
                      }`}
                      style={{ height: cellSize, width: 3.5 }}
                    />
                  )}

                  {isBottomContradiction && !hasBottomEdge && (
                    <div
                      className={`absolute left-1/2 top-1/2 -translate-x-1/2 z-0 pointer-events-none transition-all ${
                        isDeepConflict
                          ? 'bg-rose-600/40 blur-[1px] shadow-[0_0_14px_rgba(225,29,72,0.95)] animate-pulse'
                          : 'bg-amber-500/30 blur-[1.5px] shadow-[0_0_8px_rgba(245,158,11,0.8)]'
                      }`}
                      style={{ height: cellSize, width: isDeepConflict ? 6 : 4 }}
                    />
                  )}

                  {isBottomBlocked && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 -translate-y-1/2 text-rose-500 font-bold text-xs pointer-events-none z-10">
                      ✕
                    </div>
                  )}

                  {isConflictEpicenter && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                      <div className="w-9 h-9 rounded-full border border-rose-500/80 animate-ping" />
                      <div className="absolute w-5 h-5 rounded-full border border-white/90 shadow-[0_0_8px_rgba(255,255,255,0.95)]" />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 歷史時間線小地圖 */}
        <div className="w-full mt-3 px-1 flex flex-col gap-0.5">
          <div className="relative w-full h-1 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div
              className="absolute top-0 left-0 h-full bg-cyan-500/50 transition-all duration-150"
              style={{
                width: `${totalTimelineSteps > 0 ? (currentStepIndex / totalTimelineSteps) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-[6.5px] text-slate-600 font-mono">
            <span>START</span>
            <span>
              TIMELINE: {currentStepIndex}/{totalTimelineSteps}
            </span>
            <span>REDO MAX</span>
          </div>
        </div>
      </div>

      {/* 控制指引 */}
      <div className="w-full max-w-[300px] flex items-center justify-between px-1 mt-2 text-[7.5px] text-slate-500 font-mono">
        <span>{isEn ? 'Drag: Stroke' : '拖曳: 原子筆畫'}</span>
        <span>{isEn ? 'Right: Cross ✕' : '右鍵: 標記 ✕'}</span>
        <span>{isEn ? 'Ctrl+Z: Undo' : 'Ctrl+Z: 撤銷'}</span>
        <span>{isEn ? 'H: WPC Hint' : 'H: 推導提示'}</span>
      </div>

      {/* 提示按鈕 */}
      {!tournamentMode && !isCompleted && (
        <div className="flex items-center justify-between w-full max-w-[300px] mt-2 gap-1.5">
          <button
            onClick={handleRequestHint}
            className="w-full py-1.5 text-xs font-bold rounded-lg border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition flex items-center justify-center gap-1 shadow cursor-pointer"
          >
            ⚡ {isEn ? 'Deductive Ladder [H]' : '因果推導階梯 [H]'}
          </button>
        </div>
      )}

      {/* 提示內容 */}
      {hintLevel > 0 && activeHint && (
        <div className="mt-2 p-2 rounded-xl text-left w-full max-w-[300px] font-mono border bg-slate-900/90 border-amber-500/60 text-slate-200 text-[8px] animate-fade-in shadow-xl">
          <div className="flex items-center justify-between font-bold text-amber-300 mb-0.5 border-b border-slate-800 pb-0.5">
            <span>🔮 {activeHint.structuralPattern}</span>
            <span className={isDeepConflict ? 'text-rose-400 animate-pulse' : 'text-purple-400'}>
              LV.{activeHint.techniqueLevel} {isDeepConflict && '⚡ DEEP TENSE'}
            </span>
          </div>
          <div className="text-cyan-300 mt-1">{activeHint.humanReadable[isEn ? 'en' : 'zh']}</div>
          {activeHint.contradictionTree && hintLevel >= 2 && (
            <div className="mt-1 text-[7px] text-rose-300 border-l border-rose-500 pl-1.5">
              ⚠️ {isEn ? 'Lookahead Shockwave:' : '時態反證碰撞點：'} {activeHint.contradictionTree.conflictReason}
            </div>
          )}
        </div>
      )}

      {/* 通關成就面板與拓撲指紋 */}
      {isCompleted && (
        <div className="mt-2.5 p-3 bg-slate-950 border border-emerald-500/80 rounded-xl text-center w-full max-w-[320px] shadow-2xl font-mono animate-fade-in">
          <div className="text-emerald-400 font-bold text-xs mb-0.5 uppercase tracking-wider">
            {isEn ? 'EULERIAN LOOP CONVERGED!' : '歐拉單一閉環完美收斂！'}
          </div>

          {sanctionedSig && (
            <div className="my-1.5 py-1 px-2 bg-slate-900 border border-indigo-700/60 rounded text-[7px] text-indigo-300 flex items-center justify-between">
              <span>🛡️ {isEn ? 'WPF Sanctioned DNA:' : 'WPF 賽事認證碼:'}</span>
              <span className="font-bold text-cyan-300">{sanctionedSig}</span>
            </div>
          )}

          <div className="text-[8.5px] text-slate-300 mb-1">
            {isEn
              ? `Time: ${(accumulatedMs / 1000).toFixed(2)}s | Pure: ${
                  hintCountRef.current === 0 ? 'YES' : 'NO'
                } | Gf: IQ ${cci.standardIQ}`
              : `耗時: ${(accumulatedMs / 1000).toFixed(2)}s | 純淨通關: ${
                  hintCountRef.current === 0 ? '是' : '否'
                } | Gf: IQ ${cci.standardIQ}`}
          </div>

          <div className="my-1.5 p-1.5 bg-slate-900/90 border border-slate-800 rounded flex items-center justify-between gap-2">
            <div className="text-left text-[7px] text-slate-400 leading-tight">
              <div className="font-bold text-purple-300">{paradigm.replace(/_/g, ' ')}</div>
              <div>
                Iter: {genesisFrames.length * 40} | Cov: {coverageRatio} | Lip: {lipschitz}
              </div>
            </div>

            <svg className="w-10 h-6 shrink-0" viewBox="0 0 40 24" fill="none">
              {paradigm === 'archimedean_spiral' && (
                <path
                  d="M20,12 A4,4 0 0,1 24,16 A8,8 0 0,1 16,20 A12,12 0 0,1 8,8"
                  stroke="#A855F7"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              )}
              {paradigm === 'sinusoidal_braid' && (
                <path
                  d="M2,12 Q10,2 20,12 T38,12 M2,12 Q10,22 20,12 T38,12"
                  stroke="#22D3EE"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              )}
              {paradigm === 'superelliptic_meander' && (
                <path
                  d="M4,4 L36,4 L36,20 L4,20 Z"
                  stroke="#34D399"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              )}
              {paradigm === 'hyperbolic_cross' && (
                <path
                  d="M4,4 Q20,12 36,4 M4,20 Q20,12 36,20"
                  stroke="#F43F5E"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </div>

          <div className="flex items-center justify-center gap-2 mt-2">
            {genesisFrames.length > 0 && (
              <button
                onClick={() => {
                  setIsReplayingGenesis(true);
                  setReplayFrameIndex(0);
                }}
                disabled={isReplayingGenesis}
                className="px-2.5 py-1 bg-amber-950/80 border border-amber-500/80 text-amber-300 hover:bg-amber-900 text-[8px] font-bold rounded-lg transition shadow flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                {isReplayingGenesis ? (
                  <>⏳ {isEn ? `Frame ${replayFrameIndex + 1}` : `影格 ${replayFrameIndex + 1}`}</>
                ) : (
                  <>▶ {isEn ? 'Cinema' : '造物重播'}</>
                )}
              </button>
            )}

            <button
              onClick={() => setShowSubmitModal(true)}
              className="px-3 py-1 bg-neutral-200 hover:bg-white text-black text-[8px] font-bold rounded-lg cursor-pointer transition shadow"
            >
              {isEn ? 'SUBMIT' : '提交成績'}
            </button>
          </div>
        </div>
      )}

      {/* 賽事提交 Modal */}
      {showSubmitModal && actualPuzzle && (
        <TournamentSubmissionModal
          payload={{
            submissionId: `SUB-${actualPuzzle.id}-${Date.now().toString(36)}`,
            tournamentId: tournamentMode ? 'WPF_MASYU_APEX_2026' : 'GLOBAL_EULERIAN_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'masyu',
            tier: (actualPuzzle.tier as string) || 'kids',
            timeSpentSec: Math.round(accumulatedMs / 1000),
            conflictsCount: 0,
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
