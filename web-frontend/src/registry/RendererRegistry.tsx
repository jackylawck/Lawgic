// web-frontend/src/registry/RendererRegistry.tsx
import React from 'react';
import { PuzzleEntity } from '../generated';
import { MazeBoard } from '../components/MazeBoard';
import { SudokuBoard } from '../components/SudokuBoard';
import { SkyscraperBoard } from '../components/SkyscraperBoard';

export const RENDERERS: Record<string, React.FC<any>> = {
  maze: MazeBoard,
  sudoku: SudokuBoard,
  skyscraper: SkyscraperBoard,
};

interface PuzzleRendererProps {
  puzzle: PuzzleEntity;
  tournamentMode?: boolean;
}

export const PuzzleRenderer: React.FC<PuzzleRendererProps> = ({ puzzle, tournamentMode }) => {
  const Component = RENDERERS[puzzle.engine_type];

  if (!Component) {
    return (
      <div className="p-6 text-center text-xs text-slate-500 font-mono">
        未支援的引擎類型 / Unsupported Engine: {puzzle.engine_type}
      </div>
    );
  }

  return <Component puzzle={puzzle} puzzleData={puzzle} tournamentMode={tournamentMode} />;
};
