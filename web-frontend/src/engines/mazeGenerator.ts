// web-frontend/src/engines/mazeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey;
export type StrategyPersona = 'Macro-Planner' | 'Wall-Follower' | 'Intuitive-Explorer';

export interface MazeSpec {
  rows: number;
  cols: number;
  grid: number[][];
  clues: number[][];
  width: number;
  height: number;
  size: number;
  start: [number, number];
  end: [number, number];
  goal: [number, number];
  pseudoGoals: [number, number][];
  seed: number;
  actualTier: TierKey;
  pureDeductionRate: number;
  visualNoise: number;
  adaptedFor: string;
  braidLoopCount: number;
  macroShortcutCount: number;
  biEntranceTrapCount: number;
  deepPseudopodCount: number;
  strategyDivergenceRatio: number;
  localAmbiguityIndex: number;
  maxVisualRegretValue: number;
  avgVisualRegretValue: number;
  visualOptimalOverlapRatio: number;
  hasPrimeFractalSymmetry: boolean;
  solving_path: string[];
}

interface TierConfig {
  size: number;
  targetDensity: number;
  minCriticalDepth: number;
  dynamicLookaheadDepth: number;
  maxVisualOptimalOverlap: number;
  baseIrt: number;
  timeLimitSec: number;
}

const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { size: 11, targetDensity: 0.55, minCriticalDepth: 3, dynamicLookaheadDepth: 3, maxVisualOptimalOverlap: 0.70, baseIrt: 0.65, timeLimitSec: 90 },
  intermediate: { size: 17, targetDensity: 0.50, minCriticalDepth: 5, dynamicLookaheadDepth: 4, maxVisualOptimalOverlap: 0.55, baseIrt: 1.45, timeLimitSec: 150 },
  expert: { size: 23, targetDensity: 0.45, minCriticalDepth: 8, dynamicLookaheadDepth: 6, maxVisualOptimalOverlap: 0.45, baseIrt: 2.35, timeLimitSec: 240 },
  master: { size: 29, targetDensity: 0.42, minCriticalDepth: 11, dynamicLookaheadDepth: 7, maxVisualOptimalOverlap: 0.40, baseIrt: 3.15, timeLimitSec: 360 },
  legendary: { size: 35, targetDensity: 0.38, minCriticalDepth: 14, dynamicLookaheadDepth: 8, maxVisualOptimalOverlap: 0.38, baseIrt: 3.75, timeLimitSec: 480 },
  ultimate: { size: 41, targetDensity: 0.34, minCriticalDepth: 18, dynamicLookaheadDepth: 9, maxVisualOptimalOverlap: 0.35, baseIrt: 4.35, timeLimitSec: 600 },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebMazeGenerator {
  public static generate(
    tier: TierKey = 'kids',
    personaBias?: StrategyPersona,
    inputSeed?: number
  ): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);

    const size = config.size;
    const width = size;
    const height = size;

    const minDivergenceMap: Record<TierKey, number> = {
      kids: 1.1,
      intermediate: 1.35,
      expert: 1.70,
      master: 2.05,
      legendary: 2.35,
      ultimate: 2.65,
    };
    const targetMinDivergence = minDivergenceMap[tier] || 1.2;

    const maxAttempts = 35;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptSeed = (actualSeed + attempt * 0x9e3779b9) >>> 0;
      const rnd = mulberry32(attemptSeed);

      const grid: number[][] = Array.from({ length: height }, () => Array(width).fill(1));

      const applyPrimeFractal = tier !== 'kids' && rnd() > 0.20;
      this._generatePrimeFractalTree(grid, width, height, personaBias, applyPrimeFractal, rnd);

      const { start, end, pseudoGoals } = this._placeDynamicEndpointsAndLoops(grid, width, height, tier, rnd);

      const macroShortcuts = this._injectCamouflagedShortcuts(grid, width, height, start, end, tier, rnd);

      const biEntranceCount = this._injectBiEntranceDeceptionZones(grid, width, height, start, end, tier, rnd);

      const deepPseudopods = this._injectDeepPseudopods(grid, width, height, start, end, tier, rnd);

      const solution = this._bfs(grid, width, height, start, end);
      if (solution.length < 2) continue;

      const visualGreedyPath = this._simulateVisualGreedyPath(grid, width, height, start, end);
      const baselineWallFollow = this._simulateWallFollower(grid, width, height, start, end);

      const overlapRatio = this._computePathOverlapRatio(solution, visualGreedyPath);
      const divergenceRatio = Number((baselineWallFollow.length / Math.max(1, solution.length)).toFixed(2));
      const ambiguityIndex = this._computeLocalAmbiguityIndex(grid, width, height, solution);
      const { maxVisualRegret, avgVisualRegret } = this._computeVisualConfidenceRegret(grid, width, height, solution, end);

      if (attempt < maxAttempts - 1 && tier !== 'kids') {
        if (
          overlapRatio > config.maxVisualOptimalOverlap ||
          divergenceRatio < targetMinDivergence ||
          maxVisualRegret < 18
        ) {
          continue;
        }
      }

      const turnCount = this._countTurns(solution);
      const realDeadEndDepth = this._computeRealDeadEndDepth(grid, width, height);
      const pathEntropy = this._computePathEntropy(grid, width, height, solution);
      const tortuosity = this._computeTortuosity(solution);

      const isUltimate = tier === 'ultimate';
      const spatialLoad = Math.min(
        1.0,
        0.30 + (tortuosity / 2.5) * 0.40 + (turnCount / Math.max(8, width * 1.2)) * 0.30
      );
      const workingMemoryLoad = Math.min(
        1.0,
        0.25 + (pathEntropy / 3.0) * 0.35 + (maxVisualRegret / 45.0) * 0.40
      );
      const inhibitionLoad = Math.min(
        1.0,
        0.25 + (1 - overlapRatio) * 0.45 + (divergenceRatio > 2.0 ? 0.30 : 0.15)
      );

      const baseIrt = config.baseIrt;
      const dynamicIrt = Number(
        (
          baseIrt +
          (pathEntropy - 1.0) * 0.1 +
          (tortuosity - 1.0) * 0.12 +
          (divergenceRatio - 1.2) * 0.1 +
          (1 - overlapRatio) * 0.25
        ).toFixed(2)
      );

      const estimatedTimeSec = Math.round(
        14 + visualGreedyPath.length * 0.45 + turnCount * 0.6 + maxVisualRegret * 0.8 + (isUltimate ? 45 : tier === 'legendary' ? 28 : 12)
      );

      const solvingPath = [
        `Decentralized Anti-Inward Path (${solution.length} optimal steps)`,
        `Dynamic Pseudo-Goal Loops (${pseudoGoals.length} deceptive bypass rings)`,
        `Deep Pseudopods (${deepPseudopods} elbow-turned supernode crushers)`,
        `Meta-Cognitive Deception (Visual-Optimal Overlap: ${Math.round(overlapRatio * 100)}%)`,
      ];

      const spec: MazeSpec = {
        rows: height,
        cols: width,
        grid,
        clues: grid,
        width,
        height,
        size,
        start,
        end,
        goal: end,
        pseudoGoals,
        seed: actualSeed,
        actualTier: tier,
        pureDeductionRate: 1.0,
        visualNoise: tier === 'kids' ? 0.15 : tier === 'intermediate' ? 0.45 : tier === 'expert' ? 0.75 : 0.95,
        adaptedFor: personaBias || 'standard',
        braidLoopCount: macroShortcuts + biEntranceCount,
        macroShortcutCount: macroShortcuts,
        biEntranceTrapCount: biEntranceCount,
        deepPseudopodCount: deepPseudopods,
        strategyDivergenceRatio: divergenceRatio,
        localAmbiguityIndex: ambiguityIndex,
        maxVisualRegretValue: Number(maxVisualRegret.toFixed(1)),
        avgVisualRegretValue: Number(avgVisualRegret.toFixed(1)),
        visualOptimalOverlapRatio: Number(overlapRatio.toFixed(2)),
        hasPrimeFractalSymmetry: applyPrimeFractal,
        solving_path: solvingPath,
      };

      return {
        id: `maze_${tier}_s${actualSeed}`,
        category: 'spatial_logic',
        engine_type: 'maze',
        tier,
        puzzle: spec,
        solution,
        metrics: {
          grid_size: size,
          rows: height,
          cols: width,
          decision_depth: solution.length,
          propagation_steps: width * height,
          turn_count: turnCount,
          mean_dead_end_depth: Number(realDeadEndDepth.toFixed(2)),
          tortuosity: Number(tortuosity.toFixed(3)),
          human_sim_steps: visualGreedyPath.length,
          baseline_wall_steps: baselineWallFollow.length,
          cognitive_gap: Math.max(0, visualGreedyPath.length - solution.length),
          strategy_divergence_ratio: divergenceRatio,
          local_ambiguity_index: ambiguityIndex,
          max_visual_regret_value: Number(maxVisualRegret.toFixed(1)),
          avg_visual_regret_value: Number(avgVisualRegret.toFixed(1)),
          visual_optimal_overlap_ratio: Number(overlapRatio.toFixed(2)),
          pseudo_goal_count: pseudoGoals.length,
          deep_pseudopod_count: deepPseudopods,
          has_prime_fractal_symmetry: applyPrimeFractal,
          attempt_iteration: attempt,
          irt_logit_difficulty: dynamicIrt,
          estimated_time_sec: estimatedTimeSec,
          solving_path: solvingPath,
          seed: actualSeed,
          actualTier: tier,
        } as any,
        cognitiveLoad: {
          spatial: Number(spatialLoad.toFixed(2)),
          numeric: 0.0,
          workingMemory: Number(workingMemoryLoad.toFixed(2)),
          inhibition: Number(inhibitionLoad.toFixed(2)),
        },
        checksum: `MAZE_V6_DEUS_EX_MACHINA_${size}x${size}_S${actualSeed}_A${attempt}`,
      };
    }

    return this._generateSafeFallback(tier, size, actualSeed, config.baseIrt);
  }

  private static _generatePrimeFractalTree(
    grid: number[][],
    width: number,
    height: number,
    personaBias: StrategyPersona | undefined,
    applyPrimeFractal: boolean,
    rnd: () => number
  ): void {
    const total = width * height;
    const stackX = new Int16Array(total);
    const stackY = new Int16Array(total);
    let stackPtr = 0;

    grid[1][1] = 0;
    stackX[0] = 1;
    stackY[0] = 1;
    stackPtr = 1;

    let lastDx = 0;
    let lastDy = 0;
    const baseDirs: [number, number][] = [
      [0, -2],
      [0, 2],
      [-2, 0],
      [2, 0],
    ];

    const primeBlocks = [5, 7, 11];

    while (stackPtr > 0) {
      const cx = stackX[stackPtr - 1];
      const cy = stackY[stackPtr - 1];

      const validDx = new Int8Array(4);
      const validDy = new Int8Array(4);
      let validCount = 0;

      for (let i = 0; i < 4; i++) {
        const [dx, dy] = baseDirs[i];
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1 && grid[ny][nx] === 1) {
          validDx[validCount] = dx;
          validDy[validCount] = dy;
          validCount++;
        }
      }

      if (validCount > 0) {
        let chosenIdx = Math.floor(rnd() * validCount);

        if (personaBias === 'Macro-Planner' && (lastDx !== 0 || lastDy !== 0) && validCount > 1) {
          for (let i = 0; i < validCount; i++) {
            if (validDx[i] === lastDx && validDy[i] === lastDy && rnd() < 0.72) {
              chosenIdx = i;
              break;
            }
          }
        }

        const dx = validDx[chosenIdx];
        const dy = validDy[chosenIdx];
        const mx = cx + (dx >> 1);
        const my = cy + (dy >> 1);
        const nx = cx + dx;
        const ny = cy + dy;

        grid[my][mx] = 0;
        grid[ny][nx] = 0;

        if (applyPrimeFractal && rnd() < 0.40) {
          const blockSize = primeBlocks[Math.floor(rnd() * primeBlocks.length)];
          const blockBx = Math.floor(nx / blockSize) * blockSize;
          const blockBy = Math.floor(ny / blockSize) * blockSize;

          const localX = nx - blockBx;
          const localY = ny - blockBy;

          const mirrorMode = rnd() < 0.5;
          const symNx = mirrorMode ? blockBx + (blockSize - 1 - localX) : nx;
          const symNy = !mirrorMode ? blockBy + (blockSize - 1 - localY) : ny;
          const symMx = mirrorMode ? blockBx + (blockSize - 1 - (mx - blockBx)) : mx;
          const symMy = !mirrorMode ? blockBy + (blockSize - 1 - (my - blockBy)) : my;

          if (
            symNx > 0 && symNx < width - 1 &&
            symNy > 0 && symNy < height - 1 &&
            grid[symNy][symNx] === 1
          ) {
            grid[symMy][symMx] = 0;
            grid[symNy][symNx] = 0;
          }
        }

        stackX[stackPtr] = nx;
        stackY[stackPtr] = ny;
        stackPtr++;

        lastDx = dx;
        lastDy = dy;
      } else {
        stackPtr--;
        lastDx = 0;
        lastDy = 0;
      }
    }
  }

  private static _placeDynamicEndpointsAndLoops(
    grid: number[][],
    width: number,
    height: number,
    tier: TierKey,
    rnd: () => number
  ): { start: [number, number]; end: [number, number]; pseudoGoals: [number, number][] } {
    if (tier === 'kids') {
      const furthestA = this._bfsFurthestNode(grid, width, height, 1, 1);
      const furthestB = this._bfsFurthestNode(grid, width, height, furthestA[0], furthestA[1]);
      return { start: furthestA, end: furthestB, pseudoGoals: [] };
    }

    const start: [number, number] = [1, 1];
    const candidates: [number, number][] = [];
    const midX = width >> 1;
    const midY = height >> 1;

    for (let y = 3; y < height - 3; y += 2) {
      for (let x = 3; x < width - 3; x += 2) {
        if (grid[y][x] === 0) {
          const distToStart = Math.abs(x - start[0]) + Math.abs(y - start[1]);
          const distToMid = Math.abs(x - midX) + Math.abs(y - midY);
          if (distToStart > width * 0.75 && distToMid > 5) {
            candidates.push([x, y]);
          }
        }
      }
    }

    // 嚴格型別守衛：杜絕 number[] 賦值給 [number, number] 引發 TS2345/TS2322
    const end: [number, number] =
      candidates.length > 0
        ? candidates[Math.floor(rnd() * candidates.length)]
        : [width - 2, height - 2];

    const pseudoGoals: [number, number][] = [];

    const solution = this._bfs(grid, width, height, start, end);
    if (solution.length > 25) {
      const nodeAIndex = 6;
      const nodeBIndex = Math.min(solution.length - 6, nodeAIndex + 18);
      const [ax] = solution[nodeAIndex];
      const [bx, by] = solution[nodeBIndex];

      const detourMidX = Math.max(1, Math.min(width - 2, (ax + bx) >> 1));
      const detourMidY = by > (height >> 1) ? Math.max(1, by - 6) : Math.min(height - 2, by + 6);

      if (grid[detourMidY]?.[detourMidX] === 0) {
        pseudoGoals.push([detourMidX, detourMidY]);
      }
    }

    const alt1: [number, number] = [width - 1 - end[0], height - 1 - end[1]];
    if (grid[alt1[1]]?.[alt1[0]] === 0) {
      pseudoGoals.push(alt1);
    }

    return { start, end, pseudoGoals };
  }

  private static _injectDeepPseudopods(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number],
    tier: TierKey,
    rnd: () => number
  ): number {
    if (tier === 'kids') return 0;

    const solution = this._bfs(grid, width, height, start, end);
    const targetPseudopods = tier === 'intermediate' ? 2 : tier === 'expert' ? 4 : 7;
    let created = 0;

    const dirs: [number, number][] = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    for (let i = 4; i < solution.length - 4 && created < targetPseudopods; i += 3) {
      const [cx, cy] = solution[i];

      for (const [dx, dy] of dirs) {
        const wx = cx + dx;
        const wy = cy + dy;
        const n1x = cx + (dx << 1);
        const n1y = cy + (dy << 1);

        if (
          n1x > 0 && n1x < width - 1 &&
          n1y > 0 && n1y < height - 1 &&
          grid[wy][wx] === 1 &&
          grid[n1y][n1x] === 1
        ) {
          grid[wy][wx] = 0;
          grid[n1y][n1x] = 0;

          const turnDirs = [
            [dy, dx],
            [-dy, -dx],
          ];
          let turned = false;

          for (const [tdx, tdy] of turnDirs) {
            const twx = n1x + tdx;
            const twy = n1y + tdy;
            const t2x = n1x + (tdx << 1);
            const t2y = n1y + (tdy << 1);

            if (
              t2x > 0 && t2x < width - 1 &&
              t2y > 0 && t2y < height - 1 &&
              grid[twy][twx] === 1 &&
              grid[t2y][t2x] === 1
            ) {
              grid[twy][twx] = 0;
              grid[t2y][t2x] = 0;
              turned = true;
              break;
            }
          }

          if (turned) {
            created++;
            break;
          }
        }
      }
    }

    return created;
  }

  private static _injectCamouflagedShortcuts(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number],
    tier: TierKey,
    rnd: () => number
  ): number {
    if (tier === 'kids') return 0;

    const solution = this._bfs(grid, width, height, start, end);
    if (solution.length < 24) return 0;

    const maxShortcuts = tier === 'intermediate' ? 1 : tier === 'expert' ? 2 : 3;
    let shortcutsCreated = 0;

    const stepIndexMap = new Int32Array(width * height).fill(-1);
    for (let i = 0; i < solution.length; i++) {
      const [x, y] = solution[i];
      stepIndexMap[y * width + x] = i;
    }

    for (let i = 0; i < solution.length - 16 && shortcutsCreated < maxShortcuts; i += 4) {
      const [ax, ay] = solution[i];
      const targetMinStep = i + 16;

      const offsets = [
        [0, 2],
        [0, -2],
        [2, 0],
        [-2, 0],
      ];

      for (const [dx, dy] of offsets) {
        const bx = ax + dx;
        const by = ay + dy;
        if (bx > 0 && bx < width - 1 && by > 0 && by < height - 1 && grid[by][bx] === 0) {
          const stepB = stepIndexMap[by * width + bx];
          if (stepB >= targetMinStep) {
            const wallX = ax + (dx >> 1);
            const wallY = ay + (dy >> 1);
            grid[wallY][wallX] = 0;
            shortcutsCreated++;
            break;
          }
        }
      }
    }

    return shortcutsCreated;
  }

  private static _injectBiEntranceDeceptionZones(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number],
    tier: TierKey,
    rnd: () => number
  ): number {
    if (tier === 'kids') return 0;

    const solution = this._bfs(grid, width, height, start, end);
    const onMainPath = new Uint8Array(width * height);
    const stepMap = new Int32Array(width * height).fill(-1);

    for (let i = 0; i < solution.length; i++) {
      const [x, y] = solution[i];
      onMainPath[y * width + x] = 1;
      stepMap[y * width + x] = i;
    }

    const maxZones = tier === 'intermediate' ? 1 : tier === 'expert' ? 2 : 4;
    let zonesCreated = 0;

    const dirs: [number, number][] = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    for (let i = 4; i < solution.length - 12 && zonesCreated < maxZones; i += 6) {
      const [fx, fy] = solution[i];

      for (let d = 0; d < 4; d++) {
        const [dx, dy] = dirs[d];
        const wallX = fx + dx;
        const wallY = fy + dy;
        const targetX = fx + (dx << 1);
        const targetY = fy + (dy << 1);

        if (
          targetX > 0 && targetX < width - 1 &&
          targetY > 0 && targetY < height - 1 &&
          grid[wallY][wallX] === 1 &&
          grid[targetY][targetX] === 1
        ) {
          grid[wallY][wallX] = 0;
          grid[targetY][targetX] = 0;

          let curX = targetX;
          let curY = targetY;
          let chainLen = 2;
          const maxChain = 8 + Math.floor(rnd() * 6);

          while (chainLen < maxChain) {
            const viableDirs: [number, number][] = [];
            for (let vd = 0; vd < 4; vd++) {
              const [vdx, vdy] = dirs[vd];
              const wX = curX + vdx;
              const wY = curY + vdy;
              const nX = curX + (vdx << 1);
              const nY = curY + (vdy << 1);

              if (
                nX > 0 && nX < width - 1 &&
                nY > 0 && nY < height - 1 &&
                grid[wY]?.[wX] === 1 &&
                grid[nY]?.[nX] === 1
              ) {
                viableDirs.push([vdx, vdy]);
              }
            }

            if (viableDirs.length === 0) break;
            const chosen = viableDirs[Math.floor(rnd() * viableDirs.length)];
            grid[curY + chosen[1]][curX + chosen[0]] = 0;
            grid[curY + (chosen[1] << 1)][curX + (chosen[0] << 1)] = 0;
            curX += (chosen[0] << 1);
            curY += (chosen[1] << 1);
            chainLen += 2;
          }

          let connectedDownstream = false;
          for (const [cdx, cdy] of dirs) {
            const connWallX = curX + cdx;
            const connWallY = curY + cdy;
            const connTargetX = curX + (cdx << 1);
            const connTargetY = curY + (cdy << 1);

            if (
              connTargetX > 0 && connTargetX < width - 1 &&
              connTargetY > 0 && connTargetY < height - 1 &&
              onMainPath[connTargetY * width + connTargetX] === 1
            ) {
              const downstreamStep = stepMap[connTargetY * width + connTargetX];
              if (downstreamStep > i + 4) {
                grid[connWallY][connWallX] = 0;
                connectedDownstream = true;
                break;
              }
            }
          }

          if (connectedDownstream) {
            zonesCreated++;
            break;
          }
        }
      }
    }

    return zonesCreated;
  }

  private static _computePathOverlapRatio(
    optimalPath: [number, number][],
    greedyPath: [number, number][]
  ): number {
    const optimalSet = new Set<string>();
    for (const [x, y] of optimalPath) optimalSet.add(`${x},${y}`);

    let sharedNodes = 0;
    for (const [gx, gy] of greedyPath) {
      if (optimalSet.has(`${gx},${gy}`)) sharedNodes++;
    }

    return Number((sharedNodes / Math.max(1, optimalPath.length)).toFixed(3));
  }

  private static _simulateVisualGreedyPath(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number]
  ): [number, number][] {
    const path: [number, number][] = [start];
    let cx = start[0];
    let cy = start[1];

    const visited = new Uint8Array(width * height);
    visited[cy * width + cx] = 1;

    const dirs: [number, number][] = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    let currentDirIdx = 0;
    let step = 0;
    const maxSteps = width * height * 3;

    while (step++ < maxSteps && (cx !== end[0] || cy !== end[1])) {
      let bestDir: [number, number] | null = null;
      let bestScore = -Infinity;

      for (let i = 0; i < 4; i++) {
        const idx = (currentDirIdx + i) % 4;
        const [dx, dy] = dirs[idx];
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || grid[ny][nx] !== 0) continue;

        const cellIdx = ny * width + nx;
        const distToEnd = Math.abs(nx - end[0]) + Math.abs(ny - end[1]);
        const straightBonus = idx === currentDirIdx ? 2.8 : 0;
        const score = -distToEnd * 1.5 - visited[cellIdx] * 4.0 + straightBonus;

        if (score > bestScore) {
          bestScore = score;
          bestDir = [dx, dy];
        }
      }

      if (bestDir) {
        cx += bestDir[0];
        cy += bestDir[1];
        path.push([cx, cy]);
        visited[cy * width + cx] = 1;
        currentDirIdx = dirs.findIndex(([dxx, dyy]) => dxx === bestDir![0] && dyy === bestDir![1]);
      } else {
        if (path.length > 1) {
          path.pop();
          const prev = path[path.length - 1];
          cx = prev[0];
          cy = prev[1];
        } else break;
      }
    }

    return path;
  }

  private static _computeVisualConfidenceRegret(
    grid: number[][],
    width: number,
    height: number,
    solution: [number, number][],
    end: [number, number]
  ): { maxVisualRegret: number; avgVisualRegret: number } {
    const dirs: [number, number][] = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    const regretScores: number[] = [];

    for (let i = 0; i < solution.length - 1; i++) {
      const [x, y] = solution[i];
      const validExits: [number, number][] = [];

      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === 0) {
          if (i > 0 && nx === solution[i - 1][0] && ny === solution[i - 1][1]) continue;
          validExits.push([nx, ny]);
        }
      }

      if (validExits.length >= 2) {
        for (const [ex, ey] of validExits) {
          if (ex !== solution[i + 1][0] || ey !== solution[i + 1][1]) {
            const { steps, straightness } = this._traceBranchMetrics(grid, width, height, ex, ey, x, y, end);
            const confidenceMultiplier = 1.0 + straightness * 2.0;
            regretScores.push(steps * confidenceMultiplier);
          }
        }
      }
    }

    if (regretScores.length === 0) return { maxVisualRegret: 5.0, avgVisualRegret: 5.0 };
    const maxVisualRegret = Math.max(...regretScores);
    const avgVisualRegret = regretScores.reduce((a, b) => a + b, 0) / regretScores.length;

    return { maxVisualRegret, avgVisualRegret };
  }

  private static _traceBranchMetrics(
    grid: number[][],
    width: number,
    height: number,
    startX: number,
    startY: number,
    fromX: number,
    fromY: number,
    end: [number, number]
  ): { steps: number; straightness: number } {
    let steps = 1;
    let cx = startX;
    let cy = startY;
    let px = fromX;
    let py = fromY;

    const dirs: [number, number][] = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    const initialDx = startX - fromX;
    const initialDy = startY - fromY;
    let straightSteps = 0;

    const limit = 40;
    while (steps < limit) {
      const nextMoves: [number, number][] = [];

      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === 0) {
          if (nx !== px || ny !== py) {
            nextMoves.push([nx, ny]);
          }
        }
      }

      if (nextMoves.length === 0) break;
      if (nextMoves.length >= 2) {
        steps += 3;
        break;
      }

      const moveDx = nextMoves[0][0] - cx;
      const moveDy = nextMoves[0][1] - cy;

      if (moveDx === initialDx && moveDy === initialDy) {
        straightSteps++;
      }

      px = cx;
      py = cy;
      cx = nextMoves[0][0];
      cy = nextMoves[0][1];
      steps++;
    }

    const straightness = steps > 0 ? straightSteps / steps : 0;
    return { steps, straightness };
  }

  private static _computeLocalAmbiguityIndex(
    grid: number[][],
    width: number,
    height: number,
    solution: [number, number][]
  ): number {
    let ambiguityPoints = 0;
    const dirs: [number, number][] = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    for (let i = 0; i < solution.length - 1; i++) {
      const [x, y] = solution[i];
      let branches = 0;

      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === 0) {
          if (i > 0 && nx === solution[i - 1][0] && ny === solution[i - 1][1]) continue;
          branches++;
        }
      }

      if (branches >= 2) ambiguityPoints++;
    }

    return ambiguityPoints;
  }

  private static _simulateWallFollower(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number]
  ): [number, number][] {
    const path: [number, number][] = [start];
    let cx = start[0];
    let cy = start[1];
    let dir = 0;
    const dirs: [number, number][] = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];

    let steps = 0;
    const maxSteps = width * height * 4;

    while ((cx !== end[0] || cy !== end[1]) && steps++ < maxSteps) {
      let moved = false;
      for (let offset = 1; offset >= -2; offset--) {
        const newDir = (dir + offset + 4) % 4;
        const [dx, dy] = dirs[newDir];
        const nx = cx + dx;
        const ny = cy + dy;

        if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === 0) {
          cx = nx;
          cy = ny;
          dir = newDir;
          path.push([cx, cy]);
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }

    return path;
  }

  private static _bfs(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number]
  ): [number, number][] {
    if (start[0] === end[0] && start[1] === end[1]) return [start];

    const totalCells = width * height;
    const parent = new Int32Array(totalCells).fill(-1);
    const queue = new Int32Array(totalCells);
    let head = 0;
    let tail = 0;

    const startIdx = start[1] * width + start[0];
    const endIdx = end[1] * width + end[0];

    queue[0] = startIdx;
    tail = 1;
    parent[startIdx] = startIdx;

    const dirs: [number, number][] = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    let found = false;
    while (head < tail) {
      const curr = queue[head++];
      if (curr === endIdx) {
        found = true;
        break;
      }

      const cx = curr % width;
      const cy = Math.floor(curr / width);

      for (let i = 0; i < 4; i++) {
        const nx = cx + dirs[i][0];
        const ny = cy + dirs[i][1];
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === 0) {
          const nextIdx = ny * width + nx;
          if (parent[nextIdx] === -1) {
            parent[nextIdx] = curr;
            queue[tail++] = nextIdx;
          }
        }
      }
    }

    if (!found) return [start, end];

    const path: [number, number][] = [];
    let curr = endIdx;
    while (curr !== startIdx) {
      path.push([curr % width, Math.floor(curr / width)]);
      curr = parent[curr];
    }
    path.push(start);
    return path.reverse();
  }

  private static _bfsFurthestNode(
    grid: number[][],
    width: number,
    height: number,
    originX: number,
    originY: number
  ): [number, number] {
    const totalCells = width * height;
    const visited = new Uint8Array(totalCells);
    const queueX = new Int16Array(totalCells);
    const queueY = new Int16Array(totalCells);
    let head = 0;
    let tail = 0;

    queueX[0] = originX;
    queueY[0] = originY;
    tail = 1;
    visited[originY * width + originX] = 1;

    let fx = originX;
    let fy = originY;

    const dirs: [number, number][] = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    while (head < tail) {
      const cx = queueX[head];
      const cy = queueY[head];
      head++;
      fx = cx;
      fy = cy;

      for (let i = 0; i < 4; i++) {
        const nx = cx + dirs[i][0];
        const ny = cy + dirs[i][1];
        if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1 && grid[ny][nx] === 0) {
          const idx = ny * width + nx;
          if (!visited[idx]) {
            visited[idx] = 1;
            queueX[tail] = nx;
            queueY[tail] = ny;
            tail++;
          }
        }
      }
    }
    return [fx, fy];
  }

  private static _computeRealDeadEndDepth(grid: number[][], width: number, height: number): number {
    let deadEndCount = 0;
    let totalLength = 0;

    const dirs = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y][x] !== 0) continue;
        let deg = 0;
        for (let i = 0; i < 4; i++) {
          if (grid[y + dirs[i][1]]?.[x + dirs[i][0]] === 0) deg++;
        }
        if (deg === 1) {
          deadEndCount++;
          let cx = x;
          let cy = y;
          let len = 1;
          let px = -1;
          let py = -1;

          while (len < 20) {
            let nextX = -1;
            let nextY = -1;
            let currentDeg = 0;

            for (let i = 0; i < 4; i++) {
              const nx = cx + dirs[i][0];
              const ny = cy + dirs[i][1];
              if (grid[ny]?.[nx] === 0) {
                currentDeg++;
                if (nx !== px || ny !== py) {
                  nextX = nx;
                  nextY = ny;
                }
              }
            }

            if (currentDeg >= 3 || nextX === -1) break;
            px = cx;
            py = cy;
            cx = nextX;
            cy = nextY;
            len++;
          }
          totalLength += len;
        }
      }
    }

    return deadEndCount > 0 ? totalLength / deadEndCount : 2.0;
  }

  private static _computeTortuosity(path: [number, number][]): number {
    if (path.length < 2) return 1.0;
    const start = path[0];
    const end = path[path.length - 1];
    const euclideanDist = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (euclideanDist === 0) return 1.0;
    return Math.min(3.5, (path.length - 1) / euclideanDist);
  }

  private static _computePathEntropy(
    grid: number[][],
    width: number,
    height: number,
    solution: [number, number][]
  ): number {
    let totalForksOnPath = 0;
    const dirs: [number, number][] = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    for (let i = 0; i < solution.length; i++) {
      const [x, y] = solution[i];
      let branches = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + dirs[d][0];
        const ny = y + dirs[d][1];
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === 0) {
          branches++;
        }
      }
      if (branches >= 3) totalForksOnPath += branches - 1;
    }
    return Math.max(1.0, totalForksOnPath / Math.max(1, solution.length * 0.18));
  }

  private static _countTurns(path: [number, number][]): number {
    if (path.length < 3) return 0;
    let turns = 0;
    for (let i = 1; i < path.length - 1; i++) {
      const dx1 = path[i][0] - path[i - 1][0];
      const dy1 = path[i][1] - path[i - 1][1];
      const dx2 = path[i + 1][0] - path[i][0];
      const dy2 = path[i + 1][1] - path[i][1];
      if (dx1 !== dx2 || dy1 !== dy2) turns++;
    }
    return turns;
  }

  private static _generateSafeFallback(
    tier: TierKey,
    size: number,
    seed: number,
    baseIrt: number
  ): PuzzleEntity {
    const grid: number[][] = Array.from({ length: size }, () => Array(size).fill(1));
    for (let i = 1; i < size - 1; i++) {
      grid[1][i] = 0;
      grid[i][size - 2] = 0;
      grid[size - 2][i] = 0;
    }

    const start: [number, number] = [1, 1];
    const end: [number, number] = [size - 2, size - 2];
    const solution: [number, number][] = [start, [size - 2, 1], end];

    const spec: MazeSpec = {
      rows: size,
      cols: size,
      grid,
      clues: grid,
      width: size,
      height: size,
      size,
      start,
      end,
      goal: end,
      pseudoGoals: [],
      seed,
      actualTier: tier,
      pureDeductionRate: 1.0,
      visualNoise: 0.2,
      adaptedFor: 'standard',
      braidLoopCount: 0,
      macroShortcutCount: 0,
      biEntranceTrapCount: 0,
      deepPseudopodCount: 0,
      strategyDivergenceRatio: 1.2,
      localAmbiguityIndex: 1,
      maxVisualRegretValue: 4.0,
      avgVisualRegretValue: 4.0,
      visualOptimalOverlapRatio: 0.5,
      hasPrimeFractalSymmetry: false,
      solving_path: ['Safe Spanning Corridor'],
    };

    return {
      id: `maze_${tier}_fb_s${seed}`,
      category: 'spatial_logic',
      engine_type: 'maze',
      tier,
      puzzle: spec,
      solution,
      metrics: {
        grid_size: size,
        rows: size,
        cols: size,
        decision_depth: solution.length,
        propagation_steps: size * size,
        turn_count: 2,
        mean_dead_end_depth: 2.0,
        tortuosity: 1.2,
        human_sim_steps: solution.length,
        baseline_wall_steps: solution.length * 2,
        cognitive_gap: 0,
        strategy_divergence_ratio: 1.2,
        local_ambiguity_index: 1,
        max_visual_regret_value: 4.0,
        avg_visual_regret_value: 4.0,
        visual_optimal_overlap_ratio: 0.5,
        has_prime_fractal_symmetry: false,
        attempt_iteration: 0,
        braid_loop_count: 0,
        irt_logit_difficulty: baseIrt,
        estimated_time_sec: 30,
        solving_path: ['Safe Spanning Corridor'],
        seed,
        actualTier: tier,
      } as any,
      cognitiveLoad: { spatial: 0.6, numeric: 0.0, workingMemory: 0.5, inhibition: 0.5 },
      checksum: `MAZE_FB_V6_${size}x${size}_S${seed}`,
    };
  }
}
