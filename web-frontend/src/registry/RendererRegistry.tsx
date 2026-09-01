// web-frontend/src/registry/RendererRegistry.tsx
import React from 'react';
import { PuzzleEntity } from '../generated';
import { SudokuBoard } from '../components/SudokuBoard';
import { MazeBoard } from '../components/MazeBoard';

interface Props {
  puzzle: PuzzleEntity;
}

export const PuzzleRenderer: React.FC<Props> = ({ puzzle }) => {
  const engineType = puzzle.engine_type || 'sudoku';

  switch (engineType) {
    case 'maze':
      return <MazeBoard puzzleData={puzzle} />;
    case 'sudoku':
      return <SudokuBoard puzzleData={puzzle} />;
    default:
      return (
        <div className="p-6 text-center font-mono text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
          Engine [{engineType}] is loading or currently registered in secondary queue.
        </div>
      );
  }
};
