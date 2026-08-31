import React, { useState, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { SudokuBoard } from './components/SudokuBoard';
import rawLibrary from './generated/puzzle_library.json';

export type LevelKey = 'kids' | 'intermediate' | 'expert' | 'master';

const mapDepthToLevel = (depth: number): LevelKey => {
  if (depth === 0) return 'kids';
  if (depth <= 2) return 'intermediate';
  if (depth <= 5) return 'expert';
  return 'master';
};

const EngineFallbackUI: React.FC<{ resetErrorBoundary: () => void }> = ({ resetErrorBoundary }) => {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-red-950/40 border border-red-800/80 rounded-xl max-w-md text-center">
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
  const [currentLevel, setCurrentLevel] = useState<LevelKey>('kids');
  const [puzzleIndex, setPuzzleIndex] = useState<number>(0);

  const categorizedPuzzles = useMemo(() => {
    const map: Record<LevelKey, any[]> = { kids: [], intermediate: [], expert: [], master: [] };
    try {
      const rawList = Object.values(rawLibrary || {}).flat();
      rawList.forEach((p: any) => {
        if (p && p.puzzle && p.checksum) {
          const depth = p.metrics?.decision_depth ?? 0;
          map[mapDepthToLevel(depth)].push(p);
        }
      });
    } catch (e) {
      console.error("Library parse failed:", e);
    }
    return map;
  }, []);

  const activePuzzleList = categorizedPuzzles[currentLevel];
  const activePuzzle = activePuzzleList.length > 0 ? activePuzzleList[puzzleIndex % activePuzzleList.length] : null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center py-8 px-4 font-sans">
      <header className="w-full max-w-xl flex items-center justify-between mb-8 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
            LogiCore
          </h1>
          <p className="text-xs text-slate-500 font-mono mt-0.5">SMT-Welded & WASM AC-3 Verified</p>
        </div>
        <div className="flex gap-1 p-1 bg-slate-800 rounded-lg border border-slate-700">
          <button
            onClick={() => setLang('zh')}
            className={`px-3 py-1 text-xs rounded transition-all ${lang === 'zh' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
          >
            繁中
          </button>
          <button
            onClick={() => setLang('en')}
            className={`px-3 py-1 text-xs rounded transition-all ${lang === 'en' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
          >
            EN
          </button>
        </div>
      </header>

      {/* 難度選擇器 */}
      <div className="flex flex-wrap justify-center gap-2 mb-6">
        {(['kids', 'intermediate', 'expert', 'master'] as LevelKey[]).map((lvl) => (
          <button
            key={lvl}
            onClick={() => { setCurrentLevel(lvl); setPuzzleIndex(0); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
              currentLevel === lvl
                ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t.difficulty[lvl]} ({categorizedPuzzles[lvl].length})
          </button>
        ))}
      </div>

      {activePuzzle ? (
        <section className="flex flex-col items-center">
          <ErrorBoundary
            FallbackComponent={EngineFallbackUI}
            resetKeys={[currentLevel, puzzleIndex]}
            onReset={() => setPuzzleIndex(0)}
          >
            <SudokuBoard
              key={`${currentLevel}-${puzzleIndex}-${activePuzzle.checksum}`}
              puzzleData={activePuzzle}
            />
          </ErrorBoundary>

          <div className="mt-6 flex gap-4">
            <button
              onClick={() => setPuzzleIndex((prev) => (prev + 1) % activePuzzleList.length)}
              className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white rounded-lg text-sm font-medium border border-slate-700 transition-colors"
            >
              {t.ui.nextPuzzle}
            </button>
          </div>
        </section>
      ) : (
        <div className="mt-12 p-8 border border-dashed border-slate-800 rounded-xl text-center">
          <p className="text-slate-400 text-sm font-medium">{t.ui.noPuzzles}</p>
          <p className="text-slate-600 text-xs mt-1">{t.ui.noPuzzlesSub}</p>
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
