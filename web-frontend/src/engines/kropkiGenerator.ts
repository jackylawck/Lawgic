// web-frontend/src/engines/kropkiGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type DeductionType =
  | 'dot_forced_white'
  | 'dot_forced_black'
  | 'naked_single'
  | 'hypothesis';

export interface KropkiDot {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  type: 'white' | 'black';
}

export interface SolvingStep {
  step: number;
  type: DeductionType;
  row: number;
  col: number;
  value: number;
  rationale: string;
}

export interface KropkiSpec {
  size: number;
  initialGrid: number[][];
  dots: KropkiDot[];
  solution: number[][];
  solvingSteps: SolvingStep[];
  inferenceDepth: number;
  maxForcedChain: number;
  isSymmetric180: boolean;
  pureDeductionRate: number;
}

interface TierConfig {
  size: number;
  targetPrefill: number;
  minCoverageRatio: number;
  minForcedChain: number;
  baseIrt: number;
}

const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { size: 4, targetPrefill: 4, minCoverageRatio: 0.85, minForcedChain: 3, baseIrt: -0.6 },
  intermediate: { size: 5, targetPrefill: 3, minCoverageRatio: 0.75, minForcedChain: 5, baseIrt: 0.3 },
  expert: { size: 6, targetPrefill: 2, minCoverageRatio: 0.65, minForcedChain: 8, baseIrt: 1.2 },
  master: { size: 7, targetPrefill: 0, minCoverageRatio: 0.55, minForcedChain: 12, baseIrt: 2.2 },
};

export class WebKropkiGenerator {
  private static generateLatinSquare(n: number): number[][] {
    const grid: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    const isValid = (r: number, c: number, v: number): boolean => {
      for (let i = 0; i < n; i++) {
        if (grid[r][i] === v || grid[i][c] === v) return false;
      }
      return true;
    };

    const solve = (r: number, c: number): boolean => {
      if (r === n) return true;
      const nr = c === n - 1 ? r + 1 : r;
      const nc = c === n - 1 ? 0 : c + 1;
      const nums = Array.from({ length: n }, (_, i) => i + 1).sort(() => Math.random() - 0.5);

      for (const num of nums) {
        if (isValid(r, c, num)) {
          grid[r][c] = num;
          if (solve(nr, nc)) return true;
          grid[r][c] = 0;
        }
      }
      return false;
    };

    solve(0, 0);
    return grid;
  }

  private static extractDotsStrict(solution: number[][], n: number): KropkiDot[] {
    const dots: KropkiDot[] = [];
    const evaluatePair = (r1: number, c1: number, r2: number, c2: number) => {
      const v1 = solution[r1][c1];
      const v2 = solution[r2][c2];
      if (Math.abs(v1 - v2) === 1) {
        dots.push({ r1, c1, r2, c2, type: 'white' });
      } else if (v1 === v2 * 2 || v2 === v1 * 2) {
        dots.push({ r1, c1, r2, c2, type: 'black' });
      }
    };

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (c + 1 < n) evaluatePair(r, c, r, c + 1);
        if (r + 1 < n) evaluatePair(r, c, r + 1, c);
      }
    }
    return dots;
  }

  private static checkSymmetry180(dots: KropkiDot[], n: number): boolean {
    const dotSet = new Set<string>();
    for (const d of dots) {
      dotSet.add(`${d.r1},${d.c1}-${d.r2},${d.c2}-${d.type}`);
    }

    for (const d of dots) {
      const sr1 = n - 1 - d.r1;
      const sc1 = n - 1 - d.c1;
      const sr2 = n - 1 - d.r2;
      const sc2 = n - 1 - d.c2;

      const [nr1, nc1, nr2, nc2] = (sr1 < sr2 || (sr1 === sr2 && sc1 < sc2))
        ? [sr1, sc1, sr2, sc2]
        : [sr2, sc2, sr1, sc1];

      if (!dotSet.has(`${nr1},${nc1}-${nr2},${nc2}-${d.type}`)) {
        return false;
      }
    }
    return true;
  }

  private static isDotCoverageSufficient(dots: KropkiDot[], n: number, minRatio: number): boolean {
    const degree = Array.from({ length: n }, () => Array(n).fill(0));
    for (const d of dots) {
      degree[d.r1][d.c1]++;
      degree[d.r2][d.c2]++;
    }

    let covered = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (degree[r][c] > 0) covered++;
      }
    }
    return covered / (n * n) >= minRatio;
  }

  private static countSolutions(
    initGrid: number[][],
    dots: KropkiDot[],
    n: number,
    limit: number = 2
  ): number {
    const grid = initGrid.map((row) => [...row]);
    let solutions = 0;

    const dotMap = new Map<string, KropkiDot[]>();
    for (const d of dots) {
      const k1 = `${d.r1},${d.c1}`;
      const k2 = `${d.r2},${d.c2}`;
      if (!dotMap.has(k1)) dotMap.set(k1, []);
      if (!dotMap.has(k2)) dotMap.set(k2, []);
      dotMap.get(k1)!.push(d);
      dotMap.get(k2)!.push(d);
    }

    const rowMask = new Uint32Array(n);
    const colMask = new Uint32Array(n);

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = grid[r][c];
        if (v > 0) {
          rowMask[r] |= 1 << v;
          colMask[c] |= 1 << v;
        }
      }
    }

    const satisfiesDots = (r: number, c: number, v: number): boolean => {
      const neighbors = dotMap.get(`${r},${c}`);
      if (!neighbors) return true;
      for (const d of neighbors) {
        const isHead = d.r1 === r && d.c1 === c;
        const or = isHead ? d.r2 : d.r1;
        const oc = isHead ? d.c2 : d.c1;
        const ov = grid[or][oc];
        if (ov === 0) continue;

        if (d.type === 'white' && Math.abs(v - ov) !== 1) return false;
        if (d.type === 'black' && v !== ov * 2 && ov !== v * 2) return false;
      }
      return true;
    };

    const getCandidates = (r: number, c: number): number[] => {
      const list: number[] = [];
      const used = rowMask[r] | colMask[c];
      for (let v = 1; v <= n; v++) {
        if (!(used & (1 << v)) && satisfiesDots(r, c, v)) {
          list.push(v);
        }
      }
      return list;
    };

    const search = (): void => {
      if (solutions >= limit) return;

      let minCount = 999;
      let target: [number, number, number[]] | null = null;

      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (grid[r][c] === 0) {
            const cand = getCandidates(r, c);
            if (cand.length === 0) return;
            if (cand.length < minCount) {
              minCount = cand.length;
              target = [r, c, cand];
              if (minCount === 1) break;
            }
          }
        }
        if (minCount === 1) break;
      }

      if (!target) {
        solutions++;
        return;
      }

      const [tr, tc, candidates] = target;
      for (const v of candidates) {
        grid[tr][tc] = v;
        rowMask[tr] |= 1 << v;
        colMask[tc] |= 1 << v;

        search();

        rowMask[tr] &= ~(1 << v);
        colMask[tc] &= ~(1 << v);
        grid[tr][tc] = 0;

        if (solutions >= limit) return;
      }
    };

    search();
    return solutions;
  }

  public static getStrictDeductions(
    currentGrid: number[][],
    dots: KropkiDot[],
    n: number
  ): Map<string, { value: number; type: DeductionType; rationale: string }> {
    const deductions = new Map<string, { value: number; type: DeductionType; rationale: string }>();

    for (const d of dots) {
      const v1 = currentGrid[d.r1][d.c1];
      const v2 = currentGrid[d.r2][d.c2];

      if ((v1 === 0 && v2 !== 0) || (v1 !== 0 && v2 === 0)) {
        const knownVal = v1 !== 0 ? v1 : v2;
        const tr = v1 === 0 ? d.r1 : d.r2;
        const tc = v1 === 0 ? d.c1 : d.c2;

        const candidates: number[] = [];
        if (d.type === 'white') {
          if (knownVal - 1 >= 1) candidates.push(knownVal - 1);
          if (knownVal + 1 <= n) candidates.push(knownVal + 1);
        } else {
          if (knownVal % 2 === 0 && knownVal / 2 >= 1) candidates.push(knownVal / 2);
          if (knownVal * 2 <= n) candidates.push(knownVal * 2);
        }

        const legalVals = candidates.filter((v) => {
          for (let i = 0; i < n; i++) {
            if (currentGrid[tr][i] === v || currentGrid[i][tc] === v) return false;
          }
          return true;
        });

        if (legalVals.length === 1) {
          deductions.set(`${tr},${tc}`, {
            value: legalVals[0],
            type: d.type === 'white' ? 'dot_forced_white' : 'dot_forced_black',
            rationale: d.type === 'white' ? 'White Dot Diff (+/-1) forced single value' : 'Black Dot Double (2x) forced single value',
          });
        }
      }
    }

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (currentGrid[r][c] === 0 && !deductions.has(`${r},${c}`)) {
          const used = new Set<number>();
          for (let i = 0; i < n; i++) {
            if (currentGrid[r][i] > 0) used.add(currentGrid[r][i]);
            if (currentGrid[i][c] > 0) used.add(currentGrid[i][c]);
          }
          const rem: number[] = [];
          for (let v = 1; v <= n; v++) {
            if (!used.has(v)) rem.push(v);
          }

          if (rem.length === 1) {
            deductions.set(`${r},${c}`, {
              value: rem[0],
              type: 'naked_single',
              rationale: 'Row/Col Naked Single elimination',
            });
          }
        }
      }
    }

    return deductions;
  }

  private static traceSolvingProcess(
    initialGrid: number[][],
    dots: KropkiDot[],
    n: number
  ): { depth: number; steps: SolvingStep[]; maxForcedChain: number; pureRate: number } {
    const grid = initialGrid.map((row) => [...row]);
    const steps: SolvingStep[] = [];
    let progressed = true;
    let stepCount = 0;
    let currentChain = 0;
    let maxChain = 0;

    while (progressed) {
      progressed = false;
      const deductions = this.getStrictDeductions(grid, dots, n);

      if (deductions.size > 0) {
        const [coord, info] = deductions.entries().next().value;
        const [r, c] = coord.split(',').map(Number);

        grid[r][c] = info.value;
        stepCount++;
        currentChain++;
        maxChain = Math.max(maxChain, currentChain);

        steps.push({
          step: stepCount,
          type: info.type,
          row: r,
          col: c,
          value: info.value,
          rationale: info.rationale,
        });

        progressed = true;
      } else {
        currentChain = 0;
      }
    }

    const totalToFill = n * n - initialGrid.flat().filter((v) => v > 0).length;
    const pureRate = totalToFill > 0 ? Number((steps.length / totalToFill).toFixed(2)) : 1.0;

    return {
      depth: steps.length,
      steps,
      maxForcedChain: maxChain,
      pureRate,
    };
  }

  public static generate(tier: TierKey = 'kids'): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const n = config.size;
    let attempts = 0;

    while (attempts < 80) {
      attempts++;
      const solution = this.generateLatinSquare(n);
      const allDots = this.extractDotsStrict(solution, n);

      if (!this.isDotCoverageSufficient(allDots, n, config.minCoverageRatio)) {
        continue;
      }

      const initialGrid: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
      const coords: [number, number][] = [];
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) coords.push([r, c]);
      }
      coords.sort(() => Math.random() - 0.5);

      for (let i = 0; i < config.targetPrefill && i < coords.length; i++) {
        const [r, c] = coords[i];
        initialGrid[r][c] = solution[r][c];
      }

      const solCount = this.countSolutions(initialGrid, allDots, n, 2);
      if (solCount !== 1) continue;

      const { depth, steps, maxForcedChain, pureRate } = this.traceSolvingProcess(initialGrid, allDots, n);

      if (tier === 'master' && (pureRate < 0.95 || maxForcedChain < config.minForcedChain)) {
        continue;
      }

      const isSymmetric180 = this.checkSymmetry180(allDots, n);
      const dynamicIrt = Number((config.baseIrt + (depth / (n * n)) * 0.5).toFixed(2));
      const puzzleId = `kropki_${tier}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

      return {
        id: puzzleId,
        category: 'numeric_logic',
        engine_type: 'kropki',
        tier,
        checksum: `KROPKI_${n}x${n}_CERTIFIED_${Date.now().toString(36)}`,
        puzzle: {
          size: n,
          initialGrid,
          dots: allDots,
          solution,
          solvingSteps: steps,
          inferenceDepth: depth,
          maxForcedChain,
          isSymmetric180,
          pureDeductionRate: pureRate,
        } as unknown as KropkiSpec,
        solution: solution as any,
        cognitiveLoad: {
          spatial: 0.6,
          numeric: 0.9,
          workingMemory: Number(Math.min(1.0, 0.4 + depth * 0.04).toFixed(2)),
          inhibition: 0.85,
        },
        metrics: {
          estimated_time_sec: Math.max(15, depth * 7 + n * 4),
          irt_logit_difficulty: dynamicIrt,
          human_sim_steps: steps.length,
        } as any,
      };
    }

    const fallback = this.generateLatinSquare(n);
    const fallbackDots = this.extractDotsStrict(fallback, n);
    return {
      id: `kropki_${tier}_fallback_${Date.now()}`,
      category: 'numeric_logic',
      engine_type: 'kropki',
      tier,
      checksum: `KROPKI_FALLBACK_${n}x${n}`,
      puzzle: {
        size: n,
        initialGrid: fallback.map((r, ri) => r.map((c, ci) => (ri === ci ? c : 0))),
        dots: fallbackDots,
        solution: fallback,
        solvingSteps: [],
        inferenceDepth: 2,
        maxForcedChain: 2,
        isSymmetric180: false,
        pureDeductionRate: 1.0,
      } as unknown as KropkiSpec,
      solution: fallback as any,
      cognitiveLoad: { spatial: 0.6, numeric: 0.9, workingMemory: 0.7, inhibition: 0.8 },
      metrics: { estimated_time_sec: 40, irt_logit_difficulty: config.baseIrt } as any,
    };
  }
}
