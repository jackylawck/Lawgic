// web-frontend/src/generated/index.ts

export type TierKey = 'kids' | 'intermediate' | 'expert' | 'master';

export type PuzzleCategory =
  | 'spatial'
  | 'numeric'
  | 'logic'
  | 'loop'
  | 'spatial_logic'
  | 'numeric_logic'
  | 'loop_logic';

export interface CognitiveLoad {
  spatial: number;
  numeric: number;
  workingMemory: number;
  inhibition: number;
}

export interface PuzzleMetrics {
  estimated_time_sec: number;
  irt_logit_difficulty: number;
  human_sim_steps?: number;
}

export interface PuzzleEntity {
  id: string;
  category: PuzzleCategory | string;
  engine_type: string;
  tier: TierKey;
  checksum: string;
  puzzle: any;
  solution: any;
  cognitiveLoad: CognitiveLoad;
  metrics: PuzzleMetrics;
}

export const PUZZLE_CATALOG: Record<string, PuzzleEntity[]> = {
  maze: [],
  sudoku: [],
  skyscraper: [],
  hashi: [],
  kropki: [],
  slitherlink: [],
  tents: [],
  lightup: [],
};
