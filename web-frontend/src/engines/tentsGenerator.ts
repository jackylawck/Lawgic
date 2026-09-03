// web-frontend/src/engines/tentsGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type TentsCellState = 'empty' | 'tree' | 'tent';

export interface TentsSpec {
  rows: number;
  cols: number;
  trees: [number, number][];
  rowClues: number[];
  colClues: number[];
  solutionTents: [number, number][];
}

const TIER_CONFIGS: Record<TierKey, { rows: number; cols: number; treeCount: number }> = {
  kids: { rows: 4, cols: 4, treeCount: 3 },
  intermediate: { rows: 5, cols: 5, treeCount: 5 },
  expert: { rows: 6, cols: 6, treeCount: 7 },
  master: { rows: 8, cols: 8, treeCount: 12 },
};

export class WebTentsGenerator {
  public static generate(tier: TierKey = 'kids'): PuzzleEntity {
    const conf = TIER_CONFIGS[tier] || TIER_CONFIGS.kids;
    const { rows, cols, treeCount } = conf;

    // 建立基礎解題地圖
    const trees: [number, number][] = [];
    const solutionTents: [number, number][] = [];
    const occupied = new Set<string>();

    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    let attempts = 0;
    while (trees.length < treeCount && attempts < 200) {
      attempts++;
      const tr = Math.floor(Math.random() * rows);
      const tc = Math.floor(Math.random() * cols);
      const treeKey = `${tr},${tc}`;

      if (occupied.has(treeKey)) continue;

      // 尋找相鄰可用空位放置帳篷
      const validAdj: [number, number][] = [];
      for (const [dr, dc] of dirs) {
        const nr = tr + dr;
        const nc = tc + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          const adjKey = `${nr},${nc}`;
          if (!occupied.has(adjKey)) {
            // 檢查帳篷之間是否相鄰（包含對角）
            let collides = false;
            for (let rDiff = -1; rDiff <= 1; rDiff++) {
              for (let cDiff = -1; cDiff <= 1; cDiff++) {
                if (occupied.has(`${nr + rDiff},${nc + cDiff}`)) {
                  collides = true;
                  break;
                }
              }
              if (collides) break;
            }
            if (!collides) validAdj.push([nr, nc]);
          }
        }
      }

      if (validAdj.length > 0) {
        const [tentR, tentC] = validAdj[Math.floor(Math.random() * validAdj.length)];
        trees.push([tr, tc]);
        solutionTents.push([tentR, tentC]);
        occupied.add(treeKey);
        occupied.add(`${tentR},${tentC}`);
      }
    }

    const rowClues = Array(rows).fill(0);
    const colClues = Array(cols).fill(0);
    for (const [r, c] of solutionTents) {
      rowClues[r]++;
      colClues[c]++;
    }

    const spec: TentsSpec = {
      rows,
      cols,
      trees,
      rowClues,
      colClues,
      solutionTents,
    };

    return {
      id: `tents_${tier}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      category: 'spatial_logic',
      engine_type: 'tents',
      tier,
      checksum: `TENTS_${rows}x${cols}_${Date.now()}`,
      puzzle: spec as any,
      solution: solutionTents as any,
      cognitiveLoad: {
        spatial: 0.8,
        numeric: 0.6,
        workingMemory: 0.75,
        inhibition: 0.8,
      },
      metrics: {
        estimated_time_sec: rows * cols * 3,
        irt_logit_difficulty: 0.4,
        human_sim_steps: treeCount * 2,
      } as any,
    };
  }
}
