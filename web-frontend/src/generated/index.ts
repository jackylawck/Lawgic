// web-frontend/src/generated/index.ts
import sudokuPuzzles from './sudoku.json';
import skyscraperPuzzles from './skyscraper.json';
import mazePuzzles from './maze.json';

export type PuzzleCategory = 
  | 'grid_csp' 
  | 'grid_logic' 
  | 'topological' 
  | 'arithmetic' 
  | 'elimination';

export type TierKey = 'kids' | 'intermediate' | 'expert' | 'master';

export interface CognitiveLoadVector {
  spatial: number;
  numeric: number;
  workingMemory: number;
  inhibition: number;
}

export interface PuzzleEntity {
  id: string;
  category: PuzzleCategory;
  engine_type: string;
  tier: TierKey;
  puzzle: any;
  solution: any;
  metrics: { decision_depth: number; propagation_steps?: number };
  cognitiveLoad?: CognitiveLoadVector;
  checksum: string;
}

export const PUZZLE_CATALOG: Record<string, PuzzleEntity[]> = {
  sudoku: (sudokuPuzzles as unknown) as PuzzleEntity[],
  skyscraper: (skyscraperPuzzles as unknown) as PuzzleEntity[],
  hashi: [],
  kropki: [],
  slitherlink: [],
  kakuro: [],
  nurikabe: [],
  hitori: [],
  futoshiki: [],
  jigsaw: [],
  dominoes: [],
  maze: (mazePuzzles as unknown) as PuzzleEntity[],
};

export const getAllPuzzles = (): PuzzleEntity[] => {
  return Object.values(PUZZLE_CATALOG).flat();
};
