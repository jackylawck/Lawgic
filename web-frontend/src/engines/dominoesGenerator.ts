// web-frontend/src/engines/dominoesGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';

export interface DominoPiece {
  id: number;
  val1: number;
  val2: number;
}

export type DominoBorderState = 0 | 1 | 2; // 0: 未決, 1: 骨牌連線 (實體), 2: 分割牆 (紅線/隔離)

export type DominoTechnique =
  | 'single_domino_candidate'
  | 'dead_end_forced'
  | 'exhausted_pair_barrier'
  | 'checkerboard_2x2_exclusion'
  | 'parity_lock';

export interface DominoHintStep {
  step: number;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  forcedType: 1 | 2; // 1: 成牌, 2: 隔離牆
  technique: DominoTechnique;
  evidenceCells: [number, number][];
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
  dominoes: DominoPiece[];
  solutionBorders: {
    hBorders: boolean[][];
    vBorders: boolean[][];
  };
  tier: ExtendedTierKey;
  seed: number;
}

interface TierConfig {
  maxPip: number;
  baseIrt: number;
}

const TIER_SPECS: Record<ExtendedTierKey, TierConfig> = {
  kids: { maxPip: 3, baseIrt: -0.5 },
  intermediate: { maxPip: 4, baseIrt: 0.4 },
  expert: { maxPip: 5, baseIrt: 1.4 },
  master: { maxPip: 6, baseIrt: 2.3 },
  legendary: { maxPip: 6, baseIrt: 3.1 },
  ultimate: { maxPip: 7, baseIrt: 3.9 },
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
  public static getDominoKey(v1: number, v2: number): string {
    return `${Math.min(v1, v2)}-${Math.max(v1, v2)}`;
  }

  public static generateDominoSet(maxPip: number): DominoPiece[] {
    const pieces: DominoPiece[] = [];
    let id = 0;
    for (let i = 0; i <= maxPip; i++) {
      for (let j = i; j <= maxPip; j++) {
        pieces.push({ id: id++, val1: i, val2: j });
      }
    }
    return pieces;
  }

  public static countSolutions(
    rows: number,
    cols: number,
    grid: number[][],
    dominoSet: DominoPiece[],
    limit: number = 2
  ): number {
    let solutionCount = 0;
    let stepBudget = 3500;

    const covered = Array.from({ length: rows }, () => Array(cols).fill(false));
    const usedDominoes = new Set<string>();

    const backtrack = (r: number, c: number): void => {
      if (solutionCount >= limit || stepBudget-- <= 0) return;

      while (r < rows && covered[r][c]) {
        c++;
        if (c === cols) {
          c = 0;
          r++;
        }
      }

      if (r === rows) {
        solutionCount++;
        return;
      }

      const dirs = [[0, 1], [1, 0]];
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < rows && nc < cols && !covered[nr][nc]) {
          const key = WebDominoesGenerator.getDominoKey(grid[r][c], grid[nr][nc]);
          if (!usedDominoes.has(key)) {
            usedDominoes.add(key);
            covered[r][c] = true;
            covered[nr][nc] = true;

            const nextC = c === cols - 1 ? 0 : c + 1;
            const nextR = c === cols - 1 ? r + 1 : r;
            backtrack(nextR, nextC);

            covered[r][c] = false;
            covered[nr][nc] = false;
            usedDominoes.delete(key);

            if (solutionCount >= limit) return;
          }
        }
      }
    };

    backtrack(0, 0);
    return solutionCount;
  }

  /**
   * 賽事級因果推導定式引擎（含奇偶性與 2x2 交錯）
   */
  public static getNextForcedDeduction(
    rows: number,
    cols: number,
    grid: number[][],
    hBorders: DominoBorderState[][],
    vBorders: DominoBorderState[][],
    dominoSet: DominoPiece[]
  ): DominoHintStep | null {
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];

    // 定式 1: 孤立端點死胡同強制定型
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isConnected =
          (c < cols - 1 && hBorders[r][c] === 1) ||
          (c > 0 && hBorders[r][c - 1] === 1) ||
          (r < rows - 1 && vBorders[r][c] === 1) ||
          (r > 0 && vBorders[r - 1][c] === 1);

        if (isConnected) continue;

        const openNeighbors: [number, number][] = [];
        for (const [dr, dc] of dirs) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const isNeighborConnected =
              (nc < cols - 1 && hBorders[nr][nc] === 1) ||
              (nc > 0 && hBorders[nr][nc - 1] === 1) ||
              (nr < rows - 1 && vBorders[nr][nc] === 1) ||
              (nr > 0 && vBorders[nr - 1][nc] === 1);

            if (!isNeighborConnected) {
              let isBlocked = false;
              if (dr === 0 && dc === 1) isBlocked = hBorders[r][c] === 2;
              else if (dr === 0 && dc === -1) isBlocked = hBorders[r][c - 1] === 2;
              else if (dr === 1 && dc === 0) isBlocked = vBorders[r][c] === 2;
              else if (dr === -1 && dc === 0) isBlocked = vBorders[r - 1][c] === 2;

              if (!isBlocked) openNeighbors.push([nr, nc]);
            }
          }
        }

        if (openNeighbors.length === 1) {
          const [nr, nc] = openNeighbors[0];
          return {
            step: 1,
            r1: r,
            c1: c,
            r2: nr,
            c2: nc,
            forcedType: 1,
            technique: 'dead_end_forced',
            evidenceCells: [[r, c], [nr, nc]],
            rationale: `格 [${r + 1},${c + 1}] 其他方向已被邊界牆封死，僅剩 [${nr + 1},${nc + 1}] 為唯一合法相鄰格，強制結合成骨牌。`,
            humanReadable: {
              zh: `觀察 [${r + 1}, ${c + 1}]：其他方向皆被隔離牆阻斷，只能與 [${nr + 1}, ${nc + 1}] 結合，強制連成骨牌！`,
              en: `Cell [${r + 1}, ${c + 1}] is isolated; it must pair with its sole open neighbor [${nr + 1}, ${nc + 1}].`,
            },
          };
        }
      }
    }

    // 定式 2: 全盤唯一候選骨牌
    const activeConfirmedKeys = new Set<string>();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (hBorders[r][c] === 1) activeConfirmedKeys.add(WebDominoesGenerator.getDominoKey(grid[r][c], grid[r][c + 1]));
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        if (vBorders[r][c] === 1) activeConfirmedKeys.add(WebDominoesGenerator.getDominoKey(grid[r][c], grid[r + 1][c]));
      }
    }

    for (const piece of dominoSet) {
      const pKey = WebDominoesGenerator.getDominoKey(piece.val1, piece.val2);
      if (activeConfirmedKeys.has(pKey)) continue;

      const candidates: [number, number, number, number][] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (c < cols - 1 && hBorders[r][c] === 0) {
            if (WebDominoesGenerator.getDominoKey(grid[r][c], grid[r][c + 1]) === pKey) {
              candidates.push([r, c, r, c + 1]);
            }
          }
          if (r < rows - 1 && vBorders[r][c] === 0) {
            if (WebDominoesGenerator.getDominoKey(grid[r][c], grid[r + 1][c]) === pKey) {
              candidates.push([r, c, r + 1, c]);
            }
          }
        }
      }

      if (candidates.length === 1) {
        const [r1, c1, r2, c2] = candidates[0];
        return {
          step: 1,
          r1,
          c1,
          r2,
          c2,
          forcedType: 1,
          technique: 'single_domino_candidate',
          evidenceCells: [[r1, c1], [r2, c2]],
          rationale: `骨牌 [${piece.val1}-${piece.val2}] 在全盤上僅剩唯一容納位置，強制成牌。`,
          humanReadable: {
            zh: `骨牌 [${piece.val1}-${piece.val2}] 在全盤中僅剩 [${r1 + 1},${c1 + 1}] 與 [${r2 + 1},${c2 + 1}] 能容納，必然成牌。`,
            en: `Domino [${piece.val1}-${piece.val2}] has only one possible placement on the entire board.`,
          },
        };
      }
    }

    // 定式 3: 2x2 四格交錯排除 (Checkerboard 2x2 Exclusion)
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        // 若 (r,c)-(r,c+1) 與 (r+1,c)-(r+1,c+1) 構成相同的骨牌，但該骨牌全盤只有一張配額
        const topKey = WebDominoesGenerator.getDominoKey(grid[r][c], grid[r][c + 1]);
        const bottomKey = WebDominoesGenerator.getDominoKey(grid[r + 1][c], grid[r + 1][c + 1]);

        if (topKey === bottomKey && hBorders[r][c] === 0 && hBorders[r + 1][c] === 0) {
          // 兩組水平若同時成牌會違規重複，因此水平不可同時成立，若一側垂直成牌，另一側強制隔離
          if (vBorders[r][c] === 1 && hBorders[r + 1][c] === 0) {
            return {
              step: 1,
              r1: r + 1,
              c1: c,
              r2: r + 1,
              c2: c + 1,
              forcedType: 2,
              technique: 'checkerboard_2x2_exclusion',
              evidenceCells: [[r, c], [r + 1, c], [r, c + 1], [r + 1, c + 1]],
              rationale: `2x2 區域內若 [${r + 2},${c + 1}] 水平成牌將引發骨牌 [${bottomKey}] 配額重複，強制劃上隔離牆。`,
              humanReadable: {
                zh: `2x2 交錯排除：左側已縱向成牌，下方若水平成牌會引發骨牌重複，[${r + 2},${c + 1}] 與 [${r + 2},${c + 2}] 間必為隔離牆。`,
                en: `2x2 Checkerboard exclusion: pairing horizontally would cause domino duplication. Forced barrier placed.`,
              },
            };
          }
        }
      }
    }

    // 定式 4: 骨牌配額已滿邊界封閉 (Exhausted Pair Barrier)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // 檢查未鎖定的水平相鄰格
        if (c < cols - 1 && hBorders[r][c] === 0) {
          const key = WebDominoesGenerator.getDominoKey(grid[r][c], grid[r][c + 1]);
          if (activeConfirmedKeys.has(key)) {
            return {
              step: 1,
              r1: r,
              c1: c,
              r2: r,
              c2: c + 1,
              forcedType: 2,
              technique: 'exhausted_pair_barrier',
              evidenceCells: [[r, c], [r, c + 1]],
              rationale: `骨牌 [${key}] 已在盤面其他位置確認鎖定，此處不能再次成牌，強制劃上隔離邊界。`,
              humanReadable: {
                zh: `骨牌 [${key}] 已被鎖定，此處相鄰格不可再重複成牌，強制劃上隔離紅線。`,
                en: `Domino [${key}] has already been placed elsewhere. Forced barrier between these cells.`,
              },
            };
          }
        }
        // 檢查未鎖定的垂直相鄰格
        if (r < rows - 1 && vBorders[r][c] === 0) {
          const key = WebDominoesGenerator.getDominoKey(grid[r][c], grid[r + 1][c]);
          if (activeConfirmedKeys.has(key)) {
            return {
              step: 1,
              r1: r,
              c1: c,
              r2: r + 1,
              c2: c,
              forcedType: 2,
              technique: 'exhausted_pair_barrier',
              evidenceCells: [[r, c], [r + 1, c]],
              rationale: `骨牌 [${key}] 已被鎖定，垂直方向不可成牌，強制劃上隔離牆。`,
              humanReadable: {
                zh: `骨牌 [${key}] 已經在其他位置使用，垂直相鄰格強制劃上隔離紅線。`,
                en: `Domino [${key}] already exhausted. Forced vertical barrier.`,
              },
            };
          }
        }
      }
    }

    return null;
  }

  public static generate(tier: ExtendedTierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { maxPip, baseIrt } = config;

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    const dominoSet = this.generateDominoSet(maxPip);
    const totalCells = dominoSet.length * 2;

    let rows = Math.floor(Math.sqrt(totalCells));
    while (totalCells % rows !== 0) rows--;
    const cols = totalCells / rows;

    let attempts = 0;
    const maxAttempts = 35;

    while (attempts < maxAttempts) {
      attempts++;

      const solutionBorders = this._generateRandomTiling(rows, cols, rnd);
      if (!solutionBorders) continue;

      const shuffledPieces = [...dominoSet];
      for (let i = shuffledPieces.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [shuffledPieces[i], shuffledPieces[j]] = [shuffledPieces[j], shuffledPieces[i]];
      }

      const grid = Array.from({ length: rows }, () => Array(cols).fill(-1));
      let pieceIdx = 0;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (grid[r][c] !== -1) continue;
          const piece = shuffledPieces[pieceIdx++];
          const isFlipped = rnd() < 0.5;
          const v1 = isFlipped ? piece.val2 : piece.val1;
          const v2 = isFlipped ? piece.val1 : piece.val2;

          grid[r][c] = v1;
          if (c < cols - 1 && solutionBorders.hBorders[r][c]) {
            grid[r][c + 1] = v2;
          } else if (r < rows - 1 && solutionBorders.vBorders[r][c]) {
            grid[r + 1][c] = v2;
          }
        }
      }

      const solutions = this.countSolutions(rows, cols, grid, dominoSet, 2);
      if (solutions !== 1) continue;

      const puzzleId = `dominoes_${tier}_s${actualSeed}`;
      const spec: DominoesSpec = {
        rows,
        cols,
        maxPip,
        grid,
        dominoes: dominoSet,
        solutionBorders,
        tier,
        seed: actualSeed,
      };

      return {
        id: puzzleId,
        category: 'spatial_logic' as any,
        engine_type: 'dominoes',
        tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
        checksum: `DOMINOES_${rows}x${cols}_P${maxPip}_S${actualSeed}`,
        puzzle: spec as any,
        solution: solutionBorders as any,
        cognitiveLoad: {
          spatial: Number(Math.min(1.0, 0.4 + (rows * cols) / 100).toFixed(2)),
          numeric: Number(Math.min(1.0, 0.3 + (maxPip / 7) * 0.5).toFixed(2)),
          workingMemory: Number(Math.min(1.0, 0.45 + (maxPip / 7) * 0.45).toFixed(2)),
          inhibition: 0.88,
        },
        metrics: {
          estimated_time_sec: Math.max(30, rows * cols * 2.5),
          irt_logit_difficulty: baseIrt,
          human_sim_steps: dominoSet.length,
          seed: actualSeed,
          actualTier: tier,
        } as any,
      };
    }

    return this._generateFallback(tier, maxPip, actualSeed, baseIrt);
  }

  private static _generateRandomTiling(
    rows: number,
    cols: number,
    rnd: () => number
  ): { hBorders: boolean[][]; vBorders: boolean[][] } | null {
    const hBorders = Array.from({ length: rows }, () => Array(cols - 1).fill(false));
    const vBorders = Array.from({ length: rows - 1 }, () => Array(cols).fill(false));
    const covered = Array.from({ length: rows }, () => Array(cols).fill(false));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (covered[r][c]) continue;

        const options: ('H' | 'V')[] = [];
        if (c < cols - 1 && !covered[r][c + 1]) options.push('H');
        if (r < rows - 1 && !covered[r + 1][c]) options.push('V');

        if (options.length === 0) return null;

        const chosen = options[Math.floor(rnd() * options.length)];
        covered[r][c] = true;
        if (chosen === 'H') {
          covered[r][c + 1] = true;
          hBorders[r][c] = true;
        } else {
          covered[r + 1][c] = true;
          vBorders[r][c] = true;
        }
      }
    }
    return { hBorders, vBorders };
  }

  private static _generateFallback(
    tier: ExtendedTierKey,
    maxPip: number,
    seed: number,
    baseIrt: number
  ): PuzzleEntity {
    const rows = 4;
    const cols = 5;
    const dominoSet = this.generateDominoSet(3);
    const grid = [
      [0, 0, 1, 1, 2],
      [1, 2, 2, 3, 2],
      [0, 3, 0, 3, 3],
      [1, 3, 2, 0, 1],
    ];
    const solutionBorders = {
      hBorders: [
        [true, false, true, false],
        [false, true, false, false],
        [false, false, false, true],
        [true, false, true, false],
      ],
      vBorders: [
        [false, false, false, false, true],
        [true, true, true, true, false],
        [false, false, false, false, false],
      ],
    };

    return {
      id: `dominoes_${tier}_s${seed}_fb`,
      category: 'spatial_logic' as any,
      engine_type: 'dominoes',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `DOMINOES_FB_${seed}`,
      puzzle: { rows, cols, maxPip: 3, grid, dominoes: dominoSet, solutionBorders, tier, seed } as any,
      solution: solutionBorders as any,
      cognitiveLoad: { spatial: 0.6, numeric: 0.4, workingMemory: 0.6, inhibition: 0.8 },
      metrics: { estimated_time_sec: 45, irt_logit_difficulty: baseIrt, seed } as any,
    };
  }
}
