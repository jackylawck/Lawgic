export type NurikabeCellState = 0 | 1 | 2; // 0: 未決, 1: 黑海, 2: 白島/點標

export interface NurikabeSpec {
  rows: number;
  cols: number;
  grid: (number | null)[][];
  seed?: number;
}

export interface NurikabeHintStep {
  r: number;
  c: number;
  forcedState: NurikabeCellState;
  techniqueId: string;
  techniqueName: {
    en: string;
    zh: string;
  };
  techniqueIcon: string;
  humanReadable: {
    en: string;
    zh: string;
  };
  rationale: string;
  evidenceCells?: [number, number][];
}

export interface StyleVector {
  tortuosity: number;   // 纏繞度 (0.0~1.0)
  fragmentation: number; // 破碎度 (0.0~1.0)
}

export class NurikabeAxiomaticEngine {
  // ==========================================
  // 1. 核心驗證器 (Verification Axioms)
  // ==========================================

  public static verifySolution(
    rows: number,
    cols: number,
    grid: (number | null)[][],
    board: NurikabeCellState[][]
  ): boolean {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 0) return false;
      }
    }

    if (this.has2x2Sea(rows, cols, board)) return false;
    if (!this.isSeaConnected(rows, cols, board)) return false;

    let totalClues = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== null) totalClues++;
      }
    }

    return this.verifyAllIslands(rows, cols, grid, board, totalClues);
  }

  // ==========================================
  // 2. 定式推理與多候選白名單 (Deduction Engine)
  // ==========================================

  public static getAllForcedDeductions(
    rows: number,
    cols: number,
    grid: (number | null)[][],
    board: NurikabeCellState[][]
  ): NurikabeHintStep[] {
    const steps: NurikabeHintStep[] = [];
    const registered = new Set<string>();

    // ── L1-A: 線索 1 封閉 ──
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 1) {
          for (const [nr, nc] of this.getOrthogonalNeighbors(r, c, rows, cols)) {
            if (board[nr][nc] === 0 && !registered.has(`${nr},${nc}`)) {
              registered.add(`${nr},${nc}`);
              steps.push({
                r: nr,
                c: nc,
                forcedState: 1,
                techniqueId: 'Clue1Isolation',
                techniqueName: { en: 'Clue 1 Seal', zh: '孤島封閉' },
                techniqueIcon: '🔒',
                humanReadable: {
                  en: `Clue 1 at [${r + 1},${c + 1}] is fulfilled. Adjacent must be sea.`,
                  zh: `單元格 [${r + 1},${c + 1}] 為數值 1，周圍必為黑海。`,
                },
                rationale: 'Island size 1 reached its quota; orthogonal borders must be wall.',
                evidenceCells: [[r, c]],
              });
            }
          }
        }
      }
    }

    // ── L1-B: 2x2 禁池防禦 ──
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const block: [number, number][] = [
          [r, c],
          [r + 1, c],
          [r, c + 1],
          [r + 1, c + 1],
        ];
        const blacks = block.filter(([br, bc]) => board[br][bc] === 1);
        const unknowns = block.filter(([br, bc]) => board[br][bc] === 0);

        if (blacks.length === 3 && unknowns.length === 1) {
          const [ur, uc] = unknowns[0];
          const key = `${ur},${uc}`;
          if (!registered.has(key)) {
            registered.add(key);
            steps.push({
              r: ur,
              c: uc,
              forcedState: 2,
              techniqueId: 'AntiPool2x2',
              techniqueName: { en: '2x2 Anti-Pool', zh: '防 2x2 水池' },
              techniqueIcon: '⚠️',
              humanReadable: {
                en: `Preventing illegal 2x2 pool at [${ur + 1},${uc + 1}].`,
                zh: `單元格 [${ur + 1},${uc + 1}] 若填黑將形成違規 2x2 黑池，故必為白點。`,
              },
              rationale: 'Nurikabe forbids 2x2 black squares; remaining unknown corner must be dot.',
              evidenceCells: blacks,
            });
          }
        }
      }
    }

    // ── L2: 黑海死胡同逃逸 ──
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] !== 1) continue;
        const neighbors = this.getOrthogonalNeighbors(r, c, rows, cols);
        const seaNeighbors = neighbors.filter(([nr, nc]) => board[nr][nc] === 1);
        const unknownNeighbors = neighbors.filter(([nr, nc]) => board[nr][nc] === 0);

        if (seaNeighbors.length <= 1 && unknownNeighbors.length === 1) {
          const [ur, uc] = unknownNeighbors[0];
          const key = `${ur},${uc}`;

          const adjToIncompleteIsland = this.getOrthogonalNeighbors(ur, uc, rows, cols).some(([ar, ac]) => {
            if (board[ar][ac] !== 2) return false;
            const island = this.floodFillIsland(rows, cols, board, ar, ac);
            const clueCell = island.cells.find(([ir, ic]) => grid[ir][ic] !== null);
            if (!clueCell) return false;
            return island.cells.length < grid[clueCell[0]][clueCell[1]]!;
          });

          if (!adjToIncompleteIsland && !registered.has(key)) {
            registered.add(key);
            steps.push({
              r: ur,
              c: uc,
              forcedState: 1,
              techniqueId: 'SeaDeadEndEscape',
              techniqueName: { en: 'Sea Escape Path', zh: '黑海死胡同逃逸' },
              techniqueIcon: '🌊',
              humanReadable: {
                en: `Sea at [${r + 1},${c + 1}] has only one escape at [${ur + 1},${uc + 1}].`,
                zh: `黑海在 [${r + 1},${c + 1}] 僅剩出口 [${ur + 1},${uc + 1}]，必須填黑維持連通。`,
              },
              rationale: 'Sea connectivity conservation; dead-end must expand to remain contiguous.',
              evidenceCells: [[r, c]],
            });
          }
        }
      }
    }

    // ── L3: Tarjan 黑海割點 ──
    const cutVertices = this.findSeaCutVertices(rows, cols, board);
    for (const [cr, cc] of cutVertices) {
      if (board[cr][cc] === 0) {
        const key = `${cr},${cc}`;
        if (!registered.has(key)) {
          registered.add(key);
          steps.push({
            r: cr,
            c: cc,
            forcedState: 1,
            techniqueId: 'SeaArticulationPoint',
            techniqueName: { en: 'Articulation Cut', zh: '黑海全域割點' },
            techniqueIcon: '⚡',
            humanReadable: {
              en: `Cell [${cr + 1},${cc + 1}] is an articulation point of the sea manifold.`,
              zh: `單元格 [${cr + 1},${cc + 1}] 為黑海關節點，標白將切斷全域連通，故必填黑。`,
            },
            rationale: 'Tarjan articulation point; dotting this cell disconnects the sea.',
            evidenceCells: [[cr, cc]],
          });
        }
      }
    }

    return steps;
  }

  public static getNextForcedDeduction(
    rows: number,
    cols: number,
    grid: (number | null)[][],
    board: NurikabeCellState[][]
  ): NurikabeHintStep | null {
    const all = this.getAllForcedDeductions(rows, cols, grid, board);
    return all.length > 0 ? all[0] : null;
  }

  // ==========================================
  // 3. 傳播優先回溯唯一解檢驗 (CP-Solver)
  // ==========================================

  public static hasUniqueSolution(
    rows: number,
    cols: number,
    grid: (number | null)[][]
  ): boolean {
    let solutions = 0;
    let budget = 400;

    let totalClueCells = 0;
    const baseBoard: NurikabeCellState[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== null) {
          baseBoard[r][c] = 2;
          totalClueCells++;
        }
      }
    }

    const solve = (currentBoard: NurikabeCellState[][]): void => {
      if (solutions >= 2 || budget-- <= 0) return;

      const { board: propBoard, hasContradiction } = this.propagateDeductions(rows, cols, grid, currentBoard);
      if (hasContradiction) return;

      let targetR = -1;
      let targetC = -1;
      for (let r = 0; r < rows && targetR === -1; r++) {
        for (let c = 0; c < cols; c++) {
          if (propBoard[r][c] === 0) {
            targetR = r;
            targetC = c;
            break;
          }
        }
      }

      if (targetR === -1) {
        if (
          !this.has2x2Sea(rows, cols, propBoard) &&
          this.isSeaConnected(rows, cols, propBoard) &&
          this.verifyAllIslands(rows, cols, grid, propBoard, totalClueCells)
        ) {
          solutions++;
        }
        return;
      }

      for (const state of [1, 2] as NurikabeCellState[]) {
        propBoard[targetR][targetC] = state;

        let valid = true;
        if (state === 1) {
          if (
            targetR > 0 &&
            targetC > 0 &&
            propBoard[targetR - 1][targetC] === 1 &&
            propBoard[targetR][targetC - 1] === 1 &&
            propBoard[targetR - 1][targetC - 1] === 1
          ) {
            valid = false;
          }
        } else {
          const island = this.floodFillIsland(rows, cols, propBoard, targetR, targetC);
          const clues = island.cells.filter(([ir, ic]) => grid[ir][ic] !== null);
          if (clues.length > 1) valid = false;
          else if (clues.length === 1 && island.cells.length > grid[clues[0][0]][clues[0][1]]!) {
            valid = false;
          }
        }

        if (valid) {
          solve(propBoard.map(row => [...row]));
        }
        propBoard[targetR][targetC] = 0;
      }
    };

    solve(baseBoard);
    return solutions === 1;
  }

  private static propagateDeductions(
    rows: number,
    cols: number,
    grid: (number | null)[][],
    initialBoard: NurikabeCellState[][]
  ): { board: NurikabeCellState[][]; hasContradiction: boolean } {
    const board = initialBoard.map(r => [...r]);
    let changed = true;

    while (changed) {
      changed = false;
      const deductions = this.getAllForcedDeductions(rows, cols, grid, board);
      for (const d of deductions) {
        if (board[d.r][d.c] === 0) {
          board[d.r][d.c] = d.forcedState;
          changed = true;
        }
      }
      if (this.has2x2Sea(rows, cols, board)) {
        return { board, hasContradiction: true };
      }
    }

    return { board, hasContradiction: false };
  }

  // ==========================================
  // 4. 生成器：多源形態發生 + 雙割點奇點過濾
  // ==========================================

  public static generatePuzzle(
    rows: number = 6,
    cols: number = 6,
    style: StyleVector = { tortuosity: 0.6, fragmentation: 0.4 }
  ): NurikabeSpec {
    let attempts = 0;
    while (attempts++ < 150) {
      const substrate: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
      const grid: (number | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));

      const targetIslandCount = Math.floor((rows * cols) / (style.fragmentation > 0.5 ? 4.5 : 7.0));
      const islandSizes = new Map<number, number>();
      const seeds: Array<{ id: number; r: number; c: number; targetSize: number; lastDr: number; lastDc: number }> = [];

      let seedAttempts = 0;
      while (seeds.length < targetIslandCount && seedAttempts++ < 200) {
        const r = Math.floor(Math.random() * rows);
        const c = Math.floor(Math.random() * cols);
        const tooClose = seeds.some(s => Math.max(Math.abs(s.r - r), Math.abs(s.c - c)) < 2);
        if (!tooClose) {
          const id = seeds.length + 10;
          const targetSize = style.fragmentation > 0.5
            ? 2 + Math.floor(Math.random() * 3)
            : 3 + Math.floor(Math.random() * 4);
          seeds.push({ id, r, c, targetSize, lastDr: 0, lastDc: 0 });
          islandSizes.set(id, 1);
          substrate[r][c] = id;
        }
      }

      let frontier = seeds.map(s => ({ ...s }));
      while (frontier.length > 0) {
        const idx = Math.floor(Math.random() * frontier.length);
        const curr = frontier[idx];
        const currSize = islandSizes.get(curr.id)!;

        if (currSize >= curr.targetSize) {
          frontier.splice(idx, 1);
          continue;
        }

        const neighbors = this.getOrthogonalNeighbors(curr.r, curr.c, rows, cols)
          .filter(([nr, nc]) => substrate[nr][nc] === 0);

        const validExpansions = neighbors.filter(([nr, nc]) => {
          const adj = this.getOrthogonalNeighbors(nr, nc, rows, cols);
          return adj.every(([ar, ac]) => substrate[ar][ac] === 0 || substrate[ar][ac] === curr.id);
        });

        if (validExpansions.length > 0) {
          validExpansions.sort(([r1, c1], [r2, c2]) => {
            const isTurn1 = (r1 - curr.r !== curr.lastDr) || (c1 - curr.c !== curr.lastDc);
            const isTurn2 = (r2 - curr.r !== curr.lastDr) || (c2 - curr.c !== curr.lastDc);
            const w1 = (isTurn1 ? style.tortuosity : (1 - style.tortuosity)) + Math.random() * 0.2;
            const w2 = (isTurn2 ? style.tortuosity : (1 - style.tortuosity)) + Math.random() * 0.2;
            return w2 - w1;
          });

          const [nr, nc] = validExpansions[0];
          substrate[nr][nc] = curr.id;
          islandSizes.set(curr.id, currSize + 1);
          frontier.push({
            id: curr.id,
            r: nr,
            c: nc,
            targetSize: curr.targetSize,
            lastDr: nr - curr.r,
            lastDc: nc - curr.c,
          });
        } else {
          frontier.splice(idx, 1);
        }
      }

      const groundTruth: NurikabeCellState[][] = substrate.map(row =>
        row.map(cell => (cell >= 10 ? 2 : 1))
      );

      if (this.has2x2Sea(rows, cols, groundTruth) || !this.isSeaConnected(rows, cols, groundTruth)) {
        continue;
      }

      // 雙割點奇點過濾
      const cuts = this.findSeaCutVertices(rows, cols, groundTruth);
      if (cuts.length !== 2) continue;

      const [c1, c2] = cuts;
      const span = Math.abs(c1[0] - c2[0]) + Math.abs(c1[1] - c2[1]);
      if (span < Math.floor(Math.min(rows, cols) * 0.55)) continue;

      for (const seed of seeds) {
        grid[seed.r][seed.c] = islandSizes.get(seed.id)!;
      }

      if (!this.hasUniqueSolution(rows, cols, grid)) continue;

      return {
        rows,
        cols,
        grid,
        seed: Math.floor(Math.random() * 1000000),
      };
    }

    // 安全動態尺寸兜底
    return this.getFallbackPuzzle(rows, cols);
  }

  // ==========================================
  // 5. 圖論與輔助方法
  // ==========================================

  public static findSeaCutVertices(
    rows: number,
    cols: number,
    board: NurikabeCellState[][]
  ): [number, number][] {
    const seaCells: [number, number][] = [];
    const indexMap = new Map<string, number>();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1 || board[r][c] === 0) {
          indexMap.set(`${r},${c}`, seaCells.length);
          seaCells.push([r, c]);
        }
      }
    }

    const n = seaCells.length;
    if (n <= 2) return [];

    const dfn = new Int32Array(n).fill(-1);
    const low = new Int32Array(n).fill(-1);
    const isCut = new Uint8Array(n);
    let timer = 0;

    const dfs = (u: number, p: number) => {
      dfn[u] = low[u] = ++timer;
      let children = 0;
      const [r, c] = seaCells[u];

      for (const [nr, nc] of this.getOrthogonalNeighbors(r, c, rows, cols)) {
        const v = indexMap.get(`${nr},${nc}`);
        if (v === undefined || v === p) continue;
        if (dfn[v] !== -1) {
          low[u] = Math.min(low[u], dfn[v]);
        } else {
          children++;
          dfs(v, u);
          low[u] = Math.min(low[u], low[v]);
          if (p !== -1 && low[v] >= dfn[u]) isCut[u] = 1;
        }
      }
      if (p === -1 && children > 1) isCut[u] = 1;
    };

    for (let i = 0; i < n; i++) {
      if (dfn[i] === -1) dfs(i, -1);
    }

    const cuts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      if (isCut[i]) cuts.push(seaCells[i]);
    }
    return cuts;
  }

  public static floodFillIsland(
    rows: number,
    cols: number,
    board: NurikabeCellState[][],
    sr: number,
    sc: number
  ): { cells: [number, number][] } {
    const cells: [number, number][] = [];
    const visited = new Set<string>();
    const queue: [number, number][] = [[sr, sc]];
    visited.add(`${sr},${sc}`);

    while (queue.length > 0) {
      const [r, c] = queue.shift()!;
      cells.push([r, c]);
      for (const [nr, nc] of this.getOrthogonalNeighbors(r, c, rows, cols)) {
        if (board[nr][nc] === 2 && !visited.has(`${nr},${nc}`)) {
          visited.add(`${nr},${nc}`);
          queue.push([nr, nc]);
        }
      }
    }
    return { cells };
  }

  public static verifyAllIslands(
    rows: number,
    cols: number,
    grid: (number | null)[][],
    board: NurikabeCellState[][],
    expectedClueCount: number
  ): boolean {
    const visited = new Uint8Array(rows * cols);
    let foundClues = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (board[r][c] === 2 && !visited[idx]) {
          let size = 0;
          let clueValue: number | null = null;
          let clueCount = 0;
          const queue: [number, number][] = [[r, c]];
          visited[idx] = 1;

          while (queue.length > 0) {
            const [cr, cc] = queue.shift()!;
            size++;
            if (grid[cr][cc] !== null) {
              clueValue = grid[cr][cc];
              clueCount++;
            }
            for (const [nr, nc] of this.getOrthogonalNeighbors(cr, cc, rows, cols)) {
              const nIdx = nr * cols + nc;
              if (board[nr][nc] === 2 && !visited[nIdx]) {
                visited[nIdx] = 1;
                queue.push([nr, nc]);
              }
            }
          }

          if (clueCount !== 1 || clueValue === null || size !== clueValue) return false;
          foundClues++;
        }
      }
    }

    return foundClues === expectedClueCount;
  }

  public static getOrthogonalNeighbors(
    r: number,
    c: number,
    rows: number,
    cols: number
  ): [number, number][] {
    const res: [number, number][] = [];
    if (r > 0) res.push([r - 1, c]);
    if (r < rows - 1) res.push([r + 1, c]);
    if (c > 0) res.push([r, c - 1]);
    if (c < cols - 1) res.push([r, c + 1]);
    return res;
  }

  public static has2x2Sea(
    rows: number,
    cols: number,
    board: NurikabeCellState[][]
  ): boolean {
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (
          board[r][c] === 1 &&
          board[r + 1][c] === 1 &&
          board[r][c + 1] === 1 &&
          board[r + 1][c + 1] === 1
        ) return true;
      }
    }
    return false;
  }

  public static isSeaConnected(
    rows: number,
    cols: number,
    board: NurikabeCellState[][]
  ): boolean {
    let start: [number, number] | null = null;
    let totalSea = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          totalSea++;
          if (!start) start = [r, c];
        }
      }
    }
    if (!start) return true;

    const visited = new Set<string>();
    const queue: [number, number][] = [start];
    visited.add(`${start[0]},${start[1]}`);

    while (queue.length > 0) {
      const [r, c] = queue.shift()!;
      for (const [nr, nc] of this.getOrthogonalNeighbors(r, c, rows, cols)) {
        if (board[nr][nc] === 1 && !visited.has(`${nr},${nc}`)) {
          visited.add(`${nr},${nc}`);
          queue.push([nr, nc]);
        }
      }
    }
    return visited.size === totalSea;
  }

  /**
   * 微瑕 1 修復：尺寸動態安全兜底
   */
  private static getFallbackPuzzle(rows: number, cols: number): NurikabeSpec {
    const grid: (number | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));

    // 棋盤四周與對角動態佈設對稱線索，杜絕越界
    grid[0][Math.min(1, cols - 1)] = 2;
    grid[Math.min(1, rows - 1)][Math.max(0, cols - 2)] = 1;
    grid[Math.max(0, rows - 1)][Math.max(0, cols - 2)] = 2;
    if (rows >= 4 && cols >= 4) {
      grid[rows - 2][1] = 3;
    }

    return { rows, cols, grid, seed: 199404 };
  }
}

// 兼容既有命名的別名匯出
export const WebNurikabeGenerator = NurikabeAxiomaticEngine;
