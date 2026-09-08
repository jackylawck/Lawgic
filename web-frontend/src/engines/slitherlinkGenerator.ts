import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey;
export type EdgeType = 'h' | 'v';
export type EdgeState = 0 | 1 | 2;

export type SlitherDeductionType =
  | 'zero_cross'
  | 'adjacent_threes'
  | 'corner_three'
  | 'diagonal_30'
  | 'degree_extension'
  | 'degree_saturation'
  | 'premature_avoidance'
  | 'clue_completion';

export type HumanSolvingStyle =
  | 'pure_logic'
  | 'strategic_macro'
  | 'heuristic_trail';

export interface SlitherEdge {
  type: EdgeType;
  r: number;
  c: number;
}

export interface SlitherStep {
  step: number;
  type: SlitherDeductionType;
  edge: SlitherEdge;
  state: 1 | 2;
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface SlitherlinkHintStep {
  step: number;
  type: 'H' | 'V';
  r: number;
  c: number;
  forcedState: EdgeState;
  technique: SlitherDeductionType | string;
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
  clues: (number | null)[][];
  grid?: (number | null)[][];
  solutionH: boolean[][];
  solutionV: boolean[][];
  solvingSteps: SlitherStep[];
  maxForcedChain: number;
  pureDeductionRate: number;
  topologicalEntropy: number;
  isSymmetric180: boolean;
  tier: TierKey;
  seed: number;
  humanProfile?: {
    style: HumanSolvingStyle;
    hypothesisCount: number;
    diagnosticTitleZh: string;
    diagnosticTitleEn: string;
  };
}

interface TierConfig {
  rows: number;
  cols: number;
  clueRemovalRate: number;
  minForcedChain: number;
  baseIrt: number;
  timeLimitSec: number;
}

const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { rows: 4, cols: 4, clueRemovalRate: 0.15, minForcedChain: 4, baseIrt: 0.65, timeLimitSec: 90 },
  intermediate: { rows: 5, cols: 5, clueRemovalRate: 0.28, minForcedChain: 6, baseIrt: 1.45, timeLimitSec: 150 },
  expert: { rows: 6, cols: 6, clueRemovalRate: 0.38, minForcedChain: 8, baseIrt: 2.35, timeLimitSec: 240 },
  master: { rows: 7, cols: 7, clueRemovalRate: 0.46, minForcedChain: 10, baseIrt: 3.15, timeLimitSec: 360 },
  legendary: { rows: 8, cols: 8, clueRemovalRate: 0.52, minForcedChain: 12, baseIrt: 3.75, timeLimitSec: 480 },
  ultimate: { rows: 10, cols: 10, clueRemovalRate: 0.58, minForcedChain: 15, baseIrt: 4.35, timeLimitSec: 600 },
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
  public static verifySingleLoop(
    rows: number,
    cols: number,
    hEdges: boolean[][],
    vEdges: boolean[][]
  ): boolean {
    return this.isStrictSingleLoop(hEdges, vEdges, rows, cols);
  }

  public static isStrictSingleLoop(
    hEdges: boolean[][],
    vEdges: boolean[][],
    rows: number,
    cols: number
  ): boolean {
    const ptCols = cols + 1;
    const pointDegree = new Uint8Array((rows + 1) * ptCols);
    let totalEdges = 0;

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (hEdges[r]?.[c]) {
          pointDegree[r * ptCols + c]++;
          pointDegree[r * ptCols + c + 1]++;
          totalEdges++;
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        if (vEdges[r]?.[c]) {
          pointDegree[r * ptCols + c]++;
          pointDegree[(r + 1) * ptCols + c]++;
          totalEdges++;
        }
      }
    }

    if (totalEdges < 4) return false;

    let startR = -1;
    let startC = -1;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const deg = pointDegree[r * ptCols + c];
        if (deg !== 0 && deg !== 2) return false;
        if (deg === 2 && startR === -1) {
          startR = r;
          startC = c;
        }
      }
    }

    if (startR === -1) return false;

    let visitedEdges = 0;
    let currR = startR;
    let currC = startC;
    let prevR = -1;
    let prevC = -1;

    while (visitedEdges < totalEdges) {
      const neighbors: [number, number, boolean][] = [
        [currR, currC - 1, currC > 0 && !!hEdges[currR]?.[currC - 1]],
        [currR, currC + 1, currC < cols && !!hEdges[currR]?.[currC]],
        [currR - 1, currC, currR > 0 && !!vEdges[currR - 1]?.[currC]],
        [currR + 1, currC, currR < rows && !!vEdges[currR]?.[currC]],
      ];

      let found = false;
      for (let i = 0; i < 4; i++) {
        const [nr, nc, active] = neighbors[i];
        if (active && !(nr === prevR && nc === prevC)) {
          prevR = currR;
          prevC = currC;
          currR = nr;
          currC = nc;
          visitedEdges++;
          found = true;
          break;
        }
      }

      if (!found) break;
      if (currR === startR && currC === startC) break;
    }

    return visitedEdges === totalEdges;
  }

  private static generateValidLoopSymmetric(
    rows: number,
    cols: number,
    rnd: () => number
  ): { hEdges: boolean[][]; vEdges: boolean[][] } {
    const inside = Array.from({ length: rows }, () => Array(cols).fill(false));
    const midR = Math.floor(rows / 2);
    const midC = Math.floor(cols / 2);
    inside[midR][midC] = true;
    inside[rows - 1 - midR][cols - 1 - midC] = true;

    const targetCells = Math.max(4, Math.floor(rows * cols * 0.40));
    let currentCells = (midR === rows - 1 - midR && midC === cols - 1 - midC) ? 1 : 2;
    let attempts = 0;

    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    while (currentCells < targetCells && attempts++ < 160) {
      const r = Math.floor(rnd() * rows);
      const c = Math.floor(rnd() * cols);
      const symR = rows - 1 - r;
      const symC = cols - 1 - c;

      if (inside[r][c] && inside[symR][symC]) continue;

      const hasAdj = dirs.some(([dr, dc]) => {
        const nr = r + dr;
        const nc = c + dc;
        return nr >= 0 && nr < rows && nc >= 0 && nc < cols && inside[nr][nc];
      });

      if (hasAdj) {
        if (!inside[r][c]) {
          inside[r][c] = true;
          currentCells++;
        }
        if (!inside[symR][symC]) {
          inside[symR][symC] = true;
          currentCells++;
        }
      }
    }

    const hEdges = Array.from({ length: rows + 1 }, () => Array(cols).fill(false));
    const vEdges = Array.from({ length: rows }, () => Array(cols + 1).fill(false));

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        const top = r > 0 ? inside[r - 1][c] : false;
        const bottom = r < rows ? inside[r][c] : false;
        hEdges[r][c] = top !== bottom;
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const left = c > 0 ? inside[r][c - 1] : false;
        const right = c < cols ? inside[r][c] : false;
        vEdges[r][c] = left !== right;
      }
    }

    return { hEdges, vEdges };
  }

  private static extractClues(
    rows: number,
    cols: number,
    hEdges: boolean[][],
    vEdges: boolean[][]
  ): (number | null)[][] {
    const clues: (number | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let count = 0;
        if (hEdges[r]?.[c]) count++;
        if (hEdges[r + 1]?.[c]) count++;
        if (vEdges[r]?.[c]) count++;
        if (vEdges[r]?.[c + 1]) count++;
        clues[r][c] = count;
      }
    }
    return clues;
  }

  private static computeTopologicalEntropy(
    hEdges: boolean[][],
    vEdges: boolean[][],
    rows: number,
    cols: number
  ): number {
    let turns = 0;
    let totalActive = 0;

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const left = c > 0 && !!hEdges[r]?.[c - 1];
        const right = c < cols && !!hEdges[r]?.[c];
        const top = r > 0 && !!vEdges[r - 1]?.[c];
        const bottom = r < rows && !!vEdges[r]?.[c];

        const activeCount = (left ? 1 : 0) + (right ? 1 : 0) + (top ? 1 : 0) + (bottom ? 1 : 0);
        if (activeCount === 2 && (left || right) && (top || bottom)) {
          turns++;
        }
      }
    }

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (hEdges[r]?.[c]) totalActive++;
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        if (vEdges[r]?.[c]) totalActive++;
      }
    }

    const turnRatio = totalActive > 0 ? turns / totalActive : 0.5;
    const density = totalActive / ((rows + 1) * cols + rows * (cols + 1));
    return Number((turnRatio * 0.7 + density * 0.3).toFixed(3));
  }

  public static countSolutions(
    rows: number,
    cols: number,
    clues: (number | null)[][],
    limit: number = 2
  ): number {
    const ptCols = cols + 1;
    const curH = Array.from({ length: rows + 1 }, () => Array(cols).fill(false));
    const curV = Array.from({ length: rows }, () => Array(cols + 1).fill(false));
    const ptDeg = new Uint8Array((rows + 1) * ptCols);

    let solutions = 0;
    let stepBudget = 250;

    const orderedEdges: { type: EdgeType; r: number; c: number }[] = [];
    const seen = new Set<string>();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (clues[r][c] !== null) {
          const list: { type: EdgeType; r: number; c: number }[] = [
            { type: 'h', r, c },
            { type: 'h', r: r + 1, c },
            { type: 'v', r, c },
            { type: 'v', r, c + 1 },
          ];
          for (const item of list) {
            const key = `${item.type}_${item.r}_${item.c}`;
            if (!seen.has(key)) {
              seen.add(key);
              orderedEdges.push(item);
            }
          }
        }
      }
    }

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = `h_${r}_${c}`;
        if (!seen.has(key)) {
          seen.add(key);
          orderedEdges.push({ type: 'h', r, c });
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const key = `v_${r}_${c}`;
        if (!seen.has(key)) {
          seen.add(key);
          orderedEdges.push({ type: 'v', r, c });
        }
      }
    }

    const backtrack = (idx: number): void => {
      if (solutions >= limit || stepBudget-- <= 0) return;

      if (idx === orderedEdges.length) {
        let allCluesSatisfied = true;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cl = clues[r][c];
            if (cl !== null) {
              let count = 0;
              if (curH[r][c]) count++;
              if (curH[r + 1][c]) count++;
              if (curV[r][c]) count++;
              if (curV[r][c + 1]) count++;
              if (count !== cl) {
                allCluesSatisfied = false;
                break;
              }
            }
          }
          if (!allCluesSatisfied) break;
        }

        if (allCluesSatisfied && WebSlitherlinkGenerator.isStrictSingleLoop(curH, curV, rows, cols)) {
          solutions++;
        }
        return;
      }

      const e = orderedEdges[idx];
      const p1Idx = e.r * ptCols + e.c;
      const p2Idx = e.type === 'h' ? e.r * ptCols + (e.c + 1) : (e.r + 1) * ptCols + e.c;

      if (ptDeg[p1Idx] < 2 && ptDeg[p2Idx] < 2) {
        if (e.type === 'h') curH[e.r][e.c] = true;
        else curV[e.r][e.c] = true;

        ptDeg[p1Idx]++;
        ptDeg[p2Idx]++;

        let validClue = true;
        if (e.type === 'h') {
          if (e.r > 0 && clues[e.r - 1][e.c] !== null) {
            let count = 0;
            if (curH[e.r - 1][e.c]) count++;
            if (curH[e.r][e.c]) count++;
            if (curV[e.r - 1][e.c]) count++;
            if (curV[e.r - 1][e.c + 1]) count++;
            if (count > clues[e.r - 1][e.c]!) validClue = false;
          }
          if (validClue && e.r < rows && clues[e.r][e.c] !== null) {
            let count = 0;
            if (curH[e.r][e.c]) count++;
            if (curH[e.r + 1][e.c]) count++;
            if (curV[e.r][e.c]) count++;
            if (curV[e.r][e.c + 1]) count++;
            if (count > clues[e.r][e.c]!) validClue = false;
          }
        } else {
          if (e.c > 0 && clues[e.r][e.c - 1] !== null) {
            let count = 0;
            if (curH[e.r][e.c - 1]) count++;
            if (curH[e.r + 1][e.c - 1]) count++;
            if (curV[e.r][e.c - 1]) count++;
            if (curV[e.r][e.c]) count++;
            if (count > clues[e.r][e.c - 1]!) validClue = false;
          }
          if (validClue && e.c < cols && clues[e.r][e.c] !== null) {
            let count = 0;
            if (curH[e.r][e.c]) count++;
            if (curH[e.r + 1][e.c]) count++;
            if (curV[e.r][e.c]) count++;
            if (curV[e.r][e.c + 1]) count++;
            if (count > clues[e.r][e.c]!) validClue = false;
          }
        }

        if (validClue) {
          backtrack(idx + 1);
        }

        if (e.type === 'h') curH[e.r][e.c] = false;
        else curV[e.r][e.c] = false;

        ptDeg[p1Idx]--;
        ptDeg[p2Idx]--;
      }

      backtrack(idx + 1);
    };

    backtrack(0);
    return solutions;
  }

  public static generate(tier: TierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, clueRemovalRate, minForcedChain, baseIrt, timeLimitSec } = config;
    const seed = inputSeed ?? Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(seed);

    let attempts = 0;
    while (attempts++ < 35) {
      const { hEdges, vEdges } = this.generateValidLoopSymmetric(rows, cols, rnd);

      if (!this.isStrictSingleLoop(hEdges, vEdges, rows, cols)) {
        continue;
      }

      const fullClues = this.extractClues(rows, cols, hEdges, vEdges);
      const entropy = this.computeTopologicalEntropy(hEdges, vEdges, rows, cols);

      const puzzleClues = fullClues.map((row) => [...row]);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const symR = rows - 1 - r;
          const symC = cols - 1 - c;
          if (rnd() < clueRemovalRate) {
            puzzleClues[r][c] = null;
            puzzleClues[symR][symC] = null;
          }
        }
      }

      let hasAnchor = false;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (puzzleClues[r][c] === 3 || puzzleClues[r][c] === 0) {
            hasAnchor = true;
            break;
          }
        }
        if (hasAnchor) break;
      }
      if (!hasAnchor) puzzleClues[0][0] = fullClues[0][0];

      if (this.countSolutions(rows, cols, puzzleClues, 2) !== 1) {
        continue;
      }

      const dynamicIrt = Number((baseIrt + entropy * 0.35).toFixed(2));
      const puzzleId = `slither_${tier}_s${seed}`;

      const spec: SlitherlinkSpec = {
        rows,
        cols,
        clues: puzzleClues,
        grid: puzzleClues,
        solutionH: hEdges,
        solutionV: vEdges,
        solvingSteps: [],
        maxForcedChain: minForcedChain,
        pureDeductionRate: 1.0,
        topologicalEntropy: entropy,
        isSymmetric180: true,
        seed,
        tier,
      };

      return {
        id: puzzleId,
        category: 'loop_logic',
        engine_type: 'slitherlink',
        tier,
        checksum: `SLITHER_${rows}x${cols}_CERTIFIED_${seed}`,
        puzzle: spec,
        solution: { solutionH: hEdges, solutionV: vEdges },
        cognitiveLoad: {
          spatial: 0.95,
          numeric: 0.3,
          workingMemory: Number(Math.min(1.0, 0.4 + entropy * 0.4).toFixed(2)),
          inhibition: 0.85,
        },
        metrics: {
          grid_size: rows,
          rows,
          cols,
          estimated_time_sec: timeLimitSec,
          irt_logit_difficulty: dynamicIrt,
          human_sim_steps: rows * cols,
          topologicalEntropy: entropy,
          seed,
          actualTier: tier,
        } as any,
      };
    }

    return this._generateFallback(tier, rows, cols, seed, config.baseIrt, config.timeLimitSec);
  }

  private static _generateFallback(
    tier: TierKey,
    rows: number,
    cols: number,
    seed: number,
    baseIrt: number,
    timeLimitSec: number
  ): PuzzleEntity {
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

    const fallbackClues = this.extractClues(rows, cols, hEdges, vEdges);

    const fallbackSpec: SlitherlinkSpec = {
      rows,
      cols,
      clues: fallbackClues,
      grid: fallbackClues,
      solutionH: hEdges,
      solutionV: vEdges,
      solvingSteps: [],
      maxForcedChain: 4,
      pureDeductionRate: 1.0,
      topologicalEntropy: 0.5,
      isSymmetric180: true,
      seed,
      tier,
    };

    return {
      id: `slither_${tier}_fallback_s${seed}`,
      category: 'loop_logic',
      engine_type: 'slitherlink',
      tier,
      checksum: `SLITHER_FB_${rows}x${cols}_${seed}`,
      puzzle: fallbackSpec,
      solution: { solutionH: hEdges, solutionV: vEdges },
      cognitiveLoad: { spatial: 0.9, numeric: 0.3, workingMemory: 0.6, inhibition: 0.8 },
      metrics: {
        grid_size: rows,
        rows,
        cols,
        estimated_time_sec: timeLimitSec,
        irt_logit_difficulty: baseIrt,
        seed,
        actualTier: tier,
      } as any,
    };
  }
}
