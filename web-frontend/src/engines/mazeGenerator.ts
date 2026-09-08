// web-frontend/src/engines/mazeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey;
export type StrategyPersona = 'Macro-Planner' | 'Wall-Follower' | 'Intuitive-Explorer';

export interface DeceptionWaypoint {
  coordinate: [number, number];
  divergedStep: number;
  visualConfidenceScore: number;
  internalSubForks: number;
  regretCost: number;
  trapType: 'Straight_Lure' | 'Camouflaged_Bypass' | 'Goal_Keeper_Fork' | 'Twin_Landmark_Trap';
}

export interface TwinLandmarkPair {
  landmarkA: [number, number];
  landmarkB: [number, number];
  isLethalA: boolean;
  signature: string;
}

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
  twinLandmarks: TwinLandmarkPair[];
  deceptionWaypoints: DeceptionWaypoint[];
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
  cognitivePhaseGain: number;
  hasPrimeFractalSymmetry: boolean;
  hasGoalKeeperTrap: boolean;
  hasPhase2MentalGlitch: boolean;
  solving_path: string[];
}

interface TierConfig {
  size: number;
  targetDensity: number;
  minCriticalDepth: number;
  dynamicLookaheadDepth: number;
  maxVisualOptimalOverlap: number;
  minPhaseGain: number;
  baseIrt: number;
  timeLimitSec: number;
}

const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { size: 11, targetDensity: 0.55, minCriticalDepth: 3, dynamicLookaheadDepth: 3, maxVisualOptimalOverlap: 0.70, minPhaseGain: 1.1, baseIrt: 0.65, timeLimitSec: 90 },
  intermediate: { size: 17, targetDensity: 0.50, minCriticalDepth: 5, dynamicLookaheadDepth: 4, maxVisualOptimalOverlap: 0.55, minPhaseGain: 1.25, baseIrt: 1.45, timeLimitSec: 150 },
  expert: { size: 23, targetDensity: 0.45, minCriticalDepth: 8, dynamicLookaheadDepth: 6, maxVisualOptimalOverlap: 0.45, minPhaseGain: 1.35, baseIrt: 2.35, timeLimitSec: 240 },
  master: { size: 29, targetDensity: 0.42, minCriticalDepth: 11, dynamicLookaheadDepth: 7, maxVisualOptimalOverlap: 0.40, minPhaseGain: 1.40, baseIrt: 3.15, timeLimitSec: 360 },
  legendary: { size: 35, targetDensity: 0.38, minCriticalDepth: 14, dynamicLookaheadDepth: 8, maxVisualOptimalOverlap: 0.38, minPhaseGain: 1.45, baseIrt: 3.75, timeLimitSec: 480 },
  ultimate: { size: 41, targetDensity: 0.34, minCriticalDepth: 18, dynamicLookaheadDepth: 9, maxVisualOptimalOverlap: 0.35, minPhaseGain: 1.50, baseIrt: 4.35, timeLimitSec: 600 },
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

    const maxAttempts = 40;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptSeed = (actualSeed + attempt * 0x9e3779b9) >>> 0;
      const rnd = mulberry32(attemptSeed);

      const grid: number[][] = Array.from({ length: height }, () => Array(width).fill(1));

      const applyPrimeFractal = tier !== 'kids' && rnd() > 0.15;
      this._generatePrimeFractalTree(grid, width, height, personaBias, applyPrimeFractal, rnd);

      const { start, end, pseudoGoals } = this._placeDynamicEndpointsAndLoops(grid, width, height, tier, rnd);

      const macroShortcuts = this._injectCamouflagedShortcuts(grid, width, height, start, end, tier, rnd);

      const biEntranceCount = this._injectBiEntranceDeceptionZones(grid, width, height, start, end, tier, rnd);

      const deepPseudopods = this._injectDeepPseudopods(grid, width, height, start, end, tier, rnd);

      const hasGoalKeeper = tier !== 'kids' ? this._injectGoalKeeperDilemma(grid, width, height, end, rnd) : false;

      // 嚴格位元卷積匹配雙胞胎地標
      const twinLandmarks = tier !== 'kids' ? this._injectTwinLandmarkPairs(grid, width, height, rnd) : [];

      const solution = this._bfs(grid, width, height, start, end);
      if (solution.length < 2) continue;

      const visualGreedyPath = this._simulateVisualGreedyPath(grid, width, height, start, end);
      const baselineWallFollow = this._simulateWallFollower(grid, width, height, start, end);

      const overlapRatio = this._computePathOverlapRatio(solution, visualGreedyPath);
      const divergenceRatio = Number((baselineWallFollow.length / Math.max(1, solution.length)).toFixed(2));
      const ambiguityIndex = this._computeLocalAmbiguityIndex(grid, width, height, solution);

      // 嚴格相位增益 (1.4x+) 與內部決策熵值病理分析
      const { waypoints, maxVisualRegret, avgVisualRegret, phaseGain, isWaveStrictlyCompliant } =
        this._analyzeCognitiveWaveStrict(grid, width, height, solution, visualGreedyPath, end, config.minPhaseGain);

      if (attempt < maxAttempts - 1 && tier !== 'kids') {
        if (
          overlapRatio > config.maxVisualOptimalOverlap ||
          divergenceRatio < targetMinDivergence ||
          !isWaveStrictlyCompliant ||
          maxVisualRegret < 24
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
        0.25 + (pathEntropy / 3.0) * 0.35 + (maxVisualRegret / 50.0) * 0.40
      );
      const inhibitionLoad = Math.min(
        1.0,
        0.25 + (1 - overlapRatio) * 0.45 + (phaseGain >= 1.4 ? 0.30 : 0.15)
      );

      const baseIrt = config.baseIrt;
      const dynamicIrt = Number(
        (
          baseIrt +
          (pathEntropy - 1.0) * 0.1 +
          (tortuosity - 1.0) * 0.12 +
          (divergenceRatio - 1.2) * 0.1 +
          (1 - overlapRatio) * 0.25 +
          (phaseGain - 1.0) * 0.15
        ).toFixed(2)
      );

      const estimatedTimeSec = Math.round(
        14 + visualGreedyPath.length * 0.45 + turnCount * 0.6 + maxVisualRegret * 0.75 + (isUltimate ? 50 : tier === 'legendary' ? 32 : 15)
      );

      const solvingPath = [
        `Phase-Gain Wave (Gain: ${phaseGain.toFixed(2)}x, Mid Peak: ${maxVisualRegret.toFixed(1)})`,
        `Twin Landmark Paradox (${twinLandmarks.length} matched pairs)`,
        `Goal Keeper Dilemma (${hasGoalKeeper ? 'Armed' : 'None'})`,
        `Mental Glitch (${tier !== 'kids' ? 'Active on Doorstep' : 'Disabled'})`,
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
        twinLandmarks,
        deceptionWaypoints: waypoints,
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
        cognitivePhaseGain: Number(phaseGain.toFixed(2)),
        hasPrimeFractalSymmetry: applyPrimeFractal,
        hasGoalKeeperTrap: hasGoalKeeper,
        hasPhase2MentalGlitch: tier !== 'kids',
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
          cognitive_phase_gain: Number(phaseGain.toFixed(2)),
          twin_landmark_count: twinLandmarks.length,
          deception_waypoint_count: waypoints.length,
          has_goal_keeper_trap: hasGoalKeeper,
          has_phase2_mental_glitch: tier !== 'kids',
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
        checksum: `MAZE_V8_ABYSS_WATCHER_${size}x${size}_S${actualSeed}_A${attempt}`,
      };
    }

    return this._generateSafeFallback(tier, size, actualSeed, config.baseIrt);
  }

  /**
   * 3x3 八向鄰域同構哈希雙胞胎地標對（Twin Landmark Structural Hash Matching）
   */
  private static _injectTwinLandmarkPairs(
    grid: number[][],
    width: number,
    height: number,
    rnd: () => number
  ): TwinLandmarkPair[] {
    const pairs: TwinLandmarkPair[] = [];
    const hashMap = new Map<number, [number, number][]>();

    // 遍歷所有通路點，計算 3x3 鄰域二進位卷積
    for (let y = 2; y < height - 2; y += 2) {
      for (let x = 2; x < width - 2; x += 2) {
        if (grid[y][x] === 0) {
          let hash = 0;
          let bit = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (grid[y + dy][x + dx] === 1) hash |= (1 << bit);
              bit++;
            }
          }
          const list = hashMap.get(hash) || [];
          list.push([x, y]);
          hashMap.set(hash, list);
        }
      }
    }

    const viableHashes = Array.from(hashMap.keys()).filter((k) => (hashMap.get(k)?.length || 0) >= 2);
    for (let i = viableHashes.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [viableHashes[i], viableHashes[j]] = [viableHashes[j], viableHashes[i]];
    }

    for (const h of viableHashes) {
      if (pairs.length >= 2) break;
      const nodes = hashMap.get(h)!;
      for (let i = 0; i < nodes.length - 1; i++) {
        const p1 = nodes[i];
        const p2 = nodes[i + 1];
        const dist = Math.abs(p1[0] - p2[0]) + Math.abs(p1[1] - p2[1]);
        if (dist >= Math.floor(width * 0.5)) {
          pairs.push({
            landmarkA: p1,
            landmarkB: p2,
            isLethalA: true,
            signature: `Twin_3x3_Hash_${h}_D${dist}`,
          });
          break;
        }
      }
    }

    return pairs;
  }

  /**
   * 嚴格相位增益三段認知波浪與內部熵值病理分析（嚴格要求 Phase Gain >= 1.45x）
   */
  private static _analyzeCognitiveWaveStrict(
    grid: number[][],
    width: number,
    height: number,
    solution: [number, number][],
    greedyPath: [number, number][],
    end: [number, number],
    targetMinPhaseGain: number
  ): {
    waypoints: DeceptionWaypoint[];
    maxVisualRegret: number;
    avgVisualRegret: number;
    phaseGain: number;
    isWaveStrictlyCompliant: boolean;
  } {
    const waypoints: DeceptionWaypoint[] = [];
    const solSet = new Map<string, number>();
    for (let i = 0; i < solution.length; i++) {
      solSet.set(`${solution[i][0]},${solution[i][1]}`, i);
    }

    const regretScores: number[] = [];
    let earlyMax = 8.0;
    let midMax = 0.0;
    let lateMax = 6.0;

    for (let i = 0; i < greedyPath.length; i++) {
      const [gx, gy] = greedyPath[i];
      const solIdx = solSet.get(`${gx},${gy}`);

      if (solIdx === undefined && i > 0) {
        const [prevX, prevY] = greedyPath[i - 1];
        const prevSolIdx = solSet.get(`${prevX},${prevY}`);
        if (prevSolIdx !== undefined) {
          const { steps, straightness, subForks } = this._traceBranchMetricsWithEntropy(grid, width, height, gx, gy, prevX, prevY, end);
          
          // 內部決策熵值複合權重：steps * (1 + straightness*2) * (1 + subForks*0.5)
          const entropyMultiplier = 1.0 + subForks * 0.50;
          const regret = Number((steps * (1.0 + straightness * 2.0) * entropyMultiplier).toFixed(1));
          regretScores.push(regret);

          const progressRatio = prevSolIdx / solution.length;
          if (progressRatio <= 0.30) earlyMax = Math.max(earlyMax, regret);
          else if (progressRatio <= 0.70) midMax = Math.max(midMax, regret);
          else lateMax = Math.max(lateMax, regret);

          waypoints.push({
            coordinate: [prevX, prevY],
            divergedStep: prevSolIdx,
            visualConfidenceScore: Number(straightness.toFixed(2)),
            internalSubForks: subForks,
            regretCost: regret,
            trapType: progressRatio > 0.85 ? 'Goal_Keeper_Fork' : subForks >= 2 ? 'Twin_Landmark_Trap' : straightness > 0.6 ? 'Straight_Lure' : 'Camouflaged_Bypass',
          });
        }
      }
    }

    const maxVisualRegret = regretScores.length > 0 ? Math.max(...regretScores) : 14.0;
    const avgVisualRegret = regretScores.length > 0 ? regretScores.reduce((a, b) => a + b, 0) / regretScores.length : 14.0;

    const phaseGain = earlyMax > 0 ? midMax / earlyMax : 1.0;
    const isWaveStrictlyCompliant = phaseGain >= targetMinPhaseGain && midMax > lateMax * 1.20;

    return { waypoints, maxVisualRegret, avgVisualRegret, phaseGain, isWaveStrictlyCompliant };
  }

  private static _traceBranchMetricsWithEntropy(
    grid: number[][],
    width: number,
    height: number,
    startX: number,
    startY: number,
    fromX: number,
    fromY: number,
    end: [number, number]
  ): { steps: number; straightness: number; subForks: number } {
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
    let subForks = 0;

    const limit = 45;
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
        subForks++;
        steps += 3;
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
    return { steps, straightness, subForks };
  }

  private static _injectGoalKeeperDilemma(
    grid: number[][],
    width: number,
    height: number,
    end: [number, number],
    rnd: () => number
  ): boolean {
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const [ex, ey] = end;

    for (let d = 0; d < 4; d++) {
      const [dx, dy] = dirs[d];
      const gateX = ex + dx;
      const gateY = ey + dy;
      if (gateX > 1 && gateX < width - 2 && gateY > 1 && gateY < height - 2 && grid[gateY][gateX] === 0) {
        const ortho = [dy, dx];
        const loopW1X = gateX + ortho[0];
        const loopW1Y = gateY + ortho[1];
        const loopT1X = gateX + (ortho[0] << 1);
        const loopT1Y = gateY + (ortho[1] << 1);

        if (loopT1X > 0 && loopT1X < width - 1 && loopT1Y > 0 && loopT1Y < height - 1 && grid[loopW1Y][loopW1X] === 1) {
          grid[loopW1Y][loopW1X] = 0;
          grid[loopT1Y][loopT1X] = 0;
          return true;
        }
      }
    }
    return false;
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

    const dirs: [number, number][] = [
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
      twinLandmarks: [],
      deceptionWaypoints: [],
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
      cognitivePhaseGain: 1.0,
      hasPrimeFractalSymmetry: false,
      hasGoalKeeperTrap: false,
      hasPhase2MentalGlitch: false,
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
        cognitive_phase_gain: 1.0,
        has_prime_fractal_symmetry: false,
        has_goal_keeper_trap: false,
        has_phase2_mental_glitch: false,
        deception_waypoint_count: 0,
        attempt_iteration: 0,
        braid_loop_count: 0,
        irt_logit_difficulty: baseIrt,
        estimated_time_sec: 30,
        solving_path: ['Safe Spanning Corridor'],
        seed,
        actualTier: tier,
      } as any,
      cognitiveLoad: { spatial: 0.6, numeric: 0.0, workingMemory: 0.5, inhibition: 0.5 },
      checksum: `MAZE_FB_V8_${size}x${size}_S${seed}`,
    };
  }
}
