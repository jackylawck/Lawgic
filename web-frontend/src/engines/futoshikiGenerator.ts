// web-frontend/src/engines/futoshikiGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey;

export interface InequalityConstraint {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  op: '>' | '<';
}

export interface FutoshikiHintStep {
  step: number;
  r: number;
  c: number;
  forcedValue: number;
  technique: 'naked_single' | 'inequality_bound' | 'chain_elimination';
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface CruxInfo {
  r: number;
  c: number;
  chainDepth: number;
  stepOrder: number;
  forcedValue: number;
}

export interface FutoshikiSpec {
  rows: number;
  cols: number;
  size: number;
  initialGrid: number[][];
  grid?: number[][];
  clues?: any;
  inequalities: InequalityConstraint[];
  solution: number[][];
  pureDeductionRate: number;
  longestChainLength: number;
  crux: CruxInfo;
  isSymmetric: boolean;
  seed: number;
  depthProfile: number[];
  solvingSteps?: FutoshikiHintStep[];
}

export const SYMBOLIC_SETS: Record<'dots' | 'flora', string[]> = {
  dots: ['·', '○', '⦿', '◉', '●', '◈', '◆', '✦'],
  flora: ['🌱', '🌿', '☘️', '🪴', '🌲', '🌳', '🌴', '🏞️'],
};

interface TierConfig {
  size: number;
  givenRatio: number;
  inequalityCount: number;
  minChainLength: number;
  baseIrt: number;
  timeLimitSec: number;
}

// 支援完整 6 階 Tier 配置
const TIER_SPECS: Record<ExtendedTierKey, TierConfig> = {
  kids: { size: 4, givenRatio: 0.35, inequalityCount: 4, minChainLength: 2, baseIrt: 0.65, timeLimitSec: 90 },
  intermediate: { size: 5, givenRatio: 0.30, inequalityCount: 6, minChainLength: 3, baseIrt: 1.45, timeLimitSec: 150 },
  expert: { size: 6, givenRatio: 0.25, inequalityCount: 9, minChainLength: 4, baseIrt: 2.35, timeLimitSec: 240 },
  master: { size: 7, givenRatio: 0.20, inequalityCount: 13, minChainLength: 5, baseIrt: 3.15, timeLimitSec: 360 },
  legendary: { size: 8, givenRatio: 0.18, inequalityCount: 17, minChainLength: 6, baseIrt: 3.75, timeLimitSec: 480 },
  ultimate: { size: 9, givenRatio: 0.15, inequalityCount: 22, minChainLength: 7, baseIrt: 4.35, timeLimitSec: 600 },
};

export function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebFutoshikiGenerator {
  public static isValid(
    grid: number[][],
    size: number,
    inequalities: InequalityConstraint[],
    r: number,
    c: number,
    val: number
  ): boolean {
    for (let i = 0; i < size; i++) {
      if (i !== c && grid[r][i] === val) return false;
      if (i !== r && grid[i][c] === val) return false;
    }

    for (const ineq of inequalities) {
      if (ineq.r1 === r && ineq.c1 === c) {
        const other = grid[ineq.r2][ineq.c2];
        if (other !== 0) {
          if (ineq.op === '>' && !(val > other)) return false;
          if (ineq.op === '<' && !(val < other)) return false;
        }
      } else if (ineq.r2 === r && ineq.c2 === c) {
        const other = grid[ineq.r1][ineq.c1];
        if (other !== 0) {
          if (ineq.op === '>' && !(other > val)) return false;
          if (ineq.op === '<' && !(other < val)) return false;
        }
      }
    }
    return true;
  }

  public static getCandidates(
    grid: number[][],
    size: number,
    inequalities: InequalityConstraint[],
    r: number,
    c: number
  ): number[] {
    const list: number[] = [];
    for (let num = 1; num <= size; num++) {
      if (this.isValid(grid, size, inequalities, r, c, num)) {
        list.push(num);
      }
    }
    return list;
  }

  public static countSolutions(
    grid: number[][],
    size: number,
    inequalities: InequalityConstraint[],
    limit: number = 2
  ): number {
    let solutions = 0;
    let budget = 4000;
    const board = grid.map((row) => [...row]);

    const backtrackMRV = (): void => {
      if (solutions >= limit || budget-- <= 0) return;

      let minCandidatesCount = Infinity;
      let targetRow = -1;
      let targetCol = -1;
      let bestCandidates: number[] = [];

      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (board[r][c] === 0) {
            const candidates = this.getCandidates(board, size, inequalities, r, c);
            if (candidates.length === 0) return;

            if (candidates.length < minCandidatesCount) {
              minCandidatesCount = candidates.length;
              targetRow = r;
              targetCol = c;
              bestCandidates = candidates;
              if (minCandidatesCount === 1) break;
            }
          }
        }
        if (minCandidatesCount === 1) break;
      }

      if (targetRow === -1) {
        solutions++;
        return;
      }

      for (const val of bestCandidates) {
        board[targetRow][targetCol] = val;
        backtrackMRV();
        board[targetRow][targetCol] = 0;
        if (solutions >= limit) return;
      }
    };

    backtrackMRV();
    return solutions;
  }

  public static computeLongestChain(size: number, inequalities: InequalityConstraint[]): number {
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const key = `${r},${c}`;
        adj.set(key, []);
        inDegree.set(key, 0);
      }
    }

    for (const ineq of inequalities) {
      const u = ineq.op === '<' ? `${ineq.r1},${ineq.c1}` : `${ineq.r2},${ineq.c2}`;
      const v = ineq.op === '<' ? `${ineq.r2},${ineq.c2}` : `${ineq.r1},${ineq.c1}`;
      adj.get(u)!.push(v);
      inDegree.set(v, (inDegree.get(v) || 0) + 1);
    }

    const dist = new Map<string, number>();
    const queue: string[] = [];

    for (const [node, deg] of inDegree.entries()) {
      dist.set(node, 1);
      if (deg === 0) queue.push(node);
    }

    let maxLength = 1;
    while (queue.length > 0) {
      const u = queue.shift()!;
      const curDist = dist.get(u)!;
      for (const v of adj.get(u) || []) {
        const nextDist = Math.max(dist.get(v) || 1, curDist + 1);
        dist.set(v, nextDist);
        maxLength = Math.max(maxLength, nextDist);
        inDegree.set(v, (inDegree.get(v) || 1) - 1);
        if (inDegree.get(v) === 0) queue.push(v);
      }
    }

    return maxLength;
  }

  public static getNextForcedDeduction(
    grid: number[][],
    size: number,
    inequalities: InequalityConstraint[]
  ): FutoshikiHintStep | null {
    // 1. 唯餘數 (Naked Single)
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] !== 0) continue;
        const candidates = this.getCandidates(grid, size, inequalities, r, c);
        if (candidates.length === 1) {
          return {
            step: 1,
            r,
            c,
            forcedValue: candidates[0],
            technique: 'naked_single',
            rationale: `在 [${r + 1}, ${c + 1}]，排除同行列與不等約束後僅剩唯一候選數 ${candidates[0]}`,
            humanReadable: {
              zh: `單元格 [${r + 1}, ${c + 1}] 經過行、列與相鄰不等約束排除後，僅剩唯一候選數字 ${candidates[0]}！`,
              en: `Cell [${r + 1}, ${c + 1}] has only one valid candidate ${candidates[0]} remaining after constraint propagation!`,
            },
          };
        }
      }
    }

    // 2. 廣義不等式極值定式 (Generalized Inequality Bound)
    for (const ineq of inequalities) {
      const v1 = grid[ineq.r1][ineq.c1];
      const v2 = grid[ineq.r2][ineq.c2];

      if (ineq.op === '>') {
        if (v2 !== 0 && v1 === 0) {
          const valid = this.getCandidates(grid, size, inequalities, ineq.r1, ineq.c1).filter((x) => x > v2);
          if (valid.length === 1) {
            return {
              step: 1,
              r: ineq.r1,
              c: ineq.c1,
              forcedValue: valid[0],
              technique: 'inequality_bound',
              rationale: `此格大於相鄰的 ${v2}，在當前合法候選中僅能取 ${valid[0]}`,
              humanReadable: {
                zh: `單元格 [${ineq.r1 + 1}, ${ineq.c1 + 1}] 嚴格大於相鄰的 ${v2}，且只有數字 ${valid[0]} 符合條件！`,
                en: `Cell [${ineq.r1 + 1}, ${ineq.c1 + 1}] is strictly greater than ${v2}, forcing value ${valid[0]}!`,
              },
            };
          }
        }
        if (v1 !== 0 && v2 === 0) {
          const valid = this.getCandidates(grid, size, inequalities, ineq.r2, ineq.c2).filter((x) => x < v1);
          if (valid.length === 1) {
            return {
              step: 1,
              r: ineq.r2,
              c: ineq.c2,
              forcedValue: valid[0],
              technique: 'inequality_bound',
              rationale: `此格小於相鄰的 ${v1}，在當前合法候選中僅能取 ${valid[0]}`,
              humanReadable: {
                zh: `單元格 [${ineq.r2 + 1}, ${ineq.c2 + 1}] 嚴格小於相鄰的 ${v1}，且只有數字 ${valid[0]} 符合條件！`,
                en: `Cell [${ineq.r2 + 1}, ${ineq.c2 + 1}] is strictly less than ${v1}, forcing value ${valid[0]}!`,
              },
            };
          }
        }
      } else {
        if (v2 !== 0 && v1 === 0) {
          const valid = this.getCandidates(grid, size, inequalities, ineq.r1, ineq.c1).filter((x) => x < v2);
          if (valid.length === 1) {
            return {
              step: 1,
              r: ineq.r1,
              c: ineq.c1,
              forcedValue: valid[0],
              technique: 'inequality_bound',
              rationale: `此格小於相鄰的 ${v2}，在當前合法候選中僅能取 ${valid[0]}`,
              humanReadable: {
                zh: `單元格 [${ineq.r1 + 1}, ${ineq.c1 + 1}] 嚴格小於相鄰的 ${v2}，且只有數字 ${valid[0]} 符合條件！`,
                en: `Cell [${ineq.r1 + 1}, ${ineq.c1 + 1}] is strictly less than ${v2}, forcing value ${valid[0]}!`,
              },
            };
          }
        }
        if (v1 !== 0 && v2 === 0) {
          const valid = this.getCandidates(grid, size, inequalities, ineq.r2, ineq.c2).filter((x) => x > v1);
          if (valid.length === 1) {
            return {
              step: 1,
              r: ineq.r2,
              c: ineq.c2,
              forcedValue: valid[0],
              technique: 'inequality_bound',
              rationale: `此格大於相鄰的 ${v1}，在當前合法候選中僅能取 ${valid[0]}`,
              humanReadable: {
                zh: `單元格 [${ineq.r2 + 1}, ${ineq.c2 + 1}] 嚴格大於相鄰的 ${v1}，且只有數字 ${valid[0]} 符合條件！`,
                en: `Cell [${ineq.r2 + 1}, ${ineq.c2 + 1}] is strictly greater than ${v1}, forcing value ${valid[0]}!`,
              },
            };
          }
        }
      }
    }

    return null;
  }

  public static analyzeCruxAndProfile(
    initialGrid: number[][],
    size: number,
    inequalities: InequalityConstraint[]
  ): { crux: CruxInfo; depthProfile: number[] } {
    const simBoard = initialGrid.map((row) => [...row]);
    let maxChainFound = 0;
    let cruxCandidate: CruxInfo | null = null;
    let stepCount = 0;
    const stepDepths: number[] = [];

    while (true) {
      const deduction = this.getNextForcedDeduction(simBoard, size, inequalities);
      if (!deduction) break;

      stepCount++;
      simBoard[deduction.r][deduction.c] = deduction.forcedValue;

      const depth = deduction.technique === 'inequality_bound' ? 4 : 2;
      stepDepths.push(depth);

      if (depth >= maxChainFound) {
        maxChainFound = depth;
        cruxCandidate = {
          r: deduction.r,
          c: deduction.c,
          chainDepth: maxChainFound,
          stepOrder: stepCount,
          forcedValue: deduction.forcedValue,
        };
      }
    }

    if (!cruxCandidate) {
      const mid = Math.floor(size / 2);
      cruxCandidate = { r: mid, c: mid, chainDepth: 2, stepOrder: 1, forcedValue: 1 };
    }

    const profile: number[] = [1, 2, maxChainFound, Math.max(1, maxChainFound - 1), 1];
    if (stepDepths.length >= 5) {
      const stepSize = Math.floor(stepDepths.length / 5);
      for (let i = 0; i < 5; i++) {
        profile[i] = stepDepths[Math.min(i * stepSize, stepDepths.length - 1)];
      }
      profile[2] = maxChainFound;
    }

    return { crux: cruxCandidate, depthProfile: profile };
  }

  private static generateLatinSquare(size: number, rnd: () => number): number[][] {
    const square = Array.from({ length: size }, () => Array(size).fill(0));
    const nums = Array.from({ length: size }, (_, i) => i + 1);

    const shuffle = <T>(arr: T[]): T[] => {
      const result = [...arr];
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    };

    const fill = (r: number, c: number): boolean => {
      if (r === size) return true;
      const nextR = c === size - 1 ? r + 1 : r;
      const nextC = c === size - 1 ? 0 : c + 1;

      const shuffled = shuffle(nums);
      for (const val of shuffled) {
        let conflict = false;
        for (let i = 0; i < c; i++) {
          if (square[r][i] === val) { conflict = true; break; }
        }
        if (!conflict) {
          for (let i = 0; i < r; i++) {
            if (square[i][c] === val) { conflict = true; break; }
          }
        }

        if (!conflict) {
          square[r][c] = val;
          if (fill(nextR, nextC)) return true;
          square[r][c] = 0;
        }
      }
      return false;
    };

    fill(0, 0);
    return square;
  }

  public static generate(tier: ExtendedTierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { size, givenRatio, inequalityCount, minChainLength, baseIrt, timeLimitSec } = config;

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    let attempts = 0;
    while (attempts < 50) {
      attempts++;

      const solution = this.generateLatinSquare(size, rnd);
      const inequalities: InequalityConstraint[] = [];
      const edgeSet = new Set<string>();

      const addSymmetricHorizontal = (r: number, c: number) => {
        if (c + 1 >= size) return;
        const symR = size - 1 - r;
        const symC = size - 2 - c;

        const k1 = `H:${r},${c}`;
        const k2 = `H:${symR},${symC}`;
        if (edgeSet.has(k1) || edgeSet.has(k2)) return;

        const op1: '>' | '<' = solution[r][c] > solution[r][c + 1] ? '>' : '<';
        inequalities.push({ r1: r, c1: c, r2: r, c2: c + 1, op: op1 });
        edgeSet.add(k1);

        if (symR >= 0 && symR < size && symC >= 0 && symC + 1 < size && (symR !== r || symC !== c)) {
          const op2: '>' | '<' = solution[symR][symC] > solution[symR][symC + 1] ? '>' : '<';
          inequalities.push({ r1: symR, c1: symC, r2: symR, c2: symC + 1, op: op2 });
          edgeSet.add(k2);
        }
      };

      const addSymmetricVertical = (r: number, c: number) => {
        if (r + 1 >= size) return;
        const symR = size - 2 - r;
        const symC = size - 1 - c;

        const k1 = `V:${r},${c}`;
        const k2 = `V:${symR},${symC}`;
        if (edgeSet.has(k1) || edgeSet.has(k2)) return;

        const op1: '>' | '<' = solution[r][c] > solution[r + 1][c] ? '>' : '<';
        inequalities.push({ r1: r, c1: c, r2: r + 1, c2: c, op: op1 });
        edgeSet.add(k1);

        if (symR >= 0 && symR + 1 < size && symC >= 0 && symC < size && (symR !== r || symC !== c)) {
          const op2: '>' | '<' = solution[symR][symC] > solution[symR + 1][symC] ? '>' : '<';
          inequalities.push({ r1: symR, c1: symC, r2: symR + 1, c2: symC, op: op2 });
          edgeSet.add(k2);
        }
      };

      let pickAttempts = 0;
      while (inequalities.length < inequalityCount && pickAttempts < 60) {
        pickAttempts++;
        const isHoriz = rnd() > 0.5;
        const r = Math.floor(rnd() * size);
        const c = Math.floor(rnd() * size);
        if (isHoriz) addSymmetricHorizontal(r, c);
        else addSymmetricVertical(r, c);
      }

      const longestChain = this.computeLongestChain(size, inequalities);
      if (longestChain < minChainLength) continue;

      const initialGrid = solution.map((row) => [...row]);
      const totalCells = size * size;
      const targetGivens = Math.max(2, Math.floor(totalCells * givenRatio));
      const cellsToDig = totalCells - targetGivens;

      const cellPairs: [number, number, number, number][] = [];
      const visitedCells = new Set<string>();

      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const k1 = `${r},${c}`;
          if (visitedCells.has(k1)) continue;

          const symR = size - 1 - r;
          const symC = size - 1 - c;
          const k2 = `${symR},${symC}`;

          visitedCells.add(k1);
          visitedCells.add(k2);
          cellPairs.push([r, c, symR, symC]);
        }
      }

      for (let i = cellPairs.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [cellPairs[i], cellPairs[j]] = [cellPairs[j], cellPairs[i]];
      }

      let dug = 0;
      for (const [r1, c1, r2, c2] of cellPairs) {
        if (dug >= cellsToDig) break;
        const backup1 = initialGrid[r1][c1];
        const backup2 = initialGrid[r2][c2];

        initialGrid[r1][c1] = 0;
        initialGrid[r2][c2] = 0;

        if (
          this.getCandidates(initialGrid, size, inequalities, r1, c1).length === 0 ||
          this.getCandidates(initialGrid, size, inequalities, r2, c2).length === 0
        ) {
          initialGrid[r1][c1] = backup1;
          initialGrid[r2][c2] = backup2;
          continue;
        }

        if (this.countSolutions(initialGrid, size, inequalities, 2) === 1) {
          dug += r1 === r2 && c1 === c2 ? 1 : 2;
        } else {
          initialGrid[r1][c1] = backup1;
          initialGrid[r2][c2] = backup2;
        }
      }

      if (this.countSolutions(initialGrid, size, inequalities, 2) !== 1) {
        continue;
      }

      const { crux, depthProfile } = this.analyzeCruxAndProfile(initialGrid, size, inequalities);

      const puzzleId = `futoshiki_${tier}_s${actualSeed}`;
      const dynamicIrt = Number((baseIrt + longestChain * 0.15 + inequalities.length * 0.04).toFixed(2));

      const spec: FutoshikiSpec = {
        rows: size,
        cols: size,
        size,
        initialGrid,
        grid: initialGrid,
        clues: { grid: initialGrid, inequalities },
        inequalities,
        solution,
        pureDeductionRate: 1.0,
        longestChainLength: longestChain,
        crux,
        isSymmetric: true,
        seed: actualSeed,
        depthProfile,
      };

      return {
        id: puzzleId,
        category: 'numeric_logic',
        engine_type: 'futoshiki',
        tier,
        checksum: `FUTOSHIKI_${size}x${size}_S${actualSeed}_CRUX${crux.r}${crux.c}`,
        puzzle: spec,
        solution,
        cognitiveLoad: {
          spatial: 0.85,
          numeric: 0.95,
          workingMemory: Number(Math.min(1.0, 0.4 + longestChain * 0.08).toFixed(2)),
          inhibition: 0.9,
        },
        metrics: {
          estimated_time_sec: timeLimitSec,
          irt_logit_difficulty: dynamicIrt,
          human_sim_steps: totalCells,
          longestInequalityChain: longestChain,
          cruxCoordinates: [crux.r, crux.c],
          cruxChainDepth: crux.chainDepth,
          depthProfile,
          seed: actualSeed,
          isSymmetric: true,
        } as any,
      };
    }

    // 自適應尺寸的健全 Fallback（保留全部拓撲分析欄位）
    const fallbackLatin = this.generateLatinSquare(size, rnd);
    const fallbackIneqs: InequalityConstraint[] = [];
    for (let i = 0; i < size - 1; i++) {
      fallbackIneqs.push({
        r1: i,
        c1: i,
        r2: i,
        c2: i + 1,
        op: fallbackLatin[i][i] > fallbackLatin[i][i + 1] ? '>' : '<',
      });
    }

    const fallbackGrid = fallbackLatin.map((row, ri) =>
      row.map((val, ci) => (ri === ci ? val : 0))
    );

    const fallbackCrux: CruxInfo = { r: 0, c: 0, chainDepth: 2, stepOrder: 1, forcedValue: fallbackLatin[0][0] };

    const fallbackSpec: FutoshikiSpec = {
      rows: size,
      cols: size,
      size,
      initialGrid: fallbackGrid,
      grid: fallbackGrid,
      clues: { grid: fallbackGrid, inequalities: fallbackIneqs },
      inequalities: fallbackIneqs,
      solution: fallbackLatin,
      pureDeductionRate: 1.0,
      longestChainLength: 2,
      crux: fallbackCrux,
      isSymmetric: true,
      seed: actualSeed,
      depthProfile: [1, 2, 2, 1, 1],
    };

    return {
      id: `futoshiki_${tier}_s${actualSeed}_fallback`,
      category: 'numeric_logic',
      engine_type: 'futoshiki',
      tier,
      checksum: `FUTOSHIKI_FALLBACK_${size}x${size}_S${actualSeed}`,
      puzzle: fallbackSpec,
      solution: fallbackLatin,
      cognitiveLoad: { spatial: 0.7, numeric: 0.85, workingMemory: 0.6, inhibition: 0.8 },
      metrics: {
        estimated_time_sec: timeLimitSec,
        irt_logit_difficulty: config.baseIrt,
        longestInequalityChain: 2,
        cruxCoordinates: [0, 0],
        cruxChainDepth: 2,
        depthProfile: [1, 2, 2, 1, 1],
        seed: actualSeed,
        isSymmetric: true,
      } as any,
    };
  }
}
