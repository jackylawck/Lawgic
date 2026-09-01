// web-frontend/src/App.tsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
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

  const activeLevel = isZPDMode ? getZPDRecommendedTier(selectedType) : currentLevel;
  const activeList = filteredPuzzles[activeLevel] || [];
  const activePuzzle = activeList.length > 0 ? activeList[puzzleIndex % activeList.length] : null;

  const currentState = profile.typeStates[selectedType] || { theta: 0.0, strength: 5.0, avgTimeSec: 0 };
  const currentPeak = profile.peakRecords[selectedType];
  const topSchedule = getRecommendedSchedulePuzzle();

  // 🎨 動態背景：根據士氣與記憶強度改變氛圍
  const bgIntensity = Math.min(1, Math.max(0.2, profile.morale * 0.6 + (currentState.strength / 15)));
  const bgGradient = `radial-gradient(circle at 50% 0%, rgba(99, 102, 241, ${bgIntensity * 0.15}) 0%, rgba(15, 23, 42, 1) 80%)`;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (importProfileJSON(text)) {
          alert('🧠 神經大腦檔案 V5.2 載入成功！');
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
      setNeuroToast('🧠 突觸可塑性巔峰！24h 睡眠固化窗口開啟，現在挑戰高階難度，記憶增益 +25%');
    } else {
      setNeuroToast(`⚡ 神經衰退預警 (S=${topSchedule.item.currentStrength})，已切換至暖身基礎題。`);
    }
    setSelectedType(topSchedule.targetType);
    setCurrentLevel(topSchedule.puzzle.tier as TierKey);
    setPuzzleIndex(0);
    setTimeout(() => setNeuroToast(null), 4500);
  };

  return (
    <main 
      className="min-h-screen text-slate-100 flex flex-col items-center py-4 px-3 font-sans selection:bg-indigo-500 transition-all duration-1000"
      style={{ background: bgGradient, backgroundColor: '#0f172a' }}
    >
      {/* ========== 極簡神經頭部 ========== */}
      <header className="w-full max-w-lg flex items-center justify-between mb-2 pb-2 border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-sm font-black shadow-lg shadow-indigo-500/30">
            🧠
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight bg-gradient-to-r from-indigo-300 via-cyan-200 to-emerald-300 bg-clip-text text-transparent leading-none">
              LogiCore
            </h1>
            <p className="text-[9px] text-slate-500 font-mono tracking-widest uppercase">
              {isZPDMode ? '🔬 雙相神經引導' : '🎛️ 手動探索'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* 懸浮數據膠囊（點擊展開詳情） */}
          <div 
            onMouseEnter={() => setShowDetail(true)}
            onMouseLeave={() => setShowDetail(false)}
            className="relative cursor-help"
          >
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/80 border border-slate-700/60 backdrop-blur-sm text-[10px] font-mono">
              <span className="text-emerald-400">θ {currentState.theta > 0 ? `+${currentState.theta.toFixed(2)}` : currentState.theta.toFixed(2)}</span>
              <span className="text-slate-600">|</span>
              <span className="text-amber-300">{profile.morale.toFixed(2)}x</span>
            </div>
            {showDetail && (
              <div className="absolute right-0 top-full mt-1 z-50 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl text-[10px] font-mono whitespace-nowrap backdrop-blur-md">
                <div>EWMA 均時: <span className="text-indigo-300">{currentState.avgTimeSec}s</span></div>
                <div>巔峰段位: <span className="text-amber-300">{t.difficulty[overallPeakTier]}</span></div>
                <div>累積通關: <span className="text-emerald-300">{profile.history.filter(h => h.isSuccess).length}</span></div>
              </div>
            )}
          </div>
          <button onClick={exportProfileJSON} className="p-1.5 bg-slate-900/80 border border-slate-700/60 hover:border-slate-500 rounded-lg text-[10px] text-slate-400 hover:text-white transition" title="備份大腦">💾</button>
          <button onClick={() => fileInputRef.current?.click()} className="p-1.5 bg-slate-900/80 border border-slate-700/60 hover:border-slate-500 rounded-lg text-[10px] text-slate-400 hover:text-white transition" title="載入大腦">📂</button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".json" className="hidden" />
          <LangSwitcher />
        </div>
      </header>

      {/* ========== 神經動態 Toast（全幅沉浸） ========== */}
      {neuroToast && (
        <div className="w-full max-w-lg mb-3 px-4 py-3 bg-gradient-to-r from-indigo-950/95 to-slate-900/95 border border-indigo-500/70 rounded-2xl shadow-2xl shadow-indigo-600/20 text-[11px] text-indigo-100 text-center font-medium backdrop-blur-xl animate-pulse">
          {neuroToast}
        </div>
      )}

      {/* ========== 🧠 生物機會橫幅（主視覺調度） ========== */}
      {topSchedule && (
        <div 
          onClick={handleScheduleClick}
          className={`w-full max-w-lg mb-3 p-3 rounded-2xl border cursor-pointer transition-all duration-500 hover:scale-[1.01] active:scale-[0.98] shadow-2xl ${
            topSchedule.item.isConsolidated 
              ? 'bg-gradient-to-r from-emerald-950/80 to-indigo-950/80 border-emerald-400/50 shadow-emerald-500/20 animate-[pulse_3s_ease-in-out_infinite]' 
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

      {/* ========== 題型選擇（精簡膠囊） ========== */}
      <div className="w-full max-w-lg flex gap-1.5 overflow-x-auto pb-2 mb-2 scrollbar-none">
        {PUZZLE_TYPES.map((pt) => {
          const isActive = selectedType === pt.id;
          const count = PUZZLE_CATALOG[pt.id]?.length || 0;
          return (
            <button
              key={pt.id}
              onClick={() => { setSelectedType(pt.id); setPuzzleIndex(0); }}
              disabled={count === 0}
              className={`px-3.5 py-1.5 rounded-full text-[10px] font-bold whitespace-nowrap transition-all flex items-center gap-1.5 border ${
                isActive
                  ? 'bg-indigo-600/90 border-indigo-400 text-white shadow-lg shadow-indigo-500/30 ring-1 ring-indigo-400/50'
                  : count === 0
                  ? 'bg-slate-900/50 border-slate-800/50 text-slate-600 cursor-not-allowed'
                  : 'bg-slate-900/60 border-slate-700/60 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
              }`}
            >
              <span>{pt.icon}</span>
              <span>{lang === 'zh' ? pt.nameZh : pt.nameEn}</span>
              <span className="text-[8px] opacity-50">({count})</span>
            </button>
          );
        })}
      </div>

      {/* ========== 難度網格（手動模式） ========== */}
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

      {/* ========== 🧩 盤面核心（玻璃質感） ========== */}
      {activePuzzle ? (
        <section className="flex flex-col items-center w-full max-w-sm sm:max-w-md">
          <div className="w-full p-1.5 bg-white/5 backdrop-blur-sm rounded-3xl border border-white/5 shadow-2xl shadow-indigo-500/5">
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

          {/* 底部控制區（神經適應按鈕） */}
          <div className="mt-4 flex gap-3 w-full">
            <button
              onClick={() => {
                // 微交互動饋：震動感（若支援）
                if (navigator.vibrate) navigator.vibrate(10);
                setPuzzleIndex((prev) => (prev + 1) % activeList.length);
              }}
              className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.97] text-white rounded-2xl text-sm font-bold shadow-xl shadow-indigo-600/30 transition-all border border-indigo-400/30 flex items-center justify-center gap-2"
            >
              <span>⚡ 神經適應</span>
              <span className="text-[10px] opacity-70 font-mono">({puzzleIndex + 1}/{activeList.length})</span>
            </button>
          </div>
          
          {/* 小字顯示當前難度與 ZPD 狀態 */}
          <div className="mt-2 text-[9px] text-slate-500 font-mono tracking-wider">
            {isZPDMode ? `🧠 ZPD 推薦 · ${t.difficulty[activeLevel]}` : `🎛️ 手動 · ${t.difficulty[activeLevel]}`}
          </div>
        </section>
      ) : (
        <div className="mt-12 p-10 border border-dashed border-slate-800/60 rounded-3xl text-center max-w-sm backdrop-blur-sm bg-slate-900/30">
          <p className="text-indigo-400 text-3xl mb-2">🧩</p>
          <p className="text-slate-300 text-sm font-semibold">{t.ui.noPuzzles}</p>
          <p className="text-slate-500 text-[10px] mt-1">此題型正在神經焊接中，請切換其他類型</p>
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
