// web-frontend/src/engines/mazeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey;
export type StrategyPersona = 'Macro-Planner' | 'Wall-Follower' | 'Intuitive-Explorer';

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
    // 嚴格對齊全域 6 階奇數迷宮尺寸
    const sizeMap: Record<TierKey, number> = {
      kids: 11,
      intermediate: 17,
      expert: 23,
      master: 29,
      legendary: 35,
      ultimate: 41,
    };

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    const size = sizeMap[tier] || 17;
    const width = size;
    const height = size;

    // 1. 初始化實心牆 (1: 牆, 0: 通路)
    const grid: number[][] = Array.from({ length: height }, () => Array(width).fill(1));

    // 2. 慣性動量 DFS (零字串產生、純平坦棧構建生成樹)
    const stackX = new Int16Array(width * height);
    const stackY = new Int16Array(width * height);
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

    while (stackPtr > 0) {
      const cx = stackX[stackPtr - 1];
      const cy = stackY[stackPtr - 1];

      // 快速收集合法鄰格 (最多 4 個，免去動態物件分配)
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

        // 慣性宏觀規劃者動量加成
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

    // 3. 雙重 BFS 快速獲取幾何拓撲直徑最長端點
    const { start, end } = this._findTopologicalDiameterEndpoints(grid, width, height);

    // 4. 控制死胡同分佈
    const distractorBaseMap: Record<TierKey, number> = {
      kids: 0,
      intermediate: 2,
      expert: 5,
      master: 8,
      legendary: 12,
      ultimate: 16,
    };
    let distractorCount = distractorBaseMap[tier] ?? 4;
    if (personaBias === 'Intuitive-Explorer') distractorCount = Math.round(distractorCount * 1.4);
    this._injectStrictBlindAlleys(grid, width, height, start, end, distractorCount, rnd);

    // 5. 零 GC 快速求解主路徑
    const solution = this._bfs(grid, width, height, start, end);

    // 6. 人類認知模擬尋路
    const limitedHumanPath = this._simulateHumanPathLimited(grid, width, height, start, end);
    const baselineWallFollow = this._simulateWallFollower(grid, width, height, start, end);
    const cognitiveGap = Math.max(0, limitedHumanPath.length - solution.length);

    // 7. 特徵指標分析
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
      0.25 + (pathEntropy / 3.0) * 0.45 + (realDeadEndDepth / 7.0) * 0.30
    );
    const inhibitionLoad = Math.min(
      1.0,
      0.25 + (realDeadEndDepth / 6.0) * 0.45 + (isUltimate ? 0.30 : 0.18)
    );

    // 嚴格校準至全域 IRT 標準尺度 (Kids 0.65 ~ Ultimate 4.35)
    const baseIrtMap: Record<TierKey, number> = {
      kids: 0.65,
      intermediate: 1.45,
      expert: 2.35,
      master: 3.15,
      legendary: 3.75,
      ultimate: 4.35,
    };
    const dynamicIrt = Number(
      (baseIrtMap[tier] + (pathEntropy - 1.0) * 0.1 + (tortuosity - 1.0) * 0.15).toFixed(2)
    );

    const estimatedTimeSec = Math.round(
      12 + limitedHumanPath.length * 0.45 + turnCount * 0.6 + (isUltimate ? 35 : tier === 'legendary' ? 20 : 10)
    );

    const solvingPath = [
      `Topological Spanning Diameter (${solution.length} steps)`,
      `Decision Entropy Junctions (Entropy: ${pathEntropy.toFixed(1)})`,
      `Inhibition Filter (${Math.round(realDeadEndDepth)} avg dead-end depth)`,
    ];

    return {
      id: `maze_${tier}_s${actualSeed}`,
      category: 'spatial_logic',
      engine_type: 'maze',
      tier,
      puzzle: {
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
        seed: actualSeed,
        actualTier: tier,
        pureDeductionRate: 1.0,
        visualNoise: tier === 'kids' ? 0.15 : tier === 'intermediate' ? 0.45 : tier === 'expert' ? 0.75 : 0.95,
        adaptedFor: personaBias || 'standard',
        solving_path: solvingPath,
      },
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
        human_sim_steps: limitedHumanPath.length,
        baseline_wall_steps: baselineWallFollow.length,
        cognitive_gap: cognitiveGap,
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
      checksum: `MAZE_${size}x${size}_S${actualSeed}`,
    };
  }

  /**
   * 零字串分配的拓撲直徑最遠端點查找
   */
  private static _findTopologicalDiameterEndpoints(
    grid: number[][],
    width: number,
    height: number
  ): { start: [number, number]; end: [number, number] } {
    let firstX = 1;
    let firstY = 1;
    outer: for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y][x] === 0) {
          firstX = x;
          firstY = y;
          break outer;
        }
      }
    }

    const furthestA = this._bfsFurthestNode(grid, width, height, firstX, firstY);
    const furthestB = this._bfsFurthestNode(grid, width, height, furthestA[0], furthestA[1]);

    return { start: furthestA, end: furthestB };
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

    const dirs = [
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

  private static _injectStrictBlindAlleys(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number],
    count: number,
    rnd: () => number
  ): void {
    if (count <= 0) return;
    const solution = this._bfs(grid, width, height, start, end);
    const onMainPath = new Uint8Array(width * height);
    for (const [x, y] of solution) {
      onMainPath[y * width + x] = 1;
    }

    let added = 0;
    const candidates: [number, number][] = [];
    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        if (onMainPath[y * width + x]) candidates.push([x, y]);
      }
    }

    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const dirs = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    for (const [rx, ry] of candidates) {
      if (added >= count) break;

      for (let d = 0; d < 4; d++) {
        const dx = dirs[d][0];
        const dy = dirs[d][1];
        const wallX = rx + dx;
        const wallY = ry + dy;
        const blindX = rx + (dx << 1);
        const blindY = ry + (dy << 1);

        if (
          blindX > 0 &&
          blindX < width - 1 &&
          blindY > 0 &&
          blindY < height - 1 &&
          grid[wallY][wallX] === 1 &&
          grid[blindY][blindX] === 1
        ) {
          let hasNearbyLeak = false;
          for (let ox = -1; ox <= 1 && !hasNearbyLeak; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const tx = blindX + ox;
              const ty = blindY + oy;
              if (tx === wallX && ty === wallY) continue;
              if (tx >= 0 && tx < width && ty >= 0 && ty < height && grid[ty][tx] === 0) {
                hasNearbyLeak = true;
                break;
              }
            }
          }

          if (!hasNearbyLeak) {
            grid[wallY][wallX] = 0;
            grid[blindY][blindX] = 0;
            added++;
            break;
          }
        }
      }
    }
  }

  /**
   * 零 GC、平坦陣列映射的 BFS 最短路徑求解器
   */
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

    const dirs = [
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

  /**
   * 人類認知前向探索模擬 (記憶平坦映射，杜絕重複進入無效死胡同震盪)
   */
  private static _simulateHumanPathLimited(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number]
  ): [number, number][] {
    const path: [number, number][] = [start];
    let cx = start[0];
    let cy = start[1];

    const visitTimestamp = new Int32Array(width * height);
    visitTimestamp[cy * width + cx] = 1;

    const dirs: [number, number][] = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    let dirIdx = 0;
    let step = 0;
    const maxSteps = width * height * 2;

    while (step++ < maxSteps && (cx !== end[0] || cy !== end[1])) {
      let bestDir: [number, number] | null = null;
      let bestScore = -Infinity;

      for (let i = 0; i < 4; i++) {
        const idx = (dirIdx + i) % 4;
        const [dx, dy] = dirs[idx];
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || grid[ny][nx] !== 0) continue;

        const cellIdx = ny * width + nx;
        const distToEnd = Math.abs(nx - end[0]) + Math.abs(ny - end[1]);
        const revisitPenalty = visitTimestamp[cellIdx] > 0 ? 3.0 : 0;
        const forwardBias = dx === dirs[dirIdx][0] && dy === dirs[dirIdx][1] ? 0.4 : 0;
        const score = -distToEnd - revisitPenalty + forwardBias;

        if (score > bestScore) {
          bestScore = score;
          bestDir = [dx, dy];
        }
      }

      if (bestDir) {
        const [dx, dy] = bestDir;
        cx += dx;
        cy += dy;
        path.push([cx, cy]);
        visitTimestamp[cy * width + cx] = step;
        dirIdx = dirs.findIndex(([dxx, dyy]) => dxx === dx && dyy === dy);
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
    const maxSteps = width * height * 3;

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

  /**
   * 快速度數統計取得平均死胡同深度 (零字串分配)
   */
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
          // 向內走一小段檢驗平均深度
          let cx = x;
          let cy = y;
          let len = 1;
          let px = -1;
          let py = -1;

          while (len < 15) {
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
    const dirs = [
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
}
