// web-frontend/src/generated/index.ts
import sudokuPuzzles from './sudoku.json';
import skyscraperPuzzles from './skyscraper.json';

export interface CognitiveLoadVector {
  spatial: number;        // 空間幾何/旋轉 (0.0 ~ 1.0)
  numeric: number;        // 數感運算 (0.0 ~ 1.0)
  workingMemory: number;  // 工作記憶更新 (0.0 ~ 1.0)
  inhibition: number;     // 規則抑制控制 (0.0 ~ 1.0)
}

export interface PuzzleEntity {
  id: string;
  category: string;
  engine_type: string;
  tier: string;
  puzzle: any;
  solution: any;
  metrics: { decision_depth: number; propagation_steps?: number };
  cognitiveLoad?: CognitiveLoadVector;
  checksum: string;
}

// 12 大經典認知題型註冊表
export const PUZZLE_CATALOG: Record<string, PuzzleEntity[]> = {
  sudoku: (sudokuPuzzles as unknown) as PuzzleEntity[],
  skyscraper: (skyscraperPuzzles as unknown) as PuzzleEntity[],
  hashi: [],        // 數橋 (Topological Graph)
  kropki: [],       // 黑白點數獨 (Constraint Arithmetic)
  slitherlink: [],  // 數迴 (Edge Loop Closure)
  kakuro: [],       // 數和 (Arithmetic Partition)
  nurikabe: [],     // 數牆 (Island Partition)
  hitori: [],       // 數壹 (Elimination Logic)
  futoshiki: [],    // 不等式 (Inequality Ordering)
  jigsaw: [],       // 拼圖數獨 (Irregular Regions)
  dominoes: [],     // 骨牌 (Pattern Tiling)
  maze: [],         // 大迷宮 (Spatial Search)
};

export const getAllPuzzles = (): PuzzleEntity[] => {
  return Object.values(PUZZLE_CATALOG).flat();
};
