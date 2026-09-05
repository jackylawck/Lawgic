// web-frontend/src/engines/slitherlinkGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';

export type EdgeState = 0 | 1 | 2; // 0: 未決, 1: 實線 (連線), 2: 標叉 (禁止)

export type SlitherlinkTechnique =
  | 'zero_corner_cross'
  | 'three_adjacent_three'
  | 'three_diagonal_zero'
  | 'corner_three_turns'
  | 'degree_two_continuation'
  | 'subloop_prevention';

export interface SlitherlinkHintStep {
  step: number;
  type: 'H' | 'V';
  r: number;
  c: number;
  forcedState: EdgeState;
  technique: SlitherlinkTechnique;
  evidenceCells: [number, number][];
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface SlitherlinkSpec {
  rows: number;
  cols: number;
  grid: (number | null)[][];
  solutionEdges: {
    hEdges: boolean[][]; // (rows + 1) x cols
    vEdges: boolean[][]; // rows x (cols + 1)
  };
  tier: ExtendedTierKey;
  seed: number;
  metricsAnalysis?: {
    totalTurns: number;
    is180Symmetric: boolean;
    clueCount: number;
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

export class WebSlitherlinkGenerator {
  /**
   * 驗證單一封閉 Euler 迴路
   */
  public static verifySingleLoop(
    rows: number,
    cols: number,
    hEdges: boolean[][],
    vEdges: boolean[][]
  ): boolean {
    const dotRows = rows + 1;
    const dotCols = cols + 1;
    let totalActiveEdges = 0;
    let startDot: [number, number] | null = null;

    for (let r = 0; r < dotRows; r++) {
      for (let c = 0; c < dotCols; c++) {
        let deg = 0;
        if (c < cols && hEdges[r][c]) deg++;
        if (c > 0 && hEdges[r][c - 1]) deg++;
        if (r < rows && vEdges[r][c]) deg++;
        if (r > 0 && vEdges[r - 1][c]) deg++;

        if (deg !== 0 && deg !== 2) return false;
        if (deg === 2) {
          totalActiveEdges++;
          if (!startDot) startDot = [r, c];
        }
      }
    }

    if (!startDot || totalActiveEdges === 0) return false;

    const visited = new Set<string>();
    let curr: [number, number] | null = startDot;
    let prevDir = -1;
    const dirs = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    const oppDir = [2, 3, 0, 1];
    let count = 0;

    while (curr) {
      const key = `${curr[0]},${curr[1]}`;
      if (visited.has(key)) {
        return curr[0] === startDot[0] && curr[1] === startDot[1] && count === totalActiveEdges;
      }
      visited.add(key);
      count++;

      const [r, c] = curr;
      let nextDir = -1;

      if (r > 0 && vEdges[r - 1][c] && prevDir !== 0) nextDir = 0;
      else if (c < cols && hEdges[r][c] && prevDir !== 1) nextDir = 1;
      else if (r < rows && vEdges[r][c] && prevDir !== 2) nextDir = 2;
      else if (c > 0 && hEdges[r][c - 1] && prevDir !== 3) nextDir = 3;

      if (nextDir === -1) return false;
      curr = [r + dirs[nextDir][0], c + dirs[nextDir][1]];
      prevDir = oppDir[nextDir];
    }

    return false;
  }

  /**
   * 因果推導定式推理引擎
   */
  public static getNextForcedDeduction(
    rows: number,
    cols: number,
    grid: (number | null)[][],
    hEdges: EdgeState[][],
    vEdges: EdgeState[][]
  ): SlitherlinkHintStep | null {
    // 定式 1: 0 周圍四邊必然全為標叉 (2)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 0) {
          if (hEdges[r][c] === 0) {
            return {
              step: 1, type: 'H', r, c, forcedState: 2, technique: 'zero_corner_cross',
              evidenceCells: [[r, c]],
              rationale: `線索 0 的四個邊界嚴禁任何連線，頂邊必須打叉。`,
              humanReadable: { zh: `觀察 [${r + 1},${c + 1}] 的數字 0：周圍四邊嚴禁連線，頂邊強制標叉。`, en: `Clue 0 cannot touch any edge; top edge marked cross.` }
            };
          }
          if (hEdges[r + 1][c] === 0) {
            return {
              step: 1, type: 'H', r: r + 1, c, forcedState: 2, technique: 'zero_corner_cross',
              evidenceCells: [[r, c]],
              rationale: `線索 0 的底邊必須打叉。`,
              humanReadable: { zh: `[${r + 1},${c + 1}] 數字 0 的底邊強制打叉。`, en: `Clue 0 bottom edge marked cross.` }
            };
          }
          if (vEdges[r][c] === 0) {
            return {
              step: 1, type: 'V', r, c, forcedState: 2, technique: 'zero_corner_cross',
              evidenceCells: [[r, c]],
              rationale: `線索 0 的左邊必須打叉。`,
              humanReadable: { zh: `[${r + 1},${c + 1}] 數字 0 的左邊強制打叉。`, en: `Clue 0 left edge marked cross.` }
            };
          }
          if (vEdges[r][c + 1] === 0) {
            return {
              step: 1, type: 'V', r, c: c + 1, forcedState: 2, technique: 'zero_corner_cross',
              evidenceCells: [[r, c]],
              rationale: `線索 0 的右邊必須打叉。`,
              humanReadable: { zh: `[${r + 1},${c + 1}] 數字 0 的右邊強制打叉。`, en: `Clue 0 right edge marked cross.` }
            };
          }
        }
      }
    }

    // 定式 2: 相鄰 3-3 複合定式
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (grid[r][c] === 3 && grid[r][c + 1] === 3) {
          if (vEdges[r][c + 1] === 0) {
            return {
              step: 1, type: 'V', r, c: c + 1, forcedState: 1, technique: 'three_adjacent_three',
              evidenceCells: [[r, c], [r, c + 1]],
              rationale: `相鄰 3-3 定式：橫向相鄰的兩個 3 之間的中隔邊必然為實體連線。`,
              humanReadable: { zh: `經典 3-3 定式：相鄰兩數字 3 中間的分割線必然連線。`, en: `Adjacent 3-3: shared middle edge must be connected.` }
            };
          }
        }
      }
    }

    // 定式 3: 頂點出入度連續定式
    const dotRows = rows + 1;
    const dotCols = cols + 1;
    for (let r = 0; r < dotRows; r++) {
      for (let c = 0; c < dotCols; c++) {
        let activeCount = 0;
        const openOptions: { type: 'H' | 'V'; r: number; c: number }[] = [];

        if (r > 0) {
          if (vEdges[r - 1][c] === 1) activeCount++;
          else if (vEdges[r - 1][c] === 0) openOptions.push({ type: 'V', r: r - 1, c });
        }
        if (c < cols) {
          if (hEdges[r][c] === 1) activeCount++;
          else if (hEdges[r][c] === 0) openOptions.push({ type: 'H', r, c });
        }
        if (r < rows) {
          if (vEdges[r][c] === 1) activeCount++;
          else if (vEdges[r][c] === 0) openOptions.push({ type: 'V', r, c });
        }
        if (c > 0) {
          if (hEdges[r][c - 1] === 1) activeCount++;
          else if (hEdges[r][c - 1] === 0) openOptions.push({ type: 'H', r, c: c - 1 });
        }

        if (activeCount === 1 && openOptions.length === 1) {
          const opt = openOptions[0];
          return {
            step: 1, type: opt.type, r: opt.r, c: opt.c, forcedState: 1, technique: 'degree_two_continuation',
            evidenceCells: [[Math.min(rows - 1, r), Math.min(cols - 1, c)]],
            rationale: `頂點度數守恆（Degree = 2）：此端點僅剩唯一延伸通道，必須強制連通。`,
            humanReadable: { zh: `頂點連續性：迴路端點只有一條路徑可延伸，強制畫出實線。`, en: `Vertex degree must equal 2; single exit forced.` }
          };
        }
      }
    }

    return null;
  }

  public static generate(tier: ExtendedTierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, baseIrt } = config;

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    const hEdges = Array.from({ length: rows + 1 }, () => Array(cols).fill(false));
    const vEdges = Array.from({ length: rows }, () => Array(cols + 1).fill(false));

    for (let c = 0; c < cols; c++) {
      hEdges[0][c] = true;
      hEdges[rows][c] = true;
    }
    for (let r = 0; r < rows; r++) {
      vEdges[r][0] = true;
      vEdges[r][cols] = true;
    }

    const grid: (number | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));
    let clueCount = 0;

    for (let r = 0; r < Math.ceil(rows / 2); r++) {
      for (let c = 0; c < cols; c++) {
        const symR = rows - 1 - r;
        const symC = cols - 1 - c;

        const countEdges = (cr: number, cc: number) => {
          let cnt = 0;
          if (hEdges[cr][cc]) cnt++;
          if (hEdges[cr + 1][cc]) cnt++;
          if (vEdges[cr][cc]) cnt++;
          if (vEdges[cr][cc + 1]) cnt++;
          return cnt;
        };

        if (rnd() < 0.45) {
          const val1 = countEdges(r, c);
          const val2 = countEdges(symR, symC);
          grid[r][c] = val1;
          grid[symR][symC] = val2;
          clueCount += (r === symR && c === symC ? 1 : 2);
        }
      }
    }

    const solutionEdges = { hEdges, vEdges };
    const spec: SlitherlinkSpec = {
      rows,
      cols,
      grid,
      solutionEdges,
      tier,
      seed: actualSeed,
      metricsAnalysis: {
        totalTurns: (rows + cols) * 2,
        is180Symmetric: true,
        clueCount,
      },
    };

    return {
      id: `slitherlink_${tier}_s${actualSeed}`,
      category: 'topological' as any,
      engine_type: 'slitherlink',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `SLITHERLINK_${rows}x${cols}_SYM180_S${actualSeed}`,
      puzzle: spec as any,
      solution: solutionEdges as any,
      cognitiveLoad: {
        spatial: 0.88,
        numeric: 0.4,
        workingMemory: 0.75,
        inhibition: 0.9,
      },
      metrics: {
        estimated_time_sec: Math.max(30, rows * cols * 2.6),
        irt_logit_difficulty: baseIrt,
        seed: actualSeed,
        actualTier: tier,
        is180Symmetric: true,
      } as any,
    };
  }
}
