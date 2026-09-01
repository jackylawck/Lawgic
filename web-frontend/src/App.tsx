// web-frontend/src/App.tsx
import React, { useState, useMemo, useRef } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { PuzzleRenderer } from './registry/RendererRegistry';
import { PUZZLE_CATALOG, PuzzleEntity, CognitiveLoadVector } from './generated';
import { LangSwitcher } from './components/LangSwitcher';
import { useLearnerProfile, TierKey, CognitiveDimension } from './hooks/useLearnerProfile';
import { useLongTermScheduler } from './hooks/useLongTermScheduler';

interface PuzzleMeta {
  id: string;
  nameZh: string;
  nameEn: string;
  icon: string;
  primaryDimension: CognitiveDimension;
  defaultLoad: CognitiveLoadVector;
}

const PUZZLE_METAS: PuzzleMeta[] = [
  { id: 'sudoku', nameZh: '經典數獨', nameEn: 'Sudoku', icon: '🔢', primaryDimension: 'workingMemory', defaultLoad: { spatial: 0.3, numeric: 0.4, workingMemory: 0.8, inhibition: 0.6 } },
  { id: 'skyscraper', nameZh: '摩天大樓', nameEn: 'Skyscraper', icon: '🏢', primaryDimension: 'spatial', defaultLoad: { spatial: 0.9, numeric: 0.3, workingMemory: 0.7, inhibition: 0.5 } },
  { id: 'hashi', nameZh: '數橋', nameEn: 'Hashi', icon: '🌉', primaryDimension: 'spatial', defaultLoad: { spatial: 0.8, numeric: 0.5, workingMemory: 0.6, inhibition: 0.4 } },
  { id: 'kropki', nameZh: '黑白點', nameEn: 'Kropki', icon: '⚪', primaryDimension: 'numeric', defaultLoad: { spatial: 0.4, numeric: 0.8, workingMemory: 0.8, inhibition: 0.7 } },
  { id: 'slitherlink', nameZh: '數迴', nameEn: 'Slitherlink', icon: '➰', primaryDimension: 'spatial', defaultLoad: { spatial: 0.9, numeric: 0.2, workingMemory: 0.8, inhibition: 0.7 } },
  { id: 'kakuro', nameZh: '數和', nameEn: 'Kakuro', icon: '➕', primaryDimension: 'numeric', defaultLoad: { spatial: 0.3, numeric: 1.0, workingMemory: 0.9, inhibition: 0.5 } },
  { id: 'nurikabe', nameZh: '數牆', nameEn: 'Nurikabe', icon: '🧱', primaryDimension: 'inhibition', defaultLoad: { spatial: 0.8, numeric: 0.3, workingMemory: 0.7, inhibition: 0.8 } },
  { id: 'hitori', nameZh: '數壹', nameEn: 'Hitori', icon: '⬛', primaryDimension: 'inhibition', defaultLoad: { spatial: 0.5, numeric: 0.3, workingMemory: 0.6, inhibition: 0.9 } },
  { id: 'futoshiki', nameZh: '不等式', nameEn: 'Futoshiki', icon: '⚖️', primaryDimension: 'numeric', defaultLoad: { spatial: 0.4, numeric: 0.6, workingMemory: 0.7, inhibition: 0.6 } },
  { id: 'jigsaw', nameZh: '拼圖數獨', nameEn: 'Jigsaw', icon: '🧩', primaryDimension: 'spatial', defaultLoad: { spatial: 0.9, numeric: 0.4, workingMemory: 0.8, inhibition: 0.5 } },
  { id: 'dominoes', nameZh: '骨牌密拼', nameEn: 'Dominoes', icon: '🀄', primaryDimension: 'inhibition', defaultLoad: { spatial: 0.7, numeric: 0.5, workingMemory: 0.6, inhibition: 0.7 } },
  { id: 'maze', nameZh: '大迷宮', nameEn: 'Maze', icon: '🌀', primaryDimension: 'spatial', defaultLoad: { spatial: 1.0, numeric: 0.0, workingMemory: 0.5, inhibition: 0.4 } },
];

const LEVEL_KEYS: TierKey[] = ['kids', 'intermediate', 'expert', 'master'];

const EngineFallbackUI: React.FC<{ resetErrorBoundary: () => void }> = ({ resetErrorBoundary }) => {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-red-950/40 border border-red-800/80 rounded-2xl max-w-md text-center my-6">
      <p className="text-red-300 font-semibold text-sm">{t.errors.engineCrash}</p>
      <button
        onClick={resetErrorBoundary}
        className="mt-4 px-4 py-2 bg-red-900/60 hover:bg-red-800 text-red-100 rounded-xl text-xs font-medium border border-red-700"
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
    globalCognitiveProfile,
    exportProfileJSON,
    importProfileJSON,
  } = useLearnerProfile();

  const {
    overallPeakTier,
    getRecommendedSchedulePuzzle,
  } = useLongTermScheduler(profile, PUZZLE_CATALOG);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedType, setSelectedType] = useState<string>('sudoku');
  const [currentLevel, setCurrentLevel] = useState<TierKey>('kids');
  const [puzzleIndex, setPuzzleIndex] = useState<number>(0);
  const [isZPDMode, setIsZPDMode] = useState<boolean>(true);
  const [showDetail, setShowDetail] = useState<boolean>(false);
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

  const currentMeta = PUZZLE_METAS.find((m) => m.id === selectedType) || PUZZLE_METAS[0];
  const activeLevel = isZPDMode ? getZPDRecommendedTier(selectedType, currentMeta.defaultLoad) : currentLevel;
  const activeList = filteredPuzzles[activeLevel] || [];
  const activePuzzle = activeList.length > 0 ? activeList[puzzleIndex % activeList.length] : null;

  const currentLoad = activePuzzle?.cognitiveLoad || currentMeta.defaultLoad;
  const currentState = profile.typeStates[selectedType];
  const globalRadar = globalCognitiveProfile();
  const topSchedule = getRecommendedSchedulePuzzle();

  // 找出全域最弱維度
  const weakestDimension = useMemo(() => {
    const dims: CognitiveDimension[] = ['spatial', 'numeric', 'workingMemory', 'inhibition'];
    return dims.reduce((min, d) => (globalRadar[d] < globalRadar[min] ? d : min), dims[0]);
  }, [globalRadar]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (importProfileJSON(text)) {
          alert('🧠 MIRT V6 大腦檔案載入成功！');
        } else {
          alert('檔案格式錯誤。');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleScheduleClick = () => {
    if (!topSchedule) return;
    if (topSchedule.item.isConsolidated) {
      setNeuroToast('🧠 突觸可塑性巔峰！24h 睡眠固化窗口開啟，現在挑戰高階難度，記憶增益 +25%！');
    } else {
      setNeuroToast(`⚡ 神經衰退預警 (S=${topSchedule.item.currentStrength})，已切換至暖身題目以重啟神經通路。`);
    }
    setSelectedType(topSchedule.targetType);
    setCurrentLevel(topSchedule.puzzle.tier as TierKey);
    setPuzzleIndex(0);
    setTimeout(() => setNeuroToast(null), 4500);
  };

  return (
    <main
      className="min-h-screen text-slate-100 flex flex-col items-center py-4 px-3 font-sans selection:bg-indigo-500"
      style={{ backgroundColor: '#0f172a' }}
    >
      {/* 頂部 Header */}
      <header className="w-full max-w-xl flex items-center justify-between mb-2 pb-2 border-b border-slate-800/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-sm font-black shadow-lg shadow-indigo-500/30">
            🧠
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight bg-gradient-to-r from-indigo-300 via-cyan-200 to-emerald-300 bg-clip-text text-transparent leading-none">
              LogiCore
            </h1>
            <p className="text-[9px] text-slate-500 font-mono tracking-widest uppercase">
              {isZPDMode ? '🔬 MIRT 4維多維自適應' : '🎛️ 手動探索'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* 懸浮能力膠囊 */}
          <div
            onMouseEnter={() => setShowDetail(true)}
            onMouseLeave={() => setShowDetail(false)}
            className="relative cursor-help"
          >
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/80 border border-slate-700/60 backdrop-blur-sm text-[10px] font-mono">
              <span className="text-cyan-400">空間 {globalRadar.spatial > 0 ? `+${globalRadar.spatial}` : globalRadar.spatial}</span>
              <span className="text-slate-600">|</span>
              <span className="text-emerald-400">數感 {globalRadar.numeric > 0 ? `+${globalRadar.numeric}` : globalRadar.numeric}</span>
            </div>
            {showDetail && (
              <div className="absolute right-0 top-full mt-1 z-50 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl text-[10px] font-mono whitespace-nowrap backdrop-blur-md">
                <div>工作記憶: <span className="text-indigo-300">{globalRadar.workingMemory}</span></div>
                <div>抑制控制: <span className="text-amber-300">{globalRadar.inhibition}</span></div>
                <div>士氣指數: <span className="text-cyan-300">{profile.morale}x</span></div>
                <div>全域巔峰: <span className="text-amber-300">{t.difficulty[overallPeakTier]}</span></div>
              </div>
            )}
          </div>

          <button onClick={exportProfileJSON} className="p-1.5 bg-slate-900/80 border border-slate-700/60 hover:border-slate-500 rounded-lg text-[10px] text-slate-400 hover:text-white transition" title="備份大腦">💾</button>
          <button onClick={() => fileInputRef.current?.click()} className="p-1.5 bg-slate-900/80 border border-slate-700/60 hover:border-slate-500 rounded-lg text-[10px] text-slate-400 hover:text-white transition" title="載入大腦">📂</button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".json" className="hidden" />
          <LangSwitcher />
        </div>
      </header>

      {/* 神經動態 Toast 提示 */}
      {neuroToast && (
        <div className="w-full max-w-xl mb-2 px-4 py-2.5 bg-gradient-to-r from-indigo-950/95 to-slate-900/95 border border-indigo-500/70 rounded-2xl shadow-xl text-[11px] text-indigo-100 text-center font-medium backdrop-blur-xl animate-pulse">
          {neuroToast}
        </div>
      )}

      {/* 生物機會固化橫幅 */}
      {topSchedule && (
        <div
          onClick={handleScheduleClick}
          className={`w-full max-w-xl mb-3 p-3 rounded-2xl border cursor-pointer transition-all duration-500 hover:scale-[1.01] active:scale-[0.98] shadow-2xl ${
            topSchedule.item.isConsolidated
              ? 'bg-gradient-to-r from-emerald-950/80 to-indigo-950/80 border-emerald-400/50 shadow-emerald-500/20'
              : 'bg-gradient-to-r from-cyan-950/80 to-slate-900/80 border-cyan-700/60 shadow-cyan-500/10'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{topSchedule.item.isConsolidated ? '🌙' : '⚡'}</span>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                  {topSchedule.item.isConsolidated ? '🧠 突觸固化黃金期 (16-48h)' : '🔄 記憶衰退喚醒'}
                </div>
                <div className="text-sm font-bold">
                  {topSchedule.targetType} · 強度 S={topSchedule.item.currentStrength}
                  {topSchedule.item.isConsolidated && <span className="ml-2 text-emerald-300 text-[10px]">+25% 增益</span>}
                </div>
              </div>
            </div>
            <div className="text-[10px] px-3 py-1.5 bg-white/10 rounded-full backdrop-blur border border-white/10 font-bold">
              立即收割 ↗
            </div>
          </div>
        </div>
      )}

      {/* 12 大題型膠囊 */}
      <div className="w-full max-w-xl flex gap-1.5 overflow-x-auto pb-2 mb-2 scrollbar-none">
        {PUZZLE_METAS.map((pt) => {
          const isActive = selectedType === pt.id;
          const count = PUZZLE_CATALOG[pt.id]?.length || 0;
          const isWeakestTarget = pt.primaryDimension === weakestDimension;

          return (
            <button
              key={pt.id}
              onClick={() => { setSelectedType(pt.id); setPuzzleIndex(0); }}
              disabled={count === 0}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-all flex items-center gap-1.5 border ${
                isActive
                  ? 'bg-indigo-600/90 border-indigo-400 text-white shadow-lg shadow-indigo-500/30 ring-1 ring-indigo-400/50'
                  : count === 0
                  ? 'bg-slate-900/40 border-slate-800/40 text-slate-600 cursor-not-allowed'
                  : isWeakestTarget
                  ? 'bg-slate-900/90 border-amber-500/50 text-amber-300 hover:bg-slate-800'
                  : 'bg-slate-900/60 border-slate-700/60 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
              }`}
            >
              <span>{pt.icon}</span>
              <span>{lang === 'zh' ? pt.nameZh : pt.nameEn}</span>
              {isWeakestTarget && <span className="text-[8px] bg-amber-500/20 text-amber-300 px-1 rounded">🎯弱項</span>}
              <span className="text-[8px] opacity-50">({count})</span>
            </button>
          );
        })}
      </div>

      {/* 4 維認知負荷向量 */}
      <div className="w-full max-w-xl mb-3 px-3 py-2 bg-slate-900/60 rounded-xl border border-slate-800/80 grid grid-cols-4 gap-2 text-center text-[9px] font-mono">
        <div>
          <span className="text-slate-400 block">空間幾何</span>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1 overflow-hidden">
            <div className="bg-cyan-400 h-full" style={{ width: `${currentLoad.spatial * 100}%` }} />
          </div>
        </div>
        <div>
          <span className="text-slate-400 block">數感運算</span>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1 overflow-hidden">
            <div className="bg-emerald-400 h-full" style={{ width: `${currentLoad.numeric * 100}%` }} />
          </div>
        </div>
        <div>
          <span className="text-slate-400 block">工作記憶</span>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1 overflow-hidden">
            <div className="bg-indigo-400 h-full" style={{ width: `${currentLoad.workingMemory * 100}%` }} />
          </div>
        </div>
        <div>
          <span className="text-slate-400 block">抑制控制</span>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1 overflow-hidden">
            <div className="bg-amber-400 h-full" style={{ width: `${currentLoad.inhibition * 100}%` }} />
          </div>
        </div>
      </div>

      {/* 難度選擇 */}
      {!isZPDMode && (
        <div className="flex flex-wrap justify-center gap-1.5 mb-3">
          {LEVEL_KEYS.map((lvl) => {
            const count = filteredPuzzles[lvl]?.length || 0;
            return (
              <button
                key={lvl}
                onClick={() => { setCurrentLevel(lvl); setPuzzleIndex(0); }}
                disabled={count === 0}
                className={`px-3 py-1 rounded-full text-[10px] font-semibold border transition-all ${
                  activeLevel === lvl && count > 0
                    ? 'bg-indigo-600/80 border-indigo-400 text-white shadow'
                    : count === 0
                    ? 'bg-slate-900/50 border-slate-800/50 text-slate-600 cursor-not-allowed'
                    : 'bg-slate-900/60 border-slate-700/60 text-slate-400 hover:bg-slate-800/80'
                }`}
              >
                {t.difficulty[lvl]} <span className="text-[8px] opacity-50">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 盤面主體 */}
      {activePuzzle ? (
        <section className="flex flex-col items-center w-full max-w-md sm:max-w-lg">
          <div className="w-full p-2 bg-white/5 backdrop-blur-md rounded-3xl border border-white/5 shadow-2xl shadow-indigo-500/10">
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
          </div>

          <div className="mt-4 flex gap-3 w-full">
            <button
              onClick={() => {
                if (navigator.vibrate) navigator.vibrate(12);
                setPuzzleIndex((prev) => (prev + 1) % activeList.length);
              }}
              className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98] text-white rounded-2xl text-sm font-bold shadow-xl shadow-indigo-600/30 transition-all border border-indigo-400/30 flex items-center justify-center gap-2"
            >
              <span>⚡ 神經適應下一題</span>
              <span className="text-[10px] opacity-70 font-mono">({puzzleIndex + 1}/{activeList.length})</span>
            </button>
          </div>

          <div className="mt-2 text-[9px] text-slate-500 font-mono tracking-wider">
            {isZPDMode ? `🧠 MIRT 投影推薦 · ${t.difficulty[activeLevel]}` : `🎛️ 手動 · ${t.difficulty[activeLevel]}`}
          </div>
        </section>
      ) : (
        <div className="mt-12 p-10 border border-dashed border-slate-800/60 rounded-3xl text-center max-w-sm backdrop-blur-sm bg-slate-900/30">
          <p className="text-indigo-400 text-3xl mb-2">{currentMeta.icon}</p>
          <p className="text-slate-300 text-sm font-semibold">{currentMeta.nameZh} 題庫準備中</p>
          <p className="text-slate-500 text-[10px] mt-1">此題型正在 SMT 焊接中，請切換其他題型</p>
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
