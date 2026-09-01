import React from 'react';
import { SudokuBoard } from '../components/SudokuBoard';
import { PuzzleEntity } from '../generated';

export type ViewerComponent = React.FC<{ puzzleData: any }>;

const registry: Record<string, ViewerComponent> = {
  sudoku: ({ puzzleData }) => <SudokuBoard puzzleData={puzzleData} />,
  // 未來題型解鎖後逐一解除註解：
  // skyscraper: ({ puzzleData }) => <SkyscraperViewer puzzleData={puzzleData} />,
  // hashi: ({ puzzleData }) => <HashiViewer puzzleData={puzzleData} />,
};

export const registerRenderer = (engineType: string, component: ViewerComponent) => {
  registry[engineType] = component;
};

export const PuzzleRenderer: React.FC<{ puzzle: PuzzleEntity }> = ({ puzzle }) => {
  const Component = registry[puzzle.engine_type];
  if (!Component) {
    return (
      <div className="p-6 border border-slate-800 rounded-xl bg-slate-900/50 text-center">
        <p className="text-amber-400 font-mono text-sm">Renderer Missing: [{puzzle.engine_type}]</p>
      </div>
    );
  }
  return <Component puzzleData={puzzle} />;
};
