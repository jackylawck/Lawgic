// web-frontend/src/engines/mazeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export class WebMazeGenerator {
  static generate(tier: TierKey): PuzzleEntity {
    const sizeMap: Record<TierKey, number> = {
      kids: 11,
      intermediate: 15,
      expert: 19,
      master: 25,
    };

    const size = sizeMap[tier] || 11;
    const width = size;
    const height = size;

    const grid: number[][] = Array.from({ length: height }, () => Array(width).fill(1));

    const startX = 1;
    const startY = 1;
    grid[startY][startX] = 0;

    const walls: [number, number, number, number][] = [];
    for (const [dx, dy] of [[0, 2], [2, 0], [0, -2], [-2, 0]]) {
      const nx = startX + dx;
      const ny = startY + dy;
      if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1) {
        walls.push([startX, startY, nx, ny]);
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

    let solution = this._bfs(grid, width, height, start, end);
    this._injectStrategicBets(grid, width, height, solution, tier);
    solution = this._bfs(grid, width, height, start, end);

    const turnCount = this._countTurns(solution);
    const deadEndDepth = this._avgDeadEndDepth(grid, width, height);
    const pathEntropy = this._computePathEntropy(grid, width, height, solution);

    const visualNoiseScore =
      tier === 'kids' ? 0.15 : tier === 'intermediate' ? 0.4 : tier === 'expert' ? 0.7 : 0.95;

    const spatialLoad = Math.min(1.0, 0.35 + (turnCount / Math.max(6, width * 1.1)) * 0.45);
    const workingMemoryLoad = Math.min(
      1.0,
      0.30 + (pathEntropy / 3.0) * 0.45 + visualNoiseScore * 0.25
    );
    const inhibitionLoad = Math.min(
      1.0,
      0.25 + (deadEndDepth / 5.0) * 0.40 + (visualNoiseScore > 0.5 ? 0.35 : 0.15)
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

  private static _bfs(
    grid: number[][],
    width: number,
    height: number,
    start: [number, number],
    end: [number, number]
  ): [number, number][] {
    const queue: [number, number, [number, number][]][] = [[start[0], start[1], [start]]];
    const visited = new Set<string>([`${start[0]},${start[1]}`]);

    while (queue.length > 0) {
      const [cx, cy, path] = queue.shift()!;
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

  private static _injectStrategicBets(
    grid: number[][],
    width: number,
    height: number,
    solution: [number, number][],
    tier: TierKey
  ): void {
    const count = tier === 'kids' ? 1 : tier === 'intermediate' ? 2 : 3;
    let injected = 0;
    const candidates: [number, number][] = [];

    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        if (grid[y][x] === 1) {
          const hOpen = grid[y][x - 1] === 0 && grid[y][x + 1] === 0;
          const vOpen = grid[y - 1][x] === 0 && grid[y + 1][x] === 0;
          if (hOpen || vOpen) {
            candidates.push([x, y]);
          }
        }
      }
    }

    while (injected < count && candidates.length > 0) {
      const idx = Math.floor(Math.random() * candidates.length);
      const [cx, cy] = candidates.splice(idx, 1)[0];
      grid[cy][cx] = 0;
      injected++;
    }
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

  private static _avgDeadEndDepth(grid: number[][], width: number, height: number): number {
    let totalDepth = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y][x] === 0 && !(x === 1 && y === 1) && !(x === width - 2 && y === height - 2)) {
          const neighbors = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(
            ([dx, dy]) => grid[y + dy][x + dx] === 0
          );
          if (neighbors.length === 1) {
            count++;
            totalDepth += 2.5;
          }
        }
      }
    }
    return count > 0 ? totalDepth / count : 1.5;
  }
}
