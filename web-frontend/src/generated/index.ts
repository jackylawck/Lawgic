import sudokuPuzzles from './sudoku.json';
import kropkiPuzzles from './kropki.json';
import hashiPuzzles from './hashi.json';
import skyscraperPuzzles from './skyscraper.json';
import mazePuzzles from './maze.json';

export interface PuzzleEntity {
  id: string;
  engine_type: string;
  difficulty_tier: 'kids' | 'intermediate' | 'expert' | 'master';
  puzzle: any;
  solution: any;
  metrics: {
    decision_depth: number;
    propagation_steps?: number;
    [key: string]: any;
  };
  checksum: string;
}

export const PUZZLE_CATALOG: Record<string, PuzzleEntity[]> = {
  sudoku: sudokuPuzzles as PuzzleEntity[],
  kropki: kropkiPuzzles as PuzzleEntity[],
  hashi: hashiPuzzles as PuzzleEntity[],
  skyscraper: skyscraperPuzzles as PuzzleEntity[],
  maze: mazePuzzles as PuzzleEntity[],
};

export const getAllPuzzles = (): PuzzleEntity[] => {
  return Object.values(PUZZLE_CATALOG).flat();
};
