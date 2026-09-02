// web-frontend/src/App.tsx
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { AccessibilityProvider, useAccessibility } from './contexts/AccessibilityContext';
import { PuzzleRenderer } from './registry/RendererRegistry';
import { PUZZLE_CATALOG, PuzzleEntity, CognitiveLoadVector } from './generated';
import { LangSwitcher } from './components/LangSwitcher';
import { VirtualGamepad } from './components/VirtualGamepad';
import { useLearnerProfile, TierKey, CognitiveDimension, LearnerPersona } from './hooks/useLearnerProfile';
import { useLongTermScheduler } from './hooks/useLongTermScheduler';
import { WebMazeGenerator } from './engines/mazeGenerator';

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

export const LEVEL_KEYS: TierKey[] = ['kids', 'intermediate', 'expert', 'master'];

const TIER_NAMES_PRO_ZH: Record<TierKey, string> = {
  kids: '資優啟蒙',
  intermediate: '進階突破',
  expert: '錦標專家',
  master: '深淵魔王',
};

const TIER_NAMES_PRO_EN: Record<TierKey, string> = {
  kids: 'Gifted Talent',
  intermediate: 'Advance',
  expert: 'Expert',
  master: 'Grandmaster',
};

const TIER_NAMES_CHILD_ZH: Record<TierKey, string> = {
  kids: '🌱 資優小幼苗',
  intermediate: '🌲 森林探險家',
  expert: '🏰 迷宮大騎士',
  master: '👑 奧賽大宗師',
};

const TIER_NAMES_CHILD_EN: Record<TierKey, string> = {
  kids: '🌱 Gifted Junior',
  intermediate: '🌲 Explorer',
  expert: '🏰 Maze Knight',
  master: '👑 Grandmaster',
};

const PERSONA_BADGE: Record<LearnerPersona, { icon: string; zh: string; en: string; color: string }> = {
  explorer: { icon: '🧭', zh: '直覺冒險型', en: 'Explorer', color: 'text-amber-400 border-amber-500/50 bg-amber-950/60' },
  deliberate: { icon: '🧠', zh: '審慎推演型', en: 'Deliberate', color: 'text-cyan-400 border-cyan-500/50 bg-cyan-950/60' },
  struggler: { icon: '🌱', zh: '突破成長型', en: 'Growth', color: 'text-emerald-400 border-emerald-500/50 bg-emerald-950/60' },
  neutral: { icon: '⚖️', zh: '標準自適應', en: 'Adaptive', color: 'text-slate-400 border-slate-700 bg-slate-900/60' },
};

const CHILD_SAFE_IDS = new Set(['maze', 'hashi', 'sudoku', 'jigsaw']);

const EngineFallbackUI: React.FC<{ resetErrorBoundary: () => void }> = ({ resetErrorBoundary }) => (
  <div className="flex flex-col items-center justify-center p-6 bg-red-950/40 border border-red-800 text-center my-4 font-mono">
    <p className="text-red-300 text-xs">Render Exception Occurred</p>
    <button
      onClick={resetErrorBoundary}
      className="mt-3 px-3 py-1 bg-red-900/60 hover:bg-red-800 text-red-100 text-[10px] border border-red-700"
    >
      Retry
    </button>
  </div>
);

const MainDashboard: React.FC = () => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { settings, toggleFocusMode } = useAccessibility();

  const {
    profile,
    persona,
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

  const [isProZen, setIsProZen] = useState<boolean>(true);
  const [isChildMode, setIsChildMode] = useState<boolean>(false);
  const [selectedType, setSelectedType] = useState<string>('maze');
  const [currentLevel, setCurrentLevel] = useState<TierKey>('kids');
  const [puzzleIndex, setPuzzleIndex] = useState<number>(0);
  const [isZPDMode, setIsZPDMode] = useState<boolean>(false);
  const [showDetail, setShowDetail] = useState<boolean>(false);
  const [neuroToast, setNeuroToast] = useState<string | null>(null);

  // ⚡ 開機自動為迷宮 4 個階梯各算 25 題（共 100 題，含 50 題專家與宗師級）
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

  const [elapsed, setElapsed] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [flashFeedback, setFlashFeedback] = useState<'success' | 'failure' | null>(null);

  const isSpatialExplorationType = selectedType === 'maze' || selectedType === 'skyscraper';

  const visibleMetas = useMemo(() => {
    if (!isChildMode) return PUZZLE_METAS;
    return PUZZLE_METAS.filter((m) => CHILD_SAFE_IDS.has(m.id));
  }, [isChildMode]);

  // 合併靜態題庫與現場即時生成題庫
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

  const todayAvg = useMemo(() => {
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const todaySuccesses = profile.history.filter((h) => h.isSuccess && h.timestamp >= startOfToday);
    if (todaySuccesses.length === 0) return null;
    const avg = todaySuccesses.reduce((s, h) => s + h.timeSpentSec, 0) / todaySuccesses.length;
    return Math.round(avg);
  }, [profile.history]);

  useEffect(() => {
    if (profile.history.length === 0) return;
    const last = profile.history[profile.history.length - 1];
    if (Date.now() - last.timestamp < 2000) {
      setFlashFeedback(last.isSuccess ? 'success' : 'failure');
      const timer = setTimeout(() => setFlashFeedback(null), 400);
      return () => clearTimeout(timer);
    }
  }, [profile.history]);

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

  // ⚡ 核心功能：前端現場無限生成題目
  const handleLiveGenerate = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(20);
    if (selectedType === 'maze') {
      const newPuzzle = WebMazeGenerator.generate(activeLevel);
      setDynamicPuzzles((prev) => {
        const list = prev['maze'] || [];
        return { ...prev, maze: [newPuzzle, ...list] };
      });
      setPuzzleIndex(0);
      setNeuroToast(isEn ? '⚡ Brand new procedural maze generated!' : '⚡ 現場即時演算迷宮生成完畢！');
      setTimeout(() => setNeuroToast(null), 2500);
    } else {
      setNeuroToast(isEn ? '⚡ Generator for this type is compiling...' : '⚡ 此題型前端即時生成器編譯中...');
      setTimeout(() => setNeuroToast(null), 2500);
    }
  }, [selectedType, activeLevel, isEn]);

  const handleExpedition = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(15);
    const targetMeta = visibleMetas.find(
      (m) => m.primaryDimension === weakestDimension && (PUZZLE_CATALOG[m.id]?.length || 0) > 0
    );

    if (targetMeta && targetMeta.id !== selectedType) {
      setSelectedType(targetMeta.id);
      setPuzzleIndex(0);
      setNeuroToast(
        isEn
          ? `🧭 Loading targeted training: [${targetMeta.nameEn}]`
          : `🧭 載入最弱迴路訓練【${targetMeta.nameZh}】`
      );
    } else {
      setPuzzleIndex((prev) => (prev + 1) % (activeList.length || 1));
    }
    setTimeout(() => setNeuroToast(null), 3500);
  }, [visibleMetas, weakestDimension, selectedType, activeList.length, isEn]);

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
      window.dispatchEvent(
        new CustomEvent('logicore:joystick-move', { detail: { dx, dy } })
      );
    }
  }, []);

  const handleJoystickRotate = useCallback((x: number, y: number) => {}, []);
  const handleJoystickAction = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(15);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault();
          handleNextPuzzle();
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          handlePrevPuzzle();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          handleRandomPuzzle();
          break;
        case 'g':
        case 'G':
          e.preventDefault();
          handleLiveGenerate();
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
  }, [handleNextPuzzle, handlePrevPuzzle, handleRandomPuzzle, handleLiveGenerate]);

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
          setNeuroToast(isEn ? '🧠 Profile Loaded' : '🧠 檔案載入成功');
        } else {
          setNeuroToast(isEn ? '⚠️ Format Error' : '⚠️ 格式錯誤');
        }
        setTimeout(() => setNeuroToast(null), 2500);
      };
      reader.readAsText(file);
    }
  };

  const tierNames = isChildMode
    ? (isEn ? TIER_NAMES_CHILD_EN : TIER_NAMES_CHILD_ZH)
    : (isEn ? TIER_NAMES_PRO_EN : TIER_NAMES_PRO_ZH);

  const activePersonaBadge = PERSONA_BADGE[persona] || PERSONA_BADGE.neutral;

  // ==========================
  // ⚙️ 視圖 1：純粹賽道工作臺 (Pro Zen Track Mode)
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
              {isEn ? currentMeta.nameEn : currentMeta.nameZh}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[10px]">
            {/* 🧠 認知特質徽章 */}
            <div
              className={`px-1.5 py-0.5 rounded border text-[9px] font-bold flex items-center gap-1 ${activePersonaBadge.color}`}
              title={isEn ? `Cognitive Persona: ${activePersonaBadge.en}` : `認知特質：${activePersonaBadge.zh}`}
            >
              <span>{activePersonaBadge.icon}</span>
              <span className="hidden sm:inline">{isEn ? activePersonaBadge.en : activePersonaBadge.zh}</span>
            </div>

            {/* 🎯 專注模式開關 */}
            <button
              onClick={toggleFocusMode}
              className={`px-1.5 py-0.5 border rounded text-[9px] transition ${
                settings.focusMode
                  ? 'bg-indigo-950 border-indigo-400 text-indigo-200 font-bold'
                  : 'border-slate-800 text-slate-500 hover:text-slate-300'
              }`}
              title={isEn ? 'Toggle Neurodivergent Focus Mode' : '切換神經多樣性專注模式'}
            >
              {settings.focusMode ? '🎯 專注' : '👁️ 常規'}
            </button>

            {profile.streak > 0 && (
              <span className="text-amber-400 font-bold mr-1">
                🔥{profile.streak}
              </span>
            )}
            <button
              onClick={() => setIsProZen(false)}
              className="text-slate-500 hover:text-slate-300 px-1.5 py-0.5 border border-slate-800 hover:border-slate-600 transition text-[9px]"
            >
              {isEn ? '🎨 Visual' : '🎨 沉浸'}
            </button>
            <button
              onClick={() => {
                setIsChildMode(!isChildMode);
                setSelectedType('sudoku');
                setPuzzleIndex(0);
              }}
              className="text-slate-500 hover:text-slate-300 px-1.5 py-0.5 border border-slate-800 hover:border-slate-600 transition text-[9px]"
            >
              {isChildMode ? (isEn ? 'Junior' : '資優') : (isEn ? 'Pro' : '常規')}
            </button>
            <button onClick={exportProfileJSON} className="text-slate-600 hover:text-slate-300 px-1">💾</button>
            <button onClick={() => fileInputRef.current?.click()} className="text-slate-600 hover:text-slate-300 px-1">📂</button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".json" className="hidden" />
            <LangSwitcher />
          </div>
        </header>

        {neuroToast && (
          <div className="w-full max-w-lg mb-2 px-3 py-1 bg-slate-900 border border-slate-700 text-[10px] text-slate-300 text-center font-mono">
            {neuroToast}
          </div>
        )}

        {/* 題型橫列 */}
        <div className="w-full max-w-lg flex gap-1 overflow-x-auto pb-1.5 mb-1.5 scrollbar-none border-b border-slate-900">
          {visibleMetas.map((pt) => {
            const isActive = selectedType === pt.id;
            const count = (PUZZLE_CATALOG[pt.id]?.length || 0) + (dynamicPuzzles[pt.id]?.length || 0);
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
                {isEn ? pt.nameEn : pt.nameZh} <span className="text-[8px] opacity-40">({count})</span>
              </button>
            );
          })}
        </div>

        {/* 4 階難度選擇列 */}
        <div className="w-full max-w-lg flex items-center justify-between gap-1 mb-2 px-0.5">
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {LEVEL_KEYS.map((tierKey) => {
              const isSelected = activeLevel === tierKey;
              const count = filteredPuzzles[tierKey]?.length || 0;
              return (
                <button
                  key={tierKey}
                  onClick={() => {
                    setIsZPDMode(false);
                    setCurrentLevel(tierKey);
                    setPuzzleIndex(0);
                  }}
                  disabled={count === 0}
                  className={`px-1.5 py-0.5 text-[9px] font-mono border transition ${
                    isSelected
                      ? 'bg-indigo-700 border-indigo-400 text-white font-bold shadow'
                      : count === 0
                      ? 'border-slate-900 text-slate-800 cursor-not-allowed'
                      : 'border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tierNames[tierKey]} ({count})
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setIsZPDMode(!isZPDMode)}
            className={`px-1.5 py-0.5 text-[8px] font-mono border whitespace-nowrap transition ${
              isZPDMode
                ? 'bg-emerald-950 border-emerald-500 text-emerald-300 font-bold'
                : 'border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            {isZPDMode ? '🧠 ZPD' : '🎛️ 手動'}
          </button>
        </div>

        {activePuzzle ? (
          <section className="flex flex-col items-center w-full max-w-sm sm:max-w-md">
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

            {isSpatialExplorationType && (
              <VirtualGamepad
                onMove={handleJoystickMove}
                onRotate={handleJoystickRotate}
                onAction={handleJoystickAction}
                actionLabel={isEn ? "STEP" : "動作"}
              />
            )}

            {/* 3 欄操作控制：上一題 / ⚡ 現場生成 / 下一題 */}
            <div className="mt-2.5 grid grid-cols-3 gap-1.5 w-full">
              <button
                onClick={handlePrevPuzzle}
                className="py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-slate-400 hover:text-slate-200 text-[10px] font-mono border border-slate-800 transition rounded"
              >
                {isEn ? '◀ Prev (P)' : '◀ 上一題 (P)'}
              </button>
              <button
                onClick={handleLiveGenerate}
                className="py-2.5 bg-cyan-950/80 hover:bg-cyan-900/80 active:scale-[0.98] text-cyan-300 hover:text-cyan-100 font-bold text-[10px] font-mono border border-cyan-700/60 shadow transition rounded flex items-center justify-center gap-1"
                title={isEn ? "Generate new maze dynamically (G)" : "現場即時演算新迷宮 (G)"}
              >
                <span>⚡</span>
                <span>{isEn ? 'Generate' : '現場生成'}</span>
              </button>
              <button
                onClick={handleNextPuzzle}
                className="py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-[0.99] text-slate-200 hover:text-white text-[10px] font-mono border border-slate-700 transition rounded"
              >
                {isEn ? 'Next ▶ (N)' : '下一題 ▶ (N)'}
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between w-full px-1 text-[9px] text-slate-600 font-mono border-t border-slate-800/60 pt-1.5">
              <div className="flex gap-3">
                <span className="text-slate-300">⏱️ {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span>
                {todayAvg !== null && (
                  <span className="text-slate-500">⚡ {isEn ? 'Avg' : '今日均時'}: {todayAvg}s</span>
                )}
                <span className="text-slate-500">{isEn ? 'Progress' : '進度'}: {puzzleIndex + 1}/{activeList.length}</span>
              </div>
              <div className="flex gap-2 text-[8px] text-slate-500">
                <kbd className="px-1 border border-slate-800">G</kbd>{isEn ? 'Gen' : '生成'}
                <kbd className="px-1 border border-slate-800">N</kbd>{isEn ? 'Next' : '下一題'} 
                <kbd className="px-1 border border-slate-800">P</kbd>{isEn ? 'Prev' : '上一題'} 
              </div>
            </div>
          </section>
        ) : (
          <div className="mt-12 p-8 border border-slate-800 text-center max-w-sm font-mono">
            <p className="text-slate-500 text-xs">{isEn ? 'No puzzles in this tier' : '本階梯暫無題目'}</p>
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
                &nbsp;· {isEn ? 'Morale' : '士氣'} {profile.morale}x
              </span>
            ) : (
              <span className="text-slate-600">{isEn ? '⏎ Hover for MIRT Stats · Shortcuts Enabled' : '⏎ Hover 查看 MIRT 指標 · 鍵盤快速鍵已啟用'}</span>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ==========================
  // 🎨 視圖 2：沉浸視覺模式
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
              {isChildMode ? (isEn ? '🌟 Gifted Junior' : '🌟 資優邏輯挑戰') : (isEn ? '🔬 MIRT V7 Arena' : '🔬 MIRT V7 全域競技')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* 🧠 認知特質徽章 */}
          <div
            className={`px-2.5 py-1 rounded-full border text-[10px] font-mono font-bold flex items-center gap-1 ${activePersonaBadge.color}`}
            title={isEn ? `Cognitive Persona: ${activePersonaBadge.en}` : `認知特質：${activePersonaBadge.zh}`}
          >
            <span>{activePersonaBadge.icon}</span>
            <span>{isEn ? activePersonaBadge.en : activePersonaBadge.zh}</span>
          </div>

          {/* 🎯 專注模式開關 */}
          <button
            onClick={toggleFocusMode}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all border ${
              settings.focusMode
                ? 'bg-indigo-600/90 border-indigo-400 text-white shadow-md shadow-indigo-500/30'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {settings.focusMode ? '🎯 專注' : '👁️ 常規'}
          </button>

          <button
            onClick={() => setIsProZen(true)}
            className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-900 border border-slate-700 text-slate-300 hover:border-slate-500 transition"
          >
            {isEn ? '⚙️ Pro Zen' : '⚙️ 純粹'}
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
            {isChildMode ? (isEn ? '👶 Junior' : '👶 資優') : (isEn ? '👤 Pro' : '👤 常規')}
          </button>

          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-mono font-bold bg-orange-950/80 border-orange-500 text-orange-300">
            <span>🔥</span>
            <span>{profile.streak} {isEn ? 'Wins' : '連勝'}</span>
          </div>

          <button onClick={exportProfileJSON} className="p-1.5 bg-slate-900/80 border border-slate-700/60 hover:border-slate-500 rounded-lg text-[10px] text-slate-400 hover:text-white transition">💾</button>
          <button onClick={() => fileInputRef.current?.click()} className="p-1.5 bg-slate-900/80 border border-slate-700/60 hover:border-slate-500 rounded-lg text-[10px] text-slate-400 hover:text-white transition">📂</button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".json" className="hidden" />
          <LangSwitcher />
        </div>
      </header>

      {/* 題型橫列 */}
      <div className="w-full max-w-xl flex gap-1.5 overflow-x-auto pb-2 mb-1.5 scrollbar-none">
        {visibleMetas.map((pt) => {
          const isActive = selectedType === pt.id;
          const count = (PUZZLE_CATALOG[pt.id]?.length || 0) + (dynamicPuzzles[pt.id]?.length || 0);
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
              <span>{isEn ? pt.nameEn : pt.nameZh}</span>
              <span className="text-[8px] opacity-50">({count})</span>
            </button>
          );
        })}
      </div>

      {/* 4 階難度選擇膠囊 */}
      <div className="w-full max-w-xl flex items-center justify-between gap-1 mb-3 px-1">
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {LEVEL_KEYS.map((tierKey) => {
            const isSelected = activeLevel === tierKey;
            const count = filteredPuzzles[tierKey]?.length || 0;
            return (
              <button
                key={tierKey}
                onClick={() => {
                  setIsZPDMode(false);
                  setCurrentLevel(tierKey);
                  setPuzzleIndex(0);
                }}
                disabled={count === 0}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all border ${
                  isSelected
                    ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 border-cyan-400 text-white shadow-md shadow-indigo-500/20'
                    : count === 0
                    ? 'bg-slate-900/40 border-slate-800/40 text-slate-700 cursor-not-allowed'
                    : 'bg-slate-900/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                {tierNames[tierKey]} ({count})
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setIsZPDMode(!isZPDMode)}
          className={`px-2 py-1 rounded-full text-[9px] font-mono border whitespace-nowrap transition ${
            isZPDMode
              ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300 font-bold'
              : 'bg-slate-900/60 border-slate-700 text-slate-400 hover:text-slate-200'
          }`}
        >
          {isZPDMode ? '🧠 ZPD 自適應' : '🎛️ 手動'}
        </button>
      </div>

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

          {isSpatialExplorationType && (
            <VirtualGamepad
              onMove={handleJoystickMove}
              onRotate={handleJoystickRotate}
              onAction={handleJoystickAction}
              actionLabel={isEn ? "TRIGGER" : "觸發"}
            />
          )}

          <div className="mt-4 grid grid-cols-3 gap-2 w-full">
            <button
              onClick={handlePrevPuzzle}
              className="py-3 bg-slate-900/90 hover:bg-slate-800 active:scale-[0.98] text-slate-300 hover:text-white rounded-2xl text-xs font-bold shadow-md transition-all border border-slate-700/60 flex items-center justify-center"
            >
              <span>{isEn ? '◀ Prev' : '◀ 上一題'}</span>
            </button>

            <button
              onClick={handleLiveGenerate}
              className="py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] text-white rounded-2xl text-xs font-bold shadow-lg shadow-emerald-600/30 transition-all border border-emerald-400/40 flex items-center justify-center gap-1"
            >
              <span>⚡</span>
              <span>{isEn ? 'Generate' : '現場生成'}</span>
            </button>

            <button
              onClick={handleNextPuzzle}
              className="py-3 bg-slate-900/90 hover:bg-slate-800 active:scale-[0.98] text-slate-300 hover:text-white rounded-2xl text-xs font-bold shadow-md transition-all border border-slate-700/60 flex items-center justify-center"
            >
              <span>{isEn ? 'Next ▶' : '下一題 ▶'}</span>
            </button>
          </div>
        </section>
      ) : (
        <div className="mt-12 p-10 border border-dashed border-slate-800/60 rounded-3xl text-center max-w-sm backdrop-blur-sm bg-slate-900/30">
          <p className="text-indigo-400 text-3xl mb-2">{currentMeta.icon}</p>
          <p className="text-slate-300 text-sm font-semibold">{isEn ? currentMeta.nameEn : currentMeta.nameZh} {isEn ? 'No puzzles in this tier' : '本階梯暫無題目'}</p>
        </div>
      )}
    </main>
  );
};

export default function App() {
  return (
    <LanguageProvider>
      <AccessibilityProvider>
        <MainDashboard />
      </AccessibilityProvider>
    </LanguageProvider>
  );
}
