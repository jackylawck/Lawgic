// web-frontend/src/engines/shikakuGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';

export interface ShikakuRect {
  r: number;
  c: number;
  w: number;
  h: number;
  numberR: number;
  numberC: number;
}

export type ShikakuTechnique =
  | 'prime_geometry_anchor'
  | 'obstacle_entropy_exclusion'
  | 'uncovered_cell_attribution'
  | 'corner_forced_confinement'
  | 'boundary_wavefront_propagation';

export interface ShikakuHintStep {
  step: number;
  techniqueId: ShikakuTechnique;
  rect: ShikakuRect;
  numberPos: [number, number];
  techniqueIcon: string;
  techniqueName: {
    zh: string;
    en: string;
  };
  evidenceCells: [number, number][];
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
  depth: number;
}

export interface ShikakuSpec {
  rows: number;
  cols: number;
  grid: (number | null)[][];
  solutionRects: ShikakuRect[];
  tier: ExtendedTierKey;
  seed: number;
  metricsAnalysis: {
    is180Symmetric: boolean;
    totalRects: number;
    pureDeductionRate: number;
    maxDeductionDepth: number;
    branchingEntropyPenalty: number;
    dynamicIrt: number;
    logicFootprintHash: string;
  };
}

interface TierConfig {
  rows: number;
  cols: number;
  baseIrt: number;
  minDepth: number;
  minRectSize: number;
}

const TIER_SPECS: Record<ExtendedTierKey, TierConfig> = {
  kids: { rows: 6, cols: 6, baseIrt: -0.5, minDepth: 3, minRectSize: 2 },
  intermediate: { rows: 8, cols: 8, baseIrt: 0.4, minDepth: 5, minRectSize: 2 },
  expert: { rows: 10, cols: 10, baseIrt: 1.4, minDepth: 7, minRectSize: 2 },
  master: { rows: 12, cols: 12, baseIrt: 2.3, minDepth: 9, minRectSize: 2 },
  legendary: { rows: 14, cols: 14, baseIrt: 3.1, minDepth: 11, minRectSize: 2 },
  ultimate: { rows: 16, cols: 16, baseIrt: 4.0, minDepth: 13, minRectSize: 2 },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebShikakuGenerator {
  public static isPrime(n: number): boolean {
    if (n <= 1) return false;
    if (n <= 3) return true;
    if (n % 2 === 0 || n % 3 === 0) return false;
    for (let i = 5; i * i <= n; i += 6) {
      if (n % i === 0 || n % (i + 2) === 0) return false;
    }
    return true;
  }

  public static getFactors(n: number): [number, number][] {
    const factors: [number, number][] = [];
    for (let w = 1; w <= n; w++) {
      if (n % w === 0) factors.push([w, n / w]);
    }
    return factors;
  }

  public static getValidRectanglesForClue(
    clue: { r: number; c: number; area: number },
    rows: number,
    cols: number,
    grid: (number | null)[][],
    occupied: boolean[][]
  ): ShikakuRect[] {
    const list: ShikakuRect[] = [];
    const dims = this.getFactors(clue.area);

    for (const [w, h] of dims) {
      if (w > cols || h > rows) continue;
      const minR = Math.max(0, clue.r - h + 1);
      const maxR = Math.min(rows - h, clue.r);
      const minC = Math.max(0, clue.c - w + 1);
      const maxC = Math.min(cols - w, clue.c);

      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          let viable = true;
          for (let ir = r; ir < r + h; ir++) {
            for (let ic = c; ic < c + w; ic++) {
              if (occupied[ir][ic]) { viable = false; break; }
              if ((ir !== clue.r || ic !== clue.c) && grid[ir][ic] !== null) {
                viable = false;
                break;
              }
            }
            if (!viable) break;
          }

          if (viable) {
            list.push({ r, c, w, h, numberR: clue.r, numberC: clue.c });
          }
        }
      }
    }
    return list;
  }

  public static getNextForcedDeduction(
    rows: number,
    cols: number,
    grid: (number | null)[][],
    placedRects: ShikakuRect[],
    currentDepth: number = 1
  ): ShikakuHintStep | null {
    const occupied = Array.from({ length: rows }, () => Array(cols).fill(false));
    const lockedNumbers = new Set<string>();

    for (const rect of placedRects) {
      for (let r = rect.r; r < rect.r + rect.h; r++) {
        for (let c = rect.c; c < rect.c + rect.w; c++) {
          occupied[r][c] = true;
          if (grid[r][c] !== null) lockedNumbers.add(`${r},${c}`);
        }
      }
    }

    const activeClues: { r: number; c: number; area: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== null && !lockedNumbers.has(`${r},${c}`)) {
          activeClues.push({ r, c, area: grid[r][c]! });
        }
      }
    }

    const clueCandidateMap = new Map<string, ShikakuRect[]>();
    for (const clue of activeClues) {
      const candidates = this.getValidRectanglesForClue(clue, rows, cols, grid, occupied);
      clueCandidateMap.set(`${clue.r},${clue.c}`, candidates);
    }

    // 定式 1: 質數幾何錨定
    for (const clue of activeClues) {
      if (this.isPrime(clue.area)) {
        const candidates = clueCandidateMap.get(`${clue.r},${clue.c}`) || [];
        if (candidates.length === 1) {
          const target = candidates[0];
          return {
            step: currentDepth,
            techniqueId: 'prime_geometry_anchor',
            rect: target,
            numberPos: [clue.r, clue.c],
            techniqueIcon: '💎',
            techniqueName: { zh: '質數單軸幾何錨定', en: 'Prime Geometry Anchor' },
            evidenceCells: [[clue.r, clue.c]],
            rationale: `數字 ${clue.area} 為質數，只能單向延伸，當前邊界下僅存唯一合法放置。`,
            humanReadable: {
              zh: `[定式:質數錨定] 數字 [${clue.r + 1},${clue.c + 1}] (${clue.area}) 為質數，僅剩唯一合法延伸框。`,
              en: `[Prime Anchor] Clue ${clue.area} at [${clue.r + 1},${clue.c + 1}] is prime (1×${clue.area}); single orientation left.`,
            },
            depth: currentDepth,
          };
        }
      }
    }

    // 定式 2: 最大熵障礙排除
    for (const clue of activeClues) {
      const candidates = clueCandidateMap.get(`${clue.r},${clue.c}`) || [];
      if (candidates.length === 1) {
        const target = candidates[0];
        return {
          step: currentDepth,
          techniqueId: 'obstacle_entropy_exclusion',
          rect: target,
          numberPos: [clue.r, clue.c],
          techniqueIcon: '🧩',
          techniqueName: { zh: '最大熵障礙排除', en: 'Obstacle Entropy Exclusion' },
          evidenceCells: [[clue.r, clue.c]],
          rationale: `數字 ${clue.area} 受四周已佔用空間阻擋，其餘維度均穿透邊界，鎖定唯一矩形。`,
          humanReadable: {
            zh: `[定式:障礙排除] 數字 [${clue.r + 1},${clue.c + 1}] (${clue.area}) 因四周障礙阻擋，僅剩此唯一矩形。`,
            en: `[Obstacle Exclusion] Clue ${clue.area} at [${clue.r + 1},${clue.c + 1}] has all other candidates blocked.`,
          },
          depth: currentDepth,
        };
      }
    }

    // 定式 3: 角隅剛性拘束
    const corners: [number, number][] = [
      [0, 0], [0, cols - 1], [rows - 1, 0], [rows - 1, cols - 1],
    ];
    for (const [cr, cc] of corners) {
      if (occupied[cr][cc]) continue;

      const coveringRects: ShikakuRect[] = [];
      for (const clue of activeClues) {
        const candidates = clueCandidateMap.get(`${clue.r},${clue.c}`) || [];
        for (const rect of candidates) {
          if (cr >= rect.r && cr < rect.r + rect.h && cc >= rect.c && cc < rect.c + rect.w) {
            coveringRects.push(rect);
          }
        }
      }

      if (coveringRects.length === 1) {
        const target = coveringRects[0];
        return {
          step: currentDepth,
          techniqueId: 'corner_forced_confinement',
          rect: target,
          numberPos: [target.numberR, target.numberC],
          techniqueIcon: '🎯',
          techniqueName: { zh: '角隅剛性拘束', en: 'Corner Forced Confinement' },
          evidenceCells: [[cr, cc], [target.numberR, target.numberC]],
          rationale: `角隅單元格 [${cr + 1},${cc + 1}] 自由度極低，全盤僅有該矩形能覆蓋。`,
          humanReadable: {
            zh: `[定式:角隅拘束] 角落格子 [${cr + 1},${cc + 1}] 只有來自 [${target.numberR + 1},${target.numberC + 1}] 的矩形能覆蓋，強制選取！`,
            en: `[Corner Confinement] Corner cell [${cr + 1},${cc + 1}] can only be reached by this specific rectangle.`,
          },
          depth: currentDepth,
        };
      }
    }

    // 定式 4: 未覆蓋單元格唯一歸屬
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (occupied[r][c] || grid[r][c] !== null) continue;

        const reachableRects: ShikakuRect[] = [];
        for (const clue of activeClues) {
          const candidates = clueCandidateMap.get(`${clue.r},${clue.c}`) || [];
          for (const rect of candidates) {
            if (r >= rect.r && r < rect.r + rect.h && c >= rect.c && c < rect.c + rect.w) {
              reachableRects.push(rect);
            }
          }
        }

        if (reachableRects.length === 1) {
          const target = reachableRects[0];
          return {
            step: currentDepth,
            techniqueId: 'uncovered_cell_attribution',
            rect: target,
            numberPos: [target.numberR, target.numberC],
            techniqueIcon: '📍',
            techniqueName: { zh: '未覆格唯一歸屬', en: 'Uncovered Cell Attribution' },
            evidenceCells: [[r, c], [target.numberR, target.numberC]],
            rationale: `內部空格 [${r + 1},${c + 1}] 處於瓶頸點，全盤僅存在一個候選矩形能覆蓋它。`,
            humanReadable: {
              zh: `[定式:唯一歸屬] 空白格 [${r + 1},${c + 1}] 只有來自 [${target.numberR + 1},${target.numberC + 1}] 的矩形能觸及，強制歸屬！`,
              en: `[Cell Attribution] Empty cell [${r + 1},${c + 1}] has only one viable covering candidate.`,
            },
            depth: currentDepth,
          };
        }
      }
    }

    return null;
  }

  public static solveStrictHumanWavefront(
    rows: number,
    cols: number,
    grid: (number | null)[][],
    targetRectCount: number
  ): {
    isPureHumanSolvable: boolean;
    steps: ShikakuHintStep[];
    maxDepth: number;
    footprint: string;
  } {
    const placedRects: ShikakuRect[] = [];
    const steps: ShikakuHintStep[] = [];
    let depth = 0;

    while (placedRects.length < targetRectCount) {
      depth++;
      const forcedStep = this.getNextForcedDeduction(rows, cols, grid, placedRects, depth);
      if (!forcedStep) {
        return {
          isPureHumanSolvable: false,
          steps,
          maxDepth: depth,
          footprint: 'UNRESOLVED_BIFURCATION',
        };
      }

      placedRects.push(forcedStep.rect);
      steps.push(forcedStep);
    }

    const signature = steps.map(s => `${s.techniqueId}:${s.rect.w}x${s.rect.h}@${s.numberPos[0]},${s.numberPos[1]}`).join('|');
    let hash = 0;
    for (let i = 0; i < signature.length; i++) {
      hash = (hash << 5) - hash + signature.charCodeAt(i);
      hash |= 0;
    }

    return {
      isPureHumanSolvable: true,
      steps,
      maxDepth: depth,
      footprint: `DAG_${Math.abs(hash).toString(16).toUpperCase()}_D${depth}`,
    };
  }

  public static countSolutions(
    rows: number,
    cols: number,
    grid: (number | null)[][],
    limit: number = 2
  ): number {
    let solutionCount = 0;
    let stepBudget = 4000;

    const clues: { r: number; c: number; area: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== null) clues.push({ r, c, area: grid[r][c]! });
      }
    }

    const covered = Array.from({ length: rows }, () => Array(cols).fill(false));

    const backtrack = (clueIdx: number): void => {
      if (solutionCount >= limit || stepBudget-- <= 0) return;

      if (clueIdx === clues.length) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (!covered[r][c]) return;
          }
        }
        solutionCount++;
        return;
      }

      const clue = clues[clueIdx];
      const viableRects = this.getValidRectanglesForClue(clue, rows, cols, grid, covered);

      for (const rect of viableRects) {
        for (let ir = rect.r; ir < rect.r + rect.h; ir++) {
          for (let ic = rect.c; ic < rect.c + rect.w; ic++) covered[ir][ic] = true;
        }

        backtrack(clueIdx + 1);

        for (let ir = rect.r; ir < rect.r + rect.h; ir++) {
          for (let ic = rect.c; ic < rect.c + rect.w; ic++) covered[ir][ic] = false;
        }

        if (solutionCount >= limit) return;
      }
    };

    backtrack(0);
    return solutionCount;
  }

  /**
   * 健全遞迴空間剖分（Recursive BSP），100% 確保無空隙且滿足尺寸要求
   */
  private static _generateBspTiling(
    r: number,
    c: number,
    w: number,
    h: number,
    minSize: number,
    maxArea: number,
    rnd: () => number
  ): { r: number; c: number; w: number; h: number }[] {
    const area = w * h;
    const canSplitH = h >= 4;
    const canSplitV = w >= 4;

    if ((area > maxArea || rnd() < 0.65) && (canSplitH || canSplitV)) {
      const splitH = canSplitH && canSplitV ? rnd() < 0.5 : canSplitH;

      if (splitH) {
        const splitPos = 2 + Math.floor(rnd() * (h - 3));
        const top = this._generateBspTiling(r, c, w, splitPos, minSize, maxArea, rnd);
        const bottom = this._generateBspTiling(r + splitPos, c, w, h - splitPos, minSize, maxArea, rnd);
        return [...top, ...bottom];
      } else {
        const splitPos = 2 + Math.floor(rnd() * (w - 3));
        const left = this._generateBspTiling(r, c, splitPos, h, minSize, maxArea, rnd);
        const right = this._generateBspTiling(r, c + splitPos, w - splitPos, h, minSize, maxArea, rnd);
        return [...left, ...right];
      }
    }

    return [{ r, c, w, h }];
  }

  public static generate(tier: ExtendedTierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, minDepth, minRectSize } = config;

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    let attempts = 0;
    const maxAttempts = 50;

    while (attempts++ < maxAttempts) {
      // 1. 保證 100% 完全覆蓋的 BSP 剖分
      const rects = this._generateBspTiling(0, 0, cols, rows, minRectSize, 16, rnd);

      const grid: (number | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));
      const solutionRects: ShikakuRect[] = [];

      for (const box of rects) {
        // 在矩形內部隨機挑選一格作為線索位置
        const nr = box.r + Math.floor(rnd() * box.h);
        const nc = box.c + Math.floor(rnd() * box.w);
        grid[nr][nc] = box.w * box.h;
        solutionRects.push({
          r: box.r,
          c: box.c,
          w: box.w,
          h: box.h,
          numberR: nr,
          numberC: nc,
        });
      }

      // 2. 驗證唯一解
      if (this.countSolutions(rows, cols, grid, 2) !== 1) continue;

      // 3. 驗證純邏輯波前求解深度
      const humanWavefront = this.solveStrictHumanWavefront(rows, cols, grid, solutionRects.length);
      if (!humanWavefront.isPureHumanSolvable || humanWavefront.maxDepth < minDepth) {
        continue;
      }

      const totalClues = solutionRects.length;
      const avgFactorEntropy = solutionRects.reduce((acc, r) => acc + Math.log2(this.getFactors(r.w * r.h).length), 0) / totalClues;
      const dynamicIrt = Number((config.baseIrt + avgFactorEntropy * 0.4 + humanWavefront.maxDepth * 0.08).toFixed(2));

      const spec: ShikakuSpec = {
        rows,
        cols,
        grid,
        solutionRects,
        tier,
        seed: actualSeed,
        metricsAnalysis: {
          is180Symmetric: false,
          totalRects: solutionRects.length,
          pureDeductionRate: 1.0,
          maxDeductionDepth: humanWavefront.maxDepth,
          branchingEntropyPenalty: 0.2,
          dynamicIrt,
          logicFootprintHash: humanWavefront.footprint,
        },
      };

      return {
        id: `shikaku_${tier}_s${actualSeed}`,
        category: 'spatial_logic' as any,
        engine_type: 'shikaku',
        tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
        checksum: `SHIKAKU_${rows}x${cols}_${humanWavefront.footprint}`,
        puzzle: spec as any,
        solution: solutionRects as any,
        cognitiveLoad: {
          spatial: 0.92,
          numeric: 0.95,
          workingMemory: Number(Math.min(1.0, 0.65 + humanWavefront.maxDepth * 0.025).toFixed(2)),
          inhibition: 0.85,
        },
        metrics: {
          estimated_time_sec: Math.max(30, Math.round(rows * cols * 2.0 + humanWavefront.maxDepth * 4.5)),
          irt_logit_difficulty: dynamicIrt,
          seed: actualSeed,
          actualTier: tier,
          is180Symmetric: false,
          pureDeductionRate: 1.0,
          maxDeductionDepth: humanWavefront.maxDepth,
          logicFootprint: humanWavefront.footprint,
        } as any,
      };
    }

    return this._generateFallback(tier, rows, cols, actualSeed, config.baseIrt);
  }

  /**
   * 兜底保底題目：全盤 100% 完整無縫鋪滿的合規題目
   */
  private static _generateFallback(
    tier: ExtendedTierKey,
    rows: number,
    cols: number,
    seed: number,
    baseIrt: number
  ): PuzzleEntity {
    const grid: (number | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));
    const solutionRects: ShikakuRect[] = [];

    // 以 2x2 磚塊完整鋪滿全盤
    for (let r = 0; r < rows; r += 2) {
      for (let c = 0; c < cols; c += 2) {
        const h = r + 2 <= rows ? 2 : 1;
        const w = c + 2 <= cols ? 2 : 1;
        grid[r][c] = w * h;
        solutionRects.push({ r, c, w, h, numberR: r, numberC: c });
      }
    }

    const spec: ShikakuSpec = {
      rows,
      cols,
      grid,
      solutionRects,
      tier,
      seed,
      metricsAnalysis: {
        is180Symmetric: true,
        totalRects: solutionRects.length,
        pureDeductionRate: 1.0,
        maxDeductionDepth: 4,
        branchingEntropyPenalty: 0.2,
        dynamicIrt: baseIrt,
        logicFootprintHash: 'DAG_FALLBACK_FULL_COVER',
      },
    };

    return {
      id: `shikaku_${tier}_s${seed}_fb`,
      category: 'spatial_logic' as any,
      engine_type: 'shikaku',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `SHIKAKU_FB_${seed}`,
      puzzle: spec as any,
      solution: solutionRects as any,
      cognitiveLoad: { spatial: 0.85, numeric: 0.92, workingMemory: 0.75, inhibition: 0.8 },
      metrics: {
        estimated_time_sec: 45,
        irt_logit_difficulty: baseIrt,
        seed,
        is180Symmetric: true,
        logicFootprint: 'DAG_FALLBACK_FULL_COVER',
      } as any,
    };
  }
}
