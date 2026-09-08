// web-frontend/src/engines/dominoesGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey;

export type DominoBorderState = 'unknown' | 'open' | 'wall';

export type DominoTechnique =
  | 'dead_end_forcing'
  | 'unique_pair_localization'
  | 'line_sum_residual_constraint'
  | 'bipartite_matching_parity'
  | 'dynamic_forcing_chain';

export interface ContradictionNode {
  depth: number;
  assumption: string;
  derived: string;
  conflictReason: string;
}

export interface DominoHintStep {
  level: 1 | 2 | 3;
  step: number;
  actionType: 'place_domino' | 'draw_wall';
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  val1: number;
  val2: number;
  technique: DominoTechnique;
  dagDepth: number;
  evidenceCells?: [number, number][];
  forcedType?: 'connect' | 'wall';
  structuredContradiction?: ContradictionNode[];
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface DominoPlacement {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  val1: number;
  val2: number;
  isPinnedClue?: boolean;
}

export interface DominoesSpec {
  rows: number;
  cols: number;
  maxPip: number;
  grid: number[][];
  dominoes: [number, number][];
  solutionPlacements: DominoPlacement[];
  solutionBorders: {
    horizontal: boolean[][]; // true 代表隔牆，false 代表相連骨牌內部
    vertical: boolean[][];
  };
  pinnedPlacements: DominoPlacement[];
  solvingSteps: DominoHintStep[];
  highestTechnique: DominoTechnique;
  logicalComplexityScore: number;
  criticalPathDepth: number;
  pureDeductionRate: number;
  techniqueDiversityCount: number;
  fallbackHeavyPin: boolean;
  tier: TierKey;
  seed: number;
}

interface TierConfig {
  maxPip: number;
  rows: number;
  cols: number;
  minComplexityScore: number;
  maxLookaheadDepth: number;
  baseIrt: number;
  timeLimitSec: number;
}

const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { maxPip: 3, rows: 4, cols: 5, minComplexityScore: 35, maxLookaheadDepth: 2, baseIrt: 0.65, timeLimitSec: 90 },
  intermediate: { maxPip: 4, rows: 5, cols: 6, minComplexityScore: 80, maxLookaheadDepth: 3, baseIrt: 1.45, timeLimitSec: 150 },
  expert: { maxPip: 5, rows: 6, cols: 7, minComplexityScore: 140, maxLookaheadDepth: 4, baseIrt: 2.35, timeLimitSec: 240 },
  master: { maxPip: 6, rows: 7, cols: 8, minComplexityScore: 210, maxLookaheadDepth: 5, baseIrt: 3.15, timeLimitSec: 360 },
  legendary: { maxPip: 7, rows: 8, cols: 9, minComplexityScore: 300, maxLookaheadDepth: 6, baseIrt: 3.75, timeLimitSec: 480 },
  ultimate: { maxPip: 8, rows: 9, cols: 10, minComplexityScore: 400, maxLookaheadDepth: 7, baseIrt: 4.35, timeLimitSec: 600 },
};

const TECHNIQUE_WEIGHTS: Record<DominoTechnique, number> = {
  dead_end_forcing: 1,
  unique_pair_localization: 2,
  line_sum_residual_constraint: 4,
  bipartite_matching_parity: 6,
  dynamic_forcing_chain: 15,
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
    return `${Math.min(v1, v2)}_${Math.max(v1, v2)}`;
  }

  public static generate(tier: TierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { maxPip, rows, cols, minComplexityScore, maxLookaheadDepth, baseIrt, timeLimitSec } = config;

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    const totalDominoes = ((maxPip + 1) * (maxPip + 2)) / 2;
    const fullDeck: [number, number][] = [];
    for (let i = 0; i <= maxPip; i++) {
      for (let j = i; j <= maxPip; j++) {
        fullDeck.push([i, j]);
      }
    }

    let bestAttemptTiling: { grid: number[][]; placements: DominoPlacement[] } | null = null;
    let bestSimResult: any = null;
    let highestAttemptScore = -1;

    const maxAttempts = 65;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const tiling = this._generateSpiralSymmetryBrokenTiling(rows, cols, maxPip, rnd);
      if (!tiling) continue;

      const { grid, placements } = tiling;

      if (!this._verifyStrictUniquenessMRV(grid, rows, cols, maxPip)) {
        continue;
      }

      const sim = this._simulateChampionshipSolving(grid, rows, cols, maxPip, maxLookaheadDepth);

      if (sim.logicalComplexityScore > highestAttemptScore) {
        highestAttemptScore = sim.logicalComplexityScore;
        bestAttemptTiling = tiling;
        bestSimResult = sim;
      }

      if (sim.pureRate >= 1.0 && sim.logicalComplexityScore >= minComplexityScore) {
        const dynamicIrt = Number(
          (
            baseIrt +
            (sim.criticalPathDepth / totalDominoes) * 0.35 +
            (sim.logicalComplexityScore / 500) * 0.40
          ).toFixed(2)
        );

        const solutionBorders = this._deriveSolutionBorders(rows, cols, placements);

        const spec: DominoesSpec = {
          rows,
          cols,
          maxPip,
          grid,
          dominoes: fullDeck,
          solutionPlacements: placements,
          solutionBorders,
          pinnedPlacements: [],
          solvingSteps: sim.steps,
          highestTechnique: sim.highestTechnique,
          logicalComplexityScore: sim.logicalComplexityScore,
          criticalPathDepth: sim.criticalPathDepth,
          techniqueDiversityCount: sim.techniqueDiversity,
          pureDeductionRate: 1.0,
          fallbackHeavyPin: false,
          tier,
          seed: actualSeed,
        };

        return {
          id: `dominoes_${tier}_s${actualSeed}`,
          category: 'numerical_logic',
          engine_type: 'dominoes',
          tier,
          checksum: `DOMINO_V6_GOLD_${rows}x${cols}_P${maxPip}_S${actualSeed}`,
          puzzle: spec as any,
          solution: placements as any,
          cognitiveLoad: {
            spatial: 0.95,
            numeric: 0.90,
            workingMemory: Number(Math.min(1.0, 0.45 + (sim.criticalPathDepth / totalDominoes) * 0.50).toFixed(2)),
            inhibition: 0.92,
          },
          metrics: {
            grid_size: rows * cols,
            rows,
            cols,
            max_pip: maxPip,
            total_dominoes: totalDominoes,
            estimated_time_sec: timeLimitSec,
            irt_logit_difficulty: dynamicIrt,
            human_sim_steps: sim.steps.length,
            critical_path_depth: sim.criticalPathDepth,
            logical_complexity_score: sim.logicalComplexityScore,
            technique_diversity: sim.techniqueDiversity,
            highest_technique: sim.highestTechnique,
            fallback_heavy_pin: false,
            seed: actualSeed,
            actualTier: tier,
          } as any,
        };
      }
    }

    return this._generateProgressivePinnedFallback(
      tier,
      config,
      actualSeed,
      bestAttemptTiling,
      bestSimResult,
      rnd
    );
  }

  private static _deriveSolutionBorders(
    rows: number,
    cols: number,
    placements: DominoPlacement[]
  ): { horizontal: boolean[][]; vertical: boolean[][] } {
    const horizontal = Array.from({ length: Math.max(0, rows - 1) }, () => Array(cols).fill(true));
    const vertical = Array.from({ length: rows }, () => Array(Math.max(0, cols - 1)).fill(true));

    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      if (p.r1 === p.r2) {
        // 水平骨牌：垂直邊界被打通（非牆）
        const r = p.r1;
        const minC = Math.min(p.c1, p.c2);
        if (r < rows && minC < cols - 1) {
          vertical[r][minC] = false;
        }
      } else if (p.c1 === p.c2) {
        // 垂直骨牌：水平邊界被打通（非牆）
        const c = p.c1;
        const minR = Math.min(p.r1, p.r2);
        if (minR < rows - 1 && c < cols) {
          horizontal[minR][c] = false;
        }
      }
    }

    return { horizontal, vertical };
  }

  public static getNextForcedDeduction(
    spec: DominoesSpec,
    currentHBorders: DominoBorderState[][],
    currentVBorders: DominoBorderState[][]
  ): DominoHintStep | null {
    const steps = spec.solvingSteps || [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.r1 === s.r2) {
        const r = s.r1;
        const minC = Math.min(s.c1, s.c2);
        const cur = currentVBorders[r]?.[minC];
        if (s.actionType === 'place_domino' && cur !== 'open') return s;
        if (s.actionType === 'draw_wall' && cur !== 'wall') return s;
      } else if (s.c1 === s.c2) {
        const c = s.c1;
        const minR = Math.min(s.r1, s.r2);
        const cur = currentHBorders[minR]?.[c];
        if (s.actionType === 'place_domino' && cur !== 'open') return s;
        if (s.actionType === 'draw_wall' && cur !== 'wall') return s;
      }
    }
    return steps.length > 0 ? steps[0] : null;
  }

  private static _edgeKey(r1: number, c1: number, r2: number, c2: number): string {
    if (r1 < r2 || (r1 === r2 && c1 < c2)) {
      return `${r1},${c1}_${r2},${c2}`;
    }
    return `${r2},${c2}_${r1},${c1}`;
  }

  private static _generateSpiralSymmetryBrokenTiling(
    rows: number,
    cols: number,
    maxPip: number,
    rnd: () => number
  ): { grid: number[][]; placements: DominoPlacement[] } | null {
    const dominoDeck: [number, number][] = [];
    for (let i = 0; i <= maxPip; i++) {
      for (let j = i; j <= maxPip; j++) {
        dominoDeck.push([i, j]);
      }
    }

    for (let i = dominoDeck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [dominoDeck[i], dominoDeck[j]] = [dominoDeck[j], dominoDeck[i]];
    }

    const grid = Array.from({ length: rows }, () => new Int16Array(cols).fill(-1));
    const covered = Array.from({ length: rows }, () => new Uint8Array(cols));
    const placements: DominoPlacement[] = [];

    let deckIdx = 0;
    let coveredCount = 0;
    const totalCells = rows * cols;

    while (coveredCount < totalCells) {
      let bestR = -1;
      let bestC = -1;
      let minOptions = 10;
      let bestOptions: ('H' | 'V')[] = [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (covered[r][c]) continue;
          const opts: ('H' | 'V')[] = [];
          if (c + 1 < cols && !covered[r][c + 1]) opts.push('H');
          if (r + 1 < rows && !covered[r + 1][c]) opts.push('V');
          if (opts.length === 0) return null;

          if (opts.length < minOptions) {
            minOptions = opts.length;
            bestR = r;
            bestC = c;
            bestOptions = opts;
            if (minOptions === 1) break;
          }
        }
        if (minOptions === 1) break;
      }

      if (bestR === -1) break;

      const chosen = bestOptions[Math.floor(rnd() * bestOptions.length)];
      const [valA, valB] = dominoDeck[deckIdx++];
      const flip = rnd() < 0.5;
      const v1 = flip ? valA : valB;
      const v2 = flip ? valB : valA;

      if (chosen === 'H') {
        covered[bestR][bestC] = 1;
        covered[bestR][bestC + 1] = 1;
        grid[bestR][bestC] = v1;
        grid[bestR][bestC + 1] = v2;
        placements.push({ r1: bestR, c1: bestC, r2: bestR, c2: bestC + 1, val1: v1, val2: v2 });
        coveredCount += 2;
      } else {
        covered[bestR][bestC] = 1;
        covered[bestR + 1][bestC] = 1;
        grid[bestR][bestC] = v1;
        grid[bestR + 1][bestC] = v2;
        placements.push({ r1: bestR, c1: bestC, r2: bestR + 1, c2: bestC, val1: v1, val2: v2 });
        coveredCount += 2;
      }
    }

    return { grid: grid.map((r) => Array.from(r)), placements };
  }

  private static _verifyStrictUniquenessMRV(
    grid: number[][],
    rows: number,
    cols: number,
    maxPip: number,
    prePinned: DominoPlacement[] = []
  ): boolean {
    const covered = Array.from({ length: rows }, () => new Uint8Array(cols));
    const usedDominoes = Array.from({ length: maxPip + 1 }, () => new Uint8Array(maxPip + 1));

    for (let i = 0; i < prePinned.length; i++) {
      const p = prePinned[i];
      covered[p.r1][p.c1] = 1;
      covered[p.r2][p.c2] = 1;
      const minV = Math.min(p.val1, p.val2);
      const maxV = Math.max(p.val1, p.val2);
      usedDominoes[minV][maxV] = 1;
    }

    const emptyBlocked = new Set<string>();
    if (!this._hasPerfectDominoMatchingWithValueConstraints(grid, covered, usedDominoes, emptyBlocked, rows, cols)) {
      return false;
    }

    let solutionsCount = 0;
    let budget = rows * cols * 60;
    let budgetExhausted = false;

    const backtrackMRV = (): void => {
      if (solutionsCount >= 2) return;
      if (budget-- <= 0) {
        budgetExhausted = true;
        return;
      }

      let targetR = -1;
      let targetC = -1;
      let minBranch = 10;
      let targetMoves: { r2: number; c2: number; minV: number; maxV: number }[] = [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (covered[r][c]) continue;
          const v1 = grid[r][c];
          const moves: { r2: number; c2: number; minV: number; maxV: number }[] = [];

          if (c + 1 < cols && !covered[r][c + 1]) {
            const v2 = grid[r][c + 1];
            const minV = Math.min(v1, v2);
            const maxV = Math.max(v1, v2);
            if (!usedDominoes[minV][maxV]) moves.push({ r2: r, c2: c + 1, minV, maxV });
          }
          if (r + 1 < rows && !covered[r + 1][c]) {
            const v2 = grid[r + 1][c];
            const minV = Math.min(v1, v2);
            const maxV = Math.max(v1, v2);
            if (!usedDominoes[minV][maxV]) moves.push({ r2: r + 1, c2: c, minV, maxV });
          }

          if (moves.length === 0) return;
          if (moves.length < minBranch) {
            minBranch = moves.length;
            targetR = r;
            targetC = c;
            targetMoves = moves;
            if (minBranch === 1) break;
          }
        }
        if (minBranch === 1) break;
      }

      if (targetR === -1) {
        solutionsCount++;
        return;
      }

      for (let i = 0; i < targetMoves.length; i++) {
        const m = targetMoves[i];
        covered[targetR][targetC] = 1;
        covered[m.r2][m.c2] = 1;
        usedDominoes[m.minV][m.maxV] = 1;

        backtrackMRV();

        covered[targetR][targetC] = 0;
        covered[m.r2][m.c2] = 0;
        usedDominoes[m.minV][m.maxV] = 0;

        if (solutionsCount >= 2 || budgetExhausted) return;
      }
    };

    backtrackMRV();

    if (budgetExhausted) return false;
    return solutionsCount === 1;
  }

  private static _hasPerfectDominoMatchingWithValueConstraints(
    grid: number[][],
    covered: Uint8Array[],
    usedPairs: Uint8Array[],
    blockedEdges: Set<string>,
    rows: number,
    cols: number
  ): boolean {
    const unvisitedBlackCells: [number, number][] = [];
    let blackCount = 0;
    let whiteCount = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!covered[r][c]) {
          if ((r + c) % 2 === 0) {
            blackCount++;
            unvisitedBlackCells.push([r, c]);
          } else {
            whiteCount++;
          }
        }
      }
    }

    if (blackCount !== whiteCount) return false;
    if (blackCount === 0) return true;

    const whiteMatch = new Map<string, string>();
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];

    const tryAugment = (br: number, bc: number, seenWhite: Set<string>): boolean => {
      const vB = grid[br][bc];
      for (let d = 0; d < 4; d++) {
        const wr = br + dirs[d][0];
        const wc = bc + dirs[d][1];
        if (wr >= 0 && wr < rows && wc >= 0 && wc < cols && !covered[wr][wc]) {
          if (blockedEdges.has(WebDominoesGenerator._edgeKey(br, bc, wr, wc))) continue;

          const vW = grid[wr][wc];
          const minV = Math.min(vB, vW);
          const maxV = Math.max(vB, vW);

          if (!usedPairs[minV][maxV]) {
            const wKey = `${wr},${wc}`;
            if (!seenWhite.has(wKey)) {
              seenWhite.add(wKey);
              const matchedBlack = whiteMatch.get(wKey);
              if (!matchedBlack) {
                whiteMatch.set(wKey, `${br},${bc}`);
                return true;
              }
              const [nextBr, nextBc] = matchedBlack.split(',').map(Number);
              if (tryAugment(nextBr, nextBc, seenWhite)) {
                whiteMatch.set(wKey, `${br},${bc}`);
                return true;
              }
            }
          }
        }
      }
      return false;
    };

    for (let i = 0; i < unvisitedBlackCells.length; i++) {
      const [br, bc] = unvisitedBlackCells[i];
      const seenWhite = new Set<string>();
      if (!tryAugment(br, bc, seenWhite)) {
        return false;
      }
    }

    return true;
  }

  private static _simulateChampionshipSolving(
    grid: number[][],
    rows: number,
    cols: number,
    maxPip: number,
    maxLookaheadDepth: number
  ): {
    steps: DominoHintStep[];
    highestTechnique: DominoTechnique;
    logicalComplexityScore: number;
    criticalPathDepth: number;
    techniqueDiversity: number;
    pureRate: number;
  } {
    const totalDominoes = ((maxPip + 1) * (maxPip + 2)) / 2;
    const placed = Array.from({ length: rows }, () => new Uint8Array(cols));
    const usedPairs = Array.from({ length: maxPip + 1 }, () => new Uint8Array(maxPip + 1));
    const blockedEdges = new Set<string>();
    const steps: DominoHintStep[] = [];
    const usedTechniques = new Set<DominoTechnique>();

    let placedCount = 0;
    let criticalPathDepth = 1;
    let highestTech: DominoTechnique = 'dead_end_forcing';
    let progressed = true;

    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];

    const isEdgeBlocked = (r1: number, c1: number, r2: number, c2: number): boolean => {
      return blockedEdges.has(WebDominoesGenerator._edgeKey(r1, c1, r2, c2));
    };

    const isPairAvailable = (v1: number, v2: number): boolean => {
      return usedPairs[Math.min(v1, v2)][Math.max(v1, v2)] === 0;
    };

    while (progressed && placedCount < totalDominoes) {
      progressed = false;

      // 1. 死胡同唯一定向
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (placed[r][c]) continue;

          const viableNeighbors: [number, number][] = [];
          for (let d = 0; d < 4; d++) {
            const nr = r + dirs[d][0];
            const nc = c + dirs[d][1];
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !placed[nr][nc]) {
              if (!isEdgeBlocked(r, c, nr, nc) && isPairAvailable(grid[r][c], grid[nr][nc])) {
                viableNeighbors.push([nr, nc]);
              }
            }
          }

          if (viableNeighbors.length === 1) {
            const [nr, nc] = viableNeighbors[0];
            const v1 = grid[r][c];
            const v2 = grid[nr][nc];

            placed[r][c] = 1;
            placed[nr][nc] = 1;
            usedPairs[Math.min(v1, v2)][Math.max(v1, v2)] = 1;
            placedCount++;
            criticalPathDepth++;
            usedTechniques.add('dead_end_forcing');

            steps.push({
              level: 1,
              step: placedCount,
              actionType: 'place_domino',
              forcedType: 'connect',
              r1: r, c1: c, r2: nr, c2: nc,
              val1: v1, val2: v2,
              technique: 'dead_end_forcing',
              dagDepth: criticalPathDepth,
              evidenceCells: [[r, c], [nr, nc]],
              rationale: `單元格 (${r + 1}, ${c + 1}) 的相容延伸唯一受迫`,
              humanReadable: {
                zh: `【死胡同定向】單元格 [${r + 1}, ${c + 1}] 周圍僅存 [${nr + 1}, ${nc + 1}] 可相容，強制鎖定骨牌 [${v1}|${v2}]！`,
                en: `[Dead-End Forcing] Cell [${r + 1}, ${c + 1}] only has neighbor [${nr + 1}, ${nc + 1}] available; placed [${v1}|${v2}]!`,
              },
            });

            progressed = true;
            break;
          }
        }
        if (progressed) break;
      }
      if (progressed) continue;

      // 2. 全域唯一點對定位
      const pairOccurrences = new Map<string, [number, number, number, number][]>();

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (placed[r][c]) continue;

          if (c + 1 < cols && !placed[r][c + 1] && !isEdgeBlocked(r, c, r, c + 1)) {
            const v1 = grid[r][c];
            const v2 = grid[r][c + 1];
            if (isPairAvailable(v1, v2)) {
              const key = `${Math.min(v1, v2)}_${Math.max(v1, v2)}`;
              const list = pairOccurrences.get(key) || [];
              list.push([r, c, r, c + 1]);
              pairOccurrences.set(key, list);
            }
          }
          if (r + 1 < rows && !placed[r + 1][c] && !isEdgeBlocked(r, c, r + 1, c)) {
            const v1 = grid[r][c];
            const v2 = grid[r + 1][c];
            if (isPairAvailable(v1, v2)) {
              const key = `${Math.min(v1, v2)}_${Math.max(v1, v2)}`;
              const list = pairOccurrences.get(key) || [];
              list.push([r, c, r + 1, c]);
              pairOccurrences.set(key, list);
            }
          }
        }
      }

      for (const [key, spots] of pairOccurrences.entries()) {
        if (spots.length === 1) {
          const [r1, c1, r2, c2] = spots[0];
          const [pA, pB] = key.split('_').map(Number);

          placed[r1][c1] = 1;
          placed[r2][c2] = 1;
          usedPairs[pA][pB] = 1;
          placedCount++;
          usedTechniques.add('unique_pair_localization');
          if (TECHNIQUE_WEIGHTS.unique_pair_localization > TECHNIQUE_WEIGHTS[highestTech]) {
            highestTech = 'unique_pair_localization';
          }
          criticalPathDepth++;

          steps.push({
            level: 2,
            step: placedCount,
            actionType: 'place_domino',
            forcedType: 'connect',
            r1, c1, r2, c2,
            val1: grid[r1][c1], val2: grid[r2][c2],
            technique: 'unique_pair_localization',
            dagDepth: criticalPathDepth,
            evidenceCells: [[r1, c1], [r2, c2]],
            rationale: `骨牌 [${pA}|${pB}] 在全盤候選槽位中具唯一性`,
            humanReadable: {
              zh: `【唯一點對鎖定】全域掃描顯示骨牌 [${pA}|${pB}] 僅能在 [${r1 + 1}, ${c1 + 1}] 與 [${r2 + 1}, ${c2 + 1}] 成型，必然鎖定！`,
              en: `[Unique Pair] Domino [${pA}|${pB}] only legally appears at [${r1 + 1}, ${c1 + 1}]-[${r2 + 1}, ${c2 + 1}] across the entire board!`,
            },
          });

          progressed = true;
          break;
        }
      }
      if (progressed) continue;

      // 3. 行列殘餘容量約束
      outerLineSum: for (let r = 0; r < rows; r++) {
        const unplacedInRow: number[] = [];
        for (let c = 0; c < cols; c++) {
          if (!placed[r][c]) unplacedInRow.push(c);
        }

        if (unplacedInRow.length > 0) {
          if (unplacedInRow.length % 2 !== 0) {
            const verticalSpans: { c: number; targetR: number }[] = [];
            for (const c of unplacedInRow) {
              if (r > 0 && !placed[r - 1][c] && !isEdgeBlocked(r, c, r - 1, c) && isPairAvailable(grid[r][c], grid[r - 1][c])) {
                verticalSpans.push({ c, targetR: r - 1 });
              }
              if (r + 1 < rows && !placed[r + 1][c] && !isEdgeBlocked(r, c, r + 1, c) && isPairAvailable(grid[r][c], grid[r + 1][c])) {
                verticalSpans.push({ c, targetR: r + 1 });
              }
            }

            if (verticalSpans.length === 1) {
              const { c, targetR } = verticalSpans[0];
              const v1 = grid[r][c];
              const v2 = grid[targetR][c];
              placed[r][c] = 1;
              placed[targetR][c] = 1;
              usedPairs[Math.min(v1, v2)][Math.max(v1, v2)] = 1;
              placedCount++;
              usedTechniques.add('line_sum_residual_constraint');
              if (TECHNIQUE_WEIGHTS.line_sum_residual_constraint > TECHNIQUE_WEIGHTS[highestTech]) {
                highestTech = 'line_sum_residual_constraint';
              }
              criticalPathDepth += 2;

              steps.push({
                level: 2,
                step: placedCount,
                actionType: 'place_domino',
                forcedType: 'connect',
                r1: r, c1: c, r2: targetR, c2: c,
                val1: v1, val2: v2,
                technique: 'line_sum_residual_constraint',
                dagDepth: criticalPathDepth,
                evidenceCells: [[r, c], [targetR, c]],
                rationale: `第 ${r + 1} 行剩餘空格數為奇數 (${unplacedInRow.length})，強迫唯一跨行延伸`,
                humanReadable: {
                  zh: `【行列奇偶約束】第 ${r + 1} 行未決空格數為奇數 (${unplacedInRow.length})，必有垂直骨牌跨行，鎖定 [${r + 1},${c + 1}] 與 [${targetR + 1},${c + 1}] 之 [${v1}|${v2}]！`,
                  en: `[Line Parity] Row ${r + 1} has odd open cells (${unplacedInRow.length}), forcing unique vertical span [${v1}|${v2}]!`,
                },
              });

              progressed = true;
              break outerLineSum;
            }
          } else if (unplacedInRow.length === 2 && Math.abs(unplacedInRow[0] - unplacedInRow[1]) === 1) {
            const cA = unplacedInRow[0];
            const cB = unplacedInRow[1];
            if (!isPairAvailable(grid[r][cA], grid[r][cB]) || isEdgeBlocked(r, cA, r, cB)) {
              blockedEdges.add(WebDominoesGenerator._edgeKey(r, cA, r, cB));
              usedTechniques.add('line_sum_residual_constraint');
              progressed = true;
              break outerLineSum;
            }
          }
        }
      }
      if (progressed) continue;

      // 4. 二分匹配瓶頸隔牆劃定
      outerMatching: for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (placed[r][c]) continue;

          const neighbors: [number, number][] = [];
          if (c + 1 < cols && !placed[r][c + 1] && !isEdgeBlocked(r, c, r, c + 1) && isPairAvailable(grid[r][c], grid[r][c + 1])) {
            neighbors.push([r, c + 1]);
          }
          if (r + 1 < rows && !placed[r + 1][c] && !isEdgeBlocked(r, c, r + 1, c) && isPairAvailable(grid[r][c], grid[r + 1][c])) {
            neighbors.push([r + 1, c]);
          }

          for (let i = 0; i < neighbors.length; i++) {
            const [nr, nc] = neighbors[i];
            const pA = Math.min(grid[r][c], grid[nr][nc]);
            const pB = Math.max(grid[r][c], grid[nr][nc]);

            placed[r][c] = 1;
            placed[nr][nc] = 1;
            usedPairs[pA][pB] = 1;

            const canMatch = WebDominoesGenerator._hasPerfectDominoMatchingWithValueConstraints(
              grid,
              placed,
              usedPairs,
              blockedEdges,
              rows,
              cols
            );

            placed[r][c] = 0;
            placed[nr][nc] = 0;
            usedPairs[pA][pB] = 0;

            if (!canMatch) {
              blockedEdges.add(WebDominoesGenerator._edgeKey(r, c, nr, nc));
              usedTechniques.add('bipartite_matching_parity');
              if (TECHNIQUE_WEIGHTS.bipartite_matching_parity > TECHNIQUE_WEIGHTS[highestTech]) {
                highestTech = 'bipartite_matching_parity';
              }
              criticalPathDepth += 2;

              steps.push({
                level: 2,
                step: placedCount,
                actionType: 'draw_wall',
                forcedType: 'wall',
                r1: r, c1: c, r2: nr, c2: nc,
                val1: grid[r][c], val2: grid[nr][nc],
                technique: 'bipartite_matching_parity',
                dagDepth: criticalPathDepth,
                evidenceCells: [[r, c], [nr, nc]],
                rationale: `連接 [${r + 1},${c + 1}] 與 [${nr + 1},${nc + 1}] 引發子圖二分匹配瓶頸割裂`,
                humanReadable: {
                  zh: `【隔牆劃定】若連接 [${r + 1}, ${c + 1}] 與 [${nr + 1}, ${nc + 1}] 形成 [${pA}|${pB}]，剩餘子圖無法形成完美匹配，確認為隔牆！`,
                  en: `[Boundary Cut] Hypothesizing domino [${pA}|${pB}] breaks bipartite matching parity; marked as boundary wall!`,
                },
              });

              progressed = true;
              break outerMatching;
            }
          }
        }
      }
      if (progressed) continue;

      // 5. 棋譜式動態反證鏈
      outerForcing: for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (placed[r][c]) continue;

          const neighbors: [number, number][] = [];
          if (c + 1 < cols && !placed[r][c + 1] && !isEdgeBlocked(r, c, r, c + 1) && isPairAvailable(grid[r][c], grid[r][c + 1])) {
            neighbors.push([r, c + 1]);
          }
          if (r + 1 < rows && !placed[r + 1][c] && !isEdgeBlocked(r, c, r + 1, c) && isPairAvailable(grid[r][c], grid[r + 1][c])) {
            neighbors.push([r + 1, c]);
          }

          for (let i = 0; i < neighbors.length; i++) {
            const [nr, nc] = neighbors[i];
            const pA = Math.min(grid[r][c], grid[nr][nc]);
            const pB = Math.max(grid[r][c], grid[nr][nc]);

            const sandboxPlaced = placed.map((row) => new Uint8Array(row));
            const sandboxUsed = usedPairs.map((row) => new Uint8Array(row));
            const sandboxBlocked = new Set<string>(blockedEdges);

            sandboxPlaced[r][c] = 1;
            sandboxPlaced[nr][nc] = 1;
            sandboxUsed[pA][pB] = 1;

            const structuredTrace: ContradictionNode[] = [];

            const conflictFound = WebDominoesGenerator._exploreStructuredForcingChain(
              grid,
              sandboxPlaced,
              sandboxUsed,
              sandboxBlocked,
              rows,
              cols,
              maxLookaheadDepth,
              1,
              `假設連接 [${r + 1},${c + 1}] 與 [${nr + 1},${nc + 1}] 消耗骨牌 [${pA}|${pB}]`,
              structuredTrace
            );

            if (conflictFound) {
              blockedEdges.add(WebDominoesGenerator._edgeKey(r, c, nr, nc));
              usedTechniques.add('dynamic_forcing_chain');
              highestTech = 'dynamic_forcing_chain';
              criticalPathDepth += 3;

              const lastNode = structuredTrace[structuredTrace.length - 1];

              steps.push({
                level: 3,
                step: placedCount,
                actionType: 'draw_wall',
                forcedType: 'wall',
                r1: r, c1: c, r2: nr, c2: nc,
                val1: grid[r][c], val2: grid[nr][nc],
                technique: 'dynamic_forcing_chain',
                dagDepth: criticalPathDepth,
                evidenceCells: [[r, c], [nr, nc]],
                structuredContradiction: structuredTrace,
                rationale: `棋譜式反證成立：該假定經 ${structuredTrace.length} 階連鎖演繹導出衝突`,
                humanReadable: {
                  zh: `【動態矛盾鏈】假定 [${r + 1},${c + 1}] 與 [${nr + 1},${nc + 1}] 相連將引發棋譜衝突（${lastNode?.conflictReason || '不可調和死鎖'}），反證兩者間必為隔牆！`,
                  en: `[Forcing Chain] Hypothesizing [${pA}|${pB}] leads to deductive conflict (${lastNode?.conflictReason || 'Deadlock'}); boundary confirmed!`,
                },
              });

              progressed = true;
              break outerForcing;
            }
          }
        }
      }
    }

    const pureRate = Number((placedCount / totalDominoes).toFixed(2));
    const techniqueDiversity = usedTechniques.size;

    let weightedDepthSum = 0;
    for (let i = 0; i < steps.length; i++) {
      weightedDepthSum += steps[i].dagDepth * TECHNIQUE_WEIGHTS[steps[i].technique];
    }

    const rawScore = weightedDepthSum * Math.log2(techniqueDiversity + 1) * Math.max(1, criticalPathDepth / 10);
    const logicalComplexityScore = Math.round(500 * (rawScore / (rawScore + 350)));

    return {
      steps,
      highestTechnique: highestTech,
      logicalComplexityScore,
      criticalPathDepth,
      techniqueDiversity,
      pureRate,
    };
  }

  private static _exploreStructuredForcingChain(
    grid: number[][],
    placed: Uint8Array[],
    usedPairs: Uint8Array[],
    blockedEdges: Set<string>,
    rows: number,
    cols: number,
    maxDepth: number,
    currentDepth: number,
    currentAssumption: string,
    trace: ContradictionNode[]
  ): boolean {
    if (currentDepth > maxDepth) return false;

    if (!WebDominoesGenerator._hasPerfectDominoMatchingWithValueConstraints(grid, placed, usedPairs, blockedEdges, rows, cols)) {
      trace.push({
        depth: currentDepth,
        assumption: currentAssumption,
        derived: '無可滿足的子圖二分匹配',
        conflictReason: `第 ${currentDepth} 階演繹：剩餘未決空格子圖無法形成二分圖完美匹配（骨牌數值或幾何割裂）`,
      });
      return true;
    }

    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    let localProgressed = true;

    while (localProgressed) {
      localProgressed = false;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (placed[r][c]) continue;

          let viable = 0;
          let targetNr = -1;
          let targetNc = -1;

          for (let d = 0; d < 4; d++) {
            const nr = r + dirs[d][0];
            const nc = c + dirs[d][1];
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !placed[nr][nc]) {
              if (!blockedEdges.has(WebDominoesGenerator._edgeKey(r, c, nr, nc))) {
                const minV = Math.min(grid[r][c], grid[nr][nc]);
                const maxV = Math.max(grid[r][c], grid[nr][nc]);
                if (!usedPairs[minV][maxV]) {
                  viable++;
                  targetNr = nr;
                  targetNc = nc;
                }
              }
            }
          }

          if (viable === 0) {
            trace.push({
              depth: currentDepth,
              assumption: currentAssumption,
              derived: `單元格 [${r + 1},${c + 1}] (值 ${grid[r][c]}) 被迫無法配對`,
              conflictReason: `單元格 [${r + 1},${c + 1}] 周圍骨牌庫存已耗盡或被隔牆完全孤立，度數歸零`,
            });
            return true;
          }

          if (viable === 1) {
            const v1 = grid[r][c];
            const v2 = grid[targetNr][targetNc];
            placed[r][c] = 1;
            placed[targetNr][targetNc] = 1;
            usedPairs[Math.min(v1, v2)][Math.max(v1, v2)] = 1;

            trace.push({
              depth: currentDepth,
              assumption: currentAssumption,
              derived: `迫使單元格 [${r + 1},${c + 1}] 與 [${targetNr + 1},${targetNc + 1}] 連接骨牌 [${v1}|${v2}]`,
              conflictReason: '演繹鏈推進中',
            });
            localProgressed = true;
            break;
          }
        }
        if (localProgressed) break;
      }
    }

    return false;
  }

  private static _generateProgressivePinnedFallback(
    tier: TierKey,
    config: TierConfig,
    seed: number,
    bestTiling: { grid: number[][]; placements: DominoPlacement[] } | null,
    bestSim: any,
    rnd: () => number
  ): PuzzleEntity {
    const { rows, cols, maxPip, baseIrt, timeLimitSec } = config;
    const totalDominoes = ((maxPip + 1) * (maxPip + 2)) / 2;
    const fullDeck: [number, number][] = [];
    for (let i = 0; i <= maxPip; i++) {
      for (let j = i; j <= maxPip; j++) {
        fullDeck.push([i, j]);
      }
    }

    const fallbackTiling = bestTiling || this._generateSpiralSymmetryBrokenTiling(rows, cols, maxPip, rnd)!;
    const { grid, placements } = fallbackTiling;

    const candidatePlacements = [...placements].sort((a, b) => {
      const aOnEdge = a.r1 === 0 || a.r1 === rows - 1 || a.c1 === 0 || a.c1 === cols - 1;
      const bOnEdge = b.r1 === 0 || b.r1 === rows - 1 || b.c1 === 0 || b.c1 === cols - 1;
      if (aOnEdge && !bOnEdge) return -1;
      if (!aOnEdge && bOnEdge) return 1;
      return rnd() - 0.5;
    });

    const pinnedPlacements: DominoPlacement[] = [];
    let isUnique = false;

    for (let i = 0; i < candidatePlacements.length; i++) {
      const p = { ...candidatePlacements[i], isPinnedClue: true };
      pinnedPlacements.push(p);
      if (this._verifyStrictUniquenessMRV(grid, rows, cols, maxPip, pinnedPlacements)) {
        isUnique = true;
        break;
      }
    }

    const heavyPinThreshold = Math.floor(totalDominoes * 0.15);
    const isHeavyPin = pinnedPlacements.length > heavyPinThreshold;

    let finalTier = tier;
    let complexity = isUnique ? (bestSim ? bestSim.logicalComplexityScore : 90) : 45;
    let adjustedIrt = baseIrt;

    if (isHeavyPin) {
      finalTier = tier === 'ultimate' || tier === 'legendary' ? 'master' : 'intermediate';
      complexity = Math.round(complexity * 0.55);
      adjustedIrt = Math.max(0.65, baseIrt - 0.85);
    }

    const criticalDepth = isUnique ? (bestSim ? bestSim.criticalPathDepth : 14) : 8;
    const solutionBorders = this._deriveSolutionBorders(rows, cols, placements);

    const spec: DominoesSpec = {
      rows,
      cols,
      maxPip,
      grid,
      dominoes: fullDeck,
      solutionPlacements: placements,
      solutionBorders,
      pinnedPlacements,
      solvingSteps: bestSim ? bestSim.steps : [],
      highestTechnique: 'bipartite_matching_parity',
      logicalComplexityScore: complexity,
      criticalPathDepth: criticalDepth,
      techniqueDiversityCount: bestSim ? bestSim.techniqueDiversity : 3,
      pureDeductionRate: 1.0,
      fallbackHeavyPin: isHeavyPin,
      tier: finalTier,
      seed,
    };

    return {
      id: `dominoes_pinned_${finalTier}_s${seed}`,
      category: 'numerical_logic',
      engine_type: 'dominoes',
      tier: finalTier,
      checksum: `DOMINO_PINNED_V6_${rows}x${cols}_P${maxPip}_S${seed}`,
      puzzle: spec as any,
      solution: placements as any,
      cognitiveLoad: { spatial: 0.90, numeric: 0.85, workingMemory: 0.80, inhibition: 0.85 },
      metrics: {
        grid_size: rows * cols,
        rows,
        cols,
        max_pip: maxPip,
        total_dominoes: totalDominoes,
        pinned_clue_count: pinnedPlacements.length,
        fallback_heavy_pin: isHeavyPin,
        estimated_time_sec: timeLimitSec,
        irt_logit_difficulty: adjustedIrt,
        critical_path_depth: criticalDepth,
        logical_complexity_score: complexity,
        technique_diversity: 3,
        highest_technique: 'bipartite_matching_parity',
        seed,
        actualTier: finalTier,
      } as any,
    };
  }
}
