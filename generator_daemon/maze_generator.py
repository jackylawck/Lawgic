// web-frontend/src/engines/mazeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export class WebMazeGenerator {
  static generate(tier: TierKey): PuzzleEntity {
    // 依據階梯決定迷宮維度（資優硬核尺寸）
    const sizeMap: Record<TierKey, number> = {
      kids: 11,
      intermediate: 15,
      expert: 19,
      master: 25,
    };

    const size = sizeMap[tier] || 11;
    const width = size;
    const height = size;

    // 1. 初始化全牆壁 (1: 牆, 0: 通路)
    const grid: number[][] = Array.from({ length: height }, () => Array(width).fill(1));

    // 2. Randomized Prim 生成樹演算法 (保證連通與唯一解)
    const start_x = 1;
    const start_y = 1;
    grid[start_y][start_x] = 0;

    const walls: [number, number, number, number][] = [];
    for (const [dx, dy] of [[0, 2], [2, 0], [0, -2], [-2, 0]]) {
      const nx = start_x + dx;
      const ny = start_y + dy;
      if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1) {
        walls.push([start_x, start_y, nx, ny]);
      }
    }

    while (walls.length > 0) {
      const idx = Math.floor(Math.random() * walls.length);
      const [wx, wy, nx, ny] = walls.splice(idx, 1)[0];

      if (grid[ny][nx] === 1) {
        grid[wy + Math.floor((ny - wy) / 2)][wx + Math.floor((nx - wx) / 2)] = 0;
        grid[ny][nx] = 0;

        for (const [dx, dy] of [[0, 2], [2, 0], [0, -2], [-2, 0]]) {
          const nnx = nx + dx;
          const nny = ny + dy;
          if (nnx > 0 && nnx < width - 1 && nny > 0 && nny < height - 1 && grid[nny][nnx] === 1) {
            walls.push([nx, ny, nnx, nny]);
          }
        }
      }
    }

    const start: [number, number] = [1, 1];
    const end: [number, number] = [width - 2, height - 2];

    // 3. BFS 求解唯一最優路徑
    const queue: [number, number, [number, number][]][] = [[start[0], start[1], [start]]];
    const visited = new Set<string>([`${start[0]},${start[1]}`]);
    let solution: [number, number][] = [start, end];

    while (queue.length > 0) {
      const [cx, cy, path] = queue.shift()!;
      if (cx === end[0] && cy === end[1]) {
        solution = path;
        break;
      }

      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
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

    // 4. 計算轉彎數與死胡同指標
    let turnCount = 0;
    for (let i = 1; i < solution.length - 1; i++) {
      const dx1 = solution[i][0] - solution[i - 1][0];
      const dy1 = solution[i][1] - solution[i - 1][1];
      const dx2 = solution[i + 1][0] - solution[i][0];
      const dy2 = solution[i + 1][1] - solution[i][1];
      if (dx1 !== dx2 || dy1 !== dy2) turnCount++;
    }

    const pathLen = solution.length;
    const id = `maze_${tier}_gen_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    return {
      id,
      category: 'topological',
      engine_type: 'maze',
      tier,
      puzzle: { width, height, start, end, grid },
      solution,
      metrics: {
        decision_depth: pathLen,
        propagation_steps: width * height,
      },
      cognitiveLoad: {
        spatial: Math.min(1.0, 0.45 + (turnCount / (width * 1.2)) * 0.45),
        numeric: 0.0,
        workingMemory: Math.min(1.0, 0.4 + size / 30),
        inhibition: Math.min(1.0, 0.5 + size / 40),
      },
      checksum: `gen_${id}`,
    };
  }
}
