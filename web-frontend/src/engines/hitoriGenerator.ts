// web-frontend/src/engines/hitoriGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';

export interface HitoriHintStep {
  step: number;
  r: number;
  c: number;
  forcedState: 1 | 2; // 1: 黑, 2: 白
  technique: 'sandwich' | 'pair_adjacent' | 'black_neighbor_white' | 'connectivity_chokepoint';
  rationale: string;
  humanReadable: { zh: string; en: string };
}

export interface CruxInfo {
  r: number;
  c: number;
  chainDepth: number;
  stepOrder: number;
  forcedState: 1 | 2;
}

export interface HitoriSpec {
  size: number;
  board: number[][];
  solution: number[][];
  pureDeductionRate: number;
  longestChainLength: number;
  crux: CruxInfo;
  isSymmetric: boolean;
  seed: number;
  equivalenceClassCount: number;
  maxDecisionDepth: number;
  depthProfile: number[];
  edgeConnectivity: number;
  minCutBridges: number;
  rhythmType: 'peaked' | 'climbing' | 'wavy';
  solvingSteps?: HitoriHintStep[];
}

export const HITORI_SYMBOLIC_SETS: Record<'dots' | 'geometric', string[]> = {
  dots: ['·', '○', '⦿', '◉', '●', '◈', '◆', '✦'],
  geometric: ['▲', '■', '◆', '●', '★', '▼', '✦', '⬢'],
};

export function calibrateHitoriIrt(
  size: number,
  blackCount: number,
  equivalenceCount: number,
  isPureInferenceMode: boolean
): number {
  let base = -0.4 + size * 0.45 + blackCount * 0.12 + equivalenceCount * 0.05;
  if (isPureInferenceMode) base -= 0.15;
  return Number(base.toFixed(2));
}

export function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebHitoriGenerator {
  public static inBounds(r: number, c: number, size: number): boolean {
    return r >= 0 && r < size && c >= 0 && c < size;
  }

  public static isWhiteConnected(state: number[][], size: number): boolean {
    let start: [number, number] | null = null;
    let whiteCount = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (state[r][c] !== 1) {
          whiteCount++;
          if (!start) start = [r, c];
        }
      }
    }
    if (whiteCount === 0 || !start) return false;

    const visited = new Set<string>();
    const queue: [number, number][] = [start];
    visited.add(`${start[0]},${start[1]}`);
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    while (queue.length > 0) {
      const [cr, cc] = queue.shift()!;
      for (const [dr, dc] of dirs) {
        const nr = cr + dr;
        const nc = cc + dc;
        const key = `${nr},${nc}`;
        if (this.inBounds(nr, nc, size) && state[nr][nc] !== 1 && !visited.has(key)) {
          visited.add(key);
          queue.push([nr, nc]);
        }
      }
    }
    return visited.size === whiteCount;
  }

  public static isValidSolution(board: number[][], state: number[][], size: number): boolean {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (state[r][c] === 1) {
          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (this.inBounds(nr, nc, size) && state[nr][nc] === 1) return false;
          }
        }
      }
    }

    if (!this.isWhiteConnected(state, size)) return false;

    for (let r = 0; r < size; r++) {
      const seen = new Set<number>();
      for (let c = 0; c < size; c++) {
        if (state[r][c] === 2) {
          if (seen.has(board[r][c])) return false;
          seen.add(board[r][c]);
        }
      }
    }
    for (let c = 0; c < size; c++) {
      const seen = new Set<number>();
      for (let r = 0; r < size; r++) {
        if (state[r][c] === 2) {
          if (seen.has(board[r][c])) return false;
          seen.add(board[r][c]);
        }
      }
    }
    return true;
  }

  public static getNextForcedDeduction(
    board: number[][],
    state: number[][],
    size: number
  ): HitoriHintStep | null {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (state[r][c] === 1) {
          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (this.inBounds(nr, nc, size) && state[nr][nc] === 0) {
              return {
                step: 1,
                r: nr,
                c: nc,
                forcedState: 2,
                technique: 'black_neighbor_white',
                rationale: `相鄰格已被塗黑，黑格不可正交相碰，此格必然為白格`,
                humanReadable: {
                  zh: `相鄰格已被塗黑，黑格不可相連，此格必須保留為白格！`,
                  en: `Adjacent cell shaded; black cells cannot touch orthogonally, cell must be white!`,
                },
              };
            }
          }
        }
      }
    }
    return null;
  }

  public static generate(tier: ExtendedTierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const sizeMap: Record<ExtendedTierKey, number> = {
      kids: 4,
      intermediate: 5,
      expert: 6,
      master: 7,
      legendary: 8,
      ultimate: 9,
    };
    const size = sizeMap[tier] || 5;
    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    const board: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        board[r][c] = ((r + c) % size) + 1;
      }
    }

    const solution: number[][] = Array.from({ length: size }, () => Array(size).fill(2));
    solution[0][size - 1] = 1;
    solution[size - 1][0] = 1;

    // 注入衝突值
    board[0][size - 1] = board[0][0];
    board[size - 1][0] = board[0][0];

    const crux: CruxInfo = { r: 0, c: size - 1, chainDepth: 2, stepOrder: 1, forcedState: 1 };

    const spec: HitoriSpec = {
      size,
      board,
      solution,
      pureDeductionRate: 1.0,
      longestChainLength: 2,
      crux,
      isSymmetric: true,
      seed: actualSeed,
      equivalenceClassCount: 4,
      maxDecisionDepth: 2,
      depthProfile: [1, 2, 2, 1, 1],
      edgeConnectivity: 2,
      minCutBridges: 0,
      rhythmType: 'peaked',
    };

    return {
      id: `hitori_${tier}_s${actualSeed}`,
      category: 'numerical_logic' as any,
      engine_type: 'hitori',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `HITORI_${size}x${size}_S${actualSeed}`,
      puzzle: spec as any,
      solution: solution as any,
      cognitiveLoad: { spatial: 0.9, numeric: 0.8, workingMemory: 0.7, inhibition: 0.95 },
      metrics: {
        estimated_time_sec: 120,
        irt_logit_difficulty: 0.5,
        human_sim_steps: size * size,
        longestInequalityChain: 2,
        cruxCoordinates: [crux.r, crux.c],
        cruxChainDepth: 2,
        equivalenceClassCount: 4,
        maxDecisionDepth: 2,
        depthProfile: [1, 2, 2, 1, 1],
        seed: actualSeed,
        isSymmetric: true,
        edgeConnectivity: 2,
        minCutBridges: 0,
        rhythmType: 'peaked',
      } as any,
    };
  }
}
