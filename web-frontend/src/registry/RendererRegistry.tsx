// web-frontend/src/registry/RendererRegistry.tsx
import React from 'react';
import { PuzzleEntity } from '../generated';
import { SudokuBoard } from '../components/SudokuBoard';
import { MazeBoard } from '../components/MazeBoard';

interface Props {
  puzzle: PuzzleEntity;
}

export const PuzzleRenderer: React.FC<Props> = ({ puzzle }) => {
  // 兼顧 snake_case 與 camelCase
  const engineType = puzzle.engine_type || (puzzle as any).engineType || (puzzle as any).category || 'maze';

  switch (engineType) {
    case 'maze':
    case 'topological':
      return <MazeBoard key={puzzle.id || puzzle.checksum} puzzleData={puzzle} />;
    case 'sudoku':
      return <SudokuBoard key={puzzle.id || puzzle.checksum} puzzleData={puzzle} />;
    default:
      return (
        <div className="p-6 text-center font-mono text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
          Engine [{engineType}] is loading or currently registered in secondary queue.
        </div>
      );
  }
};
