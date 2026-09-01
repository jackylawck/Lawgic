// web-frontend/src/registry/RendererRegistry.tsx
import React from 'react';
import { PuzzleEntity } from '../generated';
import { SudokuBoard } from '../components/SudokuBoard';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
}

export const PuzzleRenderer: React.FC<Props> = ({ puzzle, puzzleData }) => {
  const currentPuzzle = puzzle || puzzleData;
  if (!currentPuzzle) return null;

  switch (currentPuzzle.engine_type) {
    case 'sudoku':
      return <SudokuBoard puzzleData={currentPuzzle} puzzle={currentPuzzle} />;
    default:
      return (
        <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center text-xs font-mono text-slate-400">
          題型 [{currentPuzzle.engine_type}] 渲染器就緒中
        </div>
      );
  }
};
