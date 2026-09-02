// web-frontend/src/registry/RendererRegistry.tsx
import React from 'react';
import { MazeBoard } from '../components/MazeBoard';
import { SudokuBoard } from '../components/SudokuBoard';
import { SkyscraperBoard } from '../components/SkyscraperBoard';

export const RENDERERS: Record<string, React.FC<any>> = {
  maze: MazeBoard,
  sudoku: SudokuBoard,
  skyscraper: SkyscraperBoard,
};
