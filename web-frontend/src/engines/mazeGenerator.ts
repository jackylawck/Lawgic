// web-frontend/src/engines/mazeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export class WebMazeGenerator {
  static generate(tier: TierKey): PuzzleEntity {
    // 尺寸配置：專家與魔王尺寸拉大
    const sizeMap: Record<TierKey, number> = {
      kids: 11,
      intermediate: 15,
      expert: 21,
      master: 27,
    };

    const width = sizeMap[tier] || 15;
    const height = sizeMap[tier] || 15;

    // 1. 初始化全實心牆壁 (1: 牆, 0: 通路)
    const grid: number[][] = Array.from({ length: height }, () => Array(width).fill(1));

    // 2. 採用 Deep Recursive Backtracker (產生超長曲折路徑與極深死胡同)
    const startX = 1;
    const startY = 1;
    const endX = width - 2;
    const endY = height - 2;

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
        // 隨機選擇相鄰節點打通
        const [mx, my, nx, ny] = neighbors[Math.floor(Math.random() * neighbors.length)];
        grid[my][mx] = 0;
        grid[ny][nx] = 0;
        stack.push([nx, ny]);
      } else {
        stack.pop();
      }
    }

    // 3. 確保終點周圍與終點本身絕對被打通
    grid[endY][endX] = 0;
    if (grid[endY - 1][endX] === 1 && grid[endY][endX - 1] === 1) {
      grid[endY - 1][endX] = 0;
    }

    const start: [number, number] = [startX, startY];
    const end: [number, number] = [endX, endY];

    // 4. 計算理論最短路徑
    let solution = this._bfs(grid, width, height, start, end);

    // 5. 魔王與專家模式：注入環路形成假捷徑陷阱 (Braid Loops)
    const loopCount = tier === 'kids' ? 0 : tier === 'intermediate' ? 2 : tier === 'expert' ? 5 : 8;
    this._injectLoops(grid, width, height, loopCount);

    // 重新校準注入環路後的最短解
    solution = this._bfs(grid, width, height, start, end);

    const turnCount = this._countTurns(solution);
    const pathEntropy = this._computePathEntropy(grid, width, height, solution);

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
        visualNoise: tier === 'master' ? 0.9 : tier === 'expert' ? 0.7 : 0.4,
      },
      solution,
      metrics: {
        decision_depth: solution.length,
        propagation_steps: width * height,
      },
      cognitiveLoad: {
        spatial: tier === 'master' ? 0.95 : 0.7,
        numeric: 0.0,
        workingMemory: tier === 'master' ? 0.9 : 0.6,
        inhibition: tier === 'master' ? 0.95 : 0.7,
      },
      checksum: `gen_${id}`,
    };
  }

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

  private static _injectLoops(grid: number[][], width: number, height: number, count: number): void {
    let added = 0;
    for (let attempts = 0; attempts < count * 20 && added < count; attempts++) {
      const rx = 1 + Math.floor(Math.random() * (width - 2));
      const ry = 1 + Math.floor(Math.random() * (height - 2));

      if (grid[ry][rx] === 1) {
        const hOpen = grid[ry][rx - 1] === 0 && grid[ry][rx + 1] === 0;
        const vOpen = grid[ry - 1][rx] === 0 && grid[ry + 1][rx] === 0;
        if (hOpen || vOpen) {
          grid[ry][rx] = 0;
          added++;
        }
      }
    }
  }

  private static _countTurns(path: [number, number][]): number {
    if (path.length < 3) return 0;
    let turns = 0;
    for (let i = 1; i < path.length - 1; i++) {
      const dx1 = path[i][0] - path[i - 1][0];
      const dy1 = path[i][1] - path[i - 1][1];
      const dx2 = path[i + 1][0] - path[i + 1][0];
      const dy2 = path[i + 1][1] - path[i + 1][1];
      if (dx1 !== dx2 || dy1 !== dy2) turns++;
    }
    return turns;
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
    return Math.max(1.0, totalForksOnPath / Math.max(1, solution.length * 0.2));
  }
}
