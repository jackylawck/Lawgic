// web-frontend/src/registry/RendererRegistry.tsx
import React, { Suspense } from 'react';
import { PuzzleEntity } from '../generated';
import { MazeBoard } from '../components/MazeBoard';
import { SudokuBoard } from '../components/SudokuBoard';
import { SkyscraperBoard } from '../components/SkyscraperBoard';
import { HashiBoard } from '../components/HashiBoard';

// 核心四大神作級引擎映射表 (支援引擎別名容錯)
export const RENDERERS: Record<string, React.ComponentType<any>> = {
  maze: MazeBoard,
  sudoku: SudokuBoard,
  skyscraper: SkyscraperBoard,
  hashi: HashiBoard,
  hashiwokakero: HashiBoard, // 別名相容
};

interface PuzzleRendererProps {
  puzzle: PuzzleEntity;
  tournamentMode?: boolean;
}

const LoadingSkeleton: React.FC = () => (
  <div className="flex flex-col items-center justify-center p-8 text-slate-500 font-mono text-xs animate-pulse">
    <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-indigo-500 animate-spin mb-2" />
    <span>載入認知引擎中... / Initializing Engine...</span>
  </div>
);

export const PuzzleRenderer: React.FC<PuzzleRendererProps> = ({ puzzle, tournamentMode = false }) => {
  if (!puzzle || !puzzle.engine_type) {
    return (
      <div className="p-6 text-center text-xs text-rose-400 font-mono bg-rose-950/20 border border-rose-900 rounded-xl">
        ⚠️ 題目實體無效 / Invalid Puzzle Entity
      </div>
    );
  }

  // 正規化引擎字串，避免大小寫或多餘空白導致找不到組件
  const normalizedKey = puzzle.engine_type.trim().toLowerCase();
  const Component = RENDERERS[normalizedKey];

  if (!Component) {
    return (
      <div className="p-6 text-center text-xs text-slate-500 font-mono bg-slate-900/40 border border-slate-800 rounded-xl">
        <div className="text-amber-400 mb-1 font-bold">🚧 引擎即將解鎖 / Engine Coming Soon</div>
        <div>未支援的引擎類型 / Unsupported Engine: <code className="text-cyan-400">{puzzle.engine_type}</code></div>
      </div>
    );
  }

  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Component puzzle={puzzle} puzzleData={puzzle} tournamentMode={tournamentMode} />
    </Suspense>
  );
};
