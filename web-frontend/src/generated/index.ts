import sudokuPuzzles from './sudoku.json';
import skyscraperPuzzles from './skyscraper.json';

export interface PuzzleEntity {
  id: string;
  category: 'grid_csp' | 'grid_logic' | 'sequence';
  engine_type: string;
  tier: 'kids' | 'intermediate' | 'expert' | 'master';
  puzzle: any;
  solution: any;
  metrics: { decision_depth: number; propagation_steps?: number };
  checksum: string;
}

export const PUZZLE_CATALOG: Record<string, PuzzleEntity[]> = {
  sudoku: sudokuPuzzles as PuzzleEntity[],
  skyscraper: skyscraperPuzzles as PuzzleEntity[],
};

export const getAllPuzzles = (): PuzzleEntity[] => {
  return Object.values(PUZZLE_CATALOG).flat();
};
