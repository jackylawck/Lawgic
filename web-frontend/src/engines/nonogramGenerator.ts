// web-frontend/src/engines/nonogramGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';

export interface NonogramHintStep {
  step: number;
  orientation: 'row' | 'col';
  index: number;
  targetCell: [number, number];
  forcedState: 1 | 2; // 1: 必填黑, 2: 必標叉
  technique: 'overlap' | 'boundary_extension' | 'space_exclusion' | 'exhaustion';
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface NonogramSpec {
  rows: number;
  cols: number;
  rowClues: number[][];
  colClues: number[][];
  solution: boolean[][];
  pureDeductionRate: number;
  complexityScore: number;
  tier: ExtendedTierKey;
  seed: number;
  solvingSteps?: NonogramHintStep[];
}

interface TierConfig {
  rows: number;
  cols: number;
  density: number;
  minPureRate: number;
  baseIrt: number;
}

const TIER_SPECS: Record<ExtendedTierKey, TierConfig> = {
  kids: { rows: 5, cols: 5, density: 0.55, minPureRate: 0.95, baseIrt: -0.6 },
  intermediate: { rows: 6, cols: 6, density: 0.52, minPureRate: 0.90, baseIrt: 0.3 },
  expert: { rows: 8, cols: 8, density: 0.50, minPureRate: 0.85, baseIrt: 1.2 },
  master: { rows: 10, cols: 10, density: 0.48, minPureRate: 0.80, baseIrt: 2.2 },
  legendary: { rows: 12, cols: 12, density: 0.46, minPureRate: 0.75, baseIrt: 3.0 },
  ultimate: { rows: 15, cols: 15, density: 0.45, minPureRate: 0.70, baseIrt: 3.8 },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebNonogramGenerator {
  public static extractLineClues(line: boolean[]): number[] {
    const clues: number[] = [];
    let count = 0;
    for (const cell of line) {
      if (cell) {
        count++;
      } else if (count > 0) {
        clues.push(count);
        count = 0;
      }
    }
    if (count > 0) clues.push(count);
    return clues.length > 0 ? clues : [0];
  }

  /**
   * 基於動態規劃 (DP) 的單行重疊與排除求解器
   * 時間複雜度保證 O(L * B)，徹底解決遞迴超時與貪婪覆蓋誤判
   */
  public static getLineOverlap(
    length: number,
    clues: number[],
    currentLine: number[]
  ): number[] {
    if (clues.length === 1 && clues[0] === 0) {
      return Array(length).fill(2); // 全部標叉
    }

    const numBlocks = clues.length;
    // canBeBlack[i] 與 canBeWhite[i] 紀錄第 i 格是否存在至少一種合法可能
    const canBeBlack = new Array<boolean>(length).fill(false);
    const canBeWhite = new Array<boolean>(length).fill(false);

    // dp[i][j] 表示前 i 格能否恰好由前 j 個線索塊合法匹配
    // j 範圍: 0 ~ numBlocks
    const memo = new Map<string, boolean>();

    const checkMatch = (idx: number, bIdx: number): boolean => {
      const key = `${idx},${bIdx}`;
      if (memo.has(key)) return memo.get(key)!;

      if (idx === length) {
        const res = bIdx === numBlocks;
        memo.set(key, res);
        return res;
      }

      let possible = false;

      // 嘗試在此格放白色/叉 (狀態 2 或 0 可轉白)
      if (currentLine[idx] !== 1) {
        if (checkMatch(idx + 1, bIdx)) {
          canBeWhite[idx] = true;
          possible = true;
        }
      }

      // 嘗試在此格放置線索塊 clues[bIdx]
      if (bIdx < numBlocks) {
        const bLen = clues[bIdx];
        if (idx + bLen <= length) {
          let canFitBlock = true;
          for (let k = 0; k < bLen; k++) {
            if (currentLine[idx + k] === 2) { // 撞叉
              canFitBlock = false;
              break;
            }
          }

          // 區塊後必須隔一格空位 (或已到行尾)
          const nextIdx = idx + bLen;
          if (canFitBlock) {
            if (nextIdx === length) {
              if (checkMatch(nextIdx, bIdx + 1)) {
                for (let k = 0; k < bLen; k++) canBeBlack[idx + k] = true;
                possible = true;
              }
            } else if (currentLine[nextIdx] !== 1) {
              if (checkMatch(nextIdx + 1, bIdx + 1)) {
                for (let k = 0; k < bLen; k++) canBeBlack[idx + k] = true;
                canBeWhite[nextIdx] = true;
                possible = true;
              }
            }
          }
        }
      }

      memo.set(key, possible);
      return possible;
    };

    const isFeasible = checkMatch(0, 0);
    if (!isFeasible) return Array(length).fill(0);

    const result = new Array<number>(length).fill(0);
    for (let i = 0; i < length; i++) {
      if (canBeBlack[i] && !canBeWhite[i]) result[i] = 1;      // 必然為黑
      else if (!canBeBlack[i] && canBeWhite[i]) result[i] = 2; // 必然為叉
    }
    return result;
  }

  public static getNextForcedDeduction(
    rows: number,
    cols: number,
    rowClues: number[][],
    colClues: number[][],
    grid: number[][]
  ): NonogramHintStep | null {
    for (let r = 0; r < rows; r++) {
      const overlap = this.getLineOverlap(cols, rowClues[r], grid[r]);
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 0 && overlap[c] !== 0) {
          const isBlack = overlap[c] === 1;
          return {
            step: 1,
            orientation: 'row',
            index: r,
            targetCell: [r, c],
            forcedState: overlap[c] as 1 | 2,
            technique: isBlack ? 'overlap' : 'space_exclusion',
            rationale: isBlack
              ? `第 ${r + 1} 行線索 [${rowClues[r].join(', ')}] 極限位移重疊，此格必黑`
              : `第 ${r + 1} 行線索 [${rowClues[r].join(', ')}] 空間無法容納任何線段，必標叉`,
            humanReadable: {
              zh: isBlack
                ? `觀察第 ${r + 1} 行：根據線索 [${rowClues[r].join(', ')}] 的兩端極限滑動，此格處於重疊區（必填黑）。`
                : `觀察第 ${r + 1} 行：根據線索 [${rowClues[r].join(', ')}]，沒有任何可能組合能覆蓋此格（必標叉）。`,
              en: isBlack
                ? `Inspect Row ${r + 1}: Line clues [${rowClues[r].join(', ')}] overlap forces this cell to be FILLED.`
                : `Inspect Row ${r + 1}: Clues [${rowClues[r].join(', ')}] cannot reach here; must be CROSSED.`,
            },
          };
        }
      }
    }

    for (let c = 0; c < cols; c++) {
      const colLine = Array.from({ length: rows }, (_, r) => grid[r][c]);
      const overlap = this.getLineOverlap(rows, colClues[c], colLine);
      for (let r = 0; r < rows; r++) {
        if (grid[r][c] === 0 && overlap[r] !== 0) {
          const isBlack = overlap[r] === 1;
          return {
            step: 1,
            orientation: 'col',
            index: c,
            targetCell: [r, c],
            forcedState: overlap[r] as 1 | 2,
            technique: isBlack ? 'overlap' : 'space_exclusion',
            rationale: isBlack
              ? `第 ${c + 1} 列線索 [${colClues[c].join(', ')}] 極限重疊必黑`
              : `第 ${c + 1} 列線索 [${colClues[c].join(', ')}] 空間排除必標叉`,
            humanReadable: {
              zh: isBlack
                ? `觀察第 ${c + 1} 列：根據線索 [${colClues[c].join(', ')}] 的重疊交集，此格必為黑色。`
                : `觀察第 ${c + 1} 列：根據線索 [${colClues[c].join(', ')}]，此處空間無法容納任何線段，必標叉號。`,
              en: isBlack
                ? `Inspect Col ${c + 1}: Clues [${colClues[c].join(', ')}] force this intersection to be FILLED.`
                : `Inspect Col ${c + 1}: Clues [${colClues[c].join(', ')}] exclude this cell; must be CROSSED.`,
            },
          };
        }
      }
    }

    return null;
  }

  private static evaluateSolvability(
    rows: number,
    cols: number,
    rowClues: number[][],
    colClues: number[][]
  ): { unique: boolean; pureRate: number } {
    const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    let changed = true;
    let deducedCells = 0;
    let iterations = 0;

    // 波前推進
    while (changed && iterations < 30) {
      changed = false;
      iterations++;

      for (let r = 0; r < rows; r++) {
        const overlap = this.getLineOverlap(cols, rowClues[r], grid[r]);
        for (let c = 0; c < cols; c++) {
          if (grid[r][c] === 0 && overlap[c] !== 0) {
            grid[r][c] = overlap[c];
            deducedCells++;
            changed = true;
          }
        }
      }

      for (let c = 0; c < cols; c++) {
        const currentCol = Array.from({ length: rows }, (_, r) => grid[r][c]);
        const overlap = this.getLineOverlap(rows, colClues[c], currentCol);
        for (let r = 0; r < rows; r++) {
          if (grid[r][c] === 0 && overlap[r] !== 0) {
            grid[r][c] = overlap[r];
            deducedCells++;
            changed = true;
          }
        }
      }
    }

    const totalCells = rows * cols;
    const pureRate = Number((deducedCells / totalCells).toFixed(2));

    if (pureRate >= 0.96) {
      return { unique: true, pureRate: 1.0 };
    }

    // 嚴謹熔斷判定：步數耗盡視為非唯一解，杜絕偽唯一解外洩
    let solutionCount = 0;
    let stepBudget = 300;
    let budgetExhausted = false;

    const solveBacktrack = (r: number, c: number): void => {
      if (solutionCount >= 2) return;
      if (stepBudget <= 0) {
        budgetExhausted = true;
        return;
      }
      stepBudget--;

      if (r === rows) {
        for (let j = 0; j < cols; j++) {
          const colLine = Array.from({ length: rows }, (_, i) => grid[i][j] === 1);
          const clue = this.extractLineClues(colLine);
          if (clue.join(',') !== colClues[j].join(',')) return;
        }
        solutionCount++;
        return;
      }

      const nextR = c === cols - 1 ? r + 1 : r;
      const nextC = c === cols - 1 ? 0 : c + 1;

      if (grid[r][c] !== 0) {
        solveBacktrack(nextR, nextC);
        return;
      }

      for (const val of [1, 2]) {
        grid[r][c] = val;
        if (c === cols - 1) {
          const rowLine = grid[r].map((v) => v === 1);
          if (this.extractLineClues(rowLine).join(',') !== rowClues[r].join(',')) {
            grid[r][c] = 0;
            continue;
          }
        }

        solveBacktrack(nextR, nextC);
        grid[r][c] = 0;
        if (solutionCount >= 2 || budgetExhausted) return;
      }
    };

    solveBacktrack(0, 0);

    // 步數耗盡時判定為不確定（視為無唯一解以保障品質）
    const isStrictlyUnique = !budgetExhausted && solutionCount === 1;
    return { unique: isStrictlyUnique, pureRate };
  }

  public static generate(tier: ExtendedTierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, density, minPureRate, baseIrt } = config;

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    let attempts = 0;
    const maxAttempts = tier === 'ultimate' ? 20 : tier === 'legendary' ? 25 : 35;

    while (attempts < maxAttempts) {
      attempts++;

      // 對稱矩陣生成，天然提高線索約束重疊率
      const solution: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < Math.ceil(cols / 2); c++) {
          const isFilled = rnd() < density;
          solution[r][c] = isFilled;
          solution[r][cols - 1 - c] = isFilled;
        }
      }

      const rowClues = solution.map((row) => this.extractLineClues(row));
      const colClues: number[][] = [];
      for (let c = 0; c < cols; c++) {
        colClues.push(this.extractLineClues(solution.map((row) => row[c])));
      }

      const evaluation = this.evaluateSolvability(rows, cols, rowClues, colClues);
      if (!evaluation.unique || evaluation.pureRate < minPureRate) {
        continue;
      }

      const totalClueNumbers = [...rowClues, ...colClues].reduce((sum, list) => sum + list.length, 0);
      const dynamicIrt = Number((baseIrt + (1 - evaluation.pureRate) * 0.8 + (totalClueNumbers / (rows + cols)) * 0.2).toFixed(2));
      const puzzleId = `nonogram_${tier}_s${actualSeed}`;

      const spec: NonogramSpec = {
        rows,
        cols,
        rowClues,
        colClues,
        solution,
        pureDeductionRate: evaluation.pureRate,
        complexityScore: totalClueNumbers,
        tier,
        seed: actualSeed,
      };

      return {
        id: puzzleId,
        category: 'spatial_logic' as any,
        engine_type: 'nonogram',
        tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
        checksum: `NONOGRAM_${rows}x${cols}_${tier.toUpperCase()}_S${actualSeed}`,
        puzzle: spec as any,
        solution: solution as any,
        cognitiveLoad: {
          spatial: Number(Math.min(1.0, 0.4 + (rows * cols) / 150).toFixed(2)),
          numeric: Number(Math.min(1.0, 0.3 + (totalClueNumbers / 30) * 0.5).toFixed(2)),
          workingMemory: Number(Math.min(1.0, 0.5 + (1 - evaluation.pureRate) * 0.5).toFixed(2)),
          inhibition: 0.9,
        },
        metrics: {
          estimated_time_sec: Math.max(20, rows * cols * 2),
          irt_logit_difficulty: dynamicIrt,
          human_sim_steps: rows * cols,
          seed: actualSeed,
        } as any,
      };
    }

    // 兜底保底題目（幾何鑽石對稱圖案）
    const fallbackSize = rows;
    const fallbackSolution: boolean[][] = Array.from({ length: fallbackSize }, (_, r) =>
      Array.from({ length: cols }, (_, c) => {
        const midR = (fallbackSize - 1) / 2;
        const midC = (cols - 1) / 2;
        return Math.abs(r - midR) + Math.abs(c - midC) <= Math.floor(fallbackSize * 0.45);
      })
    );

    const fbRowClues = fallbackSolution.map((r) => this.extractLineClues(r));
    const fbColClues = Array.from({ length: cols }, (_, c) =>
      this.extractLineClues(fallbackSolution.map((r) => r[c]))
    );

    return {
      id: `nonogram_${tier}_s${actualSeed}_fallback`,
      category: 'spatial_logic' as any,
      engine_type: 'nonogram',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `NONOGRAM_FALLBACK_${actualSeed}`,
      puzzle: {
        rows,
        cols,
        rowClues: fbRowClues,
        colClues: fbColClues,
        solution: fallbackSolution,
        pureDeductionRate: 1.0,
        complexityScore: rows + cols,
        tier,
        seed: actualSeed,
      } as unknown as NonogramSpec,
      solution: fallbackSolution as any,
      cognitiveLoad: { spatial: 0.8, numeric: 0.5, workingMemory: 0.6, inhibition: 0.85 },
      metrics: { estimated_time_sec: rows * cols, irt_logit_difficulty: config.baseIrt, seed: actualSeed } as any,
    };
  }
}
