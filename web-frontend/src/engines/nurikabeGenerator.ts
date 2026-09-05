// web-frontend/src/engines/nurikabeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';
export type NurikabeCellState = 0 | 1 | 2; // 0: 未決, 1: 黑海, 2: 白島

export type NurikabeTechnique =
  | 'clue_adjacent_wall'
  | 'two_by_two_wall_prevent'
  | 'isolated_sea_escape'
  | 'island_expansion_forced'
  | 'adjacent_island_barrier';

export interface NurikabeHintStep {
  step: number;
  r: number;
  c: number;
  forcedState: NurikabeCellState;
  technique: NurikabeTechnique;
  techniqueIcon: string;
  techniqueName: { zh: string; en: string };
  evidenceCells: [number, number][];
  rationale: string;
  humanReadable: { zh: string; en: string };
}

export interface NurikabeSpec {
  rows: number;
  cols: number;
  grid: (number | null)[][];
  solution: boolean[][]; // true: 黑海, false: 白島
  tier: ExtendedTierKey;
  seed: number;
  metricsAnalysis?: {
    is180Symmetric: boolean;
    totalIslands: number;
    blackCellRatio: number;
  };
}

interface TierConfig {
  rows: number;
  cols: number;
  baseIrt: number;
}

const TIER_SPECS: Record<ExtendedTierKey, TierConfig> = {
  kids: { rows: 5, cols: 5, baseIrt: -0.5 },
  intermediate: { rows: 6, cols: 6, baseIrt: 0.4 },
  expert: { rows: 7, cols: 7, baseIrt: 1.4 },
  master: { rows: 8, cols: 8, baseIrt: 2.3 },
  legendary: { rows: 9, cols: 9, baseIrt: 3.1 },
  ultimate: { rows: 10, cols: 10, baseIrt: 3.9 },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebNurikabeGenerator {
  public static inBounds(r: number, c: number, rows: number, cols: number): boolean {
    return r >= 0 && r < rows && c >= 0 && c < cols;
  }

  public static verifySolution(
    rows: number,
    cols: number,
    grid: (number | null)[][],
    board: NurikabeCellState[][]
  ): boolean {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 0) return false;
      }
    }

    // 嚴格杜絕 2x2 黑海池
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (
          board[r][c] === 1 &&
          board[r + 1][c] === 1 &&
          board[r][c + 1] === 1 &&
          board[r + 1][c + 1] === 1
        ) {
          return false;
        }
      }
    }

    // 黑海連通性校驗
    let startBlack: [number, number] | null = null;
    let totalBlacks = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          totalBlacks++;
          if (!startBlack) startBlack = [r, c];
        }
      }
    }

    if (!startBlack || totalBlacks === 0) return false;

    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const visitedBlack = new Uint8Array(rows * cols);
    visitedBlack[startBlack[0] * cols + startBlack[1]] = 1;
    const queue: [number, number][] = [startBlack];
    let reachedBlacks = 0;

    while (queue.length > 0) {
      const [cr, cc] = queue.shift()!;
      reachedBlacks++;
      for (const [dr, dc] of dirs) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 1) {
          const idx = nr * cols + nc;
          if (!visitedBlack[idx]) {
            visitedBlack[idx] = 1;
            queue.push([nr, nc]);
          }
        }
      }
    }
    if (reachedBlacks !== totalBlacks) return false;

    // 白島連通性與數字精確性校驗
    const visitedWhite = new Uint8Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const startIdx = r * cols + c;
        if (board[r][c] === 2 && !visitedWhite[startIdx]) {
          let islandSize = 0;
          let clueCount = 0;
          let targetClue = 0;
          const wQueue: [number, number][] = [[r, c]];
          visitedWhite[startIdx] = 1;

          while (wQueue.length > 0) {
            const [cr, cc] = wQueue.shift()!;
            islandSize++;

            if (grid[cr][cc] !== null) {
              clueCount++;
              targetClue = grid[cr][cc]!;
            }

            for (const [dr, dc] of dirs) {
              const nr = cr + dr;
              const nc = cc + dc;
              if (this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 2) {
                const nIdx = nr * cols + nc;
                if (!visitedWhite[nIdx]) {
                  visitedWhite[nIdx] = 1;
                  wQueue.push([nr, nc]);
                }
              }
            }
          }

          if (clueCount !== 1 || islandSize !== targetClue) {
            return false;
          }
        }
      }
    }

    return true;
  }

  public static getNextForcedDeduction(
    rows: number,
    cols: number,
    grid: (number | null)[][],
    board: NurikabeCellState[][]
  ): NurikabeHintStep | null {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    // 定式 1: 線索 1 周邊隔離
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 1) {
          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 0) {
              return {
                step: 1,
                r: nr,
                c: nc,
                forcedState: 1,
                technique: 'clue_adjacent_wall',
                techniqueIcon: '🎯',
                techniqueName: { zh: '線索 1 正交隔離', en: 'Clue 1 Wall Ring' },
                evidenceCells: [[r, c]],
                rationale: `島嶼數字為 1 且自身已完備，正交相鄰方向強制填黑海隔離。`,
                humanReadable: {
                  zh: `[${r + 1}, ${c + 1}] 為容量 1 的島嶼，四周相鄰單元格必須標記為黑海！`,
                  en: `Island [${r + 1}, ${c + 1}] has size 1; neighbor cell must be a wall.`,
                },
              };
            }
          }
        }
      }
    }

    // 定式 2: 2x2 防黑海池預警定式
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const block: [number, number][] = [
          [r, c], [r + 1, c], [r, c + 1], [r + 1, c + 1],
        ];
        const blacks = block.filter(([br, bc]) => board[br][bc] === 1);
        const unassigned = block.filter(([br, bc]) => board[br][bc] === 0);

        if (blacks.length === 3 && unassigned.length === 1) {
          const [tr, tc] = unassigned[0];
          return {
            step: 1,
            r: tr,
            c: tc,
            forcedState: 2,
            technique: 'two_by_two_wall_prevent',
            techniqueIcon: '🛡️',
            techniqueName: { zh: '2×2 防池破壞', en: '2×2 Pool Shield' },
            evidenceCells: blacks,
            rationale: `2x2 邊界防禦：此處若填黑海將形成違規的 2x2 黑海池，強制留白島點標。`,
            humanReadable: {
              zh: `若填黑將形成違規的 2×2 黑海水池，此處必須點亮為白格點！`,
              en: `Filling wall creates an illegal 2x2 pool; must be marked white dot.`,
            },
          };
        }
      }
    }

    // 定式 3: 兩不同島嶼相鄰阻隔
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== null) {
          for (const [dr, dc] of dirs) {
            const nr = r + dr * 2;
            const nc = c + dc * 2;
            const midR = r + dr;
            const midC = c + dc;
            if (this.inBounds(nr, nc, rows, cols) && grid[nr][nc] !== null) {
              if (board[midR][midC] === 0) {
                return {
                  step: 1,
                  r: midR,
                  c: midC,
                  forcedState: 1,
                  technique: 'adjacent_island_barrier',
                  techniqueIcon: '🧱',
                  techniqueName: { zh: '島嶼相撞隔離', en: 'Adjacent Island Barrier' },
                  evidenceCells: [[r, c], [nr, nc]],
                  rationale: `兩相鄰島嶼線索不可互相連通融合，中間夾心格強制為黑海隔離壁。`,
                  humanReadable: {
                    zh: `[${r + 1},${c + 1}] 與 [${nr + 1},${nc + 1}] 為兩個獨立島嶼，夾心格強制築黑海隔離！`,
                    en: `Distinct island clues cannot merge; middle cell forced black wall.`,
                  },
                };
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * 帶約束的島嶼多生長合法解建構器
   */
  private static _generateValidBoard(
    rows: number,
    cols: number,
    rnd: () => number
  ): { grid: (number | null)[][]; solution: boolean[][] } | null {
    const board: NurikabeCellState[][] = Array.from({ length: rows }, () => Array(cols).fill(1));
    const grid: (number | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));

    const numIslands = Math.max(2, Math.floor((rows * cols) / 10));
    const islandCells: [number, number][][] = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    // 1. 散播不相鄰的種子點
    const candidates: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) candidates.push([r, c]);
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    for (const [r, c] of candidates) {
      if (islandCells.length >= numIslands) break;

      // 種子點周邊不能與現存種子正交相鄰
      const hasAdjSeed = islandCells.some((cells) =>
        cells.some(([ir, ic]) => Math.abs(ir - r) + Math.abs(ic - c) <= 1)
      );

      if (!hasAdjSeed) {
        board[r][c] = 2;
        islandCells.push([[r, c]]);
      }
    }

    // 2. 隨機擴展島嶼面積 (大小 1 ~ 3)
    for (const cells of islandCells) {
      const targetSize = 1 + Math.floor(rnd() * 3);
      while (cells.length < targetSize) {
        const base = cells[Math.floor(rnd() * cells.length)];
        const openNeighbors: [number, number][] = [];

        for (const [dr, dc] of dirs) {
          const nr = base[0] + dr;
          const nc = base[1] + dc;
          if (this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 1) {
            // 不能與其他島嶼碰觸
            const touchesOther = islandCells.some((other) =>
              other !== cells && other.some(([oir, oic]) => Math.abs(oir - nr) + Math.abs(oic - nc) === 1)
            );
            if (!touchesOther) openNeighbors.push([nr, nc]);
          }
        }

        if (openNeighbors.length === 0) break;
        const [pickR, pickC] = openNeighbors[Math.floor(rnd() * openNeighbors.length)];
        board[pickR][pickC] = 2;
        cells.push([pickR, pickC]);
      }
    }

    // 3. 在每個島嶼中指定一格填入數字線索
    for (const cells of islandCells) {
      const clueCell = cells[0];
      grid[clueCell[0]][clueCell[1]] = cells.length;
    }

    // 4. 驗證全域連通與無 2x2 黑海
    if (!this.verifySolution(rows, cols, grid, board)) return null;

    const solution = board.map((row) => row.map((cell) => cell === 1));
    return { grid, solution };
  }

  public static generate(tier: ExtendedTierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, baseIrt } = config;

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    let attempts = 0;
    while (attempts++ < 50) {
      const constructed = this._generateValidBoard(rows, cols, rnd);
      if (!constructed) continue;

      const { grid, solution } = constructed;
      const totalCells = rows * cols;
      const blackCount = solution.flat().filter(Boolean).length;
      const blackCellRatio = Number((blackCount / totalCells).toFixed(2));

      const spec: NurikabeSpec = {
        rows,
        cols,
        grid,
        solution,
        tier,
        seed: actualSeed,
        metricsAnalysis: {
          is180Symmetric: false,
          totalIslands: grid.flat().filter((x) => x !== null).length,
          blackCellRatio,
        },
      };

      return {
        id: `nurikabe_${tier}_s${actualSeed}`,
        category: 'spatial_logic' as any,
        engine_type: 'nurikabe',
        tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
        checksum: `NURIKABE_${rows}x${cols}_S${actualSeed}`,
        puzzle: spec as any,
        solution: solution as any,
        cognitiveLoad: {
          spatial: 0.92,
          numeric: 0.4,
          workingMemory: 0.82,
          inhibition: 0.9,
        },
        metrics: {
          estimated_time_sec: Math.max(30, rows * cols * 2.8),
          irt_logit_difficulty: baseIrt,
          seed: actualSeed,
          actualTier: tier,
        } as any,
      };
    }

    return this._generateFallback(tier, rows, cols, actualSeed, baseIrt);
  }

  private static _generateFallback(
    tier: ExtendedTierKey,
    rows: number,
    cols: number,
    seed: number,
    baseIrt: number
  ): PuzzleEntity {
    const grid: (number | null)[][] = [
      [2, null, null, null, 1],
      [null, null, null, null, null],
      [null, null, 2, null, null],
      [null, null, null, null, null],
      [1, null, null, null, 2],
    ];
    const solution: boolean[][] = [
      [false, false, true, true, false],
      [true, true, true, true, true],
      [true, true, false, false, true],
      [true, true, true, true, true],
      [false, true, true, false, false],
    ];

    return {
      id: `nurikabe_${tier}_s${seed}_fb`,
      category: 'spatial_logic' as any,
      engine_type: 'nurikabe',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `NURIKABE_FB_${seed}`,
      puzzle: { rows: 5, cols: 5, grid, solution, tier, seed } as any,
      solution: solution as any,
      cognitiveLoad: { spatial: 0.85, numeric: 0.3, workingMemory: 0.7, inhibition: 0.8 },
      metrics: { estimated_time_sec: 60, irt_logit_difficulty: baseIrt, seed } as any,
    };
  }
}
