// web-frontend/src/engines/mazeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type StrategyPersona = 'Macro-Planner' | 'Wall-Follower' | 'Intuitive-Explorer';

export class WebMazeGenerator {
  static generate(tier: TierKey, personaBias?: StrategyPersona): PuzzleEntity {
    // 嚴格奇數尺寸階梯
    const sizeMap: Record<TierKey, number> = {
      kids: 11,
      intermediate: 15,
      expert: 21,
      master: 27,
    };

    const size = sizeMap[tier] || 15;
    const width = size;
    const height = size;

    // 1. 初始化全實心牆面 (1: 牆, 0: 通路)
    const grid: number[][] = Array.from({ length: height }, () => Array(width).fill(1));

    // 座標定義：startX = 1 (列/X), startY = 1 (行/Y)
    const startX = 1;
    const startY = 1;
    const endX = width - 2;
    const endY = height - 2;

    // 2. 深度遞迴回溯生成主拓撲樹
    grid[startY][startX] = 0;
    const stack: [number, number][] = [[startX, startY]];

    while (stack.length > 0) {
      const [cx, cy] = stack[stack.length - 1];
      const neighbors: [number, number, number, number][] = [];

      for (const [dx, dy] of [
        [0, -2],
        [0, 2],
        [-2, 0],
        [2, 0],
      ]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1 && grid[ny][nx] === 1) {
          neighbors.push([cx + dx / 2, cy + dy / 2, nx, ny]);
        }
      }

      if (neighbors.length > 0) {
        const [mx, my, nx, ny] = neighbors[Math.floor(Math.random() * neighbors.length)];
        grid[my][mx] = 0;
        grid[ny][nx] = 0;
        stack.push([nx, ny]);
      } else {
        stack.pop();
      }
    }

    // 3. 確保起點與終點實體格子必定為通路 (0)
    grid[startY][startX] = 0;
    grid[endY][endX] = 0;

    // 保證終點連通性：若終點為死胡同，強制打通相鄰內牆
    if (grid[endY - 1][endX] === 1 && grid[endY][endX - 1] === 1) {
      grid[endY - 1][endX] = 0;
    }

    const start: [number, number] = [startX, startY];
    const end: [number, number] = [endX, endY];

    // 4. 🧠 策略閉環動態調整 (Closed-Loop Adaptation)
    let loopCount = tier === 'kids' ? 0 : tier === 'intermediate' ? 2 : tier === 'expert' ? 5 : 8;
    let distractorCount = tier === 'kids' ? 0 : tier === 'intermediate' ? 4 : tier === 'expert' ? 8 : 16;

    if (personaBias === 'Intuitive-Explorer') {
      distractorCount = Math.round(distractorCount * 1.5);
    } else if (personaBias === 'Wall-Follower') {
      loopCount = Math.round(loopCount * 1.6);
    } else if (personaBias === 'Macro-Planner') {
      distractorCount += 2;
      loopCount += 2;
    }

    this._injectDeceptiveLongLoops(grid, width, height, start, end, loopCount);
    this._injectAdvancedDistractors(grid, width, height, distractorCount);

    // 重新計算並驗證數學理論最優解
    let solution = this._bfs(grid, width, height, start, end);
    if (solution.length <= 2) {
      grid[endY][endX - 1] = 0;
      grid[endY - 1][endX] = 0;
      solution = this._bfs(grid, width, height, start, end);
    }

    const limitedHumanPath = this._simulateHumanPathLimited(grid, width, height, start, end, 3, 0.7);
    const baselineWallFollow = this._simulateHumanPath(grid, width, height, start, end);
    const cognitiveGap = Math.max(0, limitedHumanPath.length - solution.length);

    const turnCount = this._countTurns(solution);
    const realDeadEndDepth = this._computeRealDeadEndDepth(grid, width, height);
    const pathEntropy = this._computePathEntropy(grid, width, height, solution);
    const tortuosity = this._computeTortuosity(solution);

    const visualNoiseScore =
      tier === 'kids' ? 0.15 : tier === 'intermediate' ? 0.45 : tier === 'expert' ? 0.75 : 0.95;

    const spatialLoad = Math.min(
      1.0,
      0.25 + (tortuosity / 2.5) * 0.45 + (turnCount / Math.max(8, width * 1.3)) * 0.30
    );
    const workingMemoryLoad = Math.min(
      1.0,
      0.20 + (pathEntropy / 3.2) * 0.40 + (realDeadEndDepth / 8.0) * 0.40
    );
    const inhibitionLoad = Math.min(
      1.0,
      0.20 + (realDeadEndDepth / 7.0) * 0.45 + (tier === 'master' ? 0.35 : 0.15)
    );

    const id = `maze_${tier}_gen_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    return {
      id,
      category: 'topological',
      engine_type: 'maze',
      tier,
      puzzle: {
        width,
        height,
        size,
        start: [startX, startY],
        end: [endX, endY],
        goal: [endX, endY], // 雙鍵容錯
        grid,
        visualNoise: visualNoiseScore,
        adaptedFor: personaBias || 'standard',
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
      } as unknown as { decision_depth: number; propagation_steps?: number },
      cognitiveLoad: {
        spatial: Number(spatialLoad.toFixed(2)),
        numeric: 0.0,
        workingMemory: Number(workingMemoryLoad.toFixed(2)),
        inhibition: Number(inhibitionLoad.toFixed(2)),
      },
      checksum: `gen_${id}`,
    };
  }

  /**
   * O(1) 隊列指針 BFS 最短路徑求解 (嚴格保持 [x, y] 格式)
   */
  private static _bfs(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number]
  ): [number, number][] {
    const queue: [number, number, [number, number][]][] = [[start[0], start[1], [start]]];
    const visited = new Set<string>([`${start[0]},${start[1]}`]);
    let head = 0;

    while (head < queue.length) {
      const [cx, cy, path] = queue[head++];
      if (cx === end[0] && cy === end[1]) return path;

      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === 0) {
          const key = `${nx},${ny}`;
          if (!visited.has(key)) {
            visited.add(key);
            queue.push([nx, ny, [...path, [nx, ny]]]);
          }
        }
      }
    }
    return [start, end];
  }

  /**
   * 長距離欺騙環路注入
   */
  private static _injectDeceptiveLongLoops(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number],
    count: number
  ): void {
    let added = 0;
    const originalShortest = this._bfs(grid, width, height, start, end).length;

    for (let attempt = 0; attempt < count * 60 && added < count; attempt++) {
      const r1 = 2 + Math.floor(Math.random() * (width - 4));
      const c1 = 2 + Math.floor(Math.random() * (height - 4));
      if (grid[c1][r1] !== 1) continue;

      let bestPair: [number, number] | null = null;
      let bestDist = 0;

      for (let i = 0; i < 25; i++) {
        const r2 = 2 + Math.floor(Math.random() * (width - 4));
        const c2 = 2 + Math.floor(Math.random() * (height - 4));
        if (grid[c2][r2] !== 1) continue;

        const dist = Math.abs(r1 - r2) + Math.abs(c1 - c2);
        if (dist > 8 && dist > bestDist) {
          const open1 = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(
            ([dx, dy]) => grid[c1 + dy]?.[r1 + dx] === 0
          ).length;
          const open2 = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(
            ([dx, dy]) => grid[c2 + dy]?.[r2 + dx] === 0
          ).length;
          if (open1 >= 1 && open2 >= 1) {
            bestPair = [r2, c2];
            bestDist = dist;
          }
        }
      }

      if (bestPair) {
        const testGrid = grid.map((row) => [...row]);
        testGrid[c1][r1] = 0;
        testGrid[bestPair[1]][bestPair[0]] = 0;

        const newShortest = this._bfs(testGrid, width, height, start, end).length;
        if (newShortest <= originalShortest * 0.85 && newShortest >= originalShortest * 0.4) {
          grid[c1][r1] = 0;
          grid[bestPair[1]][bestPair[0]] = 0;
          added++;
        }
      }
    }
  }

  /**
   * 階梯型與螺旋型多樣態盲巷
   */
  private static _injectAdvancedDistractors(
    grid: number[][],
    width: number,
    height: number,
    count: number
  ): void {
    let added = 0;
    for (let attempt = 0; attempt < count * 40 && added < count; attempt++) {
      const r = 2 + Math.floor(Math.random() * (width - 4));
      const c = 2 + Math.floor(Math.random() * (height - 4));
      if (grid[c][r] !== 1) continue;

      const openNeighbors = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(
        ([dx, dy]) => grid[c + dy]?.[r + dx] === 0
      );
      if (openNeighbors.length !== 1) continue;

      let [dx, dy] = openNeighbors[0];
      let cx = r;
      let cy = c;
      const pattern = Math.random();
      const steps = 3 + Math.floor(Math.random() * 3);

      for (let step = 0; step < steps; step++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx <= 0 || nx >= width - 1 || ny <= 0 || ny >= height - 1) break;
        if (grid[ny][nx] === 0) break;

        grid[ny][nx] = 0;
        cx = nx;
        cy = ny;

        if (pattern < 0.33 && step % 2 === 1 && step < steps - 1) {
          const turns = [[0, 1], [0, -1], [1, 0], [-1, 0]]
            .filter(([tdx, tdy]) => !(tdx === -dx && tdy === -dy))
            .filter(([tdx, tdy]) => {
              const tnx = cx + tdx;
              const tny = cy + tdy;
              return tnx > 0 && tnx < width - 1 && tny > 0 && tny < height - 1 && grid[tny][tnx] === 1;
            });
          if (turns.length > 0) {
            const chosen = turns[Math.floor(Math.random() * turns.length)];
            dx = chosen[0];
            dy = chosen[1];
          }
        } else if (pattern >= 0.33 && pattern < 0.66 && step > 0 && Math.random() < 0.35) {
          const rightTurn: [number, number][] = [
            [0, 1],
            [1, 0],
            [0, -1],
            [-1, 0],
          ];
          const idx = rightTurn.findIndex(([tdx, tdy]) => tdx === dx && tdy === dy);
          if (idx !== -1) {
            const next = rightTurn[(idx + 1) % 4];
            const tnx = cx + next[0];
            const tny = cy + next[1];
            if (tnx > 0 && tnx < width - 1 && tny > 0 && tny < height - 1 && grid[tny][tnx] === 1) {
              dx = next[0];
              dy = next[1];
            }
          }
        }
      }
      added++;
    }
  }

  /**
   * 受限人類模擬器
   */
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
    const dirs = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    let dirIdx = 0;
    let step = 0;

    while (step < width * height * 5 && !(cx === end[0] && cy === end[1])) {
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
        const revisitPenalty = visited.has(`${nx},${ny}`) ? 2.2 : 0;
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
        visited.set(`${cx},${cy}`, step);

        for (const [key, val] of visited) {
          if (step - val > 10) visited.set(key, val * memoryDecay);
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

  private static _simulateHumanPath(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number]
  ): [number, number][] {
    const path: [number, number][] = [start];
    let cx = start[0];
    let cy = start[1];
    const visited = new Set<string>([`${cx},${cy}`]);
    const dirs = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    let dirIdx = 0;

    for (let iter = 0; iter < width * height * 4; iter++) {
      if (cx === end[0] && cy === end[1]) break;

      for (let i = 0; i < 4; i++) {
        const idx = (dirIdx + i) % 4;
        const [dx, dy] = dirs[idx];
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === 0) {
          const key = `${nx},${ny}`;
          if (!visited.has(key) || (nx === end[0] && ny === end[1])) {
            visited.add(key);
            path.push([nx, ny]);
            cx = nx;
            cy = ny;
            dirIdx = (idx + 3) % 4;
            break;
          }
        }
      }

      if (path.length > 2 && cx === path[path.length - 2][0] && cy === path[path.length - 2][1]) {
        path.pop();
        if (path.length > 1) {
          cx = path[path.length - 1][0];
          cy = path[path.length - 1][1];
        }
      }
    }
    return path;
  }

  private static _computeRealDeadEndDepth(grid: number[][], width: number, height: number): number {
    const deadEnds: [number, number][] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y][x] !== 0) continue;
        if (x === 1 && y === 1) continue;
        if (x === width - 2 && y === height - 2) continue;

        const neighbors = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(
          ([dx, dy]) => grid[y + dy]?.[x + dx] === 0
        );
        if (neighbors.length === 1) deadEnds.push([x, y]);
      }
    }
    if (deadEnds.length === 0) return 2.0;

    let totalDepth = 0;
    for (const [sx, sy] of deadEnds) {
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
    const euclideanDist = Math.sqrt(
      Math.pow(end[0] - start[0], 2) + Math.pow(end[1] - start[1], 2)
    );
    if (euclideanDist === 0) return 1.0;
    const actualLength = path.length - 1;
    return Math.min(3.5, actualLength / euclideanDist);
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
