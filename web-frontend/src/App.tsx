// web-frontend/src/App.tsx
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { PuzzleRenderer } from './registry/RendererRegistry';
import { PUZZLE_CATALOG, PuzzleEntity } from './generated';
import { LangSwitcher } from './components/LangSwitcher';
import { VirtualGamepad } from './components/VirtualGamepad';
import { useLearnerProfile, TierKey } from './hooks/useLearnerProfile';
import { WebMazeGenerator } from './engines/mazeGenerator';

interface PuzzleMeta {
  id: string;
  nameZh: string;
  nameEn: string;
  icon: string;
}

// 包含系統所有遊戲
const ALL_GAMES: PuzzleMeta[] = [
  { id: 'maze', nameZh: '空間迷宮', nameEn: 'Maze', icon: '🌀' },
  { id: 'sudoku', nameZh: '數獨魔陣', nameEn: 'Sudoku', icon: '🔢' },
  { id: 'skyscraper', nameZh: '摩天透視', nameEn: 'Skyscraper', icon: '🏢' },
  { id: 'hashi', nameZh: '星際數橋', nameEn: 'Hashi', icon: '🌉' },
  { id: 'kropki', nameZh: '黑白雙星', nameEn: 'Kropki', icon: '⚪' },
  { id: 'slitherlink', nameZh: '迴路封閉', nameEn: 'Slitherlink', icon: '➰' },
  { id: 'kakuro', nameZh: '數和密碼', nameEn: 'Kakuro', icon: '➕' },
  { id: 'nurikabe', nameZh: '暗夜數牆', nameEn: 'Nurikabe', icon: '🧱' },
  { id: 'hitori', nameZh: '孤島數壹', nameEn: 'Hitori', icon: '⬛' },
  { id: 'futoshiki', nameZh: '天平不等', nameEn: 'Futoshiki', icon: '⚖️' },
  { id: 'jigsaw', nameZh: '幾何拼圖', nameEn: 'Jigsaw', icon: '🧩' },
  { id: 'dominoes', nameZh: '骨牌矩陣', nameEn: 'Dominoes', icon: '🀄' },
];

export const LEVEL_KEYS: TierKey[] = ['kids', 'intermediate', 'expert', 'master'];

// 正常清晰的 4 級分類
const TIER_NAMES: Record<TierKey, { zh: string; en: string }> = {
  kids: { zh: '兒童', en: 'Kids' },
  intermediate: { zh: '進階', en: 'Intermediate' },
  expert: { zh: '專家', en: 'Expert' },
  master: { zh: '魔王', en: 'Master' },
};

const EngineFallbackUI: React.FC<{ resetErrorBoundary: () => void }> = ({ resetErrorBoundary }) => (
  <div className="flex flex-col items-center justify-center p-6 bg-red-950/40 border border-red-800 text-center my-4 font-mono">
    <p className="text-red-300 text-xs">載入異常 / Render Error</p>
    <button
      onClick={resetErrorBoundary}
      className="mt-3 px-3 py-1 bg-red-900/60 hover:bg-red-800 text-red-100 text-[10px] border border-red-700"
    >
      重試 / Retry
    </button>
  </div>
);

const MainDashboard: React.FC = () => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const [selectedType, setSelectedType] = useState<string>('maze');
  const [currentLevel, setCurrentLevel] = useState<TierKey>('kids');
  const [puzzleIndex, setPuzzleIndex] = useState<number>(0);
  const [elapsed, setElapsed] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 動態生成池
  const [dynamicPuzzles, setDynamicPuzzles] = useState<Record<string, PuzzleEntity[]>>(() => {
    const initialMazes: PuzzleEntity[] = [];
    const tiers: TierKey[] = ['kids', 'intermediate', 'expert', 'master'];
    tiers.forEach((tier) => {
      for (let i = 0; i < 25; i++) {
        const p = WebMazeGenerator.generate(tier);
        p.id = `auto_maze_${tier}_${i + 1}`;
        initialMazes.push(p);
      }
    });
    return { maze: initialMazes };
  });

  const isSpatialExplorationType = selectedType === 'maze' || selectedType === 'skyscraper';

  // 組合靜態與動態題庫
  const filteredPuzzles = useMemo(() => {
    const staticList = PUZZLE_CATALOG[selectedType] || [];
    const liveList = dynamicPuzzles[selectedType] || [];
    const fullList = [...liveList, ...staticList];

    const grouped: Record<TierKey, PuzzleEntity[]> = {
      kids: [],
      intermediate: [],
      expert: [],
      master: [],
    };
    fullList.forEach((p) => {
      const tier = (p.tier as TierKey) || 'kids';
      if (grouped[tier]) grouped[tier].push(p);
    });
    return grouped;
  }, [selectedType, dynamicPuzzles]);

  const currentMeta = ALL_GAMES.find((m) => m.id === selectedType) || ALL_GAMES[0];
  const activeList = filteredPuzzles[currentLevel] || [];
  const activePuzzle = activeList.length > 0 ? activeList[puzzleIndex % activeList.length] : null;

  // 上一題 / 下一題
  const handlePrevPuzzle = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(8);
    setPuzzleIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, activeList.length - 1)));
  }, [activeList.length]);

  const handleNextPuzzle = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(10);
    setPuzzleIndex((prev) => (prev + 1) % (activeList.length || 1));
  }, [activeList.length]);

  // 現場生成
  const handleLiveGenerate = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(20);
    if (selectedType === 'maze') {
      const newPuzzle = WebMazeGenerator.generate(currentLevel);
      setDynamicPuzzles((prev) => {
        const list = prev['maze'] || [];
        return { ...prev, maze: [newPuzzle, ...list] };
      });
      setPuzzleIndex(0);
    }
  }, [selectedType, currentLevel]);

  // 計時器
  useEffect(() => {
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activePuzzle?.id]);

  // 虛擬鍵盤與實體手柄支援
  const lastMoveTimeRef = useRef<number>(0);
  const handleJoystickMove = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - lastMoveTimeRef.current < 160) return;

    const threshold = 0.45;
    let dx = 0;
    let dy = 0;

    if (x > threshold) dx = 1;
    else if (x < -threshold) dx = -1;

    if (y > threshold) dy = 1;
    else if (y < -threshold) dy = -1;

    if (dx !== 0 || dy !== 0) {
      lastMoveTimeRef.current = now;
      window.dispatchEvent(new CustomEvent('logicore:joystick-move', { detail: { dx, dy } }));
    }
  }, []);

  return (
    <main className="min-h-screen bg-[#090d14] text-slate-200 flex flex-col items-center py-3 px-2 font-mono selection:bg-indigo-600">
      {/* 頂部簡潔導航 */}
      <header className="w-full max-w-lg flex items-center justify-between mb-2 pb-1.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black tracking-widest text-indigo-400">LOGICORE</span>
          <span className="text-[10px] text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded">
            {isEn ? currentMeta.nameEn : currentMeta.nameZh}
          </span>
        </div>
        <LangSwitcher />
      </header>

      {/* 1. 所有遊戲列表 (可滑動橫列) */}
      <div className="w-full max-w-lg flex gap-1.5 overflow-x-auto pb-1.5 mb-2 scrollbar-none border-b border-slate-800/80">
        {ALL_GAMES.map((game) => {
          const isActive = selectedType === game.id;
          const count = (PUZZLE_CATALOG[game.id]?.length || 0) + (dynamicPuzzles[game.id]?.length || 0);
          return (
            <button
              key={game.id}
              onClick={() => {
                setSelectedType(game.id);
                setPuzzleIndex(0);
              }}
              disabled={count === 0}
              className={`px-2.5 py-1 text-[11px] whitespace-nowrap rounded transition border flex items-center gap-1 ${
                isActive
                  ? 'bg-indigo-600 border-indigo-400 text-white font-bold shadow'
                  : count === 0
                  ? 'border-slate-900 text-slate-700 cursor-not-allowed'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>{game.icon}</span>
              <span>{isEn ? game.nameEn : game.nameZh}</span>
              <span className="text-[8px] opacity-50">({count})</span>
            </button>
          );
        })}
      </div>

      {/* 2. 正常難度劃分：兒童 / 進階 / 專家 / 魔王 */}
      <div className="w-full max-w-lg grid grid-cols-4 gap-1.5 mb-2.5">
        {LEVEL_KEYS.map((tierKey) => {
          const isSelected = currentLevel === tierKey;
          const count = filteredPuzzles[tierKey]?.length || 0;
          return (
            <button
              key={tierKey}
              onClick={() => {
                setCurrentLevel(tierKey);
                setPuzzleIndex(0);
              }}
              className={`py-1 text-center text-[10px] font-bold rounded border transition ${
                isSelected
                  ? 'bg-gradient-to-r from-indigo-700 to-cyan-700 border-cyan-400 text-white shadow-md'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div>{isEn ? TIER_NAMES[tierKey].en : TIER_NAMES[tierKey].zh}</div>
              <div className="text-[8px] opacity-50 font-normal">({count})</div>
            </button>
          );
        })}
      </div>

      {/* 3. 核心遊戲區域 */}
      {activePuzzle ? (
        <section className="flex flex-col items-center w-full max-w-sm sm:max-w-md">
          <div className="w-full p-1 bg-slate-900/60 border border-slate-800 rounded-xl shadow-2xl">
            <ErrorBoundary FallbackComponent={EngineFallbackUI} resetKeys={[selectedType, currentLevel, puzzleIndex]}>
              <PuzzleRenderer key={`${selectedType}-${currentLevel}-${puzzleIndex}-${activePuzzle.checksum}`} puzzle={activePuzzle} />
            </ErrorBoundary>
          </div>

          {/* 迷宮專用虛擬方向鍵盤 */}
          {isSpatialExplorationType && (
            <VirtualGamepad
              onMove={handleJoystickMove}
              onRotate={() => {}}
              onAction={() => {}}
              actionLabel={isEn ? 'STEP' : '動作'}
            />
          )}

          {/* 操作按鈕：上一題 / 現場生成 / 下一題 */}
          <div className="mt-2.5 grid grid-cols-3 gap-1.5 w-full">
            <button
              onClick={handlePrevPuzzle}
              className="py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-[10px] border border-slate-800 rounded transition"
            >
              {isEn ? '◀ Prev' : '◀ 上一題'}
            </button>
            <button
              onClick={handleLiveGenerate}
              className="py-2.5 bg-cyan-950 hover:bg-cyan-900 text-cyan-300 font-bold text-[10px] border border-cyan-700/60 rounded shadow transition flex items-center justify-center gap-1"
            >
              <span>⚡</span>
              <span>{isEn ? 'Generate' : '現場生成'}</span>
            </button>
            <button
              onClick={handleNextPuzzle}
              className="py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-[10px] border border-slate-700 rounded transition"
            >
              {isEn ? 'Next ▶' : '下一題 ▶'}
            </button>
          </div>

          {/* 底部進度與計時 */}
          <div className="mt-2 flex items-center justify-between w-full px-1 text-[9px] text-slate-500 border-t border-slate-800/80 pt-1.5">
            <div>
              ⏱️ {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
            </div>
            <div>
              {isEn ? 'Puzzle' : '進度'}: {puzzleIndex + 1}/{activeList.length}
            </div>
          </div>
        </section>
      ) : (
        <div className="mt-12 p-8 border border-slate-800 text-center max-w-sm rounded-xl">
          <p className="text-slate-500 text-xs">{isEn ? 'No puzzles in this tier' : '本階梯暫無題目'}</p>
        </div>
      )}
    </main>
  );
};

export default function App() {
  return (
    <LanguageProvider>
      <MainDashboard />
    </LanguageProvider>
  );
}
