// web-frontend/src/engines/nurikabeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary';

export interface NurikabeClue {
  r: number;
  c: number;
  value: number;
}

export type NurikabeDeductionType =
  | 'clue_surrounding_walls'
  | 'island_isolation'
  | 'pool_prevention'
  | 'island_saturation'
  | 'stream_chokepoint';

export interface NurikabeHintStep {
  step: number;
  type: NurikabeDeductionType;
  r: number;
  c: number;
  forcedState: 1 | 2;
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface NurikabeSpec {
  rows: number;
  cols: number;
  clues: NurikabeClue[];
  solution: number[][];
  pureDeductionRate: number;
  solvingSteps?: NurikabeHintStep[];
}

interface TierConfig {
  rows: number;
  cols: number;
  clueCount: number;
  baseIrt: number;
}

const TIER_SPECS: Record<ExtendedTierKey, TierConfig> = {
  kids: { rows: 5, cols: 5, clueCount: 3, baseIrt: -0.5 },
  intermediate: { rows: 6, cols: 6, clueCount: 4, baseIrt: 0.3 },
  expert: { rows: 7, cols: 7, clueCount: 5, baseIrt: 1.3 },
  master: { rows: 8, cols: 8, clueCount: 6, baseIrt: 2.3 },
  legendary: { rows: 9, cols: 9, clueCount: 8, baseIrt: 3.2 },
};

export class WebNurikabeGenerator {
  public static inBounds(r: number, c: number, rows: number, cols: number): boolean {
    return r >= 0 && r < rows && c >= 0 && c < cols;
  }

  public static isValidStream(grid: number[][], rows: number, cols: number): boolean {
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (
          grid[r][c] === 1 &&
          grid[r + 1][c] === 1 &&
          grid[r][c + 1] === 1 &&
          grid[r + 1][c + 1] === 1
        ) {
          return false;
        }
      }
    }

    let firstWall: [number, number] | null = null;
    let totalWalls = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 1) {
          totalWalls++;
          if (!firstWall) firstWall = [r, c];
        }
      }
    }

    if (totalWalls === 0 || !firstWall) return false;

    const visited = new Set<string>();
    const queue: [number, number][] = [firstWall];
    visited.add(`${firstWall[0]},${firstWall[1]}`);

    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length > 0) {
      const [cr, cc] = queue.shift()!;
      for (const [dr, dc] of dirs) {
        const nr = cr + dr;
        const nc = cc + dc;
        const key = `${nr},${nc}`;
        if (this.inBounds(nr, nc, rows, cols) && grid[nr][nc] === 1 && !visited.has(key)) {
          visited.add(key);
          queue.push([nr, nc]);
        }
      }
    }

    return visited.size === totalWalls;
  }

  public static auditIslands(grid: number[][], rows: number, cols: number, clues: NurikabeClue[]): boolean {
    const clueMap = new Map<string, number>();
    for (const cl of clues) clueMap.set(`${cl.r},${cl.c}`, cl.value);

    const visited = new Set<string>();
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const cl of clues) {
      if (grid[cl.r][cl.c] !== 2) return false;

      const queue: [number, number][] = [[cl.r, cl.c]];
      const islandCells: [number, number][] = [[cl.r, cl.c]];
      visited.add(`${cl.r},${cl.c}`);
      let clueHits = 0;

      while (queue.length > 0) {
        const [cr, cc] = queue.shift()!;
        if (clueMap.has(`${cr},${cc}`)) clueHits++;

        for (const [dr, dc] of dirs) {
          const nr = cr + dr;
          const nc = cc + dc;
          const key = `${nr},${nc}`;
          if (this.inBounds(nr, nc, rows, cols) && grid[nr][nc] === 2 && !visited.has(key)) {
            visited.add(key);
            queue.push([nr, nc]);
            islandCells.push([nr, nc]);
          }
        }
      }

      if (clueHits !== 1 || islandCells.length !== cl.value) {
        return false;
      }
    }

    let totalWhiteCells = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 2) totalWhiteCells++;
      }
    }

    return visited.size === totalWhiteCells;
  }

  public static countSolutions(
    rows: number,
    cols: number,
    clues: NurikabeClue[],
    limit: number = 2
  ): number {
    const board: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const cl of clues) {
      board[cl.r][cl.c] = 2;
    }

    let solutions = 0;

    const isValidPartial = (r: number, c: number): boolean => {
      for (let dr = -1; dr <= 0; dr++) {
        for (let dc = -1; dc <= 0; dc++) {
          const pr = r + dr;
          const pc = c + dc;
          if (this.inBounds(pr, pc, rows - 1, cols - 1)) {
            if (
              board[pr][pc] === 1 &&
              board[pr + 1][pc] === 1 &&
              board[pr][pc + 1] === 1 &&
              board[pr + 1][pc + 1] === 1
            ) {
              return false;
            }
          }
        }
      }
      return true;
    };

    const backtrack = (idx: number): void => {
      if (solutions >= limit) return;
      if (idx === rows * cols) {
        if (this.isValidStream(board, rows, cols) && this.auditIslands(board, rows, cols, clues)) {
          solutions++;
        }
        return;
      }

      const r = Math.floor(idx / cols);
      const c = idx % cols;

      if (board[r][c] !== 0) {
        backtrack(idx + 1);
        return;
      }

      for (const val of [1, 2]) {
        board[r][c] = val;
        if (isValidPartial(r, c)) {
          backtrack(idx + 1);
        }
        board[r][c] = 0;
        if (solutions >= limit) return;
      }
    };

    backtrack(0);
    return solutions;
  }

  public static getNextForcedDeduction(
    rows: number,
    cols: number,
    clues: NurikabeClue[],
    board: number[][]
  ): NurikabeHintStep | null {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const cl of clues) {
      if (cl.value === 1) {
        for (const [dr, dc] of dirs) {
          const nr = cl.r + dr;
          const nc = cl.c + dc;
          if (this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 0) {
            return {
              step: 1,
              type: 'clue_surrounding_walls',
              r: nr,
              c: nc,
              forcedState: 1,
              rationale: `線索 1 島嶼已達標，四周鄰格必須築牆封閉`,
              humanReadable: {
                zh: `島嶼數字為 1 代表只有它自己，四周鄰格全部必須塗黑築牆！`,
                en: `Island size is 1; all adjacent cells must be closed off as black walls!`,
              },
            };
          }
        }
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const cells = [
          [r, c, board[r][c]],
          [r + 1, c, board[r + 1][c]],
          [r, c + 1, board[r][c + 1]],
          [r + 1, c + 1, board[r + 1][c + 1]],
        ];
        const blacks = cells.filter((item) => item[2] === 1);
        const empties = cells.filter((item) => item[2] === 0);

        if (blacks.length === 3 && empties.length === 1) {
          return {
            step: 1,
            type: 'pool_prevention',
            r: empties[0][0],
            c: empties[0][1],
            forcedState: 2,
            rationale: `若此格塗黑將形成 2x2 違規黑池，此處必須標記為白格`,
            humanReadable: {
              zh: `若此處塗黑將形成 2×2 違規黑池，為防死局，該格必須標點為白格！`,
              en: `Painting black here forms an illegal 2x2 pool; this cell must be marked white!`,
            },
          };
        }
      }
    }

    for (let i = 0; i < clues.length; i++) {
      for (let j = i + 1; j < clues.length; j++) {
        const c1 = clues[i];
        const c2 = clues[j];
        if (Math.abs(c1.r - c2.r) + Math.abs(c1.c - c2.c) === 2) {
          if (c1.r === c2.r && board[c1.r][(c1.c + c2.c) / 2] === 0) {
            const midC = (c1.c + c2.c) / 2;
            return {
              step: 1,
              type: 'island_isolation',
              r: c1.r,
              c: midC,
              forcedState: 1,
              rationale: `不同島嶼不得正交相連，兩線索中間共用格必須築牆`,
              humanReadable: {
                zh: `兩座不同島嶼絕不可直接接壤，夾在兩數字中間的空格必須塗黑隔開！`,
                en: `Different islands must not touch; the separator cell between them must be black!`,
              },
            };
          }
          if (c1.c === c2.c && board[(c1.r + c2.r) / 2][c1.c] === 0) {
            const midR = (c1.r + c2.r) / 2;
            return {
              step: 1,
              type: 'island_isolation',
              r: midR,
              c: c1.c,
              forcedState: 1,
              rationale: `不同島嶼不得正交相連，垂直中介格必為黑牆`,
              humanReadable: {
                zh: `兩座不同島嶼不可相通，垂直夾在中間的空格必須築牆！`,
                en: `Different islands must not touch; the vertical separator cell must be black!`,
              },
            };
          }
        }
      }
    }

    for (const cl of clues) {
      if (cl.value > 1) {
        const islandCells = new Set<string>();
        const queue: [number, number][] = [[cl.r, cl.c]];
        islandCells.add(`${cl.r},${cl.c}`);

        while (queue.length > 0) {
          const [cr, cc] = queue.shift()!;
          for (const [dr, dc] of dirs) {
            const nr = cr + dr;
            const nc = cc + dc;
            const key = `${nr},${nc}`;
            if (this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 2 && !islandCells.has(key)) {
              islandCells.add(key);
              queue.push([nr, nc]);
            }
          }
        }

        const deficit = cl.value - islandCells.size;
        if (deficit > 0) {
          const openNeighbors = new Set<string>();
          for (const key of islandCells) {
            const [ir, ic] = key.split(',').map(Number);
            for (const [dr, dc] of dirs) {
              const nr = ir + dr;
              const nc = ic + dc;
              if (this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 0) {
                openNeighbors.add(`${nr},${nc}`);
              }
            }
          }

          if (openNeighbors.size === deficit) {
            const firstTarget = Array.from(openNeighbors)[0].split(',').map(Number);
            return {
              step: 1,
              type: 'island_saturation',
              r: firstTarget[0],
              c: firstTarget[1],
              forcedState: 2,
              rationale: `線索 ${cl.value} 剩餘可用空格剛好等於缺額 (${deficit})，全部必為白格`,
              humanReadable: {
                zh: `數字 ${cl.value} 的島嶼還缺少 ${deficit} 格，但周圍剛好只剩下 ${deficit} 個空格，必須全數標為白格！`,
                en: `Island ${cl.value} still needs ${deficit} cells, matching its remaining open boundaries exactly; must be marked white!`,
              },
            };
          }
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          const neighborWalls = dirs
            .map(([dr, dc]) => [r + dr, c + dc])
            .filter(([nr, nc]) => this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 1);

          if (neighborWalls.length === 0) {
            const openExits = dirs
              .map(([dr, dc]) => [r + dr, c + dc])
              .filter(([nr, nc]) => this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 0);

            if (openExits.length === 1) {
              const [tr, tc] = openExits[0];
              return {
                step: 1,
                type: 'stream_chokepoint',
                r: tr,
                c: tc,
                forcedState: 1,
                rationale: `孤立黑牆僅存唯一出口，為防止河流中斷斷流，此通道必塗黑`,
                humanReadable: {
                  zh: `此處黑牆只剩下唯一一條與外界連通的逃逸通道，若不塗黑黑牆將斷流孤立！`,
                  en: `This black wall has only one open escape route; it must be painted black to prevent stream disconnection!`,
                },
              };
            }
          }
        }
      }
    }

    return null;
  }

  public static generate(tier: ExtendedTierKey = 'kids'): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, clueCount, baseIrt } = config;

    let attempts = 0;
    while (attempts < 80) {
      attempts++;

      const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(1));
      const clues: NurikabeClue[] = [];
      const occupied = new Set<string>();

      let placedClues = 0;
      let placeAttempts = 0;

      while (placedClues < clueCount && placeAttempts < 150) {
        placeAttempts++;
        const r = Math.floor(Math.random() * rows);
        const c = Math.floor(Math.random() * cols);
        const key = `${r},${c}`;

        if (occupied.has(key)) continue;

        let neighborClue = false;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
          const nr = r + dr;
          const nc = c + dc;
          if (this.inBounds(nr, nc, rows, cols) && occupied.has(`${nr},${nc}`)) {
            neighborClue = true;
            break;
          }
        }
        if (neighborClue) continue;

        const val = tier === 'kids' ? Math.floor(Math.random() * 2) + 1 : Math.floor(Math.random() * 3) + 1;
        clues.push({ r, c, value: val });
        occupied.add(key);
        grid[r][c] = 2;
        placedClues++;
      }

      if (clues.length < clueCount) continue;

      for (const cl of clues) {
        let currentSize = 1;
        const islandCells: [number, number][] = [[cl.r, cl.c]];

        while (currentSize < cl.value) {
          const head = islandCells[Math.floor(Math.random() * islandCells.length)];
          const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]].sort(() => Math.random() - 0.5);
          let expanded = false;

          for (const [dr, dc] of dirs) {
            const nr = head[0] + dr;
            const nc = head[1] + dc;
            if (this.inBounds(nr, nc, rows, cols) && grid[nr][nc] === 1) {
              grid[nr][nc] = 2;
              islandCells.push([nr, nc]);
              currentSize++;
              expanded = true;
              break;
            }
          }
          if (!expanded) break;
        }
      }

      if (!this.auditIslands(grid, rows, cols, clues)) {
        continue;
      }

      if (!this.isValidStream(grid, rows, cols)) {
        continue;
      }

      const solCount = this.countSolutions(rows, cols, clues, 2);
      if (solCount !== 1) {
        continue;
      }

      const puzzleId = `nurikabe_${tier}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const dynamicIrt = Number((baseIrt + clues.length * 0.15).toFixed(2));

      const spec: NurikabeSpec = {
        rows,
        cols,
        clues,
        solution: grid,
        pureDeductionRate: 1.0,
      };

      return {
        id: puzzleId,
        category: 'spatial_logic' as any,
        engine_type: 'nurikabe',
        tier: (tier === 'legendary' ? 'master' : tier) as TierKey,
        checksum: `NURIKABE_${rows}x${cols}_WPF_${Date.now().toString(36)}`,
        puzzle: spec as any,
        solution: grid as any,
        cognitiveLoad: {
          spatial: 0.95,
          numeric: 0.45,
          workingMemory: Number(Math.min(1.0, 0.5 + rows * 0.05).toFixed(2)),
          inhibition: 0.9,
        },
        metrics: {
          estimated_time_sec: rows * cols * 3,
          irt_logit_difficulty: dynamicIrt,
          human_sim_steps: rows * cols,
        },
      };
    }

    const fallbackClues: NurikabeClue[] = [
      { r: 0, c: 0, value: 2 },
      { r: 0, c: 4, value: 1 },
      { r: 4, c: 2, value: 2 },
    ];
    const fallbackGrid = [
      [2, 2, 1, 1, 2],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 2, 1, 1],
      [1, 1, 2, 1, 1],
    ];

    return {
      id: `nurikabe_${tier}_fallback_${Date.now()}`,
      category: 'spatial_logic' as any,
      engine_type: 'nurikabe',
      tier: (tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `NURIKABE_FALLBACK_${tier}`,
      puzzle: {
        rows: 5,
        cols: 5,
        clues: fallbackClues,
        solution: fallbackGrid,
        pureDeductionRate: 1.0,
      } as unknown as NurikabeSpec,
      solution: fallbackGrid as any,
      cognitiveLoad: { spatial: 0.85, numeric: 0.4, workingMemory: 0.6, inhibition: 0.8 },
      metrics: { estimated_time_sec: 45, irt_logit_difficulty: config.baseIrt },
    };
  }
}
