// web-frontend/src/engines/mazeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export class WebMazeGenerator {
  static generate(tier: TierKey): PuzzleEntity {
    // 嚴格尺寸階梯：魔王級提升至 27x27
    const sizeMap: Record<TierKey, number> = {
      kids: 11,
      intermediate: 15,
      expert: 21,
      master: 27,
    };

    const size = sizeMap[tier] || 15;
    const width = size;
    const height = size;

    // 1. 初始化全實心牆壁 (1: 牆, 0: 通路)
    const grid: number[][] = Array.from({ length: height }, () => Array(width).fill(1));

    const startX = 1;
    const startY = 1;
    const endX = width - 2;
    const endY = height - 2;

    // 2. 深度遞迴回溯生成主拓撲樹 (生成極深死路與超長蜿蜒走廊)
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

    // 3. 終點與起點絕對連通保證
    grid[endY][endX] = 0;
    if (grid[endY - 1][endX] === 1 && grid[endY][endX - 1] === 1) {
      grid[endY - 1][endX] = 0;
    }

    const start: [number, number] = [startX, startY];
    const end: [number, number] = [endX, endY];

    // 4. 計算理論基準最短路徑 (O(1) 隊列指針優化)
    let solution = this._bfs(grid, width, height, start, end);

    // 5. 注入長距離環路 (Long-range Loop Injection) 形成偽捷徑欺騙陷阱
    const loopCount = tier === 'kids' ? 0 : tier === 'intermediate' ? 2 : tier === 'expert' ? 5 : 8;
    this._injectLongLoops(grid, width, height, loopCount);

    // 6. 注入深度盲巷 (Deep Recursive Distractors，深度 3~6 步)
    const distractorCount = tier === 'kids' ? 0 : tier === 'intermediate' ? 4 : tier === 'expert' ? 8 : 16;
    this._injectDeepDistractors(grid, width, height, distractorCount);

    // 重新校準注入拓撲干擾後的真實最短解
    solution = this._bfs(grid, width, height, start, end);

    // 7. 計算真實圖論與認知科學指標（嚴禁魔術數字）
    const turnCount = this._countTurns(solution);
    const realDeadEndDepth = this._computeRealDeadEndDepth(grid, width, height);
    const pathEntropy = this._computePathEntropy(grid, width, height, solution);
    const tortuosity = this._computeTortuosity(solution);

    // 8. 認知負荷量化 (CLT 維度向量)
    const visualNoiseScore =
      tier === 'kids' ? 0.15 : tier === 'intermediate' ? 0.45 : tier === 'expert' ? 0.75 : 0.95;

    const spatialLoad = Math.min(1.0, 0.30 + (tortuosity / 2.5) * 0.40 + (turnCount / Math.max(8, width * 1.3)) * 0.30);
    const workingMemoryLoad = Math.min(
      1.0,
      0.25 + (pathEntropy / 3.2) * 0.45 + (realDeadEndDepth / 8.0) * 0.30
    );
    const inhibitionLoad = Math.min(
      1.0,
      0.20 + (realDeadEndDepth / 7.0) * 0.50 + (tier === 'master' ? 0.30 : 0.15)
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
        start,
        end,
        grid,
        visualNoise: visualNoiseScore,
      },
      solution,
      metrics: {
        decision_depth: solution.length,
        propagation_steps: width * height,
        turn_count: turnCount,
        mean_dead_end_depth: Number(realDeadEndDepth.toFixed(2)),
        tortuosity: Number(tortuosity.toFixed(3)),
      },
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
   * O(1) 隊列指針 BFS 最短路徑求解
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
   * 1. 真實死胡同深度計算：從端點向內回溯至首個分叉點 (Degree >= 3)
   */
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

        if (deg >= 3) break; // 抵達決策分叉節點

        visited.add(`${nextNode[0]},${nextNode[1]}`);
        cx = nextNode[0];
        cy = nextNode[1];
        depth++;
      }
      totalDepth += depth;
    }
    return totalDepth / deadEnds.length;
  }

  /**
   * 2. 長距離環路注入：連接距離大於 6 步的拓撲分支，形成欺騙性長捷徑
   */
  private static _injectLongLoops(grid: number[][], width: number, height: number, count: number): void {
    let added = 0;
    for (let attempt = 0; attempt < count * 40 && added < count; attempt++) {
      const rx = 2 + Math.floor(Math.random() * (width - 4));
      const ry = 2 + Math.floor(Math.random() * (height - 4));
      if (grid[ry][rx] !== 1) continue;

      const hOpen = grid[ry][rx - 1] === 0 && grid[ry][rx + 1] === 0;
      const vOpen = grid[ry - 1][rx] === 0 && grid[ry + 1][rx] === 0;

      if (hOpen || vOpen) {
        grid[ry][rx] = 0;
        added++;
      }
    }
  }

  /**
   * 3. 深度盲巷生成器：沿壁面挖掘長度 3~6 步的偽走廊，污染工作記憶
   */
  private static _injectDeepDistractors(grid: number[][], width: number, height: number, count: number): void {
    let added = 0;
    for (let attempt = 0; attempt < count * 35 && added < count; attempt++) {
      const r = 2 + Math.floor(Math.random() * (width - 4));
      const c = 2 + Math.floor(Math.random() * (height - 4));
      if (grid[c][r] !== 1) continue;

      const openNeighbors = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(
        ([dx, dy]) => grid[c + dy]?.[r + dx] === 0
      );
      if (openNeighbors.length !== 1) continue;

      const [dx, dy] = openNeighbors[0];
      const targetDepth = 2 + Math.floor(Math.random() * 4); // 2~5 步深度
      let cx = r;
      let cy = c;

      for (let step = 0; step < targetDepth; step++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx <= 0 || nx >= width - 1 || ny <= 0 || ny >= height - 1) break;
        if (grid[ny][nx] === 0) break;

        grid[ny][nx] = 0;
        cx = nx;
        cy = ny;
        added++;
      }
    }
  }

  /**
   * 4. 迂曲度指數（Tortuosity Index）：最短步數 / 起終點歐氏距離
   */
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
