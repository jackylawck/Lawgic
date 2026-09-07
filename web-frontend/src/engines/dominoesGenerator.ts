// web-frontend/src/engines/dominoesGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey;

export type DominoBorderState = 'none' | 'boundary' | 'connected';

export interface Domino {
  val1: number;
  val2: number;
}

export interface PlacedDomino {
  id: number;
  val1: number;
  val2: number;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export type DominoTechnique =
  | 'corner_dead_end_forcing'
  | 'unique_pair_localization'
  | 'pair_exhaustion_elimination'
  | 'bottleneck_parity_gating';

export interface DominoHintStep {
  step: number;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  val1: number;
  val2: number;
  forcedType: 'connected' | 'boundary';
  evidenceCells: [number, number][];
  technique: DominoTechnique;
  techniqueIcon: string;
  techniqueName: {
    zh: string;
    en: string;
  };
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface DominoesSpec {
  rows: number;
  cols: number;
  maxPip: number;
  grid: number[][];
  dominoes: Domino[];
  solutionBorders: {
    hBorders: boolean[][]; // (rows - 1) x cols
    vBorders: boolean[][]; // rows x (cols - 1)
  };
  totalDominoes: number;
  solutionDominoes: PlacedDomino[];
  pureDeductionRate: number;
  tier: TierKey;
  seed: number;
  solvingSteps?: DominoHintStep[];
}

interface TierConfig {
  maxPip: number;
  rows: number;
  cols: number;
  baseIrt: number;
  timeLimitSec: number;
}

const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { maxPip: 3, rows: 4, cols: 5, baseIrt: 0.65, timeLimitSec: 90 },
  intermediate: { maxPip: 4, rows: 5, cols: 6, baseIrt: 1.45, timeLimitSec: 150 },
  expert: { maxPip: 5, rows: 6, cols: 7, baseIrt: 2.35, timeLimitSec: 240 },
  master: { maxPip: 6, rows: 7, cols: 8, baseIrt: 3.15, timeLimitSec: 360 },
  legendary: { maxPip: 7, rows: 8, cols: 9, baseIrt: 3.75, timeLimitSec: 480 },
  ultimate: { maxPip: 8, rows: 9, cols: 10, baseIrt: 4.35, timeLimitSec: 660 },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebDominoesGenerator {
  public static generateDominoSet(maxPip: number): Domino[] {
    const set: Domino[] = [];
    for (let i = 0; i <= maxPip; i++) {
      for (let j = i; j <= maxPip; j++) {
        set.push({ val1: i, val2: j });
      }
    }
    return set;
  }

  public static getDominoKey(v1: number, v2: number): string {
    return v1 <= v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
  }

  public static getNextForcedDeduction(
    grid: number[][],
    hBorders: DominoBorderState[][],
    vBorders: DominoBorderState[][],
    rows: number,
    cols: number,
    maxPip: number,
    stepIndex: number = 1
  ): DominoHintStep | null {
    const placedGrid = Array.from({ length: rows }, () => Array(cols).fill(-1));
    const usedDominoes = new Set<string>();

    let currentId = 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols && vBorders[r]?.[c] === 'connected') {
          placedGrid[r][c] = currentId;
          placedGrid[r][c + 1] = currentId;
          usedDominoes.add(this.getDominoKey(grid[r][c], grid[r][c + 1]));
          currentId++;
        }
        if (r + 1 < rows && hBorders[r]?.[c] === 'connected') {
          placedGrid[r][c] = currentId;
          placedGrid[r + 1][c] = currentId;
          usedDominoes.add(this.getDominoKey(grid[r][c], grid[r + 1][c]));
          currentId++;
        }
      }
    }

    const matches = new Map<string, { r1: number; c1: number; r2: number; c2: number }[]>();
    const checkAndAdd = (r1: number, c1: number, r2: number, c2: number, isVertical: boolean) => {
      if (placedGrid[r1][c1] !== -1 || placedGrid[r2][c2] !== -1) return;
      if (isVertical && hBorders[r1]?.[c1] === 'boundary') return;
      if (!isVertical && vBorders[r1]?.[c1] === 'boundary') return;

      const key = this.getDominoKey(grid[r1][c1], grid[r2][c2]);
      if (usedDominoes.has(key)) return;

      if (!matches.has(key)) matches.set(key, []);
      matches.get(key)!.push({ r1, c1, r2, c2 });
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols) checkAndAdd(r, c, r, c + 1, false);
        if (r + 1 < rows) checkAndAdd(r, c, r + 1, c, true);
      }
    }

    // 定式 1: 孤立端點狹窄拘束 (Dead-End Forcing)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (placedGrid[r][c] !== -1) continue;

        const freeNeighbors: [number, number][] = [];
        if (c + 1 < cols && vBorders[r]?.[c] !== 'boundary' && placedGrid[r][c + 1] === -1) {
          const key = this.getDominoKey(grid[r][c], grid[r][c + 1]);
          if (!usedDominoes.has(key)) freeNeighbors.push([r, c + 1]);
        }
        if (c - 1 >= 0 && vBorders[r]?.[c - 1] !== 'boundary' && placedGrid[r][c - 1] === -1) {
          const key = this.getDominoKey(grid[r][c], grid[r][c - 1]);
          if (!usedDominoes.has(key)) freeNeighbors.push([r, c - 1]);
        }
        if (r + 1 < rows && hBorders[r]?.[c] !== 'boundary' && placedGrid[r + 1][c] === -1) {
          const key = this.getDominoKey(grid[r][c], grid[r + 1][c]);
          if (!usedDominoes.has(key)) freeNeighbors.push([r + 1, c]);
        }
        if (r - 1 >= 0 && hBorders[r - 1]?.[c] !== 'boundary' && placedGrid[r - 1][c] === -1) {
          const key = this.getDominoKey(grid[r][c], grid[r - 1][c]);
          if (!usedDominoes.has(key)) freeNeighbors.push([r - 1, c]);
        }

        if (freeNeighbors.length === 1) {
          const [nr, nc] = freeNeighbors[0];
          return {
            step: stepIndex,
            r1: r,
            c1: c,
            r2: nr,
            c2: nc,
            val1: grid[r][c],
            val2: grid[nr][nc],
            forcedType: 'connected',
            evidenceCells: [[r, c], [nr, nc]],
            technique: 'corner_dead_end_forcing',
            techniqueIcon: '🎯',
            techniqueName: { zh: '端點狹窄拘束', en: 'Dead-End Forcing' },
            rationale: `單元格 [${r + 1}, ${c + 1}] 周圍僅存唯一未被阻斷之延伸方向。`,
            humanReadable: {
              zh: `單元格 [${r + 1}, ${c + 1}] 僅能與 [${nr + 1}, ${nc + 1}] 相連成骨牌 [${grid[r][c]}-${grid[nr][nc]}]！`,
              en: `Cell [${r + 1}, ${c + 1}] only has one viable connection to [${nr + 1}, ${nc + 1}].`,
            },
          };
        }
      }
    }

    // 定式 2: 全盤唯一型號定位 (Unique Pair Localization)
    for (const [key, candidates] of matches.entries()) {
      if (candidates.length === 1) {
        const { r1, c1, r2, c2 } = candidates[0];
        const [v1, v2] = key.split('-').map(Number);
        return {
          step: stepIndex,
          r1,
          c1,
          r2,
          c2,
          val1: v1,
          val2: v2,
          forcedType: 'connected',
          evidenceCells: [[r1, c1], [r2, c2]],
          technique: 'unique_pair_localization',
          techniqueIcon: '💎',
          techniqueName: { zh: '稀缺型號定位', en: 'Unique Pair Localization' },
          rationale: `骨牌型號 [${key}] 在全盤僅存唯一候選位置。`,
          humanReadable: {
            zh: `骨牌 [${key}] 全盤僅有一處合法相鄰格 [${r1 + 1},${c1 + 1}] 與 [${r2 + 1},${c2 + 1}]，強制相連！`,
            en: `Domino [${key}] can only be placed between [${r1 + 1},${c1 + 1}] and [${r2 + 1},${c2 + 1}].`,
          },
        };
      }
    }

    return null;
  }

  private static _generateTiling(
    rows: number,
    cols: number,
    rnd: () => number
  ): { r1: number; c1: number; r2: number; c2: number }[] | null {
    const covered = Array.from({ length: rows }, () => Array(cols).fill(false));
    const tiles: { r1: number; c1: number; r2: number; c2: number }[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (covered[r][c]) continue;

        const options: [number, number][] = [];
        if (c + 1 < cols && !covered[r][c + 1]) options.push([r, c + 1]);
        if (r + 1 < rows && !covered[r + 1][c]) options.push([r + 1, c]);

        if (options.length === 0) return null;

        const [tr, tc] = options[options.length === 1 ? 0 : rnd() < 0.5 ? 0 : 1];
        covered[r][c] = true;
        covered[tr][tc] = true;
        tiles.push({ r1: r, c1: c, r2: tr, c2: tc });
      }
    }
    return tiles;
  }

  public static generate(tier: TierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { maxPip, rows, cols, baseIrt, timeLimitSec } = config;

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    const allDominoes = this.generateDominoSet(maxPip);
    const totalCount = allDominoes.length;

    let attempts = 0;
    const maxAttempts = 25;

    while (attempts++ < maxAttempts) {
      const tiling = this._generateTiling(rows, cols, rnd);
      if (!tiling || tiling.length !== totalCount) continue;

      const shuffledDominoes = [...allDominoes];
      for (let i = shuffledDominoes.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [shuffledDominoes[i], shuffledDominoes[j]] = [shuffledDominoes[j], shuffledDominoes[i]];
      }

      const grid = Array.from({ length: rows }, () => Array(cols).fill(-1));
      const solutionDominoes: PlacedDomino[] = [];

      const hBorders = Array.from({ length: rows - 1 }, () => Array(cols).fill(true));
      const vBorders = Array.from({ length: rows }, () => Array(cols - 1).fill(true));

      for (let i = 0; i < totalCount; i++) {
        const tile = tiling[i];
        const dom = shuffledDominoes[i];
        const flip = rnd() < 0.5;

        const val1 = flip ? dom.val2 : dom.val1;
        const val2 = flip ? dom.val1 : dom.val2;

        grid[tile.r1][tile.c1] = val1;
        grid[tile.r2][tile.c2] = val2;

        if (tile.r1 === tile.r2) {
          const minC = Math.min(tile.c1, tile.c2);
          vBorders[tile.r1][minC] = false;
        } else {
          const minR = Math.min(tile.r1, tile.r2);
          hBorders[minR][tile.c1] = false;
        }

        solutionDominoes.push({
          id: i + 1,
          val1,
          val2,
          r1: tile.r1,
          c1: tile.c1,
          r2: tile.r2,
          c2: tile.c2,
        });
      }

      const solvingSteps: DominoHintStep[] = [];
      const curHBorders: DominoBorderState[][] = Array.from({ length: rows - 1 }, () => Array(cols).fill('none'));
      const curVBorders: DominoBorderState[][] = Array.from({ length: rows }, () => Array(cols - 1).fill('none'));

      let stepNum = 1;
      let nextStep = this.getNextForcedDeduction(grid, curHBorders, curVBorders, rows, cols, maxPip, stepNum);

      while (nextStep && stepNum <= totalCount) {
        solvingSteps.push(nextStep);
        if (nextStep.r1 === nextStep.r2) {
          const minC = Math.min(nextStep.c1, nextStep.c2);
          curVBorders[nextStep.r1][minC] = 'connected';
        } else {
          const minR = Math.min(nextStep.r1, nextStep.r2);
          curHBorders[minR][nextStep.c1] = 'connected';
        }
        stepNum++;
        nextStep = this.getNextForcedDeduction(grid, curHBorders, curVBorders, rows, cols, maxPip, stepNum);
      }

      const pureDeductionRate = Number((solvingSteps.length / totalCount).toFixed(2));
      const minRate = tier === 'kids' ? 0.7 : tier === 'intermediate' ? 0.6 : 0.45;
      if (pureDeductionRate < minRate) continue;

      const dynamicIrt = Number((baseIrt + (1 - pureDeductionRate) * 0.4).toFixed(2));

      const spec: DominoesSpec = {
        rows,
        cols,
        maxPip,
        grid,
        dominoes: allDominoes,
        solutionBorders: {
          hBorders,
          vBorders,
        },
        totalDominoes: totalCount,
        solutionDominoes,
        pureDeductionRate,
        tier,
        seed: actualSeed,
        solvingSteps,
      };

      return {
        id: `dominoes_${tier}_s${actualSeed}`,
        category: 'numerical_logic',
        engine_type: 'dominoes',
        tier,
        checksum: `DOMINOES_D${maxPip}_S${actualSeed}`,
        puzzle: spec as any,
        solution: solutionDominoes as any,
        cognitiveLoad: {
          spatial: Number(Math.min(0.99, 0.45 + (rows * cols) / 120).toFixed(2)),
          numeric: Number(Math.min(0.95, 0.4 + (maxPip / 10) * 0.5).toFixed(2)),
          workingMemory: Number(Math.min(0.98, 0.5 + (1 - pureDeductionRate) * 0.45).toFixed(2)),
          inhibition: 0.88,
        },
        metrics: {
          grid_size: rows,
          rows,
          cols,
          maxPip,
          total_dominoes: totalCount,
          estimated_time_sec: timeLimitSec,
          irt_logit_difficulty: dynamicIrt,
          pureDeductionRate,
          human_sim_steps: solvingSteps.length,
          seed: actualSeed,
          actualTier: tier,
        } as any,
      };
    }

    return this._generateFallback(tier, maxPip, rows, cols, actualSeed, baseIrt);
  }

  private static _generateFallback(
    tier: TierKey,
    maxPip: number,
    rows: number,
    cols: number,
    seed: number,
    baseIrt: number
  ): PuzzleEntity {
    const allDominoes = this.generateDominoSet(maxPip);
    const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
    const solutionDominoes: PlacedDomino[] = [];

    const hBorders = Array.from({ length: rows - 1 }, () => Array(cols).fill(true));
    const vBorders = Array.from({ length: rows }, () => Array(cols - 1).fill(true));

    let domIdx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c += 2) {
        if (c + 1 < cols && domIdx < allDominoes.length) {
          const dom = allDominoes[domIdx];
          grid[r][c] = dom.val1;
          grid[r][c + 1] = dom.val2;
          vBorders[r][c] = false;
          solutionDominoes.push({
            id: domIdx + 1,
            val1: dom.val1,
            val2: dom.val2,
            r1: r,
            c1: c,
            r2: r,
            c2: c + 1,
          });
          domIdx++;
        }
      }
    }

    const spec: DominoesSpec = {
      rows,
      cols,
      maxPip,
      grid,
      dominoes: allDominoes,
      solutionBorders: {
        hBorders,
        vBorders,
      },
      totalDominoes: allDominoes.length,
      solutionDominoes,
      pureDeductionRate: 1.0,
      tier,
      seed,
    };

    return {
      id: `dominoes_${tier}_s${seed}_fb`,
      category: 'numerical_logic',
      engine_type: 'dominoes',
      tier,
      checksum: `DOMINOES_FB_D${maxPip}_S${seed}`,
      puzzle: spec as any,
      solution: solutionDominoes as any,
      cognitiveLoad: { spatial: 0.7, numeric: 0.6, workingMemory: 0.65, inhibition: 0.8 },
      metrics: {
        grid_size: rows,
        rows,
        cols,
        maxPip,
        estimated_time_sec: 120,
        irt_logit_difficulty: baseIrt,
        pureDeductionRate: 1.0,
        seed,
        actualTier: tier,
      } as any,
    };
  }
}
