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
  kids: { rows: 5, cols: 5, density: 0.55, minPureRate: 1.0, baseIrt: -0.6 },
  intermediate: { rows: 6, cols: 6, density: 0.52, minPureRate: 0.95, baseIrt: 0.3 },
  expert: { rows: 8, cols: 8, density: 0.5, minPureRate: 0.9, baseIrt: 1.2 },
  master: { rows: 10, cols: 10, density: 0.48, minPureRate: 0.85, baseIrt: 2.2 },
  legendary: { rows: 12, cols: 12, density: 0.46, minPureRate: 0.88, baseIrt: 3.0 },
  ultimate: { rows: 15, cols: 15, density: 0.45, minPureRate: 0.88, baseIrt: 3.8 },
};

// 記憶化快取：大幅加速 15x15 的行列排列組合計算，避免瀏覽器主執行緒卡頓
const permCache = new Map<string, boolean[][]>();

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

  public static generateLinePermutations(length: number, clues: number[]): boolean[][] {
    const key = `${length}:${clues.join(',')}`;
    if (permCache.has(key)) {
      return permCache.get(key)!;
    }

    if (clues.length === 1 && clues[0] === 0) {
      const res = [Array(length).fill(false)];
      permCache.set(key, res);
      return res;
    }

    const results: boolean[][] = [];
    const minSpaces = clues.reduce((a, b) => a + b, 0) + clues.length - 1;
    if (minSpaces > length) {
      permCache.set(key, []);
      return [];
    }

    const backtrack = (clueIdx: number, startPos: number, current: boolean[]) => {
      if (clueIdx === clues.length) {
        const fullLine = [...current, ...Array(length - current.length).fill(false)];
        results.push(fullLine);
        return;
      }

      const blockLen = clues[clueIdx];
      const remainingCluesSum = clues.slice(clueIdx + 1).reduce((a, b) => a + b, 0);
      const minRequiredAfter = remainingCluesSum + (clues.length - 1 - clueIdx);
      const maxStart = length - minRequiredAfter - blockLen;

      for (let pos = startPos; pos <= maxStart; pos++) {
        const nextCurrent = [...current, ...Array(pos - current.length).fill(false), ...Array(blockLen).fill(true)];
        if (clueIdx < clues.length - 1) {
          nextCurrent.push(false);
        }
        backtrack(clueIdx + 1, nextCurrent.length, nextCurrent);
      }
    };

    backtrack(0, 0, []);
    permCache.set(key, results);
    return results;
  }

  public static getLineOverlap(
    length: number,
    clues: number[],
    currentLine: number[]
  ): number[] {
    const allPerms = this.generateLinePermutations(length, clues);
    const validPerms = allPerms.filter((perm) => {
      for (let i = 0; i < length; i++) {
        if (currentLine[i] === 1 && !perm[i]) return false;
        if (currentLine[i] === 2 && perm[i]) return false;
      }
      return true;
    });

    if (validPerms.length === 0) return Array(length).fill(0);

    const result = Array(length).fill(0);
    for (let i = 0; i < length; i++) {
      const allTrue = validPerms.every((p) => p[i] === true);
      const allFalse = validPerms.every((p) => p[i] === false);
      if (allTrue) result[i] = 1;
      else if (allFalse) result[i] = 2;
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
              ? `第 ${r + 1} 行線索 [${rowClues[r].join(', ')}] 在所有可能排布中，此格均覆蓋黑色`
              : `第 ${r + 1} 行線索 [${rowClues[r].join(', ')}] 無任何合法排布能觸及此格，必標叉號`,
            humanReadable: {
              zh: isBlack
                ? `觀察第 ${r + 1} 行：根據線索 [${rowClues[r].join(', ')}] 的兩端極限位移，該格必處於重疊段內（必黑）。`
                : `觀察第 ${r + 1} 行：根據線索 [${rowClues[r].join(', ')}]，沒有任何可能組合能覆蓋該格（必叉）。`,
              en: isBlack
                ? `Inspect Row ${r + 1}: Line clues [${rowClues[r].join(', ')}] overlap forces this cell to be FILLED.`
                : `Inspect Row ${r + 1}: No valid placement for clues [${rowClues[r].join(', ')}] can reach here; must be CROSSED.`,
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
              ? `第 ${c + 1} 列線索 [${colClues[c].join(', ')}] 極限重疊必然填黑`
              : `第 ${c + 1} 列線索 [${colClues[c].join(', ')}] 空間排除必然標叉`,
            humanReadable: {
              zh: isBlack
                ? `觀察第 ${c + 1} 列：根據線索 [${colClues[c].join(', ')}] 的重疊交集，該格必為黑色。`
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

    while (changed) {
      changed = false;
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

    if (pureRate === 1.0) {
      return { unique: true, pureRate: 1.0 };
    }

    let solutionCount = 0;
    const solveBacktrack = (r: number, c: number): void => {
      if (solutionCount >= 2) return;
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
        if (solutionCount >= 2) return;
      }
    };

    solveBacktrack(0, 0);
    return { unique: solutionCount === 1, pureRate };
  }

  public static generate(tier: ExtendedTierKey = 'kids'): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, density, minPureRate, baseIrt } = config;

    let attempts = 0;
    while (attempts < 60) {
      attempts++;

      const solution: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < Math.ceil(cols / 2); c++) {
          const isFilled = Math.random() < density;
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
      const puzzleId = `nonogram_${tier}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

      const spec: NonogramSpec = {
        rows,
        cols,
        rowClues,
        colClues,
        solution,
        pureDeductionRate: evaluation.pureRate,
        complexityScore: totalClueNumbers,
        tier,
      };

      return {
        id: puzzleId,
        category: 'spatial_logic' as any,
        engine_type: 'nonogram',
        tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
        checksum: `NONOGRAM_${rows}x${cols}_${tier.toUpperCase()}_${Date.now().toString(36)}`,
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
        },
      };
    }

    const fallbackSolution = [
      [false, true, true, false],
      [true, true, true, true],
      [true, true, true, true],
      [false, true, true, false],
    ];
    const fbRowClues = fallbackSolution.map((r) => this.extractLineClues(r));
    const fbColClues = [0, 1, 2, 3].map((c) => this.extractLineClues(fallbackSolution.map((r) => r[c])));

    return {
      id: `nonogram_${tier}_fallback_${Date.now()}`,
      category: 'spatial_logic' as any,
      engine_type: 'nonogram',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `NONOGRAM_FALLBACK_${tier}`,
      puzzle: {
        rows: 4,
        cols: 4,
        rowClues: fbRowClues,
        colClues: fbColClues,
        solution: fallbackSolution,
        pureDeductionRate: 1.0,
        complexityScore: 8,
        tier,
      } as unknown as NonogramSpec,
      solution: fallbackSolution as any,
      cognitiveLoad: { spatial: 0.6, numeric: 0.4, workingMemory: 0.5, inhibition: 0.8 },
      metrics: { estimated_time_sec: 25, irt_logit_difficulty: config.baseIrt },
    };
  }
}
