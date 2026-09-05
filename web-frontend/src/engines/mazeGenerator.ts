// web-frontend/src/engines/mazeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';
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
  static generate(tier: ExtendedTierKey, personaBias?: StrategyPersona, inputSeed?: number): PuzzleEntity {
    const sizeMap: Record<ExtendedTierKey, number> = {
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

    // 2. 深度遞迴生成樹 (帶慣性動量的 DFS，取代寫死 chosenIdx = 0)
    const rootX = 1;
    const rootY = 1;
    grid[rootY][rootX] = 0;
    const stack: [number, number][] = [[rootX, rootY]];

    let lastDir: [number, number] | null = null;
    const baseDirs: [number, number][] = [
      [0, -2],
      [0, 2],
      [-2, 0],
      [2, 0],
    ];

    while (stack.length > 0) {
      const [cx, cy] = stack[stack.length - 1];
      const neighbors: [number, number, number, number, [number, number]][] = [];

      for (const [dx, dy] of baseDirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1 && grid[ny][nx] === 1) {
          neighbors.push([cx + dx / 2, cy + dy / 2, nx, ny, [dx, dy]]);
        }
      }

      if (neighbors.length > 0) {
        let chosenIdx = Math.floor(rnd() * neighbors.length);

        // 策略偏好：Macro-Planner 具備方向前進慣性 (直道優先，而非寫死往北)
        if (personaBias === 'Macro-Planner' && lastDir && neighbors.length > 1) {
          const sameDirIdx = neighbors.findIndex((n) => n[4][0] === lastDir![0] && n[4][1] === lastDir![1]);
          if (sameDirIdx !== -1 && rnd() < 0.72) {
            chosenIdx = sameDirIdx;
          }
        }

        const [mx, my, nx, ny, d] = neighbors[chosenIdx];
        grid[my][mx] = 0;
        grid[ny][nx] = 0;
        stack.push([nx, ny]);
        lastDir = d;
      } else {
        stack.pop();
        lastDir = null;
      }
    }

    // 3. 圖論樹直徑搜尋：雙重 BFS 取得整張地圖拓撲最遠之端點
    const { start, end } = this._findTopologicalDiameterEndpoints(grid, width, height);

    // 4. 受控死胡同注入 (嚴格杜絕迴圈形成)
    const distractorBaseMap: Record<ExtendedTierKey, number> = {
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

    // 5. 最優解計算 (BFS 最短路徑)
    const solution = this._bfs(grid, width, height, start, end);

    // 6. 人類工作記憶衰減尋路模擬 (FOV=3, Decay=0.7)
    const limitedHumanPath = this._simulateHumanPathLimited(grid, width, height, start, end, 3, 0.7);
    const baselineWallFollow = this._simulateWallFollower(grid, width, height, start, end);
    const cognitiveGap = Math.max(0, limitedHumanPath.length - solution.length);

    // 7. 認知與拓撲指標計算
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

    const normalizedSteps = limitedHumanPath.length / (width * height);
    const rawDifficulty = pathEntropy * 0.35 + realDeadEndDepth * 0.25 + normalizedSteps * 1.1;
    const tierBonus = tier === 'ultimate' ? 1.8 : tier === 'legendary' ? 1.2 : tier === 'master' ? 0.6 : 0;
    const irtLogitDifficulty = Number(Math.max(-2.5, Math.min(4.5, (rawDifficulty - 1.8) * 1.25 + tierBonus)).toFixed(2));

    const estimatedTimeSec = Math.round(
      12 + limitedHumanPath.length * 0.55 + turnCount * 0.8 + (isUltimate ? 40 : tier === 'legendary' ? 25 : 15)
    );

    const solvingPath = [
      `Topological Spanning Diameter (${solution.length} steps)`,
      `Decision Entropy Junctions (Entropy: ${pathEntropy.toFixed(1)})`,
      `Inhibition Filter (${Math.round(realDeadEndDepth)} avg dead-end depth)`,
    ];

    return {
      id: `maze_${tier}_s${actualSeed}`,
      category: 'topological',
      engine_type: 'maze',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      puzzle: {
        width,
        height,
        size,
        start,
        end,
        goal: end,
        grid,
        seed: actualSeed,
        actualTier: tier,
        visualNoise: tier === 'kids' ? 0.15 : tier === 'intermediate' ? 0.45 : tier === 'expert' ? 0.75 : 0.95,
        adaptedFor: personaBias || 'standard',
        solving_path: solvingPath,
      },
      solution,
      metrics: {
        decision_depth: solution.length,
        propagation_steps: width * height,
        turn_count: turnCount,
        mean_dead_end_depth: Number(realDeadEndDepth.toFixed(2)),
        tortuosity: Number(tortuosity.toFixed(3)),
        human_sim_steps: limitedHumanPath.length,
        baseline_wall_steps: baselineWallFollow.length,
        cognitive_gap: cognitiveGap,
        irt_logit_difficulty: irtLogitDifficulty,
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

  private static _findTopologicalDiameterEndpoints(
    grid: number[][],
    width: number,
    height: number
  ): { start: [number, number]; end: [number, number] } {
    let firstNode: [number, number] = [1, 1];
    outer: for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y][x] === 0) {
          firstNode = [x, y];
          break outer;
        }
      }
    }

    const furthestA = this._bfsFurthestNode(grid, width, height, firstNode);
    const furthestB = this._bfsFurthestNode(grid, width, height, furthestA);

    return { start: furthestA, end: furthestB };
  }

  private static _bfsFurthestNode(
    grid: number[][],
    width: number,
    height: number,
    origin: [number, number]
  ): [number, number] {
    const queue: [number, number][] = [origin];
    const visited = new Set<string>([`${origin[0]},${origin[1]}`]);
    let furthest: [number, number] = origin;
    let head = 0;

    const dirs = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    while (head < queue.length) {
      const [cx, cy] = queue[head++];
      furthest = [cx, cy];

      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1 && grid[ny][nx] === 0) {
          const key = `${nx},${ny}`;
          if (!visited.has(key)) {
            visited.add(key);
            queue.push([nx, ny]);
          }
        }
      }
    }
    return furthest;
  }

  /**
   * 嚴格保持單一樹拓撲的死胡同注入器 (杜絕 2x2 與環狀連通)
   */
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
    const mainSolution = new Set(
      this._bfs(grid, width, height, start, end).map(([x, y]) => `${x},${y}`)
    );

    let added = 0;
    const candidates: [number, number][] = [];
    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        if (mainSolution.has(`${x},${y}`)) candidates.push([x, y]);
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

      for (const [dx, dy] of dirs) {
        const wallX = rx + dx;
        const wallY = ry + dy;
        const blindX = rx + dx * 2;
        const blindY = ry + dy * 2;

        if (
          blindX > 0 &&
          blindX < width - 1 &&
          blindY > 0 &&
          blindY < height - 1 &&
          grid[wallY][wallX] === 1 &&
          grid[blindY][blindX] === 1
        ) {
          // 嚴格檢測：blindX, blindY 周邊 8 鄰居除 wallX, wallY 外不得有任何已開通路
          let hasNearbyLeak = false;
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const tx = blindX + ox;
              const ty = blindY + oy;
              if (tx === wallX && ty === wallY) continue;
              if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
                if (grid[ty][tx] === 0) {
                  hasNearbyLeak = true;
                  break;
                }
              }
            }
            if (hasNearbyLeak) break;
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

  private static _bfs(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number]
  ): [number, number][] {
    if (start[0] === end[0] && start[1] === end[1]) return [start];

    const queue: [number, number][] = [start];
    const prevMap = new Map<string, [number, number]>();
    const visited = new Set<string>([`${start[0]},${start[1]}`]);
    let head = 0;

    const dirs = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    let found = false;
    while (head < queue.length) {
      const [cx, cy] = queue[head++];
      if (cx === end[0] && cy === end[1]) {
        found = true;
        break;
      }

      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === 0) {
          const key = `${nx},${ny}`;
          if (!visited.has(key)) {
            visited.add(key);
            prevMap.set(key, [cx, cy]);
            queue.push([nx, ny]);
          }
        }
      }
    }

    if (!found) return [start, end];

    const path: [number, number][] = [];
    let curr: [number, number] | undefined = end;
    while (curr) {
      path.push(curr);
      if (curr[0] === start[0] && curr[1] === start[1]) break;
      curr = prevMap.get(`${curr[0]},${curr[1]}`);
    }
    return path.reverse();
  }

  private static _simulateHumanPathLimited(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number],
    viewRadius: number = 3,
    memoryDecay: number = 0.7
  ): [number, number][] {
    const path: [number, number][] = [start];
    let cx = start[0];
    let cy = start[1];
    const visited = new Map<string, number>();
    visited.set(`${cx},${cy}`, 0);
    const dirs: [number, number][] = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    let dirIdx = 0;
    let step = 0;

    while (step < width * height * 3 && !(cx === end[0] && cy === end[1])) {
      step++;
      let bestDir: [number, number] | null = null;
      let bestScore = -Infinity;

      for (let i = 0; i < 4; i++) {
        const idx = (dirIdx + i) % 4;
        const [dx, dy] = dirs[idx];
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || grid[ny][nx] !== 0) continue;

        const distToEnd = Math.abs(nx - end[0]) + Math.abs(ny - end[1]);
        const revisitPenalty = visited.has(`${nx},${ny}`) ? 2.4 : 0;
        const forwardBias = dx === dirs[dirIdx][0] && dy === dirs[dirIdx][1] ? 0.35 : 0;
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
        visited.set(`${cx},${cy}`, step);

        for (const [key, val] of visited) {
          if (step - val > 12) visited.set(key, val * memoryDecay);
        }
        dirIdx = dirs.findIndex(([dxx, dyy]) => dxx === dx && dyy === dy);
      } else {
        if (path.length > 1) {
          path.pop();
          cx = path[path.length - 1][0];
          cy = path[path.length - 1][1];
        } else break;
      }
    }
    return path;
  }

  /**
   * 健全的右手摸牆法則模擬器（杜絕原地死循環震盪）
   */
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
    let dir = 0; // 0: 南, 1: 東, 2: 北, 3: 西
    const dirs: [number, number][] = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];

    let steps = 0;
    const maxSteps = width * height * 4;

    while (!(cx === end[0] && cy === end[1]) && steps++ < maxSteps) {
      // 右手摸牆優先嘗試右轉方向：(dir + 1) % 4
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

  private static _computeRealDeadEndDepth(grid: number[][], width: number, height: number): number {
    const deadEnds: [number, number][] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y][x] !== 0) continue;
        const neighbors = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(
          ([dx, dy]) => grid[y + dy]?.[x + dx] === 0
        );
        if (neighbors.length === 1) deadEnds.push([x, y]);
      }
    }
    if (deadEnds.length === 0) return 2.0;

    let totalDepth = 0;
    const globalMemo = new Set<string>();

    for (const [sx, sy] of deadEnds) {
      if (globalMemo.has(`${sx},${sy}`)) continue;

      let depth = 1;
      let cx = sx;
      let cy = sy;
      const visited = new Set<string>([`${cx},${cy}`]);

      while (true) {
        const next = [[0, 1], [0, -1], [1, 0], [-1, 0]]
          .map(([dx, dy]) => [cx + dx, cy + dy] as [number, number])
          .filter(([nx, ny]) => nx >= 0 && nx < width && ny >= 0 && ny < height)
          .filter(([nx, ny]) => grid[ny][nx] === 0 && !visited.has(`${nx},${ny}`));

        if (next.length === 0) break;

        const nextNode = next[0];
        const deg = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(
          ([dx, dy]) => grid[nextNode[1] + dy]?.[nextNode[0] + dx] === 0
        ).length;

        if (deg >= 3) break;

        visited.add(`${nextNode[0]},${nextNode[1]}`);
        globalMemo.add(`${nextNode[0]},${nextNode[1]}`);
        cx = nextNode[0];
        cy = nextNode[1];
        depth++;
      }
      totalDepth += depth;
    }
    return totalDepth / deadEnds.length;
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
    for (const [x, y] of solution) {
      const branches = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(
        ([dx, dy]) =>
          x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && grid[y + dy][x + dx] === 0
      ).length;
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
