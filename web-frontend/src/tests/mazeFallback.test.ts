import { describe, it, expect } from 'vitest';
import { WebMazeGenerator, MazeSpec } from '../engines/mazeGenerator';
import { VALID_TIERS } from '../hooks/usePuzzlePool';

describe('Maze Production Pipeline & Topological Integrity', () => {
  VALID_TIERS.forEach((tier) => {
    it(`Tier [${tier}] generated instance must have valid continuous solution path`, () => {
      // 測試包含一般種子與極限邊界種子 (0, 0x7fffffff)
      const testSeeds = [42, 0, 0x7fffffff];

      for (const seed of testSeeds) {
        const entity = WebMazeGenerator.generate(tier, undefined, seed);
        const spec = entity.puzzle as MazeSpec;
        const solution = entity.solution as [number, number][];

        expect(spec).toBeDefined();
        expect(spec.grid.length).toBe(spec.height);
        expect(spec.grid[0].length).toBe(spec.width);
        expect(solution.length).toBeGreaterThanOrEqual(2);

        // 驗證起點與終點
        expect(solution[0]).toEqual(spec.start);
        expect(solution[solution.length - 1]).toEqual(spec.end);

        // 走廊步進連續性驗證 (每一步曼哈頓距離必須嚴格為 1)
        for (let i = 0; i < solution.length - 1; i++) {
          const [cx, cy] = solution[i];
          const [nx, ny] = solution[i + 1];
          const dist = Math.abs(cx - nx) + Math.abs(cy - ny);
          expect(dist).toBe(1);
          expect(spec.grid[cy][cx]).toBe(0);
          expect(spec.grid[ny][nx]).toBe(0);
        }
      }
    });
  });
});
