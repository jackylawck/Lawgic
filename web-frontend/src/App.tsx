import React, { useState, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { PuzzleRenderer } from './registry/RendererRegistry';
import { PUZZLE_CATALOG, PuzzleEntity } from './generated';
import { LangSwitcher } from './components/LangSwitcher';
import { useLearnerProfile, TierKey } from './hooks/useLearnerProfile';
import { useLongTermScheduler } from './hooks/useLongTermScheduler';

const PUZZLE_TYPES = [
  { id: 'sudoku', nameZh: '經典數獨', nameEn: 'Sudoku', icon: '🔢' },
  { id: 'skyscraper', nameZh: '摩天大樓', nameEn: 'Skyscraper', icon: '🏢' },
  { id: 'hashi', nameZh: '數橋', nameEn: 'Hashi', icon: '🌉' },
  { id: 'kropki', nameZh: '黑白點', nameEn: 'Kropki', icon: '⚪' },
  { id: 'maze', nameZh: '大迷宮', nameEn: 'Maze', icon: '🌀' },
];

const LEVEL_KEYS: TierKey[] = ['kids', 'intermediate', 'expert', 'master'];

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
  const { t, lang } = useLanguage();
  const { profile, getZPDRecommendedTier } = useLearnerProfile();
  const { forgottenTypes, overallPeakTier, getNextForgottenPuzzle } = useLongTermScheduler(
    profile,
    PUZZLE_CATALOG
  );

  const [selectedType, setSelectedType] = useState<string>('sudoku');
  const [currentLevel, setCurrentLevel] = useState<TierKey>('kids');
  const [puzzleIndex, setPuzzleIndex] = useState<number>(0);
  const [isZPDMode, setIsZPDMode] = useState<boolean>(false);

  const filteredPuzzles = useMemo(() => {
    const rawList = PUZZLE_CATALOG[selectedType] || [];
    const grouped: Record<TierKey, PuzzleEntity[]> = {
      kids: [],
      intermediate: [],
      expert: [],
      master: [],
    };

    rawList.forEach((p) => {
      const tier = (p.tier as TierKey) || 'kids';
      if (grouped[tier]) grouped[tier].push(p);
    });

    return grouped;
  }, [selectedType]);

  const activeLevel = isZPDMode ? getZPDRecommendedTier(selectedType) : currentLevel;
  const activeList = filteredPuzzles[activeLevel] || [];
  const activePuzzle = activeList.length > 0 ? activeList[puzzleIndex % activeList.length] : null;

  const typeStats = profile.typeMastery[selectedType] || { solved: 0, totalAttempts: 0 };
  const currentPeak = profile.peakRecords[selectedType];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center py-6 px-4 font-sans selection:bg-indigo-500">
      {/* Header */}
      <header className="w-full max-w-xl flex items-center justify-between mb-3 pb-3 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-black bg-gradient-to-r from-indigo-400 via-cyan-300 to-emerald-400 bg-clip-text text-transparent">
            LogiCore
          </h1>
          <p className="text-[11px] text-slate-500 font-mono">Lifelong Cognitive Companion · ZPD Adaptive</p>
        </div>
        <LangSwitcher />
      </header>

      {/* 終身巔峰與遺忘曲線調度條 */}
      <div className="w-full max-w-xl mb-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gradient-to-r from-indigo-950/40 to-slate-900/60 rounded-xl border border-indigo-900/40 text-xs">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full font-bold">
            🏆 巔峰段位: {t.difficulty[overallPeakTier]}
          </span>
          {currentPeak && (
            <span className="text-slate-400 font-mono text-[11px]">
              本項最佳: {t.difficulty[currentPeak.tier]} ({currentPeak.timeSpentSec}s)
            </span>
          )}
        </div>

        {forgottenTypes.length > 0 && (
          <button
            onClick={() => {
              const res = getNextForgottenPuzzle();
              if (res) {
                setSelectedType(res.targetType);
                setCurrentLevel(res.puzzle.tier as TierKey);
                setPuzzleIndex(0);
              }
            }}
            className="px-2.5 py-1 bg-cyan-950 text-cyan-300 border border-cyan-700 hover:bg-cyan-900/80 rounded-lg text-[11px] font-semibold transition"
          >
            🕰️ 遺忘複習 ({forgottenTypes.join(', ')})
          </button>
        )}
      </div>

      {/* 認知歷程指示條 */}
      <div className="w-full max-w-xl mb-4 px-3 py-2 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">通關累計:</span>
          <span className="text-emerald-400 font-bold">
            {profile.history.filter((h) => h.isSuccess).length} 題
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-400">勝率:</span>
          <span className="text-cyan-400 font-bold">
            {typeStats.totalAttempts > 0
              ? `${Math.round((typeStats.solved / typeStats.totalAttempts) * 100)}%`
              : '0%'}
          </span>
        </div>
        <button
          onClick={() => setIsZPDMode(!isZPDMode)}
          className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
            isZPDMode
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold shadow'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          {isZPDMode ? '🧠 ZPD 自適應' : '手動選階'}
        </button>
      </div>

      {/* 題型選擇 */}
      <div className="w-full max-w-xl flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-none">
        {PUZZLE_TYPES.map((pt) => {
          const isActive = selectedType === pt.id;
          const count = PUZZLE_CATALOG[pt.id]?.length || 0;
          return (
            <button
              key={pt.id}
              onClick={() => {
                setSelectedType(pt.id);
                setPuzzleIndex(0);
              }}
              disabled={count === 0}
              className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 border ${
                isActive
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 border-indigo-400 text-white shadow-lg shadow-indigo-500/25 ring-2 ring-indigo-400/40'
                  : count === 0
                  ? 'bg-slate-900/50 border-slate-800/50 text-slate-600 cursor-not-allowed'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>{pt.icon}</span>
              <span>{lang === 'zh' ? pt.nameZh : pt.nameEn}</span>
              <span className="text-[10px] opacity-60 ml-0.5">({count})</span>
            </button>
          );
        })}
      </div>

      {/* 難度選擇 */}
      {!isZPDMode && (
        <div className="flex flex-wrap justify-center gap-1.5 mb-6">
          {LEVEL_KEYS.map((lvl) => {
            const count = filteredPuzzles[lvl]?.length || 0;
            return (
              <button
                key={lvl}
                onClick={() => {
                  setCurrentLevel(lvl);
                  setPuzzleIndex(0);
                }}
                disabled={count === 0}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  activeLevel === lvl && count > 0
                    ? 'bg-indigo-600 border-indigo-400 text-white shadow-md'
                    : count === 0
                    ? 'bg-slate-900/50 border-slate-800/50 text-slate-600 cursor-not-allowed'
                    : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {t.difficulty[lvl]} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* 盤面渲染 */}
      {activePuzzle ? (
        <section className="flex flex-col items-center w-full max-w-sm sm:max-w-md">
          <ErrorBoundary
            FallbackComponent={EngineFallbackUI}
            resetKeys={[selectedType, activeLevel, puzzleIndex]}
            onReset={() => setPuzzleIndex(0)}
          >
            <PuzzleRenderer
              key={`${selectedType}-${activeLevel}-${puzzleIndex}-${activePuzzle.checksum}`}
              puzzle={activePuzzle}
            />
          </ErrorBoundary>

          <div className="mt-6 flex gap-3 w-full">
            <button
              onClick={() => setPuzzleIndex((prev) => (prev + 1) % activeList.length)}
              className="w-full py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 active:scale-[0.98] text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-600/30 transition-all border border-indigo-500/30"
            >
              🎲 {t.ui.nextPuzzle} ({puzzleIndex + 1}/{activeList.length})
            </button>
          </div>
        </section>
      ) : (
        <div className="mt-8 p-8 border border-dashed border-slate-800 rounded-2xl text-center max-w-sm">
          <p className="text-indigo-400 text-2xl mb-2">🧩</p>
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
