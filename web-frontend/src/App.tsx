// web-frontend/src/App.tsx
import React, { useState, useMemo, useRef } from 'react';
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
  const {
    profile,
    getZPDRecommendedTier,
    exportProfileJSON,
    importProfileJSON,
  } = useLearnerProfile();

  const {
    scheduledItems,
    overallPeakTier,
    getRecommendedSchedulePuzzle,
  } = useLongTermScheduler(profile, PUZZLE_CATALOG);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedType, setSelectedType] = useState<string>('sudoku');
  const [currentLevel, setCurrentLevel] = useState<TierKey>('kids');
  const [puzzleIndex, setPuzzleIndex] = useState<number>(0);
  const [isZPDMode, setIsZPDMode] = useState<boolean>(true);
  const [neuroToast, setNeuroToast] = useState<string | null>(null);

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

  const currentState = profile.typeStates[selectedType] || { theta: 0.0, strength: 5.0, avgTimeSec: 0 };
  const currentPeak = profile.peakRecords[selectedType];
  const topSchedule = getRecommendedSchedulePuzzle();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (importProfileJSON(text)) {
          alert('LogiCore V5.1 神經動力學大腦檔案載入成功！');
        } else {
          alert('檔案格式錯誤，匯入失敗。');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleScheduleClick = () => {
    if (!topSchedule) return;

    if (topSchedule.item.isConsolidated) {
      setNeuroToast('🧠 神經科學發現：您上次練習此題型約 24 小時前，大腦正在高速固化邏輯迴路！現在複習，記憶保留率可提升 25%！');
    } else {
      setNeuroToast(`⚡ 記憶衰退預警：該題型已閒置 ${topSchedule.item.daysInactive} 天，已切換至溫手感題目以重新激活神經通路。`);
    }

    setSelectedType(topSchedule.targetType);
    setCurrentLevel(topSchedule.puzzle.tier as TierKey);
    setPuzzleIndex(0);

    setTimeout(() => setNeuroToast(null), 5000);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center py-6 px-4 font-sans selection:bg-indigo-500">
      {/* 頂部 Header */}
      <header className="w-full max-w-xl flex items-center justify-between mb-3 pb-3 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-black bg-gradient-to-r from-indigo-400 via-cyan-300 to-emerald-400 bg-clip-text text-transparent">
            LogiCore
          </h1>
          <p className="text-[11px] text-slate-500 font-mono">Biphasic Neuro-Dynamics · V5.1 Masterpiece</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportProfileJSON}
            title="備份大腦數據庫"
            className="p-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-lg text-xs"
          >
            💾 備份
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            title="載入大腦數據庫"
            className="p-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-lg text-xs"
          >
            📂 載入
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".json"
            className="hidden"
          />
          <LangSwitcher />
        </div>
      </header>

      {/* 神經動態 Toast 提示 */}
      {neuroToast && (
        <div className="w-full max-w-xl mb-3 px-3.5 py-2.5 bg-indigo-950/90 border border-indigo-500/80 rounded-xl text-xs text-indigo-200 text-center animate-fade-in shadow-lg shadow-indigo-950/50 font-medium">
          {neuroToast}
        </div>
      )}

      {/* 巔峰段位與離線固化/記憶預警條 */}
      <div className="w-full max-w-xl mb-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gradient-to-r from-indigo-950/40 to-slate-900/60 rounded-xl border border-indigo-900/40 text-xs">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full font-bold">
            🏆 巔峰: {t.difficulty[overallPeakTier]}
          </span>
          {currentPeak && (
            <span className="text-slate-400 font-mono text-[11px]">
              最佳: {t.difficulty[currentPeak.tier]} ({currentPeak.timeSpentSec}s)
            </span>
          )}
        </div>

        {topSchedule && (
          <button
            onClick={handleScheduleClick}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition flex items-center gap-1 border ${
              topSchedule.item.isConsolidated
                ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500 hover:bg-emerald-900 shadow-sm shadow-emerald-900/50 animate-pulse'
                : 'bg-cyan-950/80 text-cyan-300 border-cyan-700 hover:bg-cyan-900/80'
            }`}
          >
            <span>{topSchedule.item.isConsolidated ? '🧠 睡眠固化黃金期:' : '⚡ 記憶衰退預警:'}</span>
            <span className="uppercase font-bold">{topSchedule.targetType} (S:{topSchedule.item.currentStrength})</span>
          </button>
        )}
      </div>

      {/* 心理特質 θ 與心流數值指示條 */}
      <div className="w-full max-w-xl mb-4 px-3 py-2 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-slate-400">能力值(θ): <b className="text-emerald-400">{currentState.theta > 0 ? `+${currentState.theta}` : currentState.theta}</b></span>
          <span className="text-slate-400">士氣: <b className="text-amber-300">{profile.morale}x</b></span>
          <span className="text-slate-400 hidden sm:inline">EWMA均時: <b className="text-indigo-300">{currentState.avgTimeSec}s</b></span>
        </div>
        <button
          onClick={() => setIsZPDMode(!isZPDMode)}
          className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
            isZPDMode
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold shadow'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          {isZPDMode ? '🧠 雙相神經引導' : '手動選階'}
        </button>
      </div>

      {/* 題型選擇 Tab */}
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

      {/* 難度選擇按鈕 */}
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
