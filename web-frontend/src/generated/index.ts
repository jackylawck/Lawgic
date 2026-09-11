// web-frontend/src/generated/index.ts

// 導入靜態題庫 JSON
import puzzleLibraryRaw from './puzzle_library.json';
import sudokuRaw from './sudoku.json';
import mazeRaw from './maze.json';
import hashiRaw from './hashi.json';
import skyscraperRaw from './skyscraper.json';

export type TierKey = 'kids' | 'intermediate' | 'expert' | 'master' | 'legendary' | 'ultimate';

export type PuzzleCategory =
  | 'spatial'
  | 'numeric'
  | 'logic'
  | 'loop'
  | 'pattern'
  | 'spatial_logic'
  | 'numeric_logic'
  | 'pattern_logic'
  | 'loop_logic'
  | 'grid_csp';

export interface CognitiveLoad {
  spatial: number;
  numeric: number;
  workingMemory: number;
  inhibition: number;
}

/**
 * 引擎題目規格介面（唯一事實來源）
 * 使用交集型別相容具體 Spec (FutoshikiSpec, SudokuSpec, MazeSpec 等)，杜絕 TS2322 缺少索引簽名錯誤
 */
export type PuzzleSpec = {
  rows?: number;
  cols?: number;
  height?: number;
  width?: number;
  size?: number;
  clues?: unknown;
  grid?: unknown;
  solution?: unknown;
  pureDeductionRate?: number;
  seed?: number;
  tier?: string;
  difficulty?: string;
} & Record<string, any>;

export interface PuzzleMetrics {
  estimated_time_sec?: number;
  irt_logit_difficulty: number;
  human_sim_steps?: number;
  decision_depth?: number;
  propagation_steps?: number;
  difficulty_tier?: string;
  seed?: number;
  [key: string]: unknown;
}

export interface PuzzleEntity {
  id: string;
  category: PuzzleCategory | string;
  engine_type: string;
  tier: TierKey;
  checksum: string;
  puzzle: PuzzleSpec;
  solution: unknown;
  cognitiveLoad: CognitiveLoad;
  metrics: PuzzleMetrics;
  [key: string]: unknown;
}

// 認知負荷預設權重表 (涵蓋全部 18 款遊戲)
const DEFAULT_COGNITIVE_LOADS: Record<string, CognitiveLoad> = {
  maze: { spatial: 0.95, numeric: 0.2, workingMemory: 0.7, inhibition: 0.8 },
  sudoku: { spatial: 0.3, numeric: 0.95, workingMemory: 0.85, inhibition: 0.7 },
  nonogram: { spatial: 0.8, numeric: 0.7, workingMemory: 0.8, inhibition: 0.85 },
  nurikabe: { spatial: 0.9, numeric: 0.4, workingMemory: 0.8, inhibition: 0.92 },
  skyscraper: { spatial: 0.9, numeric: 0.5, workingMemory: 0.8, inhibition: 0.7 },
  hashi: { spatial: 0.88, numeric: 0.6, workingMemory: 0.6, inhibition: 0.7 },
  kropki: { spatial: 0.5, numeric: 0.8, workingMemory: 0.65, inhibition: 0.85 },
  slitherlink: { spatial: 0.88, numeric: 0.4, workingMemory: 0.75, inhibition: 0.9 },
  tents: { spatial: 0.92, numeric: 0.45, workingMemory: 0.75, inhibition: 0.88 },
  lightup: { spatial: 0.8, numeric: 0.5, workingMemory: 0.6, inhibition: 0.8 },
  kakuro: { spatial: 0.4, numeric: 0.95, workingMemory: 0.8, inhibition: 0.7 },
  hitori: { spatial: 0.6, numeric: 0.8, workingMemory: 0.8, inhibition: 0.9 },
  futoshiki: { spatial: 0.45, numeric: 0.85, workingMemory: 0.75, inhibition: 0.8 },
  masyu: { spatial: 0.9, numeric: 0.2, workingMemory: 0.6, inhibition: 0.85 },
  dominoes: { spatial: 0.75, numeric: 0.5, workingMemory: 0.85, inhibition: 0.88 },
  heyawake: { spatial: 0.85, numeric: 0.4, workingMemory: 0.75, inhibition: 0.85 },
  yajilin: { spatial: 0.9, numeric: 0.45, workingMemory: 0.8, inhibition: 0.9 },
  shikaku: { spatial: 0.92, numeric: 0.9, workingMemory: 0.8, inhibition: 0.85 },
};

/**
 * 32-bit FNV-1a 確定性雜湊：
 * 杜絕 Math.random() 產生的 ID 漂移，確保純前端離線運行時題目 ID 的可重現性
 */
function fastHash(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 題目規格正規化處理器
 */
function normalizePuzzle(
  raw: any,
  defaultEngine: string,
  defaultTier: TierKey,
  fallbackIndex = 0
): PuzzleEntity | null {
  if (!raw) return null;

  const engineType = raw.engine_type || defaultEngine;
  const tier: TierKey = (raw.tier || raw.metrics?.difficulty_tier || defaultTier) as TierKey;

  const rawPuzzle = raw.puzzle || {};
  const isPuzzleArray = Array.isArray(rawPuzzle);

  const rows = Number(
    rawPuzzle.rows || rawPuzzle.height || rawPuzzle.size || raw.rows || (isPuzzleArray ? rawPuzzle.length : 6)
  );
  const cols = Number(
    rawPuzzle.cols || rawPuzzle.width || rawPuzzle.size || raw.cols || (isPuzzleArray && rawPuzzle[0] ? rawPuzzle[0].length : rows)
  );

  const gridData = !isPuzzleArray ? (rawPuzzle.grid ?? rawPuzzle.clues) : rawPuzzle;
  const cluesData = !isPuzzleArray ? (rawPuzzle.clues ?? rawPuzzle.grid) : rawPuzzle;
  const solutionData = raw.solution ?? rawPuzzle.solution ?? null;

  const seed = raw.metrics?.seed ?? raw.seed ?? rawPuzzle.seed;

  const fallbackIrt: Record<TierKey, number> = {
    kids: 0.65,
    intermediate: 1.45,
    expert: 2.35,
    master: 3.15,
    legendary: 3.75,
    ultimate: 4.35,
  };

  const irt = Number(raw.metrics?.irt_logit_difficulty || fallbackIrt[tier] || 1.5);

  // 確定性特徵雜湊（杜絕 Math.random()）
  const signature = `${engineType}_${tier}_${seed ?? fallbackIndex}_${rows}x${cols}`;
  const stableHash = fastHash(signature);

  return {
    id: raw.id || `${engineType}_${tier}_${stableHash}`,
    category:
      raw.category ||
      (engineType === 'sudoku' || engineType === 'kakuro' ? 'numeric_logic' : 'spatial_logic'),
    engine_type: engineType,
    tier,
    checksum: raw.checksum || `VERIFIED_${stableHash}`,
    puzzle: {
      ...rawPuzzle,
      rows,
      cols,
      grid: gridData,
      clues: cluesData,
      solution: solutionData,
      pureDeductionRate: rawPuzzle.pureDeductionRate ?? 1.0,
      seed,
    },
    solution: solutionData,
    cognitiveLoad:
      raw.cognitiveLoad ||
      DEFAULT_COGNITIVE_LOADS[engineType] || {
        spatial: 0.7,
        numeric: 0.7,
        workingMemory: 0.7,
        inhibition: 0.7,
      },
    metrics: {
      estimated_time_sec: raw.metrics?.estimated_time_sec || rows * cols * 2.5,
      irt_logit_difficulty: irt,
      decision_depth: raw.metrics?.decision_depth || 0,
      propagation_steps: raw.metrics?.propagation_steps || 100,
      difficulty_tier: tier,
      seed,
    },
  };
}

/**
 * 載入 JSON 資料源並壓平成題庫陣列
 */
function ingestRawSource(source: any, defaultEngine: string): PuzzleEntity[] {
  if (!source) return [];
  const results: PuzzleEntity[] = [];

  if (Array.isArray(source)) {
    source.forEach((item, index) => {
      const parsed = normalizePuzzle(item, defaultEngine, 'intermediate', index);
      if (parsed) results.push(parsed);
    });
  } else if (typeof source === 'object') {
    const validTiers: TierKey[] = ['kids', 'intermediate', 'expert', 'master', 'legendary', 'ultimate'];
    Object.entries(source).forEach(([key, val]) => {
      if (validTiers.includes(key as TierKey) && Array.isArray(val)) {
        val.forEach((item, index) => {
          const parsed = normalizePuzzle(item, defaultEngine, key as TierKey, index);
          if (parsed) results.push(parsed);
        });
      } else if (Array.isArray(val)) {
        val.forEach((item, index) => {
          const parsed = normalizePuzzle(item, key, 'intermediate', index);
          if (parsed) results.push(parsed);
        });
      }
    });
  }

  return results;
}

// 建立 18 款遊戲的題庫骨幹
const baseCatalog: Record<string, PuzzleEntity[]> = {
  maze: [],
  sudoku: [],
  nonogram: [],
  nurikabe: [],
  skyscraper: [],
  hashi: [],
  kropki: [],
  slitherlink: [],
  tents: [],
  lightup: [],
  kakuro: [],
  hitori: [],
  futoshiki: [],
  masyu: [],
  dominoes: [],
  heyawake: [],
  yajilin: [],
  shikaku: [],
};

// 注入各 JSON 資料源
ingestRawSource(sudokuRaw, 'sudoku').forEach((p) => baseCatalog.sudoku.push(p));
ingestRawSource(mazeRaw, 'maze').forEach((p) => baseCatalog.maze.push(p));
ingestRawSource(hashiRaw, 'hashi').forEach((p) => baseCatalog.hashi.push(p));
ingestRawSource(skyscraperRaw, 'skyscraper').forEach((p) => baseCatalog.skyscraper.push(p));

// 使用 Set 實現 O(1) 去重字典
const seenIds = new Set<string>();
Object.values(baseCatalog).forEach((list) => {
  list.forEach((p) => seenIds.add(p.id));
});

// 注入綜合題庫 puzzle_library.json
if (puzzleLibraryRaw && typeof puzzleLibraryRaw === 'object') {
  Object.entries(puzzleLibraryRaw).forEach(([engineKey, puzzleList]) => {
    if (Array.isArray(puzzleList)) {
      puzzleList.forEach((raw, idx) => {
        const item = normalizePuzzle(raw, engineKey, 'intermediate', idx);
        if (item) {
          if (!baseCatalog[item.engine_type]) {
            baseCatalog[item.engine_type] = [];
          }
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            baseCatalog[item.engine_type].push(item);
          }
        }
      });
    }
  });
}

export const PUZZLE_CATALOG = baseCatalog;
