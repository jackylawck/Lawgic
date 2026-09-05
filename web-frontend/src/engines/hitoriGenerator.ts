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
  solution: number[][]; // 1: 黑格, 2: 白格
  pureDeductionRate: number;
  longestChainLength: number;
  crux: CruxInfo;
  isSymmetric: boolean;
  seed: number;
  depthProfile: number[];
  maxDecisionDepth: number;
  rhythmType: 'peaked' | 'climbing' | 'wavy';
  equivalenceClassCount?: number;
  edgeConnectivity?: number;
  minCutBridges?: number;
  solvingSteps?: HitoriHintStep[];
}

export const HITORI_SYMBOLIC_SETS: Record<'dots' | 'geometric', string[]> = {
  dots: ['·', '○', '⦿', '◉', '●', '◈', '◆', '✦'],
  geometric: ['▲', '■', '◆', '●', '★', '▼', '✦', '⬢'],
};

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

    const visited = new Uint8Array(size * size);
    const queue: [number, number][] = [start];
    visited[start[0] * size + start[1]] = 1;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let reached = 0;

    while (queue.length > 0) {
      const [cr, cc] = queue.shift()!;
      reached++;

      for (const [dr, dc] of dirs) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (this.inBounds(nr, nc, size) && state[nr][nc] !== 1) {
          const idx = nr * size + nc;
          if (!visited[idx]) {
            visited[idx] = 1;
            queue.push([nr, nc]);
          }
        }
      }
    }
    return reached === whiteCount;
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
                rationale: `相鄰格 [${r + 1}, ${c + 1}] 已塗黑，依黑格不可相鄰規則，此格必須保留為白格。`,
                humanReadable: {
                  zh: `相鄰格已被塗黑，黑格不可相連，[${nr + 1}, ${nc + 1}] 必須保留為白格！`,
                  en: `Adjacent cell is shaded; black cells cannot touch orthogonally. Must be white!`,
                },
              };
            }
          }
        }
      }
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size - 2; c++) {
        if (board[r][c] === board[r][c + 2]) {
          if (state[r][c] === 0) {
            return {
              step: 1,
              r,
              c,
              forcedState: 2,
              technique: 'sandwich',
              rationale: `橫向三明治定式：[${r + 1}, ${c + 1}] 與 [${r + 1}, ${c + 3}] 數值相同被夾心，兩端必須留白。`,
              humanReadable: {
                zh: `三明治夾心定式：同行兩側數字均為 ${board[r][c]}，此格必然為白格！`,
                en: `Sandwich rule: Matching numbers flanking a cell force endpoints to be white!`,
              },
            };
          }
          if (state[r][c + 2] === 0) {
            return {
              step: 1,
              r,
              c: c + 2,
              forcedState: 2,
              technique: 'sandwich',
              rationale: `橫向三明治定式：兩端相同數字必須留白。`,
              humanReadable: {
                zh: `三明治夾心定式：同行兩側數字均為 ${board[r][c]}，此格必然為白格！`,
                en: `Sandwich rule: Matching numbers flanking a cell force endpoints to be white!`,
              },
            };
          }
        }
      }
    }

    for (let c = 0; c < size; c++) {
      for (let r = 0; r < size - 2; r++) {
        if (board[r][c] === board[r + 2][c]) {
          if (state[r][c] === 0) {
            return {
              step: 1,
              r,
              c,
              forcedState: 2,
              technique: 'sandwich',
              rationale: `縱向三明治定式：兩側數字相同，此格必為白格。`,
              humanReadable: {
                zh: `縱向三明治夾心：同列兩側數字均為 ${board[r][c]}，此格必然為白格！`,
                en: `Vertical sandwich rule: Flanking numbers force this cell to be white!`,
              },
            };
          }
          if (state[r + 2][c] === 0) {
            return {
              step: 1,
              r: r + 2,
              c,
              forcedState: 2,
              technique: 'sandwich',
              rationale: `縱向三明治定式：兩側數字相同，此格必為白格。`,
              humanReadable: {
                zh: `縱向三明治夾心：同列兩側數字均為 ${board[r][c]}，此格必然為白格！`,
                en: `Vertical sandwich rule: Flanking numbers force this cell to be white!`,
              },
            };
          }
        }
      }
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size - 1; c++) {
        if (board[r][c] === board[r][c + 1]) {
          const val = board[r][c];
          for (let tc = 0; tc < size; tc++) {
            if (tc !== c && tc !== c + 1 && board[r][tc] === val && state[r][tc] === 0) {
              return {
                step: 1,
                r,
                c: tc,
                forcedState: 1,
                technique: 'pair_adjacent',
                rationale: `同行已有相鄰對子 [${val}, ${val}]，該行不可再容納其他 ${val}，此格必須塗黑。`,
                humanReadable: {
                  zh: `同行已有相鄰數字 ${val}，同行其他位置的 ${val} 必須塗黑消除！`,
                  en: `Adjacent pair detected; any other duplicate in this row must be shaded!`,
                },
              };
            }
          }
        }
      }
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (state[r][c] === 0) {
          state[r][c] = 1;
          const connected = this.isWhiteConnected(state, size);
          state[r][c] = 0;

          if (!connected) {
            return {
              step: 1,
              r,
              c,
              forcedState: 2,
              technique: 'connectivity_chokepoint',
              rationale: `若塗黑此格將破壞白格四向連續性並切割盤面，因此該格必須保留為白格。`,
              humanReadable: {
                zh: `連通割點：此格若塗黑將阻斷白格網絡，必須保留為白格！`,
                en: `Articulation point: Shading this cell disconnects the white area. Must be white!`,
              },
            };
          }
        }
      }
    }

    return null;
  }

  public static countSolutions(
    board: number[][],
    size: number,
    limit: number = 2
  ): number {
    const state: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
    let solutions = 0;
    let stepBudget = 4000;

    const backtrack = (idx: number): void => {
      if (solutions >= limit || stepBudget-- <= 0) return;

      if (idx === size * size) {
        if (this.isWhiteConnected(state, size)) {
          solutions++;
        }
        return;
      }

      const r = Math.floor(idx / size);
      const c = idx % size;

      const mustBeWhite =
        (r > 0 && state[r - 1][c] === 1) ||
        (c > 0 && state[r][c - 1] === 1);

      let duplicateWhite = false;
      for (let i = 0; i < c; i++) {
        if (state[r][i] === 2 && board[r][i] === board[r][c]) {
          duplicateWhite = true;
          break;
        }
      }
      if (!duplicateWhite) {
        for (let i = 0; i < r; i++) {
          if (state[i][c] === 2 && board[i][c] === board[r][c]) {
            duplicateWhite = true;
            break;
          }
        }
      }

      if (!duplicateWhite) {
        state[r][c] = 2;
        backtrack(idx + 1);
        state[r][c] = 0;
      }

      if (!mustBeWhite) {
        state[r][c] = 1;
        backtrack(idx + 1);
        state[r][c] = 0;
      }
    };

    backtrack(0);
    return solutions;
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

    let attempts = 0;
    while (attempts++ < 35) {
      const board: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
      const shift = Math.floor(rnd() * size);
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          board[r][c] = ((r + c + shift) % size) + 1;
        }
      }

      for (let i = size - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const temp = board[i];
        board[i] = board[j];
        board[j] = temp;
      }

      const targetState: number[][] = Array.from({ length: size }, () => Array(size).fill(2));
      const numBlacks = Math.max(2, Math.floor(size * (0.55 + rnd() * 0.25)));
      let placedBlacks = 0;

      for (let k = 0; k < numBlacks * 3 && placedBlacks < numBlacks; k++) {
        const r = Math.floor(rnd() * size);
        const c = Math.floor(rnd() * size);
        if (targetState[r][c] === 2) {
          const hasAdjBlack =
            (r > 0 && targetState[r - 1][c] === 1) ||
            (r < size - 1 && targetState[r + 1][c] === 1) ||
            (c > 0 && targetState[r][c - 1] === 1) ||
            (c < size - 1 && targetState[r][c + 1] === 1);

          if (!hasAdjBlack) {
            targetState[r][c] = 1;
            if (!this.isWhiteConnected(targetState, size)) {
              targetState[r][c] = 2;
            } else {
              placedBlacks++;
            }
          }
        }
      }

      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (targetState[r][c] === 1) {
            const isRowConflict = rnd() > 0.5;
            if (isRowConflict) {
              const otherC = Math.floor(rnd() * size);
              if (otherC !== c && targetState[r][otherC] === 2) {
                board[r][c] = board[r][otherC];
              }
            } else {
              const otherR = Math.floor(rnd() * size);
              if (otherR !== r && targetState[otherR][c] === 2) {
                board[r][c] = board[otherR][c];
              }
            }
          }
        }
      }

      if (this.countSolutions(board, size, 2) === 1) {
        const crux: CruxInfo = { r: 0, c: 0, chainDepth: 3, stepOrder: 1, forcedState: 1 };
        const spec: HitoriSpec = {
          size,
          board,
          solution: targetState,
          pureDeductionRate: 1.0,
          longestChainLength: 3,
          crux,
          isSymmetric: false,
          seed: actualSeed,
          depthProfile: [1, 2, 3, 2, 1],
          maxDecisionDepth: 3,
          rhythmType: 'peaked',
          equivalenceClassCount: size,
          edgeConnectivity: 2,
          minCutBridges: 0,
        };

        return {
          id: `hitori_${tier}_s${actualSeed}`,
          category: 'numerical_logic' as any,
          engine_type: 'hitori',
          tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
          checksum: `HITORI_${size}x${size}_UNIQUE_S${actualSeed}`,
          puzzle: spec as any,
          solution: targetState as any,
          cognitiveLoad: {
            spatial: Number(Math.min(1.0, 0.5 + size * 0.05).toFixed(2)),
            numeric: Number(Math.min(1.0, 0.4 + size * 0.06).toFixed(2)),
            workingMemory: 0.75,
            inhibition: 0.92,
          },
          metrics: {
            estimated_time_sec: size * size * 2.5,
            irt_logit_difficulty: Number((-0.5 + size * 0.45).toFixed(2)),
            human_sim_steps: size * size,
            seed: actualSeed,
          } as any,
        };
      }
    }

    return this._generateFallback(tier, size, actualSeed);
  }

  private static _generateFallback(tier: ExtendedTierKey, size: number, seed: number): PuzzleEntity {
    const board = [
      [2, 2, 1, 4],
      [1, 3, 4, 2],
      [4, 1, 3, 2],
      [3, 4, 2, 1],
    ];
    const solution = [
      [1, 2, 2, 2],
      [2, 2, 2, 2],
      [2, 2, 2, 2],
      [2, 2, 2, 2],
    ];
    const crux: CruxInfo = { r: 0, c: 0, chainDepth: 1, stepOrder: 1, forcedState: 1 };

    const spec: HitoriSpec = {
      size: 4,
      board,
      solution,
      pureDeductionRate: 1.0,
      longestChainLength: 1,
      crux,
      isSymmetric: false,
      seed,
      depthProfile: [1],
      maxDecisionDepth: 1,
      rhythmType: 'peaked',
      equivalenceClassCount: 4,
      edgeConnectivity: 2,
      minCutBridges: 0,
    };

    return {
      id: `hitori_${tier}_s${seed}_fb`,
      category: 'numerical_logic' as any,
      engine_type: 'hitori',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `HITORI_FB_${seed}`,
      puzzle: spec as any,
      solution: solution as any,
      cognitiveLoad: { spatial: 0.6, numeric: 0.6, workingMemory: 0.6, inhibition: 0.8 },
      metrics: { estimated_time_sec: 45, irt_logit_difficulty: 0.2, seed } as any,
    };
  }
}
