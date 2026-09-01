import React, { useState, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { SudokuBoard } from './components/SudokuBoard';
import rawLibrary from './generated/puzzle_library.json';

export type LevelKey = 'kids' | 'intermediate' | 'expert' | 'master';
export type PuzzleType = 'sudoku' | 'kropki' | 'hashi' | 'maze' | 'skyscraper';

interface PuzzleTypeMeta {
  id: PuzzleType;
  nameZh: string;
  nameEn: string;
  icon: string;
}

const PUZZLE_TYPES: PuzzleTypeMeta[] = [
  { id: 'sudoku', nameZh: '經典數獨', nameEn: 'Sudoku', icon: '🔢' },
  { id: 'kropki', nameZh: '黑白點數獨', nameEn: 'Kropki', icon: '⚪' },
  { id: 'hashi', nameZh: '數橋', nameEn: 'Hashi', icon: '🌉' },
  { id: 'skyscraper', nameZh: '摩天大樓', nameEn: 'Skyscraper', icon: '🏢' },
  { id: 'maze', nameZh: '大迷宮', nameEn: 'Maze', icon: '🌀' },
];

const mapDepthToLevel = (depth: number): LevelKey => {
  if (depth === 0) return 'kids';
  if (depth <= 2) return 'intermediate';
  if (depth <= 5) return 'expert';
  return 'master';
};

const EngineFallbackUI: React.FC<{ resetErrorBoundary: () => void }> = ({ resetErrorBoundary }) => {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-red-950/40 border border-red-800/80 rounded-xl max-w-md text-center my-6">
      <p className="text-red-300 font-semibold text-sm">{t.errors.engineCrash}</p>
      <button
        onClick={resetErrorBoundary}
        className="mt-4 px-4 py-2 bg-red-900/60 hover:bg-red-800 text-red-100 rounded-lg text-xs font-medium border border-red-700"
      >
        {t.ui.retry}
      </button>
    </div>
  );
};

const MainDashboard: React.FC = () => {
  const { t, lang, setLang } = useLanguage();
  const [selectedType, setSelectedType] = useState<PuzzleType>('sudoku');
  const [currentLevel, setCurrentLevel] = useState<LevelKey>('kids');
  const [puzzleIndex, setPuzzleIndex] = useState<number>(0);

  // 根據「題型」與「難度」雙重過濾
  const filteredPuzzles = useMemo(() => {
    const map: Record<LevelKey, any[]> = { kids: [], intermediate: [], expert: [], master: [] };
    try {
      const rawList = Object.values(rawLibrary || {}).flat();
      rawList.forEach((p: any) => {
        if (p && (p.engine_type === selectedType || (!p.engine_type && selectedType === 'sudoku'))) {
          const depth = p.metrics?.decision_depth ?? 0;
          map[mapDepthToLevel(depth)].push(p);
        }
      });
    } catch (e) {
      console.error("Library parse failed:", e);
    }
    return map;
  }, [selectedType]);

  const activeList = filteredPuzzles[currentLevel];
  const activePuzzle = activeList.length > 0 ? activeList[puzzleIndex % activeList.length] : null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center py-6 px-4 font-sans selection:bg-indigo-500">
      {/* 頂部 Header */}
      <header className="w-full max-w-xl flex items-center justify-between mb-6 pb-3 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-black bg-gradient-to-r from-indigo-400 via-cyan-300 to-emerald-400 bg-clip-text text-transparent">
            LogiCore
          </h1>
          <p className="text-[11px] text-slate-500 font-mono mt-0.5">SMT-Welded & WASM AC-3 Logic Gym</p>
        </div>
        <div className="flex gap-1 p-1 bg-slate-800/80 rounded-lg border border-slate-700">
          <button
            onClick={() => setLang('zh')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${lang === 'zh' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400'}`}
          >
            繁中
          </button>
          <button
            onClick={() => setLang('en')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${lang === 'en' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400'}`}
          >
            EN
          </button>
        </div>
      </header>

      {/* 題型選擇區 (橫向滾動 Tab) */}
      <div className="w-full max-w-xl flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-none">
        {PUZZLE_TYPES.map((pt) => {
          const isSelected = selectedType === pt.id;
          return (
            <button
              key={pt.id}
              onClick={() => {
                setSelectedType(pt.id);
                setPuzzleIndex(0);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 border ${
                isSelected
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 border-indigo-400 text-white shadow-lg shadow-indigo-500/25 ring-2 ring-indigo-400/40'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>{pt.icon}</span>
              <span>{lang === 'zh' ? pt.nameZh : pt.nameEn}</span>
            </button>
          );
        })}
      </div>

      {/* 難度選擇區 */}
      <div className="flex flex-wrap justify-center gap-1.5 mb-6">
        {(['kids', 'intermediate', 'expert', 'master'] as LevelKey[]).map((lvl) => (
          <button
            key={lvl}
            onClick={() => { setCurrentLevel(lvl); setPuzzleIndex(0); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              currentLevel === lvl
                ? 'bg-indigo-600 border-indigo-400 text-white shadow-md'
                : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {t.difficulty[lvl]} ({filteredPuzzles[lvl].length})
          </button>
        ))}
      </div>

      {/* 遊戲盤面 */}
      {activePuzzle ? (
        <section className="flex flex-col items-center w-full max-w-sm sm:max-w-md">
          <ErrorBoundary
            FallbackComponent={EngineFallbackUI}
            resetKeys={[selectedType, currentLevel, puzzleIndex]}
            onReset={() => setPuzzleIndex(0)}
          >
            <SudokuBoard
              key={`${selectedType}-${currentLevel}-${puzzleIndex}-${activePuzzle.checksum}`}
              puzzleData={activePuzzle}
            />
          </ErrorBoundary>

          <div className="mt-6 flex gap-3 w-full">
            <button
              onClick={() => setPuzzleIndex((prev) => (prev + 1) % activeList.length)}
              className="w-full py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 active:scale-[0.98] text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-600/30 transition-all border border-indigo-500/30"
            >
              🎲 {t.ui.nextPuzzle} / Next Puzzle ({puzzleIndex + 1}/{activeList.length})
            </button>
          </div>
        </section>
      ) : (
        <div className="mt-8 p-8 border border-dashed border-slate-800 rounded-2xl text-center max-w-sm">
          <p className="text-indigo-400 text-2xl mb-2">🚧</p>
          <p className="text-slate-300 text-sm font-semibold">{t.ui.noPuzzles}</p>
          <p className="text-slate-500 text-xs mt-1">此題型正在 SMT 焊接中，請切換其他難度或題型</p>
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
