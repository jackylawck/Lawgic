// web-frontend/src/App.tsx
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { PuzzleRenderer } from './registry/RendererRegistry';
import { PUZZLE_CATALOG, PuzzleEntity } from './generated';
import { LangSwitcher } from './components/LangSwitcher';
import { VirtualGamepad } from './components/VirtualGamepad';
import { useLearnerProfile, TierKey } from './hooks/useLearnerProfile';
import { ChallengeCodec } from './utils/challengeCodec';

// 匯入演算法生成器
import { WebMazeGenerator } from './engines/mazeGenerator';
import { WebSudokuGenerator } from './engines/sudokuGenerator';
import { WebNonogramGenerator } from './engines/nonogramGenerator';
import { WebNurikabeGenerator } from './engines/nurikabeGenerator';
import { WebSkyscraperGenerator } from './engines/skyscraperGenerator';
import { WebHashiGenerator } from './engines/hashiGenerator';
import { WebKropkiGenerator } from './engines/kropkiGenerator';
import { WebSlitherlinkGenerator } from './engines/slitherlinkGenerator';
import { WebTentsGenerator } from './engines/tentsGenerator';
import { WebLightUpGenerator } from './engines/lightupGenerator';
import { WebFutoshikiGenerator } from './engines/futoshikiGenerator';
import { WebHitoriGenerator } from './engines/hitoriGenerator';
import { WebKakuroGenerator } from './engines/kakuroGenerator';
import { WebMasyuGenerator } from './engines/masyuGenerator';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';

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
  { id: 'jigsaw', nameZh: '幾何拼圖', nameEn: 'Jigsaw', icon: '🧩' },
  { id: 'dominoes', nameZh: '骨牌矩陣', nameEn: 'Dominoes', icon: '🀄' },
];

export const LEVEL_KEYS: ExtendedTierKey[] = ['kids', 'intermediate', 'expert', 'master', 'legendary', 'ultimate'];

const TIER_NAMES: Record<ExtendedTierKey, { zh: string; en: string }> = {
  kids: { zh: '兒童', en: 'Kids' },
  intermediate: { zh: '進階', en: 'Intermediate' },
  expert: { zh: '專家', en: 'Expert' },
  master: { zh: '大師', en: 'Master' },
  legendary: { zh: '傳奇', en: 'Legendary' },
  ultimate: { zh: '終極', en: 'Ultimate' },
};

const EngineFallbackUI: React.FC<{ resetErrorBoundary: () => void }> = ({ resetErrorBoundary }) => (
  <div className="flex flex-col items-center justify-center p-6 bg-red-950/40 border border-red-800 text-center my-4 font-mono rounded-xl">
    <p className="text-red-300 text-xs">載入異常 / Render Error</p>
    <button
      onClick={resetErrorBoundary}
      className="mt-3 px-3 py-1 bg-red-900/60 hover:bg-red-800 text-red-100 text-[10px] border border-red-700 rounded transition"
    >
      重試 / Retry
    </button>
  </div>
);

function generateEnginePuzzle(gameId: string, tier: ExtendedTierKey): PuzzleEntity | null {
  try {
    let puzzle: PuzzleEntity | null = null;
    const baseTier: TierKey = (tier === 'legendary' || tier === 'ultimate') ? 'master' : (tier as TierKey);

    switch (gameId) {
      case 'maze':
        puzzle = WebMazeGenerator.generate(baseTier);
        break;
      case 'sudoku':
        puzzle = WebSudokuGenerator.generate(baseTier);
        break;
      case 'nonogram':
        puzzle = WebNonogramGenerator.generate(tier as any);
        break;
      case 'nurikabe':
        puzzle = WebNurikabeGenerator.generate(tier as any);
        break;
      case 'skyscraper':
        puzzle = WebSkyscraperGenerator.generate(baseTier);
        break;
      case 'hashi':
        puzzle = WebHashiGenerator.generate(baseTier);
        break;
      case 'kropki':
        puzzle = WebKropkiGenerator.generate(baseTier);
        break;
      case 'slitherlink':
        puzzle = WebSlitherlinkGenerator.generate(baseTier);
        break;
      case 'tents':
        puzzle = WebTentsGenerator.generate(baseTier);
        break;
      case 'lightup':
        puzzle = WebLightUpGenerator.generate((tier === 'ultimate' ? 'legendary' : tier) as any);
        break;
      case 'futoshiki':
        puzzle = WebFutoshikiGenerator.generate(tier as any);
        break;
      case 'hitori':
        puzzle = WebHitoriGenerator.generate(tier as any);
        break;
      case 'kakuro':
        puzzle = WebKakuroGenerator.generate(tier as any);
        break;
      case 'masyu':
        puzzle = WebMasyuGenerator.generate(tier as any);
        break;
      default:
        return null;
    }

    if (puzzle && (tier === 'legendary' || tier === 'ultimate')) {
      puzzle.tier = tier as any;
      if (puzzle.metrics) {
        puzzle.metrics.irt_logit_difficulty = Number(
          ((puzzle.metrics.irt_logit_difficulty || 2.2) + (tier === 'ultimate' ? 1.0 : 0.6)).toFixed(2)
        );
      }
    }

    return puzzle;
  } catch {
    return null;
  }
}

const MainDashboard: React.FC = () => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { profile, getCompositeCognitiveIndex } = useLearnerProfile();

  const [selectedType, setSelectedType] = useState<string>('maze');
  const [currentLevel, setCurrentLevel] = useState<ExtendedTierKey>('kids');
  const [puzzleIndex, setPuzzleIndex] = useState<number>(0);
  const [tournamentMode, setTournamentMode] = useState<boolean>(false);
  const [elapsed, setElapsed] = useState<number>(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isGeneratingRef = useRef<boolean>(false);

  const [dynamicPuzzles, setDynamicPuzzles] = useState<Record<string, PuzzleEntity[]>>(() => {
    const initialPool: Record<string, PuzzleEntity[]> = {
      maze: [],
      sudoku: [],
      nonogram: [],
      nurikabe: [],
      skyscraper: [],
      hashi: [],
      kropki: [],
      slitherlink: [],
      tents: [],
      lightup: [],
      futoshiki: [],
      hitori: [],
      kakuro: [],
      masyu: [],
    };

    try {
      const p = generateEnginePuzzle('maze', 'kids');
      if (p) {
        p.id = `maze_kids_init_0`;
        initialPool.maze.push(p);
      }
    } catch (e) {
      console.error('Initial puzzle gen error:', e);
    }

    return initialPool;
  });

  const activeList = useMemo(() => {
    const staticList = PUZZLE_CATALOG[selectedType] || [];
    const liveList = dynamicPuzzles[selectedType] || [];
    const fullList = [...liveList, ...staticList];
    return fullList.filter((p) => ((p.tier as ExtendedTierKey) || 'kids') === currentLevel);
  }, [selectedType, currentLevel, dynamicPuzzles]);

  const activePuzzle = activeList.length > 0 ? activeList[puzzleIndex % activeList.length] : null;

  const appendBatchPuzzles = useCallback(
    async (gameId: string, tier: ExtendedTierKey, count: number = 5) => {
      if (isGeneratingRef.current) return;
      isGeneratingRef.current = true;
      setIsGenerating(true);

      const generated: PuzzleEntity[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const p = generateEnginePuzzle(gameId, tier);
          if (p) {
            p.id = `${gameId}_${tier}_batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
            generated.push(p);
          }
        } catch (err) {
          console.warn(`Engine ${gameId} batch error:`, err);
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }

      if (generated.length > 0) {
        setDynamicPuzzles((prev) => ({
          ...prev,
          [gameId]: [...(prev[gameId] || []), ...generated],
        }));
      }

      isGeneratingRef.current = false;
      setIsGenerating(false);
    },
    []
  );

  useEffect(() => {
    if (activeList.length < 2 && !isGeneratingRef.current) {
      appendBatchPuzzles(selectedType, currentLevel, 5);
    }
  }, [selectedType, currentLevel, activeList.length, appendBatchPuzzles]);

  useEffect(() => {
    if (activeList.length > 0 && puzzleIndex >= activeList.length - 1 && !isGeneratingRef.current) {
      appendBatchPuzzles(selectedType, currentLevel, 5);
    }
  }, [puzzleIndex, activeList.length, selectedType, currentLevel, appendBatchPuzzles]);

  useEffect(() => {
    const handleNav = (e: Event) => {
      const customEvent = e as CustomEvent<{ gameId?: string }>;
      if (customEvent.detail?.gameId) {
        setSelectedType(customEvent.detail.gameId);
        setPuzzleIndex(0);
      }
    };
    window.addEventListener('logicore:navigate-game', handleNav);
    return () => window.removeEventListener('logicore:navigate-game', handleNav);
  }, []);

  useEffect(() => {
    const checkHashChallenge = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#challenge=')) {
        const code = hash.replace('#challenge=', '');
        const importedPuzzle = ChallengeCodec.decode(code);
        if (importedPuzzle) {
          setSelectedType(importedPuzzle.engine_type);
          setCurrentLevel((importedPuzzle.tier as ExtendedTierKey) || 'kids');
          setDynamicPuzzles((prev) => ({
            ...prev,
            [importedPuzzle.engine_type]: [importedPuzzle, ...(prev[importedPuzzle.engine_type] || [])],
          }));
          setPuzzleIndex(0);

          const pRows = importedPuzzle.puzzle?.rows || '?';
          const pCols = importedPuzzle.puzzle?.cols || '?';
          const pIrt = importedPuzzle.metrics?.irt_logit_difficulty || '1.0';
          const gameMeta = ALL_GAMES.find((g) => g.id === importedPuzzle.engine_type);
          const name = isEn ? gameMeta?.nameEn || 'Puzzle' : gameMeta?.nameZh || '益智謎題';

          setToastMsg(
            isEn
              ? `🎯 Challenge Loaded! [${name} · ${pRows}×${pCols} · IRT ${pIrt}]`
              : `🎯 賽事挑戰載入！【${name} · ${pRows}×${pCols} · 難度 IRT ${pIrt}】`
          );
          setTimeout(() => setToastMsg(null), 3000);
        }
      }
    };

    checkHashChallenge();
    window.addEventListener('hashchange', checkHashChallenge);
    return () => window.removeEventListener('hashchange', checkHashChallenge);
  }, [isEn]);

  useEffect(() => {
    const activeGame = ALL_GAMES.find((g) => g.id === selectedType);
    const gameName = activeGame ? (isEn ? activeGame.nameEn : activeGame.nameZh) : 'Cognitive Arena';
    const tierName = isEn ? TIER_NAMES[currentLevel].en : TIER_NAMES[currentLevel].zh;
    document.title = `${gameName} [${tierName}] | Lawgic 羅輯`;
  }, [selectedType, currentLevel, isEn]);

  const isSpatialExplorationType = selectedType === 'maze';

  const handlePrevPuzzle = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(8);
    setPuzzleIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, activeList.length - 1)));
  }, [activeList.length]);

  const handleNextPuzzle = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(10);
    setPuzzleIndex((prev) => (prev + 1) % (activeList.length || 1));
  }, [activeList.length]);

  const handleLiveGenerate = useCallback(async () => {
    if (navigator.vibrate) navigator.vibrate(20);
    setIsGenerating(true);

    await new Promise((r) => setTimeout(r, 16));

    try {
      const newPuzzle = generateEnginePuzzle(selectedType, currentLevel);
      if (newPuzzle) {
        newPuzzle.id = `${selectedType}_${currentLevel}_manual_${Date.now().toString(36)}`;
        setDynamicPuzzles((prev) => ({
          ...prev,
          [selectedType]: [newPuzzle, ...(prev[selectedType] || [])],
        }));
        setPuzzleIndex(0);
        setToastMsg(isEn ? '⚡ Dynamic puzzle synthesized' : '⚡ 演算法已即時合成全新題目');
        setTimeout(() => setToastMsg(null), 2000);
      }
    } finally {
      setIsGenerating(false);
    }
  }, [selectedType, currentLevel, isEn]);

  const handleTierJump = useCallback(
    (steps: number = 1) => {
      if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
      const currentIdx = LEVEL_KEYS.indexOf(currentLevel);
      const targetIdx = Math.min(LEVEL_KEYS.length - 1, currentIdx + steps);
      if (targetIdx !== currentIdx) {
        setCurrentLevel(LEVEL_KEYS[targetIdx]);
        setPuzzleIndex(0);
      }
    },
    [currentLevel]
  );

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

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '[' || e.key === 'PageUp') { e.preventDefault(); handlePrevPuzzle(); }
      if (e.key === ']' || e.key === 'PageDown') { e.preventDefault(); handleNextPuzzle(); }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [handlePrevPuzzle, handleNextPuzzle]);

  const lastMoveTimeRef = useRef<number>(0);
  const handleJoystickMove = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - lastMoveTimeRef.current < 150) return;

    const threshold = 0.45;
    let dx = 0;
    let dy = 0;
    if (x > threshold) dx = 1;
    else if (x < -threshold) dy = -1;
    if (y > threshold) dy = 1;
    else if (y < -threshold) dy = -1;

    if (dx !== 0 || dy !== 0) {
      lastMoveTimeRef.current = now;
      window.dispatchEvent(new CustomEvent('logicore:joystick-move', { detail: { dx, dy } }));
    }
  }, []);

  const handleJoystickLook = useCallback((x: number, y: number) => {
    window.dispatchEvent(new CustomEvent('logicore:joystick-look', { detail: { x, y } }));
  }, []);

  const handleJoystickAction = useCallback(() => {
    window.dispatchEvent(new CustomEvent('logicore:joystick-action'));
  }, []);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex]);

  return (
    <main className="min-h-screen bg-[#090d14] text-slate-200 flex flex-col items-center py-2 px-2 font-mono selection:bg-indigo-600">
      {toastMsg && (
        <div className="fixed top-2 z-50 px-3 py-1.5 bg-cyan-600 border border-cyan-400 text-white font-bold text-xs rounded-full shadow-2xl animate-fade-in pointer-events-none">
          {toastMsg}
        </div>
      )}

      {isGenerating && (
        <div className="fixed top-1 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-1 bg-slate-900/95 border border-indigo-500/80 rounded-full text-indigo-300 text-[8px] font-mono shadow-2xl animate-pulse pointer-events-none">
          <div className="w-2 h-2 rounded-full border border-indigo-400 border-t-transparent animate-spin" />
          <span>🧠 {isEn ? 'Synthesizing Topology...' : '神經網絡拓撲生成中...'}</span>
        </div>
      )}

      <div className="w-full max-w-sm sm:max-w-md flex items-center justify-between px-1 mb-1 text-[8px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-cyan-400">IQ {cci.standardIQ}</span>
          <span>(±{cci.semIQ})</span>
          {profile.pureStreak >= 2 && (
            <span className="text-amber-300 font-bold">💎 ×{profile.pureStreak}</span>
          )}
        </div>
        <button
          onClick={() => setTournamentMode((prev) => !prev)}
          className={`px-1.5 py-0.5 rounded border transition text-[7px] font-bold ${
            tournamentMode
              ? 'bg-amber-950 border-amber-500 text-amber-300 shadow-xs'
              : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
        >
          {tournamentMode ? '🏆 TOURNAMENT SANCTIONED' : '○ TOURNAMENT OFF'}
        </button>
      </div>

      <header className="w-full max-w-sm sm:max-w-md flex items-center justify-between gap-1.5 mb-2 pb-1.5 border-b border-slate-800">
        <div className="flex flex-col shrink-0 leading-tight">
          <span className="text-xs font-black tracking-widest text-indigo-400">LAWGIC</span>
          <span className="text-[6.5px] font-bold text-slate-500 tracking-wider">羅輯・遊戲</span>
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
                {isEn ? TIER_NAMES[tierKey].en : TIER_NAMES[tierKey].zh}
              </option>
            ))}
          </select>
        </div>

        <LangSwitcher />
      </header>

      {activePuzzle ? (
        <section className="flex flex-col items-center w-full max-w-sm sm:max-w-md">
          <div className="w-full p-1 bg-slate-900/60 border border-slate-800 rounded-xl shadow-2xl">
            <ErrorBoundary FallbackComponent={EngineFallbackUI} resetKeys={[selectedType, currentLevel, puzzleIndex]}>
              <PuzzleRenderer
                key={`${selectedType}-${currentLevel}-${puzzleIndex}-${activePuzzle.checksum}`}
                puzzle={activePuzzle}
                tournamentMode={tournamentMode}
              />
            </ErrorBoundary>
          </div>

          {isSpatialExplorationType && (
            <VirtualGamepad
              onMove={handleJoystickMove}
              onRotate={handleJoystickLook}
              onAction={handleJoystickAction}
              actionLabel={isEn ? 'MARK' : '標記'}
            />
          )}

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

          {currentLevel !== 'ultimate' && (
            <div className="flex gap-1.5 mt-1.5 w-full">
              <button
                onClick={() => handleTierJump(1)}
                className="flex-1 py-1.5 bg-gradient-to-r from-indigo-950 via-purple-950 to-slate-900 hover:from-indigo-900 border border-indigo-700/60 hover:border-indigo-500 text-indigo-300 text-[10px] font-bold rounded-lg transition shadow flex items-center justify-center gap-1"
              >
                <span>🚀</span>
                <span>{isEn ? 'Tier Jump (+1)' : '升階挑戰 (+1)'}</span>
              </button>
              {currentLevel === 'kids' && (
                <button
                  onClick={() => handleTierJump(2)}
                  className="px-3 py-1.5 bg-rose-950/70 hover:bg-rose-900 border border-rose-700/60 text-rose-300 text-[10px] font-bold rounded-lg transition shadow"
                  title={isEn ? 'Direct Jump to Expert' : '直接跳級至專家'}
                >
                  <span>⚡ +2</span>
                </button>
              )}
            </div>
          )}

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
          <p className="text-slate-500 text-xs">{isEn ? 'Generating puzzles...' : '題目載入生成中...'}</p>
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
