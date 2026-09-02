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

  const activeList = filteredPuzzles[currentLevel] || [];
  const activePuzzle = activeList.length > 0 ? activeList[puzzleIndex % activeList.length] : null;

  const handlePrevPuzzle = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(8);
    setPuzzleIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, activeList.length - 1)));
  }, [activeList.length]);

  const handleNextPuzzle = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(10);
    setPuzzleIndex((prev) => (prev + 1) % (activeList.length || 1));
  }, [activeList.length]);

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
    <main className="min-h-screen bg-[#090d14] text-slate-200 flex flex-col items-center py-2 px-2 font-mono selection:bg-indigo-600">
      {/* 頂部整合工具列：遊戲選單 + 難度選單 + 語言切換 (單行緊湊佈局) */}
      <header className="w-full max-w-sm sm:max-w-md flex items-center justify-between gap-1.5 mb-2 pb-1.5 border-b border-slate-800">
        <span className="text-xs font-black tracking-widest text-indigo-400 shrink-0">LOGICORE</span>
        
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {/* 1. 遊戲摺疊清單 */}
          <select
            value={selectedType}
            onChange={(e) => {
              setSelectedType(e.target.value);
              setPuzzleIndex(0);
            }}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1 outline-none focus:border-indigo-500 cursor-pointer"
          >
            {ALL_GAMES.map((game) => {
              const count = (PUZZLE_CATALOG[game.id]?.length || 0) + (dynamicPuzzles[game.id]?.length || 0);
              return (
                <option key={game.id} value={game.id} disabled={count === 0} className="bg-slate-900 text-slate-200">
                  {game.icon} {isEn ? game.nameEn : game.nameZh} ({count})
                </option>
              );
            })}
          </select>

          {/* 2. 難度摺疊清單 (兒童 / 進階 / 專家 / 魔王) */}
          <select
            value={currentLevel}
            onChange={(e) => {
              setCurrentLevel(e.target.value as TierKey);
              setPuzzleIndex(0);
            }}
            className="w-28 shrink-0 bg-slate-900 border border-slate-700 text-cyan-300 text-xs font-bold rounded px-2 py-1 outline-none focus:border-cyan-500 cursor-pointer"
          >
            {LEVEL_KEYS.map((tierKey) => {
              const count = filteredPuzzles[tierKey]?.length || 0;
              return (
                <option key={tierKey} value={tierKey} className="bg-slate-900 text-cyan-300">
                  {isEn ? TIER_NAMES[tierKey].en : TIER_NAMES[tierKey].zh} ({count})
                </option>
              );
            })}
          </select>
        </div>

        <LangSwitcher />
      </header>

      {/* 核心盤面 */}
      {activePuzzle ? (
        <section className="flex flex-col items-center w-full max-w-sm sm:max-w-md">
          <div className="w-full p-1 bg-slate-900/60 border border-slate-800 rounded-xl shadow-2xl">
            <ErrorBoundary FallbackComponent={EngineFallbackUI} resetKeys={[selectedType, currentLevel, puzzleIndex]}>
              <PuzzleRenderer key={`${selectedType}-${currentLevel}-${puzzleIndex}-${activePuzzle.checksum}`} puzzle={activePuzzle} />
            </ErrorBoundary>
          </div>

          {/* 搖桿控制區 */}
          {isSpatialExplorationType && (
            <VirtualGamepad
              onMove={handleJoystickMove}
              onRotate={() => {}}
              onAction={() => {}}
              actionLabel={isEn ? 'STEP' : '動作'}
            />
          )}

          {/* 操作導覽列 */}
          <div className="mt-2 grid grid-cols-3 gap-1.5 w-full">
            <button
              onClick={handlePrevPuzzle}
              className="py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-[10px] border border-slate-800 rounded transition"
            >
              {isEn ? '◀ Prev' : '◀ 上一題'}
            </button>
            <button
              onClick={handleLiveGenerate}
              className="py-2 bg-cyan-950 hover:bg-cyan-900 text-cyan-300 font-bold text-[10px] border border-cyan-700/60 rounded shadow transition flex items-center justify-center gap-1"
            >
              <span>⚡</span>
              <span>{isEn ? 'Generate' : '現場生成'}</span>
            </button>
            <button
              onClick={handleNextPuzzle}
              className="py-2 bg-slate-800 hover:bg-slate-700 text-white text-[10px] border border-slate-700 rounded transition"
            >
              {isEn ? 'Next ▶' : '下一題 ▶'}
            </button>
          </div>

          {/* 底部時間與關卡進度 */}
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
