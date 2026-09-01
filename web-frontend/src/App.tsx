// web-frontend/src/App.tsx
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { PuzzleRenderer } from './registry/RendererRegistry';
import { PUZZLE_CATALOG, PuzzleEntity, CognitiveLoadVector } from './generated';
import { LangSwitcher } from './components/LangSwitcher';
import { VirtualGamepad } from './components/VirtualGamepad';
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
  { id: 'sudoku', nameZh: '數獨魔陣', nameEn: 'Sudoku', icon: '🔢', primaryDimension: 'workingMemory', defaultLoad: { spatial: 0.3, numeric: 0.4, workingMemory: 0.8, inhibition: 0.6 } },
  { id: 'skyscraper', nameZh: '摩天透視', nameEn: 'Skyscraper', icon: '🏢', primaryDimension: 'spatial', defaultLoad: { spatial: 0.9, numeric: 0.3, workingMemory: 0.7, inhibition: 0.5 } },
  { id: 'hashi', nameZh: '星際數橋', nameEn: 'Hashi', icon: '🌉', primaryDimension: 'spatial', defaultLoad: { spatial: 0.8, numeric: 0.5, workingMemory: 0.6, inhibition: 0.4 } },
  { id: 'kropki', nameZh: '黑白雙星', nameEn: 'Kropki', icon: '⚪', primaryDimension: 'numeric', defaultLoad: { spatial: 0.4, numeric: 0.8, workingMemory: 0.8, inhibition: 0.7 } },
  { id: 'slitherlink', nameZh: '迴路封閉', nameEn: 'Slitherlink', icon: '➰', primaryDimension: 'spatial', defaultLoad: { spatial: 0.9, numeric: 0.2, workingMemory: 0.8, inhibition: 0.7 } },
  { id: 'kakuro', nameZh: '數和密碼', nameEn: 'Kakuro', icon: '➕', primaryDimension: 'numeric', defaultLoad: { spatial: 0.3, numeric: 1.0, workingMemory: 0.9, inhibition: 0.5 } },
  { id: 'nurikabe', nameZh: '暗夜數牆', nameEn: 'Nurikabe', icon: '🧱', primaryDimension: 'inhibition', defaultLoad: { spatial: 0.8, numeric: 0.3, workingMemory: 0.7, inhibition: 0.8 } },
  { id: 'hitori', nameZh: '孤島數壹', nameEn: 'Hitori', icon: '⬛', primaryDimension: 'inhibition', defaultLoad: { spatial: 0.5, numeric: 0.3, workingMemory: 0.6, inhibition: 0.9 } },
  { id: 'futoshiki', nameZh: '天平不等', nameEn: 'Futoshiki', icon: '⚖️', primaryDimension: 'numeric', defaultLoad: { spatial: 0.4, numeric: 0.6, workingMemory: 0.7, inhibition: 0.6 } },
  { id: 'jigsaw', nameZh: '幾何拼圖', nameEn: 'Jigsaw', icon: '🧩', primaryDimension: 'spatial', defaultLoad: { spatial: 0.9, numeric: 0.4, workingMemory: 0.8, inhibition: 0.5 } },
  { id: 'dominoes', nameZh: '骨牌矩陣', nameEn: 'Dominoes', icon: '🀄', primaryDimension: 'inhibition', defaultLoad: { spatial: 0.7, numeric: 0.5, workingMemory: 0.6, inhibition: 0.7 } },
  { id: 'maze', nameZh: '空間迷宮', nameEn: 'Maze', icon: '🌀', primaryDimension: 'spatial', defaultLoad: { spatial: 1.0, numeric: 0.0, workingMemory: 0.5, inhibition: 0.4 } },
];

const LEVEL_KEYS: TierKey[] = ['kids', 'intermediate', 'expert', 'master'];

const TIER_NAMES_PRO: Record<TierKey, string> = {
  kids: '4x4 奠基',
  intermediate: '6x6 突破',
  expert: '9x9 精通',
  master: '變體深淵',
};

const TIER_NAMES_CHILD: Record<TierKey, string> = {
  kids: '🌱 小小種子',
  intermediate: '🌿 發芽小樹',
  expert: '🌳 森林守護者',
  master: '🏰 邏輯小騎士',
};

const CHILD_SAFE_IDS = new Set(['maze', 'hashi', 'sudoku', 'jigsaw']);

const EngineFallbackUI: React.FC<{ resetErrorBoundary: () => void }> = ({ resetErrorBoundary }) => (
  <div className="flex flex-col items-center justify-center p-6 bg-red-950/40 border border-red-800 text-center my-4 font-mono">
    <p className="text-red-300 text-xs">盤面渲染異常</p>
    <button
      onClick={resetErrorBoundary}
      className="mt-3 px-3 py-1 bg-red-900/60 hover:bg-red-800 text-red-100 text-[10px] border border-red-700"
    >
      重試
    </button>
  </div>
);

const MainDashboard: React.FC = () => {
  const { t } = useLanguage();
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

  // 模式狀態
  const [isProZen, setIsProZen] = useState<boolean>(true);
  const [isChildMode, setIsChildMode] = useState<boolean>(false);
  const [selectedType, setSelectedType] = useState<string>('sudoku');
  const [currentLevel, setCurrentLevel] = useState<TierKey>('kids');
  const [puzzleIndex, setPuzzleIndex] = useState<number>(0);
  const [isZPDMode, setIsZPDMode] = useState<boolean>(true);
  const [showDetail, setShowDetail] = useState<boolean>(false);
  const [neuroToast, setNeuroToast] = useState<string | null>(null);

  // ⏱️ 即時碼錶
  const [elapsed, setElapsed] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ⚡ 瞬間二進制視覺反饋狀態 (400ms 綠/紅邊框脈衝)
  const [flashFeedback, setFlashFeedback] = useState<'success' | 'failure' | null>(null);

  // 🕹️ 判斷當前是否為空間探索類題型（需要虛擬搖桿支援）
  const isSpatialExplorationType = selectedType === 'maze' || selectedType === 'skyscraper';

  const visibleMetas = useMemo(() => {
    if (!isChildMode) return PUZZLE_METAS;
    return PUZZLE_METAS.filter((m) => CHILD_SAFE_IDS.has(m.id));
  }, [isChildMode]);

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
  const globalRadar = globalCognitiveProfile();
  const topSchedule = getRecommendedSchedulePuzzle();

  const weakestDimension = useMemo(() => {
    const dims: CognitiveDimension[] = ['spatial', 'numeric', 'workingMemory', 'inhibition'];
    return dims.reduce((min, d) => (globalRadar[d] < globalRadar[min] ? d : min), dims[0]);
  }, [globalRadar]);

  // 今日平均速度 (Pace)
  const todayAvg = useMemo(() => {
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const todaySuccesses = profile.history.filter((h) => h.isSuccess && h.timestamp >= startOfToday);
    if (todaySuccesses.length === 0) return null;
    const avg = todaySuccesses.reduce((s, h) => s + h.timeSpentSec, 0) / todaySuccesses.length;
    return Math.round(avg);
  }, [profile.history]);

  // 監聽答題紀錄，觸發 400ms 二進制反饋
  useEffect(() => {
    if (profile.history.length === 0) return;
    const last = profile.history[profile.history.length - 1];
    if (Date.now() - last.timestamp < 2000) {
      setFlashFeedback(last.isSuccess ? 'success' : 'failure');
      const timer = setTimeout(() => setFlashFeedback(null), 400);
      return () => clearTimeout(timer);
    }
  }, [profile.history]);

  // 控制動作
  const handlePrevPuzzle = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(8);
    setPuzzleIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, activeList.length - 1)));
  }, [activeList.length]);

  const handleNextPuzzle = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(10);
    setPuzzleIndex((prev) => (prev + 1) % (activeList.length || 1));
  }, [activeList.length]);

  const handleRandomPuzzle = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(12);
    if (activeList.length > 1) {
      setPuzzleIndex(Math.floor(Math.random() * activeList.length));
    }
  }, [activeList.length]);

  const handleExpedition = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(15);
    const targetMeta = visibleMetas.find(
      (m) => m.primaryDimension === weakestDimension && (PUZZLE_CATALOG[m.id]?.length || 0) > 0
    );

    if (targetMeta && targetMeta.id !== selectedType) {
      setSelectedType(targetMeta.id);
      setPuzzleIndex(0);
      setNeuroToast(`🧭 載入最弱迴路訓練【${targetMeta.nameZh}】`);
    } else {
      setPuzzleIndex((prev) => (prev + 1) % (activeList.length || 1));
    }
    setTimeout(() => setNeuroToast(null), 3500);
  }, [visibleMetas, weakestDimension, selectedType, activeList.length]);

  // 🕹️ 搖桿控制回調處理
  const handleJoystickMove = useCallback((x: number, y: number) => {
    // 輸出給迷宮位移或平移視角
  }, []);

  const handleJoystickRotate = useCallback((x: number, y: number) => {
    // 輸出給 3D 視角旋轉
  }, []);

  const handleJoystickAction = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(15);
    // 觸發空間互動/落子/確認動作
  }, []);

  // ⌨️ 全域鍵盤快捷鍵 (N / P / R / Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'n':
        case 'N':
        case 'ArrowRight':
          e.preventDefault();
          handleNextPuzzle();
          break;
        case 'p':
        case 'P':
        case 'ArrowLeft':
          e.preventDefault();
          handlePrevPuzzle();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          handleRandomPuzzle();
          break;
        case 'z':
        case 'Z':
          e.preventDefault();
          setIsZPDMode((prev) => !prev);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNextPuzzle, handlePrevPuzzle, handleRandomPuzzle]);

  // 重設計時器
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (importProfileJSON(text)) {
          setNeuroToast('🧠 檔案載入成功');
        } else {
          setNeuroToast('⚠️ 格式錯誤');
        }
        setTimeout(() => setNeuroToast(null), 2500);
      };
      reader.readAsText(file);
    }
  };

  const handleScheduleClick = () => {
    if (!topSchedule) return;
    setSelectedType(topSchedule.targetType);
    setCurrentLevel(topSchedule.puzzle.tier as TierKey);
    setPuzzleIndex(0);
    setNeuroToast(
      topSchedule.item.isConsolidated
        ? '🌙 24h 睡眠固化窗口已啟動（難度對齊個人巔峰）'
        : `⚡ 記憶衰退喚醒：${topSchedule.targetType}`
    );
    setTimeout(() => setNeuroToast(null), 3500);
  };

  const tierNames = isChildMode ? TIER_NAMES_CHILD : TIER_NAMES_PRO;

  // ==========================
  // ⚙️ 視圖 1：純粹主義賽道工作臺 (Pro Zen Track Mode)
  // ==========================
  if (isProZen) {
    return (
      <main className="min-h-screen bg-[#090d14] text-slate-200 flex flex-col items-center py-3 px-2 font-mono selection:bg-indigo-600">
        <header className="w-full max-w-lg flex items-center justify-between mb-2 pb-1.5 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold tracking-[0.2em] text-slate-400 uppercase">
              LOGICORE
            </span>
            <span className="text-[9px] text-slate-500 border border-slate-800 px-1 py-0.5">
              {currentMeta.nameZh}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[10px]">
            {profile.streak > 0 && (
              <span className="text-amber-400 font-bold mr-1">
                🔥{profile.streak}
              </span>
            )}
            <button
              onClick={() => setIsProZen(false)}
              className="text-slate-500 hover:text-slate-300 px-1.5 py-0.5 border border-slate-800 hover:border-slate-600 transition text-[9px]"
              title="切換至沉浸模式"
            >
              🎨 沉浸
            </button>
            <button
              onClick={() => {
                setIsChildMode(!isChildMode);
                setSelectedType('sudoku');
                setPuzzleIndex(0);
              }}
              className="text-slate-500 hover:text-slate-300 px-1.5 py-0.5 border border-slate-800 hover:border-slate-600 transition text-[9px]"
            >
              {isChildMode ? '兒童' : '成人'}
            </button>
            <button onClick={exportProfileJSON} className="text-slate-600 hover:text-slate-300 px-1" title="備份">💾</button>
            <button onClick={() => fileInputRef.current?.click()} className="text-slate-600 hover:text-slate-300 px-1" title="載入">📂</button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".json" className="hidden" />
            <LangSwitcher />
          </div>
        </header>

        {neuroToast && (
          <div className="w-full max-w-lg mb-2 px-3 py-1 bg-slate-900 border border-slate-700 text-[10px] text-slate-300 text-center font-mono">
            {neuroToast}
          </div>
        )}

        <div className="w-full max-w-lg flex gap-1 overflow-x-auto pb-1.5 mb-2 scrollbar-none border-b border-slate-900">
          {visibleMetas.map((pt) => {
            const isActive = selectedType === pt.id;
            const count = PUZZLE_CATALOG[pt.id]?.length || 0;
            return (
              <button
                key={pt.id}
                onClick={() => { setSelectedType(pt.id); setPuzzleIndex(0); }}
                disabled={count === 0}
                className={`px-2 py-1 text-[10px] whitespace-nowrap transition border ${
                  isActive
                    ? 'bg-slate-800 border-slate-500 text-white font-bold'
                    : count === 0
                    ? 'border-transparent text-slate-700 cursor-not-allowed'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                {pt.nameZh} <span className="text-[8px] opacity-40">({count})</span>
              </button>
            );
          })}
        </div>

        {activePuzzle ? (
          <section className="flex flex-col items-center w-full max-w-sm sm:max-w-md">
            {/* 包含 400ms 瞬間二進制邊框脈衝之容器 */}
            <div
              className={`w-full p-1 bg-slate-900/60 border-2 transition-all duration-150 ${
                flashFeedback === 'success'
                  ? 'border-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.45)]'
                  : flashFeedback === 'failure'
                  ? 'border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.45)]'
                  : 'border-slate-800'
              }`}
            >
              <ErrorBoundary
                FallbackComponent={EngineFallbackUI}
                resetKeys={[selectedType, activeLevel, puzzleIndex, isChildMode, isProZen]}
                onReset={() => setPuzzleIndex(0)}
              >
                <PuzzleRenderer
                  key={`${selectedType}-${activeLevel}-${puzzleIndex}-${activePuzzle.checksum}-${isChildMode}-${isProZen}`}
                  puzzle={activePuzzle}
                />
              </ErrorBoundary>
            </div>

            {/* 🕹️ 自適應虛擬搖桿（僅空間題型顯示） */}
            {isSpatialExplorationType && (
              <VirtualGamepad
                onMove={handleJoystickMove}
                onRotate={handleJoystickRotate}
                onAction={handleJoystickAction}
                actionLabel="STEP"
              />
            )}

            <div className="mt-2.5 grid grid-cols-2 gap-1.5 w-full">
              <button
                onClick={handlePrevPuzzle}
                className="py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-slate-400 hover:text-slate-200 text-[10px] font-mono border border-slate-800 transition"
              >
                ◀ 上一題 (P)
              </button>
              <button
                onClick={handleNextPuzzle}
                className="py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-[0.99] text-slate-200 hover:text-white text-[10px] font-mono border border-slate-700 transition"
              >
                下一題 ▶ (N)
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between w-full px-1 text-[9px] text-slate-600 font-mono border-t border-slate-800/60 pt-1.5">
              <div className="flex gap-3">
                <span className="text-slate-300">⏱️ {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span>
                {todayAvg !== null && (
                  <span className="text-slate-500">⚡ 今日均時: {todayAvg}s</span>
                )}
                <span className="text-slate-500">進度: {puzzleIndex + 1}/{activeList.length}</span>
              </div>
              <div className="flex gap-2 text-[8px] text-slate-500">
                <kbd className="px-1 border border-slate-800">N</kbd>下一題 
                <kbd className="px-1 border border-slate-800">P</kbd>上一題 
                <kbd className="px-1 border border-slate-800">R</kbd>隨機
              </div>
            </div>
          </section>
        ) : (
          <div className="mt-12 p-8 border border-slate-800 text-center max-w-sm font-mono">
            <p className="text-slate-500 text-xs">題庫尚未加載</p>
          </div>
        )}

        <div
          onMouseEnter={() => setShowDetail(true)}
          onMouseLeave={() => setShowDetail(false)}
          className="fixed bottom-2 left-1/2 -translate-x-1/2 z-40 cursor-help"
        >
          <div className="px-3 py-1 bg-slate-900/90 border border-slate-800 text-[8px] text-slate-500 font-mono tracking-wider">
            {showDetail ? (
              <span className="text-slate-300">
                θ: {globalRadar.spatial}s / {globalRadar.numeric}n / {globalRadar.workingMemory}w / {globalRadar.inhibition}i
                &nbsp;· 士氣 {profile.morale}x &nbsp;· 巔峰 {t.difficulty[overallPeakTier]}
              </span>
            ) : (
              <span className="text-slate-600">⏎ Hover 查看 MIRT 指標 · 鍵盤快速鍵已啟用</span>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ==========================
  // 🎨 視圖 2：沉浸神經美學模式
  // ==========================
  return (
    <main
      className="min-h-screen text-slate-100 flex flex-col items-center py-4 px-3 font-sans selection:bg-indigo-500 transition-colors duration-700 relative overflow-x-hidden"
      style={{ backgroundColor: isChildMode ? '#0c1a24' : '#0f172a' }}
    >
      <header className="w-full max-w-xl flex items-center justify-between mb-2 pb-2 border-b border-slate-800/60">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-sm font-black shadow-lg shadow-indigo-500/30">
            {isChildMode ? '🧸' : '🧠'}
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight bg-gradient-to-r from-indigo-300 via-cyan-200 to-emerald-300 bg-clip-text text-transparent leading-none">
              LogiCore
            </h1>
            <p className="text-[9px] text-slate-500 font-mono tracking-widest uppercase">
              {isChildMode ? '🌟 奇幻邏輯遊樂園' : '🔬 MIRT V7 全域競技'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsProZen(true)}
            className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-900 border border-slate-700 text-slate-300 hover:border-slate-500 transition"
            title="切換至硬核工作臺"
          >
            ⚙️ 純粹
          </button>
          <button
            onClick={() => {
              setIsChildMode(!isChildMode);
              setSelectedType('sudoku');
              setPuzzleIndex(0);
            }}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all flex items-center gap-1 border ${
              isChildMode
                ? 'bg-amber-500/20 border-amber-400 text-amber-200 shadow-amber-500/20 shadow-md'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {isChildMode ? '👶 兒童' : '👤 成人'}
          </button>

          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-mono font-bold bg-orange-950/80 border-orange-500 text-orange-300">
            <span>🔥</span>
            <span>{profile.streak} 連勝</span>
          </div>

          <button onClick={exportProfileJSON} className="p-1.5 bg-slate-900/80 border border-slate-700/60 hover:border-slate-500 rounded-lg text-[10px] text-slate-400 hover:text-white transition" title="備份">💾</button>
          <button onClick={() => fileInputRef.current?.click()} className="p-1.5 bg-slate-900/80 border border-slate-700/60 hover:border-slate-500 rounded-lg text-[10px] text-slate-400 hover:text-white transition" title="載入">📂</button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".json" className="hidden" />
          <LangSwitcher />
        </div>
      </header>

      {neuroToast && (
        <div className="w-full max-w-xl mb-2 px-4 py-2.5 bg-gradient-to-r from-indigo-950/95 to-slate-900/95 border border-indigo-500/70 rounded-2xl shadow-xl text-[11px] text-indigo-100 text-center font-medium backdrop-blur-xl animate-pulse">
          {neuroToast}
        </div>
      )}

      {!isChildMode && topSchedule && (
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

      <div className="w-full max-w-xl flex gap-1.5 overflow-x-auto pb-2 mb-2 scrollbar-none">
        {visibleMetas.map((pt) => {
          const isActive = selectedType === pt.id;
          const count = PUZZLE_CATALOG[pt.id]?.length || 0;
          return (
            <button
              key={pt.id}
              onClick={() => { setSelectedType(pt.id); setPuzzleIndex(0); }}
              disabled={count === 0}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-all flex items-center gap-1.5 border ${
                isActive
                  ? 'bg-indigo-600/90 border-indigo-400 text-white shadow-lg shadow-indigo-500/30'
                  : count === 0
                  ? 'bg-slate-900/40 border-slate-800/40 text-slate-600 cursor-not-allowed'
                  : 'bg-slate-900/60 border-slate-700/60 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
              }`}
            >
              <span>{pt.icon}</span>
              <span>{pt.nameZh}</span>
              <span className="text-[8px] opacity-50">({count})</span>
            </button>
          );
        })}
      </div>

      {!isChildMode && (
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
      )}

      {activePuzzle ? (
        <section className="flex flex-col items-center w-full max-w-md sm:max-w-lg">
          <div
            className={`w-full p-2 bg-white/5 backdrop-blur-md rounded-3xl border transition-all duration-150 ${
              flashFeedback === 'success'
                ? 'border-emerald-400 shadow-[0_0_25px_rgba(52,211,153,0.5)]'
                : flashFeedback === 'failure'
                ? 'border-rose-500 shadow-[0_0_25px_rgba(244,63,94,0.5)]'
                : 'border-white/5 shadow-2xl shadow-indigo-500/10'
            }`}
          >
            <ErrorBoundary
              FallbackComponent={EngineFallbackUI}
              resetKeys={[selectedType, activeLevel, puzzleIndex, isChildMode, isProZen]}
              onReset={() => setPuzzleIndex(0)}
            >
              <PuzzleRenderer
                key={`${selectedType}-${activeLevel}-${puzzleIndex}-${activePuzzle.checksum}-${isChildMode}-${isProZen}`}
                puzzle={activePuzzle}
              />
            </ErrorBoundary>
          </div>

          {/* 🕹️ 自適應虛擬搖桿（僅空間題型顯示） */}
          {isSpatialExplorationType && (
            <VirtualGamepad
              onMove={handleJoystickMove}
              onRotate={handleJoystickRotate}
              onAction={handleJoystickAction}
              actionLabel="TRIGGER"
            />
          )}

          <div className="mt-4 grid grid-cols-2 gap-2.5 w-full">
            <button
              onClick={handleNextPuzzle}
              className="py-3.5 bg-slate-900/90 hover:bg-slate-800 active:scale-[0.98] text-slate-300 hover:text-white rounded-2xl text-xs font-bold shadow-md transition-all border border-slate-700/60 flex items-center justify-center gap-1.5"
            >
              <span>🎲 輕鬆探索</span>
              <span className="text-[10px] opacity-50 font-mono">({puzzleIndex + 1}/{activeList.length})</span>
            </button>

            <button
              onClick={handleExpedition}
              className="py-3.5 bg-gradient-to-r from-cyan-600 via-indigo-600 to-violet-600 hover:from-cyan-500 hover:to-indigo-500 active:scale-[0.98] text-white rounded-2xl text-xs font-bold shadow-xl shadow-cyan-600/25 transition-all border border-cyan-400/30 flex items-center justify-center gap-1.5"
            >
              <span>🗺️ 未知領域</span>
              <span className="text-[10px] opacity-75">探索推薦 ↗</span>
            </button>
          </div>

          <div className="mt-2 text-[9px] text-slate-500 font-mono tracking-wider">
            {isZPDMode ? `🧠 智能階梯 · ${tierNames[activeLevel]}` : `🎛️ 手動探索 · ${tierNames[activeLevel]}`}
          </div>
        </section>
      ) : (
        <div className="mt-12 p-10 border border-dashed border-slate-800/60 rounded-3xl text-center max-w-sm backdrop-blur-sm bg-slate-900/30">
          <p className="text-indigo-400 text-3xl mb-2">{currentMeta.icon}</p>
          <p className="text-slate-300 text-sm font-semibold">{currentMeta.nameZh} 題庫準備中</p>
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
