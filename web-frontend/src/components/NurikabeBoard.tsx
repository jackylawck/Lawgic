// web-frontend/src/components/NurikabeBoard.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { NurikabeSpec, NurikabeHintStep, WebNurikabeGenerator } from '../engines/nurikabeGenerator';
import { ChallengeCodec } from '../utils/challengeCodec';
import { LeaderboardManager, LeaderboardEntry } from '../utils/leaderboard';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

type CellState = 0 | 1 | 2; // 0: 空白, 1: 黑牆, 2: 白島

export const NurikabeBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as NurikabeSpec;
  const rows = spec?.rows || 5;
  const cols = spec?.cols || 5;
  const clues = spec?.clues || [];

  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<CellState[][]>(() =>
    Array.from({ length: rows }, () => Array(cols).fill(0))
  );
  const [selectedCell, setSelectedCell] = useState<[number, number]>([0, 0]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isTimeOut, setIsTimeOut] = useState<boolean>(false);
  const [isMonochrome, setIsMonochrome] = useState<boolean>(false);
  const [showHallOfFame, setShowHallOfFame] = useState<boolean>(false);
  const [showKeyboardHUD, setShowKeyboardHUD] = useState<boolean>(false);
  const [pureFilterOnly, setPureFilterOnly] = useState<boolean>(false);
  const [toastText, setToastText] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string>(() => localStorage.getItem('lawgic_player_nick') || 'Player');

  // 累計提示觸發次數
  const [hintsTriggeredCount, setHintsTriggeredCount] = useState<number>(0);

  // 高精度公平時計與防切頁防護
  const timeLimit = actualPuzzle?.metrics?.estimated_time_sec || 180;
  const [remainingSec, setRemainingSec] = useState<number>(timeLimit);
  const [accumulatedMs, setAccumulatedMs] = useState<number>(0);
  const lastActiveTimestamp = useRef<number>(performance.now());
  const isSuspended = useRef<boolean>(false);

  // 三階因果提示狀態
  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<NurikabeHintStep | null>(null);

  const clueMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of clues) map.set(`${c.r},${c.c}`, c.value);
    return map;
  }, [clues]);

  const currentEarnedPoints = useMemo(() => {
    const irt = actualPuzzle?.metrics?.irt_logit_difficulty || 1.0;
    const spentSec = Math.round(accumulatedMs / 1000);
    return LeaderboardManager.calculateScore(irt, spentSec, timeLimit, hintsTriggeredCount);
  }, [actualPuzzle, accumulatedMs, timeLimit, hintsTriggeredCount]);

  // 細節 1：動態段位稱號晉級系統
  const masteryRankTitle = useMemo(() => {
    const isPure = hintsTriggeredCount === 0;
    if (currentEarnedPoints >= 180 && isPure) {
      return { zh: '💎 純粹宗師', en: '💎 Pure Grandmaster', color: 'text-cyan-300' };
    }
    if (currentEarnedPoints >= 150 && isPure) {
      return { zh: '🧠 推理巨匠', en: '🧠 Logic Master', color: 'text-purple-300' };
    }
    if (currentEarnedPoints >= 120) {
      return { zh: '⚡ 極速先鋒', en: '⚡ Speed Pioneer', color: 'text-amber-300' };
    }
    return { zh: '🌱 暗夜行者', en: '🌱 Shadow Walker', color: 'text-emerald-400' };
  }, [currentEarnedPoints, hintsTriggeredCount]);

  // 初始化與自動聚焦
  useEffect(() => {
    const initialBoard: CellState[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const cl of clues) initialBoard[cl.r][cl.c] = 2;
    setBoard(initialBoard);
    setSelectedCell([0, 0]);
    setIsCompleted(false);
    setIsTimeOut(false);
    setRemainingSec(timeLimit);
    setAccumulatedMs(0);
    setHintsTriggeredCount(0);
    lastActiveTimestamp.current = performance.now();
    setHintLevel(0);
    setActiveHint(null);

    requestAnimationFrame(() => {
      boardContainerRef.current?.focus();
    });
  }, [actualPuzzle?.id, rows, cols, clues, timeLimit]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        isSuspended.current = true;
      } else {
        lastActiveTimestamp.current = performance.now();
        isSuspended.current = false;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (isCompleted || isTimeOut) return;

    const timer = setInterval(() => {
      if (isSuspended.current) return;
      const now = performance.now();
      const delta = now - lastActiveTimestamp.current;
      lastActiveTimestamp.current = now;

      setAccumulatedMs((prev) => {
        const next = prev + delta;
        if (tournamentMode) {
          const spentSec = Math.floor(next / 1000);
          const left = Math.max(0, timeLimit - spentSec);
          setRemainingSec(left);
          if (left === 0) setIsTimeOut(true);
        }
        return next;
      });
    }, 100);

    return () => clearInterval(timer);
  }, [isCompleted, isTimeOut, tournamentMode, timeLimit]);

  const poolViolations = useMemo(() => {
    const set = new Set<string>();
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (
          board[r][c] === 1 &&
          board[r + 1][c] === 1 &&
          board[r][c + 1] === 1 &&
          board[r + 1][c + 1] === 1
        ) {
          set.add(`${r},${c}`);
          set.add(`${r + 1},${c}`);
          set.add(`${r},${c + 1}`);
          set.add(`${r + 1},${c + 1}`);
        }
      }
    }
    return set;
  }, [board, rows, cols]);

  const isStreamFragmented = useMemo(() => {
    let firstWall: [number, number] | null = null;
    let totalWalls = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          totalWalls++;
          if (!firstWall) firstWall = [r, c];
        }
      }
    }
    if (totalWalls <= 1 || !firstWall) return false;

    const visited = new Set<string>();
    const queue: [number, number][] = [firstWall];
    visited.add(`${firstWall[0]},${firstWall[1]}`);
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    while (queue.length > 0) {
      const [cr, cc] = queue.shift()!;
      for (const [dr, dc] of dirs) {
        const nr = cr + dr;
        const nc = cc + dc;
        const key = `${nr},${nc}`;
        if (WebNurikabeGenerator.inBounds(nr, nc, rows, cols) && board[nr][nc] === 1 && !visited.has(key)) {
          visited.add(key);
          queue.push([nr, nc]);
        }
      }
    }
    return visited.size < totalWalls;
  }, [board, rows, cols]);

  const checkVictory = useCallback(
    (curBoard: CellState[][]): boolean => {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (curBoard[r][c] === 0) return false;
        }
      }
      return (
        WebNurikabeGenerator.isValidStream(curBoard, rows, cols) &&
        WebNurikabeGenerator.auditIslands(curBoard, rows, cols, clues)
      );
    },
    [rows, cols, clues]
  );

  const toggleCell = useCallback(
    (r: number, c: number, overrideState?: CellState) => {
      if (isCompleted || isTimeOut || clueMap.has(`${r},${c}`)) return;

      setHintLevel(0);
      setActiveHint(null);

      setBoard((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = overrideState !== undefined ? overrideState : next[r][c] === 0 ? 1 : next[r][c] === 1 ? 2 : 0;

        if (checkVictory(next)) {
          setIsCompleted(true);
          const timeSpent = Math.max(1, Math.round(accumulatedMs / 1000));
          const isPure = hintsTriggeredCount === 0;

          if (actualPuzzle) {
            recordAttempt({
              puzzleId: actualPuzzle.id,
              engineType: 'nurikabe',
              tier: (actualPuzzle.tier as TierKey) || 'kids',
              cognitiveLoad: actualPuzzle.cognitiveLoad || {
                spatial: 0.95,
                numeric: 0.45,
                workingMemory: 0.7,
                inhibition: 0.9,
              },
              isSuccess: true,
              timeSpentSec: timeSpent,
              conflictsCount: 0,
              technique: 'ConnectivityDeduction',
              isPureClear: isPure,
            });

            LeaderboardManager.addEntry(actualPuzzle.checksum, {
              nickname,
              engine: 'nurikabe',
              tier: actualPuzzle.tier || 'kids',
              timeSpentSec: timeSpent,
              points: currentEarnedPoints,
              hintsUsed: hintsTriggeredCount,
              isPure,
            });
          }
        }
        return next;
      });
    },
    [isCompleted, isTimeOut, clueMap, checkVictory, accumulatedMs, hintsTriggeredCount, actualPuzzle, recordAttempt, nickname, currentEarnedPoints]
  );

  const handleRequestHint = useCallback(() => {
    if (isCompleted || isTimeOut) return;
    const step = WebNurikabeGenerator.getNextForcedDeduction(rows, cols, clues, board);
    if (!step) return;

    if (!activeHint || activeHint.type !== step.type || activeHint.targets[0]?.[0] !== step.targets[0]?.[0]) {
      setActiveHint(step);
      setHintLevel(1);
      setHintsTriggeredCount((prev) => prev + 1);
      if (step.targets.length > 0) setSelectedCell(step.targets[0]);
    } else {
      setHintLevel((prev) => Math.min(3, prev + 1));
    }
  }, [isCompleted, isTimeOut, rows, cols, clues, board, activeHint]);

  // 全鍵盤操作映射
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isTimeOut) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const [r, c] = selectedCell;

      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          e.preventDefault();
          setSelectedCell([Math.max(0, r - 1), c]);
          break;
        case 's':
        case 'arrowdown':
          e.preventDefault();
          setSelectedCell([Math.min(rows - 1, r + 1), c]);
          break;
        case 'a':
        case 'arrowleft':
          e.preventDefault();
          setSelectedCell([r, Math.max(0, c - 1)]);
          break;
        case 'd':
        case 'arrowright':
          e.preventDefault();
          setSelectedCell([r, Math.min(cols - 1, c + 1)]);
          break;
        case '1':
        case 'j':
          e.preventDefault();
          toggleCell(r, c, 1);
          break;
        case '2':
        case 'k':
          e.preventDefault();
          toggleCell(r, c, 2);
          break;
        case '0':
        case ' ':
        case 'x':
        case 'c':
        case 'backspace':
          e.preventDefault();
          toggleCell(r, c, 0);
          break;
        case 'h':
          e.preventDefault();
          handleRequestHint();
          break;
        case '?':
          e.preventDefault();
          setShowKeyboardHUD((prev) => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, rows, cols, isCompleted, isTimeOut, toggleCell, handleRequestHint]);

  const handleCopyChallenge = () => {
    if (!actualPuzzle) return;
    const url = ChallengeCodec.generateShareUrl(actualPuzzle);
    navigator.clipboard.writeText(url).then(() => {
      setToastText(isEn ? '🔗 Challenge URL copied!' : '🔗 題目挑戰連結已複製！');
      setTimeout(() => setToastText(null), 2500);
    });
  };

  const cellSize = Math.min(270 / Math.max(rows, cols), 42);
  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  const hallOfFameList = useMemo(() => {
    return actualPuzzle ? LeaderboardManager.getEntriesForPuzzle(actualPuzzle.checksum, pureFilterOnly) : [];
  }, [actualPuzzle, showHallOfFame, pureFilterOnly, isCompleted]);

  const hintTargetSet = useMemo(() => {
    const set = new Set<string>();
    if (activeHint && hintLevel === 3) {
      for (const [tr, tc] of activeHint.targets) set.add(`${tr},${tc}`);
    }
    return set;
  }, [activeHint, hintLevel]);

  return (
    <div
      ref={boardContainerRef}
      tabIndex={0}
      className={`relative flex flex-col items-center justify-center p-2 select-none font-mono outline-none ${isMonochrome ? 'contrast-125' : ''}`}
    >
      {toastText && (
        <div className="fixed top-3 z-50 px-3 py-1.5 bg-cyan-600 border border-cyan-400 text-white font-bold text-xs rounded-full shadow-2xl animate-fade-in">
          {toastText}
        </div>
      )}

      {/* 頂部賽事數據列 */}
      <div className="w-full grid grid-cols-4 gap-1 mb-2 text-[8px]">
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{tournamentMode ? (isEn ? 'Time Left' : '倒數') : (isEn ? 'Time' : '耗時')}</div>
          <div className={`font-bold ${tournamentMode && remainingSec <= 30 ? 'text-rose-400 animate-pulse' : 'text-slate-200'}`}>
            {tournamentMode ? `${remainingSec}s` : `${(accumulatedMs / 1000).toFixed(1)}s`}
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? 'WPF Points' : '賽事積分'}</div>
          <div className="text-amber-300 font-bold">
            ★ {currentEarnedPoints} {hintsTriggeredCount === 0 && <span className="text-cyan-400 font-normal">💎</span>}
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1.5 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? 'Topology' : '拓撲檢查'}</div>
          <div className={poolViolations.size > 0 ? 'text-rose-400 font-bold' : isStreamFragmented ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
            {poolViolations.size > 0 ? '2×2池' : isStreamFragmented ? '斷流' : '正常'}
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setIsMonochrome((prev) => !prev)}
            className={`flex-1 rounded border text-[7px] font-bold transition ${
              isMonochrome ? 'bg-white text-black border-white' : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            BW
          </button>
          <button
            onClick={() => setShowHallOfFame((prev) => !prev)}
            className="flex-1 rounded border border-amber-500/50 bg-slate-900 text-amber-300 text-[7px] font-bold"
            title="同題防偽好友榜"
          >
            🏆
          </button>
        </div>
      </div>

      {/* 棋盤本體 */}
      <div className={`p-2 border-2 rounded-xl shadow-2xl flex flex-col items-center ${isMonochrome ? 'bg-black border-white' : 'bg-slate-950 border-slate-800'}`}>
        <div
          className={`grid gap-[2px] p-[2px] rounded border ${isMonochrome ? 'bg-black border-white' : 'bg-slate-900/90 border-slate-800'}`}
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {board.map((row, r) =>
            row.map((val, c) => {
              const clueVal = clueMap.get(`${r},${c}`);
              const isClue = clueVal !== undefined;
              const isSelected = selectedCell[0] === r && selectedCell[1] === c;
              const isBatchHintTarget = hintTargetSet.has(`${r},${c}`);
              const isPoolViolation = poolViolations.has(`${r},${c}`);

              let bgClass = isMonochrome ? 'bg-black text-white' : 'bg-slate-950 text-slate-300 hover:bg-slate-900';
              if (val === 1) bgClass = isMonochrome ? 'bg-white text-black font-black' : 'bg-slate-800 text-slate-400 shadow-inner';
              if (val === 2) bgClass = isMonochrome ? 'bg-black text-white font-bold' : 'bg-slate-950 text-cyan-400';
              if (isClue) bgClass = isMonochrome ? 'bg-black text-white font-black border-2 border-white' : 'bg-slate-900 text-amber-300 font-black border border-amber-500/40';

              if (isPoolViolation && !isMonochrome) bgClass += ' ring-2 ring-rose-500 bg-rose-950/50';
              if (isBatchHintTarget) bgClass += isMonochrome ? ' ring-4 ring-white animate-pulse' : ' ring-2 ring-amber-400 bg-amber-500/30 animate-pulse';

              return (
                <div
                  key={`${r}-${c}`}
                  onClick={() => { setSelectedCell([r, c]); toggleCell(r, c); }}
                  onContextMenu={(e) => { e.preventDefault(); setSelectedCell([r, c]); toggleCell(r, c, 1); }}
                  className={`flex items-center justify-center font-bold text-xs cursor-pointer transition select-none ${bgClass} ${
                    isSelected ? (isMonochrome ? 'ring-2 ring-white z-20' : 'ring-2 ring-cyan-400 z-20 shadow-[0_0_8px_rgba(34,211,238,0.8)]') : ''
                  }`}
                  style={{ width: cellSize, height: cellSize }}
                >
                  {isClue ? <span className="text-sm font-extrabold">{clueVal}</span> : val === 2 ? <span>•</span> : val === 1 && isMonochrome ? <span>■</span> : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 細節 4：快捷鍵 HUD 透明卡片與切換按鈕 */}
      <div className="w-full max-w-[280px] flex items-center justify-between px-1 mt-1 text-[7px] text-slate-500 font-mono">
        <span>WASD: 移動</span>
        <span>1: 黑牆</span>
        <span>2: 白格</span>
        <button
          onClick={() => setShowKeyboardHUD((prev) => !prev)}
          className="text-cyan-400 hover:text-cyan-300 underline font-bold"
        >
          ⌨️ HUD {showKeyboardHUD ? '▲' : '▼'}
        </button>
      </div>

      {showKeyboardHUD && (
        <div className="mt-1 p-2 bg-slate-900/95 border border-cyan-500/40 rounded-lg text-[7.5px] text-slate-300 w-full max-w-[280px] shadow-lg animate-fade-in font-mono grid grid-cols-2 gap-1 text-left">
          <div>• <span className="text-cyan-300">WASD / ↑↓←→</span>: 游標導航</div>
          <div>• <span className="text-cyan-300">1 / J</span>: 標記黑牆 (■)</div>
          <div>• <span className="text-cyan-300">2 / K</span>: 標記白格 (•)</div>
          <div>• <span className="text-cyan-300">0 / Space / C</span>: 清空單元格</div>
          <div className="col-span-2 text-center text-slate-400 border-t border-slate-800 pt-1 mt-0.5">
            按 <span className="text-amber-300 font-bold">H</span>: 請求因果提示 | 按 <span className="text-cyan-300 font-bold">?</span>: 收合本面板
          </div>
        </div>
      )}

      {/* 三階因果提示面板 */}
      {hintLevel > 0 && activeHint && (
        <div className={`mt-2 p-2 rounded-xl text-center w-full max-w-[280px] font-mono border ${isMonochrome ? 'bg-black border-white text-white' : 'bg-slate-900/90 border-amber-500/60 text-slate-200'}`}>
          <div className="text-[7.5px] font-bold text-amber-300 mb-0.5">
            🔮 {activeHint.targets.length > 1 ? (isEn ? 'BATCH LOGIC' : '批次因果推理') : (isEn ? 'STREAM DEDUCTION' : '正交拓撲推導')}
          </div>
          <div className="text-[8px]">
            {hintLevel === 1 && <span>🔍 {isEn ? `Focus region near [${activeHint.targets[0][0] + 1}, ${activeHint.targets[0][1] + 1}]` : `審視坐標 [${activeHint.targets[0][0] + 1}, ${activeHint.targets[0][1] + 1}] 區域`}</span>}
            {hintLevel === 2 && <span className="text-cyan-300 font-bold">⚡ {isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}</span>}
            {hintLevel === 3 && (
              <span className="text-rose-400 font-extrabold">
                🎯 {activeHint.targets.length > 1
                  ? (isEn ? `All ${activeHint.targets.length} cells are forced ${activeHint.forcedState === 1 ? 'WALLS' : 'ISLANDS'}!` : `高亮的 ${activeHint.targets.length} 格整批必然為${activeHint.forcedState === 1 ? '黑牆' : '白格'}！`)
                  : (isEn ? `Forced ${activeHint.forcedState === 1 ? 'WALL' : 'ISLAND'}!` : `必然為${activeHint.forcedState === 1 ? '黑牆' : '白格'}！`)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 控制列 */}
      <div className="flex items-center justify-between w-full max-w-[280px] mt-2 gap-1.5">
        <button
          onClick={handleRequestHint}
          disabled={isCompleted || isTimeOut}
          className="flex-1 py-1.5 text-[10px] font-bold rounded-lg border bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-950/40 transition flex items-center justify-center gap-1 shadow disabled:opacity-40"
        >
          💡 {isEn ? 'Hint [H]' : '提示階梯 [H]'}
        </button>
        <button
          onClick={handleCopyChallenge}
          className="flex-1 py-1.5 text-[10px] font-bold rounded-lg border bg-slate-900 border-cyan-500/50 text-cyan-300 hover:bg-cyan-950/40 transition flex items-center justify-center gap-1 shadow"
        >
          🔗 {isEn ? 'Challenge' : '好友挑戰碼'}
        </button>
      </div>

      {/* 同題對抗朋友榜（含細節 2：我的最佳「👤 You」標記） */}
      {showHallOfFame && (
        <div className="mt-2.5 p-3 bg-slate-950 border border-amber-500/80 rounded-xl w-full max-w-[280px] shadow-2xl animate-fade-in font-mono text-left">
          <div className="flex justify-between items-center mb-1.5 pb-1 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-amber-300">🏆 本題榜單</span>
              <button
                onClick={() => setPureFilterOnly((prev) => !prev)}
                className={`px-1.5 py-0.2 rounded text-[7px] font-bold transition border ${
                  pureFilterOnly ? 'bg-cyan-950 border-cyan-400 text-cyan-300' : 'bg-slate-900 border-slate-700 text-slate-400'
                }`}
              >
                {pureFilterOnly ? '💎 Pure Only' : 'All'}
              </button>
            </div>
            <button onClick={() => setShowHallOfFame(false)} className="text-slate-400 text-xs font-bold hover:text-white">✕</button>
          </div>
          <div className="text-[7px] text-slate-500 mb-1.5">盤面指紋: {actualPuzzle?.checksum.slice(-12)}</div>
          <div className="max-h-36 overflow-y-auto space-y-1 pr-1 text-[8.5px]">
            {hallOfFameList.length === 0 ? (
              <div className="text-slate-500 text-center py-2">{isEn ? 'No matching records.' : '尚無符合條件的挑戰紀錄'}</div>
            ) : (
              hallOfFameList.map((item, idx) => {
                const isMe = item.nickname === nickname;
                return (
                  <div
                    key={item.id}
                    className={`flex justify-between items-center px-1.5 py-1 rounded border transition ${
                      isMe
                        ? 'bg-cyan-950/50 border-cyan-500/60 shadow-[0_0_6px_rgba(6,182,212,0.3)]'
                        : 'bg-slate-900/60 border-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-1 text-slate-300">
                      <span className={`font-bold ${isMe ? 'text-cyan-300' : 'text-amber-400'}`}>#{idx + 1}</span>
                      <span className="truncate max-w-[70px]">{item.nickname}</span>
                      {isMe && <span className="text-[7px] text-cyan-400 font-bold">👤</span>}
                      {item.isPure && <span className="text-[7px] text-cyan-400 font-bold" title="零提示無猜測通關">💎</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">{item.timeSpentSec}s</span>
                      <span className="font-bold text-emerald-400">★{item.points}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 結算登榜面板（含細節 1：動態段位晉級稱號） */}
      {isCompleted && (
        <div className="mt-2.5 p-3 bg-slate-950 border border-emerald-500/80 rounded-xl text-center w-full max-w-[280px] shadow-2xl animate-fade-in font-mono">
          <div className="text-emerald-400 font-bold text-xs mb-0.5">ISLANDS CONNECTED!</div>
          
          <div className="my-1 py-1 bg-slate-900/80 border border-slate-800 rounded">
            <div className="text-[7.5px] text-slate-400 tracking-wider mb-0.5">{isEn ? 'ACHIEVEMENT TIER' : '解題段位'}</div>
            <div className={`text-xs font-black tracking-widest ${masteryRankTitle.color}`}>
              {isEn ? masteryRankTitle.en : masteryRankTitle.zh}
            </div>
          </div>

          <div className="text-[8.5px] text-slate-300 mb-1">
            {isEn ? 'Earned' : '獲得積分'}: <span className="text-amber-300 font-bold">★ {currentEarnedPoints}</span>
            {hintsTriggeredCount === 0 && <span className="ml-1 text-cyan-400 font-bold">[💎 PURE]</span>}
            <span className="ml-1">| IQ {cci.standardIQ}</span>
          </div>

          <div className="flex items-center justify-center gap-1.5 mt-2">
            <input
              type="text"
              value={nickname}
              onChange={(e) => {
                const val = e.target.value.slice(0, 10);
                setNickname(val);
                localStorage.setItem('lawgic_player_nick', val);
              }}
              placeholder={isEn ? 'Nickname' : '解題者暱稱'}
              className="px-2 py-0.5 bg-slate-900 border border-slate-700 text-xs rounded text-center w-24 text-white"
            />
            <button
              onClick={() => {
                if (actualPuzzle) {
                  LeaderboardManager.addEntry(actualPuzzle.checksum, {
                    nickname: nickname || 'Player',
                    engine: 'nurikabe',
                    tier: actualPuzzle.tier || 'kids',
                    timeSpentSec: Math.round(accumulatedMs / 1000),
                    points: currentEarnedPoints,
                    hintsUsed: hintsTriggeredCount,
                    isPure: hintsTriggeredCount === 0,
                  });
                  setShowHallOfFame(true);
                }
              }}
              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded transition shadow"
            >
              {isEn ? 'Save' : '登榜'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
