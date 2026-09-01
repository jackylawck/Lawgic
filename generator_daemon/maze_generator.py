// web-frontend/src/engines/mazeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export class WebMazeGenerator {
  static generate(tier: TierKey): PuzzleEntity {
    // 依據階梯決定迷宮維度（必須為奇數）
    const sizeMap: Record<TierKey, number> = {
      kids: 9,
      intermediate: 11,
      expert: 13,
      master: 17,
    };

    const size = sizeMap[tier] || 9;
    const width = size;
    const height = size;

    // 1. 初始化全牆壁 (1: 牆, 0: 通路)
    const grid: number[][] = Array.from({ length: height }, () => Array(width).fill(1));

    // 2. DFS 遞迴回溯挖路
    const carve = (x: number, y: number) => {
      grid[y][x] = 0;
      const dirs = [
        [0, -2],
        [0, 2],
        [-2, 0],
        [2, 0],
      ].sort(() => Math.random() - 0.5);

      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1 && grid[ny][nx] === 1) {
          grid[y + dy / 2][x + dx / 2] = 0;
          carve(nx, ny);
        }
      }
    };

    carve(1, 1);

    const start: [number, number] = [1, 1];
    const end: [number, number] = [width - 2, height - 2];

    // 3. BFS 最短路徑求解 (保證解法存在)
    const queue: [number, number, [number, number][]][] = [[start[0], start[1], [start]]];
    const visited = new Set<string>([`${start[0]},${start[1]}`]);
    let solution: [number, number][] = [start, end];

    while (queue.length > 0) {
      const [cx, cy, path] = queue.shift()!;
      if (cx === end[0] && cy === end[1]) {
        solution = path;
        break;
      }

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

    const pathLen = solution.length;
    const id = `maze_${tier}_gen_${Date.now()}`;

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
        spatial: Math.min(1.0, 0.5 + pathLen / 50),
        numeric: 0.0,
        workingMemory: Math.min(1.0, 0.4 + size / 25),
        inhibition: 0.6,
      },
      checksum: `gen_${id}`,
    };
  }
}
