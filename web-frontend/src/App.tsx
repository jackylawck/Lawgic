import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { AccessibilityProvider, useAccessibility } from './contexts/AccessibilityContext';
import { PuzzleRenderer, CognitiveDashboard } from './registry/RendererRegistry';
import { PuzzleEntity } from './generated';
import { LangSwitcher } from './components/LangSwitcher';
import { VirtualGamepad } from './components/VirtualGamepad';
import { ComplianceModal } from './components/ComplianceModal';
import { useLearnerProfile, ExtendedTierKey } from './hooks/useLearnerProfile';
import { useLongTermScheduler } from './hooks/useLongTermScheduler';
import { PUZZLE_CATALOG } from './generated';
import { usePuzzlePool, VALID_TIERS } from './hooks/usePuzzlePool';
import { useGlobalHotkeys } from './hooks/useGlobalHotkeys';
import { VaultManager } from './utils/vaultStorage';
import { EventBus } from './events/bus';
import { useT } from './locales';

interface PuzzleMeta {
  id: string;
  nameZh: string;
  nameEn: string;
  icon: string;
}

const ALL_GAMES: PuzzleMeta[] = [
  { id: 'maze', nameZh: '空間迷宮', nameEn: 'Maze', icon: '🌀' },
  { id: 'sudoku', nameZh: '數獨魔陣', nameEn: 'Sudoku', icon: '🔢' },
  { id: 'nonogram', nameZh: '像素數織', nameEn: 'Nonogram', icon: '🎨' },
  { id: 'nurikabe', nameZh: '暗夜數牆', nameEn: 'Nurikabe', icon: '🧱' },
  { id: 'skyscraper', nameZh: '摩天透視', nameEn: 'Skyscraper', icon: '🏢' },
  { id: 'hashi', nameZh: '星際數橋', nameEn: 'Hashi', icon: '🌉' },
  { id: 'kropki', nameZh: '黑白雙星', nameEn: 'Kropki', icon: '⚪' },
  { id: 'slitherlink', nameZh: '迴路封閉', nameEn: 'Slitherlink', icon: '➰' },
  { id: 'tents', nameZh: '帳篷扎營', nameEn: 'Tents & Trees', icon: '⛺' },
  { id: 'lightup', nameZh: '燈泡照明', nameEn: 'Light Up', icon: '💡' },
  { id: 'kakuro', nameZh: '數和密碼', nameEn: 'Kakuro', icon: '➕' },
  { id: 'hitori', nameZh: '孤島數壹', nameEn: 'Hitori', icon: '⬛' },
  { id: 'futoshiki', nameZh: '天平不等', nameEn: 'Futoshiki', icon: '⚖️' },
  { id: 'masyu', nameZh: '珍珠迴路', nameEn: 'Masyu', icon: '⚪' },
  { id: 'dominoes', nameZh: '骨牌矩陣', nameEn: 'Dominoes', icon: '🀄' },
  { id: 'heyawake', nameZh: '連環分室', nameEn: 'Heyawake', icon: '🚪' },
  { id: 'yajilin', nameZh: '矢印迴路', nameEn: 'Yajilin', icon: '🧭' },
  { id: 'shikaku', nameZh: '四角分割', nameEn: 'Shikaku', icon: '📐' },
];

export const LEVEL_KEYS: ExtendedTierKey[] = VALID_TIERS;

const EngineFallbackUI: React.FC<{ resetErrorBoundary: () => void; error?: Error }> = ({ resetErrorBoundary, error }) => {
  const isChunkError =
    error?.message?.includes('Failed to fetch dynamically imported module') ||
    error?.message?.includes('Loading chunk');

  const handleReload = () => {
    if ('caches' in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
    window.location.reload();
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-red-950/40 border border-red-800 text-center my-4 font-mono rounded-xl max-w-md w-full">
      <p className="text-red-300 text-xs font-bold uppercase tracking-wider">
        {isChunkError ? '版本已更新 / New Version Available' : '載入異常 / Render Error'}
      </p>
      {error?.message && (
        <p className="text-red-400/80 text-[10px] mt-1 break-all px-2 font-mono">{error.message}</p>
      )}
      <div className="flex gap-2 mt-3">
        <button
          onClick={handleReload}
          className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded transition cursor-pointer"
        >
          重新載入最新版本 / Reload
        </button>
        <button
          onClick={resetErrorBoundary}
          className="px-3 py-1 bg-red-900/60 hover:bg-red-800 text-red-100 text-[10px] border border-red-700 rounded transition cursor-pointer"
        >
          重試 / Retry
        </button>
      </div>
    </div>
  );
};

const PuzzleTimer: React.FC<{ activeId: string | undefined }> = memo(({ activeId }) => {
  const [elapsed, setElapsed] = useState<number>(0);

  useEffect(() => {
    setElapsed(0);
    const interval = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, [activeId]);

  return (
    <span>
      ⏱️ {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
    </span>
  );
});
PuzzleTimer.displayName = 'PuzzleTimer';

const MainDashboard: React.FC = () => {
  const t = useT();
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const { playSound } = useAccessibility();
  const { profile, getCompositeCognitiveIndex } = useLearnerProfile();
  const { getRecommendedSchedulePuzzle } = useLongTermScheduler(profile, PUZZLE_CATALOG);

  const [selectedType, setSelectedType] = useState<string>('maze');
  const [currentLevel, setCurrentLevel] = useState<ExtendedTierKey>('kids');
  const [tournamentMode, setTournamentMode] = useState<boolean>(false);
  const [showDashboardModal, setShowDashboardModal] = useState<boolean>(false);
  const [showComplianceModal, setShowComplianceModal] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // ── PWA 生命週期受控更新 ──
  const [hasUpdate, setHasUpdate] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const boardContainerRef = useRef<HTMLDivElement>(null);
  const lastMoveTimeRef = useRef<number>(0);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((msg: string, duration = 2500) => {
    clearTimeout(toastTimeoutRef.current);
    setToastMsg(msg);
    toastTimeoutRef.current = setTimeout(() => setToastMsg(null), duration);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(toastTimeoutRef.current);
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return EventBus.on('update-available', () => {
      setHasUpdate(true);
    });
  }, []);

  const handleApplyUpdate = useCallback(async () => {
    if (isUpdating) return;
    setIsUpdating(true);

    const controllerChangeHandler = () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      window.location.reload();
    };

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.waiting) {
          navigator.serviceWorker.addEventListener(
            'controllerchange',
            controllerChangeHandler,
            { once: true }
          );

          reg.waiting.postMessage({ type: 'SKIP_WAITING' });

          fallbackTimerRef.current = setTimeout(() => {
            console.warn('[PWA] Fallback timer expired. Forcing reload.');
            window.location.reload();
          }, 3000);
          return;
        }
      }
      window.location.reload();
    } catch (e) {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      console.warn('[PWA] Update dispatch failed:', e);
      setIsUpdating(false);
      window.location.reload();
    }
  }, [isUpdating]);

  const handleChallengeLoaded = useCallback((imported: PuzzleEntity) => {
    setSelectedType(imported.engine_type);
    setCurrentLevel(imported.tier as ExtendedTierKey);
    const gameMeta = ALL_GAMES.find((g) => g.id === imported.engine_type);
    const name = gameMeta ? (isEn ? gameMeta.nameEn : gameMeta.nameZh) : 'Puzzle';
    showToast(t.toast.challengeLoaded(name, imported.metrics?.irt_logit_difficulty || '1.0'), 3000);
  }, [t, isEn, showToast]);

  const {
    activeList,
    activePuzzle,
    puzzleIndex,
    setPuzzleIndex,
    isGenerating,
    triggerManualGenerate,
  } = usePuzzlePool(selectedType, currentLevel, handleChallengeLoaded);

  const handlePrevPuzzle = useCallback(() => {
    if (activeList.length === 0) return;
    playSound('step');
    if (navigator.vibrate) navigator.vibrate(8);
    setPuzzleIndex((prev) => (prev - 1 + activeList.length) % activeList.length);
    boardContainerRef.current?.focus();
  }, [activeList.length, playSound, setPuzzleIndex]);

  const handleNextPuzzle = useCallback(() => {
    if (activeList.length === 0) return;
    playSound('step');
    if (navigator.vibrate) navigator.vibrate(10);
    setPuzzleIndex((prev) => (prev + 1) % activeList.length);
    boardContainerRef.current?.focus();
  }, [activeList.length, playSound, setPuzzleIndex]);

  const handleLiveGenerate = useCallback(async () => {
    if (tournamentMode) return;
    playSound('click');
    if (navigator.vibrate) navigator.vibrate(20);
    const success = await triggerManualGenerate();
    if (success) showToast(t.toast.dynamicSynthesized);
    boardContainerRef.current?.focus();
  }, [tournamentMode, playSound, triggerManualGenerate, showToast, t]);

  useGlobalHotkeys({
    onPrev: handlePrevPuzzle,
    onNext: handleNextPuzzle,
    onGenerate: handleLiveGenerate,
    onToggleTournament: () => setTournamentMode((prev) => !prev),
    disabled: showDashboardModal || showComplianceModal,
  });

  useEffect(() => {
    return EventBus.on('navigate-game', (detail) => {
      if (!detail.gameId && !detail.tier) return;
      if (detail.gameId) setSelectedType(detail.gameId);
      if (detail.tier) setCurrentLevel(detail.tier);
      setPuzzleIndex(0);
    });
  }, [setPuzzleIndex]);

  useEffect(() => {
    const activeGame = ALL_GAMES.find((g) => g.id === selectedType);
    const gameName = activeGame ? (isEn ? activeGame.nameEn : activeGame.nameZh) : 'Cognitive Arena';
    const tierName = t.tiers[currentLevel];
    document.title = `${gameName} [${tierName}] | ${t.status.titleSuffix}`;
  }, [selectedType, currentLevel, isEn, t]);

  const handleTierJump = useCallback(
    (steps: number) => {
      playSound('hint');
      if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
      const currentIdx = LEVEL_KEYS.indexOf(currentLevel);
      const targetIdx = Math.max(0, Math.min(LEVEL_KEYS.length - 1, currentIdx + steps));
      if (targetIdx !== currentIdx) {
        setCurrentLevel(LEVEL_KEYS[targetIdx]);
        setPuzzleIndex(0);
      }
    },
    [currentLevel, playSound, setPuzzleIndex]
  );

  const handleSmartDrill = useCallback(() => {
    const recommendation = getRecommendedSchedulePuzzle();
    if (recommendation) {
      playSound('hint');
      setSelectedType(recommendation.type);
      setCurrentLevel(recommendation.tier);
      setPuzzleIndex(0);
      showToast(`🎯 ${recommendation.reason}`, 3500);
    }
  }, [getRecommendedSchedulePuzzle, playSound, setPuzzleIndex, showToast]);

  const handleShareVaultBadge = useCallback(() => {
    if (!activePuzzle) return;
    playSound('success');
    const badge = VaultManager.generateAsciiBadge({
      engine: activePuzzle.engine_type,
      tier: currentLevel,
      seed: activePuzzle.puzzle?.seed || 1000,
      steps: activePuzzle.metrics?.human_sim_steps || 24,
      timeSpentSec: activePuzzle.metrics?.estimated_time_sec || 60,
      iq: Math.round(100 + (activePuzzle.metrics?.irt_logit_difficulty || 1.0) * 15),
    });

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(badge)
        .then(() => showToast(t.toast.badgeCopied))
        .catch(() => showToast(t.toast.clipboardDenied));
    } else {
      showToast(t.toast.clipboardUnsupported);
    }
  }, [activePuzzle, currentLevel, playSound, showToast, t]);

  const handleJoystickMove = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - lastMoveTimeRef.current < 150) return;

    const threshold = 0.45;
    let dx = 0;
    let dy = 0;
    if (x > threshold) dx = 1;
    else if (x < -threshold) dx = -1;
    if (y > threshold) dy = 1;
    else if (y < -threshold) dy = -1;

    if (dx !== 0 || dy !== 0) {
      lastMoveTimeRef.current = now;
      EventBus.emit('joystick-move', { dx, dy });
    }
  }, []);

  const cci = getCompositeCognitiveIndex();

  return (
    <main className="min-h-screen bg-[#070a0f] text-slate-200 flex flex-col items-center py-2 px-2 font-mono selection:bg-indigo-600">
      {toastMsg && (
        <div className="fixed top-2 z-50 px-3 py-1.5 bg-cyan-600 border border-cyan-400 text-white font-bold text-xs rounded-full shadow-2xl animate-fade-in pointer-events-none">
          {toastMsg}
        </div>
      )}

      {/* PWA 智慧更新橫幅：安全區域自適應，尊重用戶主動更新權利 */}
      {hasUpdate && (
        <div className="fixed top-[max(3.75rem,calc(env(safe-area-inset-top)+0.75rem))] z-[60] flex items-center gap-2 px-3.5 py-1.5 bg-indigo-950/90 border border-indigo-500/70 text-indigo-200 text-xs font-bold rounded-full shadow-2xl backdrop-blur-md">
          <span>🚀 {isEn ? 'Engine Update Ready' : '核心演算法有新版本'}</span>
          <button
            onClick={handleApplyUpdate}
            disabled={isUpdating}
            className={`px-2.5 py-0.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-full text-[10px] font-mono transition cursor-pointer ${
              isUpdating ? 'opacity-50 cursor-wait' : ''
            }`}
          >
            {isUpdating ? (isEn ? 'Updating...' : '更新中...') : (isEn ? 'Reload' : '更新')}
          </button>
        </div>
      )}

      {isGenerating && (
        <div className="fixed top-1 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-1 bg-slate-900/95 border border-indigo-500/80 rounded-full text-indigo-300 text-[8px] font-mono shadow-2xl animate-pulse pointer-events-none">
          <div className="w-2 h-2 rounded-full border border-indigo-400 border-t-transparent animate-spin" />
          <span>🧠 {t.status.synthesizing}</span>
        </div>
      )}

      {showDashboardModal && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="relative w-full max-w-4xl bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-auto p-2 sm:p-4">
            <button
              onClick={() => setShowDashboardModal(false)}
              className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-full font-bold text-xs transition cursor-pointer"
            >
              ✕
            </button>
            <CognitiveDashboard />
          </div>
        </div>
      )}

      {/* 頂部狀態列 */}
      <div className="w-full max-w-sm sm:max-w-md flex items-center justify-between px-1 mb-1 text-[8px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowDashboardModal(true)}
            className="flex items-center gap-1 hover:text-cyan-300 transition cursor-pointer"
          >
            <span className="font-bold text-cyan-400">IQ {cci.standardIQ}</span>
            <span>(±{cci.semIQ})</span>
            <span className="text-[7px] text-indigo-400 underline">📊</span>
          </button>
          {profile.pureStreak >= 2 && (
            <span className="text-amber-300 font-bold">💎 ×{profile.pureStreak}</span>
          )}
          <button
            onClick={handleSmartDrill}
            className="px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-700/60 text-purple-300 font-bold hover:bg-purple-900 transition cursor-pointer"
          >
            ⚡ {t.actions.smartDrill}
          </button>
        </div>

        <button
          onClick={() => {
            playSound('alert');
            setTournamentMode((prev) => !prev);
          }}
          className={`px-1.5 py-0.5 rounded border transition text-[7px] font-bold cursor-pointer ${
            tournamentMode
              ? 'bg-amber-950 border-amber-500 text-amber-300 shadow-xs'
              : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
        >
          {tournamentMode ? t.status.tournamentOn : t.status.tournamentOff}
        </button>
      </div>

      {/* 主選單標頭 */}
      <header className="w-full max-w-sm sm:max-w-md flex items-center justify-between gap-1.5 mb-2 pb-1.5 border-b border-slate-800">
        <div className="flex flex-col shrink-0 leading-tight">
          <span className="text-xs font-black tracking-widest text-indigo-400">LOGICORE</span>
          <span className="text-[6.5px] font-bold text-slate-500 tracking-wider">
            {t.status.titleSuffix}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <select
            value={selectedType}
            onChange={(e) => {
              setSelectedType(e.target.value);
              setPuzzleIndex(0);
            }}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1 outline-none focus:border-indigo-500 cursor-pointer"
          >
            {ALL_GAMES.map((game) => (
              <option key={game.id} value={game.id} className="bg-slate-900 text-slate-200">
                {game.icon} {isEn ? game.nameEn : game.nameZh}
              </option>
            ))}
          </select>

          <select
            value={currentLevel}
            onChange={(e) => {
              setCurrentLevel(e.target.value as ExtendedTierKey);
              setPuzzleIndex(0);
            }}
            className="w-28 shrink-0 bg-slate-900 border border-slate-700 text-cyan-300 text-xs font-bold rounded px-2 py-1 outline-none focus:border-cyan-500 cursor-pointer"
          >
            {LEVEL_KEYS.map((tierKey) => (
              <option key={tierKey} value={tierKey} className="bg-slate-900 text-cyan-300">
                {t.tiers[tierKey]}
              </option>
            ))}
          </select>
        </div>

        <LangSwitcher />
      </header>

      {/* 核心謎題舞台 */}
      {activePuzzle ? (
        <section
          ref={boardContainerRef}
          tabIndex={-1}
          className="flex flex-col items-center w-full max-w-sm sm:max-w-md outline-none pb-4"
        >
          <div className="mb-2 grid grid-cols-3 gap-1.5 w-full">
            <button
              onClick={handlePrevPuzzle}
              className="py-2 bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-300 text-[10px] font-bold border border-slate-800 rounded-lg transition cursor-pointer shadow-sm"
            >
              {t.actions.prev}
            </button>
            <button
              onClick={handleLiveGenerate}
              disabled={tournamentMode}
              className={`py-2 text-[10px] font-bold border rounded-lg shadow-sm transition flex items-center justify-center gap-1 ${
                tournamentMode
                  ? 'bg-slate-900/50 border-slate-800 text-slate-600 cursor-not-allowed'
                  : 'bg-cyan-950 hover:bg-cyan-900 active:scale-95 text-cyan-300 border-cyan-700/60 cursor-pointer'
              }`}
            >
              <span>⚡</span>
              <span>{t.actions.generate}</span>
            </button>
            <button
              onClick={handleNextPuzzle}
              className="py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-black text-[10px] border border-indigo-400 rounded-lg shadow-md transition cursor-pointer"
            >
              {t.actions.next}
            </button>
          </div>

          <div className="w-full p-1 bg-slate-900/60 border border-slate-800 rounded-xl shadow-2xl puzzle-board">
            <ErrorBoundary
              FallbackComponent={EngineFallbackUI}
              resetKeys={[selectedType, currentLevel, puzzleIndex, activePuzzle.id]}
            >
              <PuzzleRenderer
                key={`${selectedType}-${currentLevel}-${puzzleIndex}-${activePuzzle.id}`}
                puzzle={activePuzzle}
                tournamentMode={tournamentMode}
              />
            </ErrorBoundary>
          </div>

          {selectedType === 'maze' && (
            <VirtualGamepad
              onMove={handleJoystickMove}
              onRotate={(x, y) => EventBus.emit('joystick-look', { x, y })}
              onAction={() => EventBus.emit('joystick-action')}
              actionLabel={t.actions.mark}
            />
          )}

          {/* 雙向升降階調整通道 */}
          <div className="flex gap-1.5 mt-2 w-full">
            {currentLevel !== 'kids' && (
              <button
                onClick={() => handleTierJump(-1)}
                className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 text-[10px] font-bold rounded-lg transition shadow flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>🔽</span>
                <span>{t.actions.tierStepDown}</span>
              </button>
            )}
            {currentLevel !== 'ultimate' && (
              <button
                onClick={() => handleTierJump(1)}
                className="flex-1 py-1.5 bg-gradient-to-r from-indigo-950 via-purple-950 to-slate-900 hover:from-indigo-900 border border-indigo-700/60 text-indigo-300 text-[10px] font-bold rounded-lg transition shadow flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>🚀</span>
                <span>{t.actions.tierStepUp}</span>
              </button>
            )}
          </div>

          {/* 謎題即時指標條 */}
          <div className="mt-2 flex items-center justify-between w-full px-1 text-[9px] text-slate-500 border-t border-slate-800/80 pt-1.5">
            <PuzzleTimer activeId={activePuzzle.id} />
            <div className="flex items-center gap-2">
              <button
                onClick={handleShareVaultBadge}
                className="hover:text-amber-400 transition cursor-pointer text-[8px] flex items-center gap-0.5"
              >
                <span>🏆</span>
                <span className="underline">{t.status.vaultCard}</span>
              </button>
              <span>•</span>
              <div>
                {t.status.puzzleProgress}: {puzzleIndex + 1}/{activeList.length}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="mt-12 p-8 border border-slate-800 text-center max-w-sm rounded-xl">
          <p className="text-slate-500 text-xs">{t.status.loading}</p>
        </div>
      )}

      {/* 治理與合規聲明頁尾 */}
      <footer className="w-full max-w-sm sm:max-w-md mt-auto pt-3 pb-2 flex flex-col items-center gap-1 border-t border-slate-900 text-[8px] text-slate-600">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-emerald-500/80 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {t.status.zeroTrustVerified}
          </span>
          <span>•</span>
          <button
            onClick={() => {
              playSound('click');
              setShowComplianceModal(true);
            }}
            className="text-slate-400 hover:text-indigo-300 underline transition cursor-pointer flex items-center gap-0.5"
          >
            <span>⚖️</span>
            <span>{t.status.complianceNotice}</span>
          </button>
        </div>
        <div className="text-slate-600 text-[7px] tracking-wide">
          LogiCore Apex Engine v3.0 • Deterministic CSP • No Autonomous PII Ingestion
        </div>
      </footer>

      <ComplianceModal isOpen={showComplianceModal} onClose={() => setShowComplianceModal(false)} />
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
