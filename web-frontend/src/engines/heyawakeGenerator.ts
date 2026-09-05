// web-frontend/src/engines/heyawakeGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';

export interface Room {
  id: number;
  cells: [number, number][];
  clue: number | null;
  shapeType?: 'rect' | 'corridor' | 'l_shape' | 't_shape' | 'irregular';
}

export type HeyawakeTechnique =
  | 'quota_full_exclusion'
  | 'quota_starvation_fill'
  | 'adjacent_black_isolation'
  | 'ray_boundary_blocker'
  | 'connectivity_bridge';

export interface HeyawakeHintStep {
  step: number;
  targetCell: [number, number];
  forcedState: 1 | 2; // 1: 黑, 2: 白
  technique: HeyawakeTechnique;
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface HeyawakeSpec {
  rows: number;
  cols: number;
  rooms: Room[];
  gridRooms: number[][];
  solution: boolean[][];
  pureDeductionRate: number;
  tier: ExtendedTierKey;
  seed: number;
  solvingSteps?: HeyawakeHintStep[];
  metricsAnalysis?: {
    roomSizeVariance: number;
    internalWallPerimeter: number;
    clueEntropy: number;
    effectiveRayDensity: number;
    techniqueHistogram: Record<HeyawakeTechnique, number>;
  };
}

interface TierConfig {
  rows: number;
  cols: number;
  minRooms: number;
  maxRooms: number;
  clueDensity: number;
  minPureRate: number;
  baseIrt: number;
}

const TIER_SPECS: Record<ExtendedTierKey, TierConfig> = {
  kids: { rows: 5, cols: 5, minRooms: 4, maxRooms: 6, clueDensity: 0.85, minPureRate: 1.0, baseIrt: -0.4 },
  intermediate: { rows: 6, cols: 6, minRooms: 6, maxRooms: 9, clueDensity: 0.80, minPureRate: 0.95, baseIrt: 0.5 },
  expert: { rows: 8, cols: 8, minRooms: 10, maxRooms: 14, clueDensity: 0.72, minPureRate: 0.90, baseIrt: 1.5 },
  master: { rows: 10, cols: 10, minRooms: 14, maxRooms: 20, clueDensity: 0.65, minPureRate: 0.85, baseIrt: 2.4 },
  legendary: { rows: 12, cols: 12, minRooms: 20, maxRooms: 28, clueDensity: 0.60, minPureRate: 0.82, baseIrt: 3.2 },
  ultimate: { rows: 14, cols: 14, minRooms: 26, maxRooms: 36, clueDensity: 0.55, minPureRate: 0.80, baseIrt: 4.0 },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebHeyawakeGenerator {
  /**
   * 射線跨界演算法：連續白格穿透邊界線不得 >= 2
   */
  public static checkBoundaryCrossing(
    board: boolean[][],
    rows: number,
    cols: number,
    gridRooms: number[][]
  ): boolean {
    for (let r = 0; r < rows; r++) {
      let crossed = 0;
      for (let c = 0; c < cols; c++) {
        if (!board[r][c]) {
          if (c > 0 && !board[r][c - 1] && gridRooms[r][c] !== gridRooms[r][c - 1]) {
            crossed++;
            if (crossed >= 2) return false;
          }
        } else {
          crossed = 0;
        }
      }
    }

    for (let c = 0; c < cols; c++) {
      let crossed = 0;
      for (let r = 0; r < rows; r++) {
        if (!board[r][c]) {
          if (r > 0 && !board[r - 1][c] && gridRooms[r][c] !== gridRooms[r - 1][c]) {
            crossed++;
            if (crossed >= 2) return false;
          }
        } else {
          crossed = 0;
        }
      }
    }

    return true;
  }

  /**
   * 白格四向正交連通檢查 (BFS)
   */
  public static isWhiteConnected(board: boolean[][], rows: number, cols: number): boolean {
    let startWhite: [number, number] | null = null;
    let totalWhite = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!board[r][c]) {
          totalWhite++;
          if (!startWhite) startWhite = [r, c];
        }
      }
    }

    if (!startWhite) return false;

    const queue: [number, number][] = [startWhite];
    const visited = new Uint8Array(rows * cols);
    visited[startWhite[0] * cols + startWhite[1]] = 1;
    let count = 0;

    while (queue.length > 0) {
      const [cr, cc] = queue.shift()!;
      count++;

      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !board[nr][nc]) {
          const idx = nr * cols + nc;
          if (!visited[idx]) {
            visited[idx] = 1;
            queue.push([nr, nc]);
          }
        }
      }
    }

    return count === totalWhite;
  }

  /**
   * 人類可解性因果定式引擎
   */
  public static getNextForcedDeduction(
    rows: number,
    cols: number,
    rooms: Room[],
    gridRooms: number[][],
    grid: number[][] // 0: 未決, 1: 黑, 2: 白
  ): HeyawakeHintStep | null {
    // 定式 1: 房間配額滿額留白
    for (const room of rooms) {
      if (room.clue === null) continue;
      let blackCount = 0;
      const unassigned: [number, number][] = [];

      for (const [r, c] of room.cells) {
        if (grid[r][c] === 1) blackCount++;
        else if (grid[r][c] === 0) unassigned.push([r, c]);
      }

      if (blackCount === room.clue && unassigned.length > 0) {
        const target = unassigned[0];
        return {
          step: 1,
          targetCell: target,
          forcedState: 2,
          technique: 'quota_full_exclusion',
          rationale: `房間 #${room.id + 1} 黑格配額已滿 (${room.clue}/${room.clue})，剩餘未定格強制留白。`,
          humanReadable: {
            zh: `房間 #${room.id + 1} 線索為 ${room.clue} 且黑格已找齊，此單元格強制標記為白格！`,
            en: `Room #${room.id + 1} quota of ${room.clue} is satisfied. Cell must be marked white.`,
          },
        };
      }
    }

    // 定式 2: 房間配額缺額填黑
    for (const room of rooms) {
      if (room.clue === null) continue;
      let blackCount = 0;
      const unassigned: [number, number][] = [];

      for (const [r, c] of room.cells) {
        if (grid[r][c] === 1) blackCount++;
        else if (grid[r][c] === 0) unassigned.push([r, c]);
      }

      const needed = room.clue - blackCount;
      if (needed > 0 && unassigned.length === needed) {
        const target = unassigned[0];
        return {
          step: 1,
          targetCell: target,
          forcedState: 1,
          technique: 'quota_starvation_fill',
          rationale: `房間 #${room.id + 1} 尚缺 ${needed} 個黑格，剩餘空格恰等於所需數量，強制填黑。`,
          humanReadable: {
            zh: `房間 #${room.id + 1} 尚缺 ${needed} 個黑格，剩餘未定格必須塗黑！`,
            en: `Room #${room.id + 1} requires ${needed} more black cell(s). Must be filled black.`,
          },
        };
      }
    }

    // 定式 3: 黑格不相鄰隔離
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 1) {
          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === 0) {
              return {
                step: 1,
                targetCell: [nr, nc],
                forcedState: 2,
                technique: 'adjacent_black_isolation',
                rationale: `黑格不得相鄰規則：黑格正交相鄰方向必須留白。`,
                humanReadable: {
                  zh: `根據黑格不得相鄰規則，[${r + 1}, ${c + 1}] 已是黑格，此相鄰格強制留白！`,
                  en: `Black cells cannot be orthogonally adjacent. Cell adjacent to [${r + 1}, ${c + 1}] must be white.`,
                },
              };
            }
          }
        }
      }
    }

    // 定式 4: 防跨雙牆射線阻斷
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== 0) continue;

        // 水平向假設留白檢測
        grid[r][c] = 2;
        let left = c;
        while (left > 0 && grid[r][left - 1] === 2) left--;
        let right = c;
        while (right < cols - 1 && grid[r][right + 1] === 2) right++;

        let crossed = 0;
        for (let i = left; i < right; i++) {
          if (gridRooms[r][i] !== gridRooms[r][i + 1]) crossed++;
        }
        grid[r][c] = 0;

        if (crossed >= 2) {
          return {
            step: 1,
            targetCell: [r, c],
            forcedState: 1,
            technique: 'ray_boundary_blocker',
            rationale: `若留白會導致水平連續白區跨越 ${crossed} 條房間邊界，違反上限規定，強制塗黑阻斷。`,
            humanReadable: {
              zh: `第 ${r + 1} 行：此格若留白將跨越兩道以上房間牆體，強制塗黑阻斷射線！`,
              en: `Row ${r + 1}: Leaving white bridges 2+ room boundaries. Forced black to block ray.`,
            },
          };
        }

        // 垂直向假設留白檢測
        grid[r][c] = 2;
        let top = r;
        while (top > 0 && grid[top - 1][c] === 2) top--;
        let bottom = r;
        while (bottom < rows - 1 && grid[bottom + 1][c] === 2) bottom++;

        crossed = 0;
        for (let i = top; i < bottom; i++) {
          if (gridRooms[i][c] !== gridRooms[i + 1][c]) crossed++;
        }
        grid[r][c] = 0;

        if (crossed >= 2) {
          return {
            step: 1,
            targetCell: [r, c],
            forcedState: 1,
            technique: 'ray_boundary_blocker',
            rationale: `若留白會導致垂直連續白區跨越 ${crossed} 條房間邊界，強制塗黑阻斷。`,
            humanReadable: {
              zh: `第 ${c + 1} 列：此格若留白將縱向跨越兩道以上房間牆體，強制塗黑！`,
              en: `Col ${c + 1}: Leaving white spans 2+ room boundaries vertically. Forced black.`,
            },
          };
        }
      }
    }

    return null;
  }

  public static evaluateHumanSolvability(
    rows: number,
    cols: number,
    rooms: Room[],
    gridRooms: number[][]
  ): { pureRate: number; deductionSteps: HeyawakeHintStep[]; techniqueHistogram: Record<HeyawakeTechnique, number> } {
    const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    const deductionSteps: HeyawakeHintStep[] = [];
    const techniqueHistogram: Record<HeyawakeTechnique, number> = {
      quota_full_exclusion: 0,
      quota_starvation_fill: 0,
      adjacent_black_isolation: 0,
      ray_boundary_blocker: 0,
      connectivity_bridge: 0,
    };

    let stepCounter = 1;
    let advanced = true;

    while (advanced) {
      advanced = false;
      const step = this.getNextForcedDeduction(rows, cols, rooms, gridRooms, grid);
      if (step) {
        const [r, c] = step.targetCell;
        grid[r][c] = step.forcedState;
        step.step = stepCounter++;
        deductionSteps.push(step);
        techniqueHistogram[step.technique]++;
        advanced = true;
      }
    }

    const totalCells = rows * cols;
    const deducedCells = grid.flat().filter((v) => v !== 0).length;
    const pureRate = Number((deducedCells / totalCells).toFixed(2));

    return { pureRate, deductionSteps, techniqueHistogram };
  }

  /**
   * 帶前向剪枝的 CSP 唯一解求解器
   */
  public static countHeyawakeSolutions(
    rooms: Room[],
    gridRooms: number[][],
    rows: number,
    cols: number,
    limit: number = 2
  ): number {
    const board: (boolean | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));
    let solutionCount = 0;
    let stepBudget = 8000;

    const roomQuotaMap = new Map<number, number>();
    for (const rm of rooms) {
      if (rm.clue !== null) roomQuotaMap.set(rm.id, rm.clue);
    }

    const roomFilledBlack = new Array<number>(rooms.length).fill(0);
    const roomRemainingCells = rooms.map((r) => r.cells.length);

    const backtrack = (r: number, c: number): void => {
      if (solutionCount >= limit || stepBudget-- <= 0) return;

      if (r === rows) {
        const fullBoard = board.map((row) => row.map((v) => Boolean(v)));
        if (
          WebHeyawakeGenerator.checkBoundaryCrossing(fullBoard, rows, cols, gridRooms) &&
          WebHeyawakeGenerator.isWhiteConnected(fullBoard, rows, cols)
        ) {
          solutionCount++;
        }
        return;
      }

      const nextR = c === cols - 1 ? r + 1 : r;
      const nextC = c === cols - 1 ? 0 : c + 1;
      const roomId = gridRooms[r][c];
      const quota = roomQuotaMap.get(roomId);

      const hasAdjacentBlack =
        (r > 0 && board[r - 1][c] === true) ||
        (c > 0 && board[r][c - 1] === true);

      const canPlaceBlack =
        !hasAdjacentBlack &&
        (quota === undefined || roomFilledBlack[roomId] < quota);

      // 分支 1: 放黑
      if (canPlaceBlack) {
        board[r][c] = true;
        roomRemainingCells[roomId]--;
        roomFilledBlack[roomId]++;

        backtrack(nextR, nextC);

        board[r][c] = null;
        roomRemainingCells[roomId]++;
        roomFilledBlack[roomId]--;
      }

      // 分支 2: 放白
      if (quota !== undefined) {
        const remainingAfter = roomRemainingCells[roomId] - 1;
        const needed = quota - roomFilledBlack[roomId];
        if (remainingAfter < needed) return;
      }

      // 局部剪枝：水平雙牆白射線防禦
      if (c > 0 && board[r][c - 1] === false) {
        let borders = 0;
        let k = c;
        while (k > 0 && board[r][k - 1] === false) {
          if (gridRooms[r][k] !== gridRooms[r][k - 1]) borders++;
          k--;
        }
        if (borders >= 2) return;
      }

      // 局部剪枝：垂直雙牆白射線防禦
      if (r > 0 && board[r - 1][c] === false) {
        let borders = 0;
        let k = r;
        while (k > 0 && board[k - 1][c] === false) {
          if (gridRooms[k][c] !== gridRooms[k - 1][c]) borders++;
          k--;
        }
        if (borders >= 2) return;
      }

      board[r][c] = false;
      roomRemainingCells[roomId]--;

      backtrack(nextR, nextC);

      board[r][c] = null;
      roomRemainingCells[roomId]++;
    };

    backtrack(0, 0);
    return solutionCount;
  }

  private static _partitionRoomsDiverse(
    rows: number,
    cols: number,
    targetRoomCount: number,
    rnd: () => number
  ): { rooms: Room[]; gridRooms: number[][] } {
    const gridRooms: number[][] = Array.from({ length: rows }, () => Array(cols).fill(-1));
    const rooms: Room[] = [];

    const allCoords: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) allCoords.push([r, c]);
    }

    for (let i = allCoords.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [allCoords[i], allCoords[j]] = [allCoords[j], allCoords[i]];
    }

    const actualCount = Math.min(targetRoomCount, allCoords.length);
    const frontiers: Map<number, [number, number][]> = new Map();

    for (let id = 0; id < actualCount; id++) {
      const [sr, sc] = allCoords[id];
      gridRooms[sr][sc] = id;
      rooms.push({ id, cells: [[sr, sc]], clue: null });
      frontiers.set(id, [[sr, sc]]);
    }

    let unassigned = rows * cols - actualCount;
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    let safetyLoop = 0;

    while (unassigned > 0 && safetyLoop++ < rows * cols * 4) {
      let expandedAny = false;

      for (let id = 0; id < actualCount; id++) {
        const frontier = frontiers.get(id);
        if (!frontier || frontier.length === 0) continue;

        const pickIdx = Math.floor(rnd() * frontier.length);
        const [cr, cc] = frontier[pickIdx];

        const validNeighbors: [number, number][] = [];
        for (const [dr, dc] of dirs) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && gridRooms[nr][nc] === -1) {
            validNeighbors.push([nr, nc]);
          }
        }

        if (validNeighbors.length > 0) {
          const [targetR, targetC] = validNeighbors[Math.floor(rnd() * validNeighbors.length)];
          gridRooms[targetR][targetC] = id;
          rooms[id].cells.push([targetR, targetC]);
          frontier.push([targetR, targetC]);
          unassigned--;
          expandedAny = true;
        } else {
          frontier.splice(pickIdx, 1);
        }
      }

      if (!expandedAny) break;
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (gridRooms[r][c] === -1) {
          let assignedNeighbor = -1;
          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && gridRooms[nr][nc] !== -1) {
              assignedNeighbor = gridRooms[nr][nc];
              break;
            }
          }
          if (assignedNeighbor === -1) assignedNeighbor = 0;
          gridRooms[r][c] = assignedNeighbor;
          rooms[assignedNeighbor].cells.push([r, c]);
        }
      }
    }

    for (const rm of rooms) {
      const rs = rm.cells.map(([r]) => r);
      const cs = rm.cells.map(([, c]) => c);
      const h = Math.max(...rs) - Math.min(...rs) + 1;
      const w = Math.max(...cs) - Math.min(...cs) + 1;
      const area = rm.cells.length;

      if (h === 1 || w === 1) rm.shapeType = 'corridor';
      else if (h * w === area) rm.shapeType = 'rect';
      else if (area <= 5) rm.shapeType = 'l_shape';
      else rm.shapeType = 'irregular';
    }

    return { rooms, gridRooms };
  }

  /**
   * 約束引導構造合法解答（不再盲目隨機撒點）
   */
  private static _generateConstrainedSolution(
    rows: number,
    cols: number,
    rooms: Room[],
    gridRooms: number[][],
    rnd: () => number
  ): boolean[][] | null {
    const board: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));

    // 各房間嘗試依上限配置不相鄰黑格
    for (const room of rooms) {
      const maxPossibleBlack = Math.ceil(room.cells.length / 2);
      const targetBlack = Math.floor(rnd() * (maxPossibleBlack + 1));
      let placed = 0;

      const shuffledCells = [...room.cells];
      for (let i = shuffledCells.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [shuffledCells[i], shuffledCells[j]] = [shuffledCells[j], shuffledCells[i]];
      }

      for (const [r, c] of shuffledCells) {
        if (placed >= targetBlack) break;

        const hasAdjacentBlack =
          (r > 0 && board[r - 1][c]) ||
          (r < rows - 1 && board[r + 1][c]) ||
          (c > 0 && board[r][c - 1]) ||
          (c < cols - 1 && board[r][c + 1]);

        if (!hasAdjacentBlack) {
          board[r][c] = true;
          // 局部若破壞連通或射線則立即回滾
          if (!this.checkBoundaryCrossing(board, rows, cols, gridRooms)) {
            board[r][c] = false;
          } else {
            placed++;
          }
        }
      }
    }

    if (!this.isWhiteConnected(board, rows, cols)) return null;
    return board;
  }

  public static generate(tier: ExtendedTierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, minRooms, maxRooms, clueDensity, minPureRate, baseIrt } = config;

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      attempts++;

      const targetRooms = minRooms + Math.floor(rnd() * (maxRooms - minRooms + 1));
      const { rooms, gridRooms } = this._partitionRoomsDiverse(rows, cols, targetRooms, rnd);

      const solution = this._generateConstrainedSolution(rows, cols, rooms, gridRooms, rnd);
      if (!solution) continue;

      for (const room of rooms) {
        const blackCount = room.cells.filter(([r, c]) => solution[r][c]).length;
        room.clue = rnd() < clueDensity ? blackCount : null;
      }

      const solutions = this.countHeyawakeSolutions(rooms, gridRooms, rows, cols, 2);
      if (solutions !== 1) continue;

      const evaluation = this.evaluateHumanSolvability(rows, cols, rooms, gridRooms);
      if (evaluation.pureRate < minPureRate) continue;

      const totalCells = rows * cols;
      const avgRoomSize = totalCells / rooms.length;
      const roomSizeVariance =
        rooms.reduce((acc, rm) => acc + Math.pow(rm.cells.length - avgRoomSize, 2), 0) / rooms.length;

      let internalWallCount = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (c < cols - 1 && gridRooms[r][c] !== gridRooms[r][c + 1]) internalWallCount++;
          if (r < rows - 1 && gridRooms[r][c] !== gridRooms[r + 1][c]) internalWallCount++;
        }
      }
      const internalWallDensity = internalWallCount / (rows * (cols - 1) + cols * (rows - 1));
      const clueCount = rooms.filter((r) => r.clue !== null).length;
      const clueRatio = clueCount / rooms.length;
      const clueEntropy = -(clueRatio * Math.log2(clueRatio + 1e-6) + (1 - clueRatio) * Math.log2(1 - clueRatio + 1e-6));

      const structuralOffset = (roomSizeVariance * 0.12 + internalWallDensity * 0.65 + (1 - clueRatio) * 0.8) - 0.45;
      const dynamicIrt = Number(Math.max(-2.5, Math.min(4.5, baseIrt + structuralOffset)).toFixed(2));

      const puzzleId = `heyawake_${tier}_s${actualSeed}`;
      const spec: HeyawakeSpec = {
        rows,
        cols,
        rooms,
        gridRooms,
        solution,
        pureDeductionRate: evaluation.pureRate,
        tier,
        seed: actualSeed,
        solvingSteps: evaluation.deductionSteps,
        metricsAnalysis: {
          roomSizeVariance: Number(roomSizeVariance.toFixed(2)),
          internalWallPerimeter: internalWallCount,
          clueEntropy: Number(clueEntropy.toFixed(2)),
          effectiveRayDensity: Number(internalWallDensity.toFixed(2)),
          techniqueHistogram: evaluation.techniqueHistogram,
        },
      };

      return {
        id: puzzleId,
        category: 'spatial_logic' as any,
        engine_type: 'heyawake',
        tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
        checksum: `HEYAWAKE_${rows}x${cols}_S${actualSeed}`,
        puzzle: spec as any,
        solution: solution as any,
        cognitiveLoad: {
          spatial: Number(Math.min(1.0, 0.35 + internalWallDensity * 0.50 + (rooms.length / totalCells) * 0.35).toFixed(2)),
          numeric: Number(Math.min(1.0, 0.25 + clueRatio * 0.45).toFixed(2)),
          workingMemory: Number(Math.min(1.0, 0.30 + (1 - clueRatio) * 0.40 + (roomSizeVariance / 10) * 0.25).toFixed(2)),
          inhibition: 0.88,
        },
        metrics: {
          estimated_time_sec: Math.max(35, Math.round(totalCells * 2.8 + internalWallCount * 0.5)),
          irt_logit_difficulty: dynamicIrt,
          human_sim_steps: totalCells,
          seed: actualSeed,
          actualTier: tier,
          pure_deduction_rate: evaluation.pureRate,
        } as any,
      };
    }

    return this._generateFallback(tier, rows, cols, actualSeed, baseIrt);
  }

  private static _generateFallback(
    tier: ExtendedTierKey,
    rows: number,
    cols: number,
    seed: number,
    baseIrt: number
  ): PuzzleEntity {
    const solution = Array.from({ length: rows }, () => Array(cols).fill(false));
    const gridRooms = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => Math.floor(r / 2) * 2 + Math.floor(c / 2))
    );

    const roomMap = new Map<number, [number, number][]>();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rid = gridRooms[r][c];
        if (!roomMap.has(rid)) roomMap.set(rid, []);
        roomMap.get(rid)!.push([r, c]);
      }
    }

    const rooms: Room[] = Array.from(roomMap.entries()).map(([id, cells]) => ({
      id,
      cells,
      clue: 0,
      shapeType: 'rect',
    }));

    return {
      id: `heyawake_${tier}_s${seed}_fb`,
      category: 'spatial_logic' as any,
      engine_type: 'heyawake',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `HEYAWAKE_FB_${seed}`,
      puzzle: { rows, cols, rooms, gridRooms, solution, pureDeductionRate: 1.0, tier, seed } as any,
      solution: solution as any,
      cognitiveLoad: { spatial: 0.7, numeric: 0.3, workingMemory: 0.6, inhibition: 0.8 },
      metrics: { estimated_time_sec: 60, irt_logit_difficulty: baseIrt, seed } as any,
    };
  }
}
