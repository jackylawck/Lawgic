// web-frontend/src/App.tsx
import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import {
  AccessibilityProvider,
  useAccessibilitySettings,
  useAccessibilityActions,
} from './contexts/AccessibilityContext';
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
import { ALL_GAMES, PuzzleMeta } from './registry/engineMetadata';

export type { PuzzleMeta };
export const LEVEL_KEYS: ExtendedTierKey[] = VALID_TIERS;

const MODAL_FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const EngineFallbackUI: React.FC<{ resetErrorBoundary: () => void; error?: Error }> = ({
  resetErrorBoundary,
  error,
}) => {
  const isChunkError =
    error?.message?.includes('Failed to fetch dynamically imported module') ||
    error?.message?.includes('Loading chunk');

  const handleReload = async () => {
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (err) {
        console.warn('[Cache] Clear error before reload:', err);
      }
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
    let lastTick = performance.now();
    let accumulated = 0;

    const handleVisibility = () => {
      const now = performance.now();
      if (document.hidden) {
        accumulated += (now - lastTick) / 1000;
        setElapsed(Math.floor(accumulated));
        lastTick = now;
      } else {
        lastTick = now;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const interval = setInterval(() => {
      const now = performance.now();
      if (!document.hidden) {
        accumulated += (now - lastTick) / 1000;
        setElapsed(Math.floor(accumulated));
      }
      lastTick = now;
    }, 1000);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [activeId]);

  return (
    <span aria-live="off">
      ⏱️ {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
    </span>
  );
});
PuzzleTimer.displayName = 'PuzzleTimer';

const MainDashboard: React.FC = () => {
  const t = useT();
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const { hapticFeedback, reducedMotion } = useAccessibilitySettings();
  const { playSound, announce } = useAccessibilityActions();

  const { profile, getCompositeCognitiveIndex } = useLearnerProfile();
  const { getRecommendedSchedulePuzzle } = useLongTermScheduler(profile, PUZZLE_CATALOG);

  const [selectedType, setSelectedType] = useState<string>('maze');
  const [currentLevel, setCurrentLevel] = useState<ExtendedTierKey>('kids');
  const [tournamentMode, setTournamentMode] = useState<boolean>(false);
  const [showDashboardModal, setShowDashboardModal] = useState<boolean>(false);
  const [showComplianceModal, setShowComplianceModal] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [hasUpdate, setHasUpdate] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const boardContainerRef = useRef<HTMLDivElement>(null);
  const lastMoveTimeRef = useRef<number>(-Infinity);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const dashboardModalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  const safeVibrate = useCallback(
    (pattern: number | number[]) => {
      if (!hapticFeedback || reducedMotion) return;
      if (typeof navigator === 'undefined' || !navigator.vibrate) return;
      try {
        navigator.vibrate(pattern);
      } catch {}
    },
    [hapticFeedback, reducedMotion]
  );

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

  const handleChallengeLoaded = useCallback(
    (imported: PuzzleEntity) => {
      setSelectedType(imported.engine_type);
      setCurrentLevel(imported.tier as ExtendedTierKey);
      const gameMeta = ALL_GAMES.find((g) => g.id === imported.engine_type);
      const name = gameMeta ? (isEn ? gameMeta.nameEn : gameMeta.nameZh) : 'Puzzle';
      const irtDisplay = imported.metrics?.irt_logit_difficulty ?? '1.0';
      const msg = t.toast.challengeLoaded(name, irtDisplay);
      showToast(msg, 3000);
      announce(msg, 'polite');
    },
    [t, isEn, showToast, announce]
  );

  const {
    activeList,
    activePuzzle,
    puzzleIndex,
    setPuzzleIndex,
    isGenerating,
    triggerManualGenerate,
  } = usePuzzlePool(selectedType, currentLevel, handleChallengeLoaded);

  const handlePrevPuzzle = useCallback(() => {
    if (activeList.length === 0 || isGenerating) return;
    playSound('step');
    safeVibrate(8);
    setPuzzleIndex((prev) => (prev - 1 + activeList.length) % activeList.length);
    boardContainerRef.current?.focus();
  }, [activeList.length, isGenerating, playSound, safeVibrate, setPuzzleIndex]);

  const handleNextPuzzle = useCallback(() => {
    if (activeList.length === 0 || isGenerating) return;
    playSound('step');
    safeVibrate(10);
    setPuzzleIndex((prev) => (prev + 1) % activeList.length);
    boardContainerRef.current?.focus();
  }, [activeList.length, isGenerating, playSound, safeVibrate, setPuzzleIndex]);

  const handleLiveGenerate = useCallback(async () => {
    if (tournamentMode || isGenerating) return;
    playSound('click');
    safeVibrate(20);
    const success = await triggerManualGenerate();
    if (success) {
      showToast(t.toast.dynamicSynthesized);
      announce(t.toast.dynamicSynthesized, 'polite');
    }
    boardContainerRef.current?.focus();
  }, [tournamentMode, isGenerating, playSound, safeVibrate, triggerManualGenerate, showToast, announce, t]);

  const handleToggleTournament = useCallback(() => {
    playSound('alert');
    safeVibrate(15);
    setTournamentMode((prev) => !prev);
  }, [playSound, safeVibrate]);

  useGlobalHotkeys({
    onPrev: handlePrevPuzzle,
    onNext: handleNextPuzzle,
    onGenerate: handleLiveGenerate,
    onToggleTournament: handleToggleTournament,
    disabled: showDashboardModal || showComplianceModal || isGenerating,
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
  }, [selectedType, currentLevel, isEn, t.status.titleSuffix, t.tiers]);

  const handleTierJump = useCallback(
    (steps: number) => {
      if (isGenerating) return;
      playSound('hint');
      safeVibrate([20, 30, 20]);
      const currentIdx = LEVEL_KEYS.indexOf(currentLevel);
      const targetIdx = Math.max(0, Math.min(LEVEL_KEYS.length - 1, currentIdx + steps));
      if (targetIdx !== currentIdx) {
        setCurrentLevel(LEVEL_KEYS[targetIdx]);
        setPuzzleIndex(0);
      }
    },
    [currentLevel, isGenerating, playSound, safeVibrate, setPuzzleIndex]
  );

  const handleSmartDrill = useCallback(() => {
    if (isGenerating) return;
    const recommendation = getRecommendedSchedulePuzzle();
    if (recommendation) {
      playSound('hint');
      safeVibrate(15);
      setSelectedType(recommendation.type);
      setCurrentLevel(recommendation.tier);
      setPuzzleIndex(0);
      const msg = `🎯 ${recommendation.reason}`;
      showToast(msg, 3500);
      announce(msg, 'polite');
    }
  }, [getRecommendedSchedulePuzzle, isGenerating, playSound, safeVibrate, setPuzzleIndex, showToast, announce]);

  const handleShareVaultBadge = useCallback(() => {
    if (!activePuzzle) return;
    playSound('success');
    safeVibrate(25);
    const seedVal = activePuzzle.puzzle?.seed ?? 1000;
    const irtVal = activePuzzle.metrics?.irt_logit_difficulty ?? 1.0;

    const badge = VaultManager.generateAsciiBadge({
      engine: activePuzzle.engine_type,
      tier: currentLevel,
      seed: seedVal,
      steps: activePuzzle.metrics?.human_sim_steps ?? 24,
      timeSpentSec: activePuzzle.metrics?.estimated_time_sec ?? 60,
      iq: Math.round(100 + irtVal * 15),
    });

    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard
        .writeText(badge)
        .then(() => {
          showToast(t.toast.badgeCopied);
          announce(t.toast.badgeCopied, 'polite');
        })
        .catch(() => {
          showToast(t.toast.clipboardDenied);
          announce(t.toast.clipboardDenied, 'assertive');
        });
    } else {
      showToast(t.toast.clipboardUnsupported);
      announce(t.toast.clipboardUnsupported, 'assertive');
    }
  }, [activePuzzle, currentLevel, playSound, safeVibrate, showToast, announce, t]);

  const handleJoystickMove = useCallback((x: number, y: number) => {
    const now = performance.now();
    if (now - lastMoveTimeRef.current < 120) return;

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

  useEffect(() => {
    if (showDashboardModal) {
      previouslyFocusedElementRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focusable = dashboardModalRef.current?.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR);
      if (focusable && focusable.length > 0) {
        focusable[0].focus();
      }
    } else {
      if (previouslyFocusedElementRef.current?.isConnected) {
        previouslyFocusedElementRef.current.focus();
      }
    }
  }, [showDashboardModal]);

  const handleDashboardKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setShowDashboardModal(false);
      return;
    }

    if (e.key === 'Tab' && dashboardModalRef.current) {
      const focusable = Array.from(
        dashboardModalRef.current.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  // 避免重複遍歷計算 IQ 指標
  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex]);

  return (
    <main className="min-h-screen bg-[#070a0f] text-slate-200 flex flex-col items-center py-2 px-2 font-mono selection:bg-indigo-600">
      {toastMsg && (
        <div
          aria-hidden="true"
          className="fixed top-2 z-50 px-3 py-1.5 bg-cyan-600 border border-cyan-400 text-white font-bold text-xs rounded-full shadow-2xl animate-fade-in pointer-events-none"
        >
          {toastMsg}
        </div>
      )}

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
        <div
          aria-hidden="true"
          className="fixed top-1 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-1 bg-slate-900/95 border border-indigo-500/80 rounded-full text-indigo-300 text-[8px] font-mono shadow-2xl animate-pulse pointer-events-none"
        >
          <div className="w-2 h-2 rounded-full border border-indigo-400 border-t-transparent animate-spin" />
          <span>🧠 {t.status.synthesizing}</span>
        </div>
      )}

      {showDashboardModal && (
        <div
          ref={dashboardModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-modal-title"
          onKeyDown={handleDashboardKeyDown}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
        >
          <h2 id="dashboard-modal-title" className="sr-only">
            {isEn ? 'Cognitive Dashboard' : '認知量表儀表板'}
          </h2>
          <div className="relative w-full max-w-4xl bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-auto p-2 sm:p-4">
            <button
              onClick={() => setShowDashboardModal(false)}
              aria-label={isEn ? 'Close Dashboard' : '關閉認知儀表板'}
              className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-full font-bold text-xs transition cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              ✕
            </button>
            <CognitiveDashboard />
          </div>
        </div>
      )}

      <div className="w-full max-w-sm sm:max-w-md flex items-center justify-between px-1 mb-1 text-[8px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowDashboardModal(true)}
            aria-label={isEn ? `View IQ Score: ${cci.standardIQ}` : `檢視智商分數：${cci.standardIQ}`}
            className="flex items-center gap-1 hover:text-cyan-300 transition cursor-pointer outline-none focus-visible:underline"
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
            disabled={isGenerating}
            className="px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-700/60 text-purple-300 font-bold hover:bg-purple-900 disabled:opacity-50 transition cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-purple-400"
          >
            ⚡ {t.actions.smartDrill}
          </button>
        </div>

        <button
          onClick={handleToggleTournament}
          className={`px-1.5 py-0.5 rounded border transition text-[7px] font-bold cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-amber-400 ${
            tournamentMode
              ? 'bg-amber-950 border-amber-500 text-amber-300 shadow-xs'
              : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
        >
          {tournamentMode ? t.status.tournamentOn : t.status.tournamentOff}
        </button>
      </div>

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
            disabled={isGenerating}
            aria-label={isEn ? 'Select game type' : '選擇遊戲類型'}
            onChange={(e) => {
              setSelectedType(e.target.value);
              setPuzzleIndex(0);
            }}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1 outline-none focus:border-indigo-500 disabled:opacity-50 cursor-pointer"
          >
            {ALL_GAMES.map((game) => (
              <option key={game.id} value={game.id} className="bg-slate-900 text-slate-200">
                {game.icon} {isEn ? game.nameEn : game.nameZh}
              </option>
            ))}
          </select>

          <select
            value={currentLevel}
            disabled={isGenerating}
            aria-label={isEn ? 'Select difficulty tier' : '選擇難度等級'}
            onChange={(e) => {
              setCurrentLevel(e.target.value as ExtendedTierKey);
              setPuzzleIndex(0);
            }}
            className="w-28 shrink-0 bg-slate-900 border border-slate-700 text-cyan-300 text-xs font-bold rounded px-2 py-1 outline-none focus:border-cyan-500 disabled:opacity-50 cursor-pointer"
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

      {activePuzzle ? (
        <section
          ref={boardContainerRef}
          tabIndex={-1}
          className="flex flex-col items-center w-full max-w-sm sm:max-w-md outline-none pb-4"
        >
          <div className="mb-2 grid grid-cols-3 gap-1.5 w-full">
            <button
              onClick={handlePrevPuzzle}
              disabled={isGenerating}
              className="py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 active:scale-95 text-slate-300 text-[10px] font-bold border border-slate-800 rounded-lg transition cursor-pointer shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
            >
              {t.actions.prev}
            </button>
            <button
              onClick={handleLiveGenerate}
              disabled={tournamentMode || isGenerating}
              className={`py-2 text-[10px] font-bold border rounded-lg shadow-sm transition flex items-center justify-center gap-1 outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
                tournamentMode || isGenerating
                  ? 'bg-slate-900/50 border-slate-800 text-slate-600 cursor-not-allowed'
                  : 'bg-cyan-950 hover:bg-cyan-900 active:scale-95 text-cyan-300 border-cyan-700/60 cursor-pointer'
              }`}
            >
              <span>⚡</span>
              <span>{isGenerating ? (isEn ? 'Solving...' : '求解中...') : t.actions.generate}</span>
            </button>
            <button
              onClick={handleNextPuzzle}
              disabled={isGenerating}
              className="py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 active:scale-95 text-white font-black text-[10px] border border-indigo-400 rounded-lg shadow-md transition cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-indigo-300"
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

          <div className="flex gap-1.5 mt-2 w-full">
            {currentLevel !== 'kids' && (
              <button
                onClick={() => handleTierJump(-1)}
                disabled={isGenerating}
                className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 border border-slate-700 text-slate-400 hover:text-slate-200 text-[10px] font-bold rounded-lg transition shadow flex items-center justify-center gap-1 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
              >
                <span>🔽</span>
                <span>{t.actions.tierStepDown}</span>
              </button>
            )}
            {currentLevel !== 'ultimate' && (
              <button
                onClick={() => handleTierJump(1)}
                disabled={isGenerating}
                className="flex-1 py-1.5 bg-gradient-to-r from-indigo-950 via-purple-950 to-slate-900 hover:from-indigo-900 disabled:opacity-50 border border-indigo-700/60 text-indigo-300 text-[10px] font-bold rounded-lg transition shadow flex items-center justify-center gap-1 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-indigo-400"
              >
                <span>🚀</span>
                <span>{t.actions.tierStepUp}</span>
              </button>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between w-full px-1 text-[9px] text-slate-500 border-t border-slate-800/80 pt-1.5">
            <PuzzleTimer activeId={activePuzzle.id} />
            <div className="flex items-center gap-2">
              <button
                onClick={handleShareVaultBadge}
                className="hover:text-amber-400 transition cursor-pointer text-[8px] flex items-center gap-0.5 outline-none focus-visible:underline"
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
              safeVibrate(10);
              setShowComplianceModal(true);
            }}
            className="text-slate-400 hover:text-indigo-300 underline transition cursor-pointer flex items-center gap-0.5 outline-none focus-visible:ring-1 focus-visible:ring-indigo-400"
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
