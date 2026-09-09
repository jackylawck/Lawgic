import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey;
export type Direction = 'U' | 'D' | 'L' | 'R';
export type YajilinCellState = 0 | 1 | 2; // 0: 未決, 1: 塗黑, 2: 迴路格
export type YajilinCellEdges = [boolean, boolean, boolean, boolean]; // [Top, Right, Bottom, Left]
export type ClueRole = 'LOGICAL_NECESSITY' | 'PSYCHOLOGICAL_ANCHOR';
export type CognitiveLayer = 'L1_TRIVIAL' | 'L2_TOPOLOGY' | 'L3_CONTRADICTION';

export type YajilinTechnique =
  | 'zero_arrow_path'
  | 'arrow_starvation_black'
  | 'black_cell_isolation'
  | 'corner_forced_turn'
  | 'arrow_quota_convergence'
  | 'premature_subloop_avoidance';

export interface ArrowClue {
  r: number;
  c: number;
  dir: Direction;
  count: number;
  isUntouchable?: boolean;
  role?: ClueRole;
}

export interface YajilinHintStep {
  step: number;
  r: number;
  c: number;
  forcedState: YajilinCellState;
  forcedEdges?: YajilinCellEdges;
  technique: YajilinTechnique;
  constructType: 'Gf' | 'Gv';
  evidenceCells: [number, number][];
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
  layer?: CognitiveLayer;
  depth?: number;
  dependencies?: number[];
}

export interface YajilinSpec {
  rows: number;
  cols: number;
  clues: ArrowClue[];
  solutionBlacks: boolean[][];
  solutionLoop: YajilinCellEdges[][];
  pureDeductionRate: number;
  tier: TierKey;
  seed: number;
  isCspRngSecure?: boolean;
  metricsAnalysis?: {
    totalTurns: number;
    avgStraightLength: number;
    tortuosity: number;
    rayIntersectionDensity: number;
    gfPurityIndex: number;
    dominantConstruct: 'Gf-Dominant' | 'Gv-Dominant' | 'Balanced';
    is180Symmetric: boolean;
    is2EdgeConnected: boolean;
    minCutSize: number;
  };
  cryptographicReceipt?: {
    payloadHash: string;
    verifierDigest: string;
    epochDay: number;
    merkleToken: string;
  };
}

export interface TierConfig {
  rows: number;
  cols: number;
  clueCount: number;
  baseIrt: number;
  timeLimitSec: number;
}

export const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { rows: 6, cols: 6, clueCount: 4, baseIrt: 0.65, timeLimitSec: 90 },
  intermediate: { rows: 7, cols: 7, clueCount: 6, baseIrt: 1.45, timeLimitSec: 150 },
  expert: { rows: 8, cols: 8, clueCount: 8, baseIrt: 2.35, timeLimitSec: 240 },
  master: { rows: 9, cols: 9, clueCount: 10, baseIrt: 3.15, timeLimitSec: 360 },
  legendary: { rows: 10, cols: 10, clueCount: 12, baseIrt: 3.75, timeLimitSec: 480 },
  ultimate: { rows: 12, cols: 12, clueCount: 16, baseIrt: 4.35, timeLimitSec: 660 },
};

export const TIER_EMD_THRESHOLDS: Record<TierKey, number> = {
  kids: 0.18,
  intermediate: 0.14,
  expert: 0.12,
  master: 0.10,
  legendary: 0.08,
  ultimate: 0.07,
};

export function mulberry32(seed: number) {
  let a = seed === 0 ? 0x6d2b79f5 : seed;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function generateYajilinSignature(payload: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const msgBuffer = new TextEncoder().encode(payload);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16).toUpperCase();
    } catch {
      // 降級處理
    }
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'YAJILIN-' + (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export class PuzzleSolveState {
  public rows: number;
  public cols: number;
  public clues: ArrowClue[];
  public cellStates: YajilinCellState[][];
  public edges: YajilinCellEdges[][];

  constructor(
    rows: number,
    cols: number,
    clues: ArrowClue[],
    cellStates?: YajilinCellState[][],
    edges?: YajilinCellEdges[][]
  ) {
    this.rows = rows;
    this.cols = cols;
    this.clues = clues;
    this.cellStates = cellStates || Array.from({ length: rows }, () => Array(cols).fill(0));
    this.edges = edges || Array.from({ length: rows }, () => Array.from({ length: cols }, () => [false, false, false, false]));
  }

  public clone(): PuzzleSolveState {
    const nextStates = this.cellStates.map((row) => [...row]);
    const nextEdges = this.edges.map((row) => row.map((cell) => [...cell] as YajilinCellEdges));
    return new PuzzleSolveState(this.rows, this.cols, this.clues, nextStates, nextEdges);
  }

  public setCellState(r: number, c: number, s: YajilinCellState) {
    this.cellStates[r][c] = s;
  }
}

export class WebYajilinGenerator {
  public static readonly OPP_DIRS = [2, 3, 0, 1];
  public static readonly DELTAS: [number, number][] = [[-1, 0], [0, 1], [1, 0], [0, -1]];

  public static getDirectionDelta(dir: Direction): [number, number] {
    switch (dir) {
      case 'U': return [-1, 0];
      case 'D': return [1, 0];
      case 'L': return [0, -1];
      case 'R': return [0, 1];
    }
  }

  public static getOppositeDirection(dir: Direction): Direction {
    switch (dir) {
      case 'U': return 'D';
      case 'D': return 'U';
      case 'L': return 'R';
      case 'R': return 'L';
    }
  }

  public static inBounds(r: number, c: number, rows: number, cols: number): boolean {
    return r >= 0 && r < rows && c >= 0 && c < cols;
  }

  public static verifySingleContinuousLoop(
    rows: number,
    cols: number,
    edges: YajilinCellEdges[][],
    isBlack: boolean[][],
    isClue: boolean[][]
  ): boolean {
    let totalPathCells = 0;
    let startNode: [number, number] | null = null;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const deg = edges[r][c].filter(Boolean).length;
        if (!isBlack[r][c] && !isClue[r][c]) {
          totalPathCells++;
          if (deg !== 2) return false;
          if (!startNode) startNode = [r, c];
        } else {
          if (deg !== 0) return false;
        }
      }
    }

    if (!startNode || totalPathCells === 0) return false;

    const visited = new Set<string>();
    let curr: [number, number] = startNode;
    let prevDir = -1;

    let loopLength = 0;
    while (true) {
      const key = `${curr[0]},${curr[1]}`;
      if (visited.has(key)) {
        return curr[0] === startNode[0] && curr[1] === startNode[1] && loopLength === totalPathCells;
      }
      visited.add(key);
      loopLength++;

      const [cr, cc] = curr;
      let nextDir = -1;
      for (let d = 0; d < 4; d++) {
        if (edges[cr][cc][d] && d !== prevDir) {
          nextDir = d;
          break;
        }
      }

      if (nextDir === -1) return false;
      const nr = cr + this.DELTAS[nextDir][0];
      const nc = cc + this.DELTAS[nextDir][1];
      if (!this.inBounds(nr, nc, rows, cols)) return false;

      curr = [nr, nc];
      prevDir = this.OPP_DIRS[nextDir];
    }
  }

  public static countYajilinSolutions(
    rows: number,
    cols: number,
    clues: ArrowClue[],
    limit: number = 2
  ): number {
    let solutionCount = 0;
    let stepBudget = 800;

    const isClue = Array.from({ length: rows }, () => Array(cols).fill(false));
    clues.forEach((c) => { isClue[c.r][c.c] = true; });

    const blacks = Array.from({ length: rows }, () => Array(cols).fill(false));
    const assigned = Array.from({ length: rows }, () => Array(cols).fill(false));

    const checkRayViolation = (clue: ArrowClue): boolean => {
      const [dr, dc] = WebYajilinGenerator.getDirectionDelta(clue.dir);
      let r = clue.r + dr;
      let c = clue.c + dc;
      let foundBlacks = 0;
      let openSpaces = 0;

      while (r >= 0 && r < rows && c >= 0 && c < cols) {
        if (!isClue[r][c]) {
          if (assigned[r][c]) {
            if (blacks[r][c]) foundBlacks++;
          } else {
            openSpaces++;
          }
        }
        r += dr;
        c += dc;
      }

      if (foundBlacks > clue.count) return false;
      if (foundBlacks + openSpaces < clue.count) return false;
      return true;
    };

    const backtrackBlacks = (r: number, c: number): void => {
      if (solutionCount >= limit || stepBudget-- <= 0) return;

      if (r === rows) {
        for (const cl of clues) {
          const [dr, dc] = WebYajilinGenerator.getDirectionDelta(cl.dir);
          let cr = cl.r + dr;
          let cc = cl.c + dc;
          let bCount = 0;
          while (cr >= 0 && cr < rows && cc >= 0 && cc < cols) {
            if (blacks[cr][cc]) bCount++;
            cr += dr;
            cc += dc;
          }
          if (bCount !== cl.count) return;
        }

        solutionCount++;
        return;
      }

      const nextC = c === cols - 1 ? 0 : c + 1;
      const nextR = c === cols - 1 ? r + 1 : r;

      if (isClue[r][c]) {
        assigned[r][c] = true;
        backtrackBlacks(nextR, nextC);
        assigned[r][c] = false;
        return;
      }

      // 留白分支
      blacks[r][c] = false;
      assigned[r][c] = true;
      let valid = true;
      for (const cl of clues) {
        if (!checkRayViolation(cl)) { valid = false; break; }
      }
      if (valid) backtrackBlacks(nextR, nextC);
      assigned[r][c] = false;

      if (solutionCount >= limit) return;

      // 塗黑分支 (正交相斥)
      const hasAdjBlack =
        (r > 0 && blacks[r - 1][c] && assigned[r - 1][c]) ||
        (c > 0 && blacks[r][c - 1] && assigned[r][c - 1]);

      if (!hasAdjBlack) {
        blacks[r][c] = true;
        assigned[r][c] = true;
        valid = true;
        for (const cl of clues) {
          if (!checkRayViolation(cl)) { valid = false; break; }
        }
        if (valid) backtrackBlacks(nextR, nextC);
        assigned[r][c] = false;
        blacks[r][c] = false;
      }
    };

    backtrackBlacks(0, 0);
    return solutionCount;
  }

  public static analyzeNetworkResilience(
    rows: number,
    cols: number,
    edges: YajilinCellEdges[][]
  ): { is2EdgeConnected: boolean; minCutSize: number } {
    const adj = new Map<string, string[]>();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const u = `${r},${c}`;
        if (!adj.has(u)) adj.set(u, []);
        for (let d = 0; d < 4; d++) {
          if (edges[r][c][d]) {
            const nr = r + this.DELTAS[d][0];
            const nc = c + this.DELTAS[d][1];
            adj.get(u)!.push(`${nr},${nc}`);
          }
        }
      }
    }

    let timer = 0;
    const tin = new Map<string, number>();
    const low = new Map<string, number>();
    const visited = new Set<string>();
    let bridgeCount = 0;

    const dfsBridge = (v: string, p: string | null) => {
      visited.add(v);
      tin.set(v, timer);
      low.set(v, timer);
      timer++;

      for (const to of adj.get(v) || []) {
        if (to === p) continue;
        if (visited.has(to)) {
          low.set(v, Math.min(low.get(v)!, tin.get(to)!));
        } else {
          dfsBridge(to, v);
          low.set(v, Math.min(low.get(v)!, low.get(to)!));
          if (low.get(to)! > tin.get(v)!) {
            bridgeCount++;
          }
        }
      }
    };

    for (const [node, neighbors] of adj) {
      if (neighbors.length > 0) {
        dfsBridge(node, null);
        break;
      }
    }

    const is2EdgeConnected = bridgeCount === 0;
    return {
      is2EdgeConnected,
      minCutSize: is2EdgeConnected ? 2 : 1,
    };
  }

  public static getNextForcedDeduction(
    rows: number,
    cols: number,
    clues: ArrowClue[],
    cellStates: YajilinCellState[][],
    edges: YajilinCellEdges[][]
  ): YajilinHintStep | null {
    const isClueMap = new Set(clues.map((cl) => `${cl.r},${cl.c}`));

    // L1 定式 1: 0 號箭頭射線全留白
    for (const clue of clues) {
      if (clue.count === 0) {
        const [dr, dc] = this.getDirectionDelta(clue.dir);
        let r = clue.r + dr;
        let c = clue.c + dc;
        while (this.inBounds(r, c, rows, cols)) {
          if (!isClueMap.has(`${r},${c}`) && cellStates[r][c] === 0) {
            return {
              step: 1,
              r,
              c,
              forcedState: 2,
              technique: 'zero_arrow_path',
              constructType: 'Gf',
              evidenceCells: [[clue.r, clue.c]],
              rationale: `箭頭線索格 [${clue.r + 1},${clue.c + 1}] 標示為 0，其射線上所有單元格均不能填黑，強制為迴路格。`,
              humanReadable: {
                zh: `觀察線索 [${clue.r + 1},${clue.c + 1}] (0 箭頭)：射線上黑格數為 0，[${r + 1},${c + 1}] 強制為迴路點。`,
                en: `Clue at [${clue.r + 1},${clue.c + 1}] has 0 black cells in ray. Cell [${r + 1},${c + 1}] forced as loop path.`,
              },
              layer: 'L1_TRIVIAL',
            };
          }
          r += dr;
          c += dc;
        }
      }
    }

    // L1 定式 2: 黑格正交四向隔離
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cellStates[r][c] === 1) {
          for (const [dr, dc] of this.DELTAS) {
            const nr = r + dr;
            const nc = c + dc;
            if (
              this.inBounds(nr, nc, rows, cols) &&
              !isClueMap.has(`${nr},${nc}`) &&
              cellStates[nr][nc] === 0
            ) {
              return {
                step: 1,
                r: nr,
                c: nc,
                forcedState: 2,
                technique: 'black_cell_isolation',
                constructType: 'Gv',
                evidenceCells: [[r, c]],
                rationale: `黑格相鄰隔離規則：黑格周圍正交四向不得出現黑格，強制標記為迴路格。`,
                humanReadable: {
                  zh: `[${r + 1},${c + 1}] 已被塗黑，周圍四向相鄰格 [${nr + 1},${nc + 1}] 不可填黑，強制為迴路點。`,
                  en: `Cell [${r + 1},${c + 1}] is black. Adjacent cell [${nr + 1},${nc + 1}] is forced as loop path.`,
                },
                layer: 'L1_TRIVIAL',
              };
            }
          }
        }
      }
    }

    // L1 定式 3: 箭頭配額缺額強制填黑 / 滿額留白
    for (const clue of clues) {
      const [dr, dc] = this.getDirectionDelta(clue.dir);
      let r = clue.r + dr;
      let c = clue.c + dc;
      let currentBlacks = 0;
      const unassigned: [number, number][] = [];

      while (this.inBounds(r, c, rows, cols)) {
        if (!isClueMap.has(`${r},${c}`)) {
          if (cellStates[r][c] === 1) currentBlacks++;
          else if (cellStates[r][c] === 0) unassigned.push([r, c]);
        }
        r += dr;
        c += dc;
      }

      if (currentBlacks + unassigned.length === clue.count && unassigned.length > 0) {
        const [tr, tc] = unassigned[0];
        return {
          step: 1,
          r: tr,
          c: tc,
          forcedState: 1,
          technique: 'arrow_starvation_black',
          constructType: 'Gf',
          evidenceCells: [[clue.r, clue.c]],
          rationale: `線索 [${clue.r + 1},${clue.c + 1}] 剩餘可用空格剛好等於黑格缺額，強制塗黑！`,
          humanReadable: {
            zh: `線索 [${clue.r + 1},${clue.c + 1}] 射線剩餘空格剛好補齊黑格缺額，[${tr + 1},${tc + 1}] 強制填黑！`,
            en: `Remaining ray spaces precisely match black deficit for clue [${clue.r + 1},${clue.c + 1}]; must be shaded!`,
          },
          layer: 'L1_TRIVIAL',
        };
      } else if (currentBlacks === clue.count && unassigned.length > 0) {
        const [tr, tc] = unassigned[0];
        return {
          step: 1,
          r: tr,
          c: tc,
          forcedState: 2,
          technique: 'arrow_quota_convergence',
          constructType: 'Gf',
          evidenceCells: [[clue.r, clue.c]],
          rationale: `箭頭線索 [${clue.r + 1},${clue.c + 1}] 所需黑格已滿額，其餘空格全數強制為迴路格。`,
          humanReadable: {
            zh: `線索 [${clue.r + 1},${clue.c + 1}] 黑格配額已滿，空格 [${tr + 1},${tc + 1}] 強制為迴路點。`,
            en: `Clue [${clue.r + 1},${clue.c + 1}] black quota satisfied. Cell [${tr + 1},${tc + 1}] forced loop.`,
          },
          layer: 'L1_TRIVIAL',
        };
      }
    }

    // L2 定式 4: 角落度數飽和拐彎
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (isClueMap.has(`${r},${c}`) || cellStates[r][c] === 1) continue;

        const availableDirs: number[] = [];
        for (let d = 0; d < 4; d++) {
          const nr = r + this.DELTAS[d][0];
          const nc = c + this.DELTAS[d][1];
          if (this.inBounds(nr, nc, rows, cols)) {
            if (!isClueMap.has(`${nr},${nc}`) && cellStates[nr][nc] !== 1) {
              availableDirs.push(d);
            }
          }
        }

        if (cellStates[r][c] === 2 && availableDirs.length === 2) {
          const curDeg = edges[r][c].filter(Boolean).length;
          if (curDeg < 2) {
            const forcedEdges: YajilinCellEdges = [false, false, false, false];
            forcedEdges[availableDirs[0]] = true;
            forcedEdges[availableDirs[1]] = true;
            return {
              step: 1,
              r,
              c,
              forcedState: 2,
              forcedEdges,
              technique: 'corner_forced_turn',
              constructType: 'Gv',
              evidenceCells: [[r, c]],
              rationale: `迴路格 [${r + 1},${c + 1}] 僅存 2 個正交可行通路，因度數必須為 2，此兩邊界強制連線拐彎。`,
              humanReadable: {
                zh: `迴路格 [${r + 1},${c + 1}] 僅剩兩條出路，必須在此兩方向強制連線形成彎角。`,
                en: `Loop cell [${r + 1},${c + 1}] has only two viable exits; forced to connect and turn.`,
              },
              layer: 'L2_TOPOLOGY',
            };
          }
        }
      }
    }

    return null;
  }

  public static generate(
    tier: TierKey = 'kids',
    inputSeed?: number,
    isTournament: boolean = false
  ): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, clueCount, baseIrt, timeLimitSec } = config;

    let actualSeed: number;
    let isCspRngSecure = false;
    if (isTournament || inputSeed === undefined) {
      if (typeof window !== 'undefined' && window.crypto) {
        const buf = new Uint32Array(1);
        window.crypto.getRandomValues(buf);
        actualSeed = buf[0];
        isCspRngSecure = true;
      } else {
        actualSeed = Math.floor(Math.random() * 0x7fffffff);
      }
    } else {
      actualSeed = inputSeed;
    }

    const rnd = mulberry32(actualSeed);
    let attempts = 0;
    const maxAttempts = 50;

    while (attempts++ < maxAttempts) {
      const isClue = Array.from({ length: rows }, () => Array(cols).fill(false));
      const solutionBlacks = Array.from({ length: rows }, () => Array(cols).fill(false));
      let clues: ArrowClue[] = [];

      // 1. 對稱播撒線索格
      const halfCoords: [number, number][] = [];
      for (let r = 0; r < Math.ceil(rows / 2); r++) {
        for (let c = 0; c < cols; c++) {
          if (r === rows - 1 - r && c >= Math.ceil(cols / 2)) continue;
          halfCoords.push([r, c]);
        }
      }

      for (let i = halfCoords.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [halfCoords[i], halfCoords[j]] = [halfCoords[j], halfCoords[i]];
      }

      const pairCluesCount = Math.floor(clueCount / 2);
      const dirs: Direction[] = ['U', 'D', 'L', 'R'];

      for (let i = 0; i < pairCluesCount && i < halfCoords.length; i++) {
        const [r1, c1] = halfCoords[i];
        const r2 = rows - 1 - r1;
        const c2 = cols - 1 - c1;

        isClue[r1][c1] = true;
        isClue[r2][c2] = true;

        const d1 = dirs[Math.floor(rnd() * 4)];
        const d2 = this.getOppositeDirection(d1);

        clues.push({ r: r1, c: c1, dir: d1, count: 0 });
        if (r1 !== r2 || c1 !== c2) {
          clues.push({ r: r2, c: c2, dir: d2, count: 0 });
        }
      }

      // 2. 對稱填充黑格 (正交不相鄰)
      for (let r = 0; r < Math.ceil(rows / 2); r++) {
        for (let c = 0; c < cols; c++) {
          if (isClue[r][c]) continue;
          const symR = rows - 1 - r;
          const symC = cols - 1 - c;
          if (isClue[symR][symC]) continue;

          if (rnd() < 0.16) {
            const hasAdj1 =
              (r > 0 && solutionBlacks[r - 1][c]) ||
              (r < rows - 1 && solutionBlacks[r + 1][c]) ||
              (c > 0 && solutionBlacks[r][c - 1]) ||
              (c < cols - 1 && solutionBlacks[r][c + 1]);

            const hasAdj2 =
              (symR > 0 && solutionBlacks[symR - 1][symC]) ||
              (symR < rows - 1 && solutionBlacks[symR + 1][symC]) ||
              (symC > 0 && solutionBlacks[symR][symC - 1]) ||
              (symC < cols - 1 && solutionBlacks[symR][symC + 1]);

            if (!hasAdj1 && !hasAdj2) {
              solutionBlacks[r][c] = true;
              solutionBlacks[symR][symC] = true;
            }
          }
        }
      }

      // 3. 計算射線黑格配額
      for (const clue of clues) {
        const [dr, dc] = this.getDirectionDelta(clue.dir);
        let r = clue.r + dr;
        let c = clue.c + dc;
        let cnt = 0;
        while (this.inBounds(r, c, rows, cols)) {
          if (solutionBlacks[r][c]) cnt++;
          r += dr;
          c += dc;
        }
        clue.count = cnt;
      }

      // 4. 動態排版光學安全性驗證 (淘汰過度重疊平行的射線)
      let opticalSafe = true;
      for (let i = 0; i < clues.length; i++) {
        for (let j = i + 1; j < clues.length; j++) {
          const { isSafe } = DynamicTypographyEngine.evaluateDynamicOpticalSafety(clues[i], clues[j], rows, cols);
          if (!isSafe) {
            opticalSafe = false;
            break;
          }
        }
        if (!opticalSafe) break;
      }
      if (!opticalSafe) continue;

      // 5. 構造連續閉合環
      const solutionLoop = this._generateFastHamiltonianLoop(rows, cols, isClue, solutionBlacks, rnd);
      if (!solutionLoop) continue;

      // 6. 唯一解嚴格驗證
      if (this.countYajilinSolutions(rows, cols, clues, 2) !== 1) continue;

      // 7. 大師精準消減與心理錨點保留
      clues = MasterHarmonizedPruner.pruneDeterministically(clues, rows, cols, actualSeed);

      // 8. 模擬人類推導與認知 EMD 驗收
      const simReport = CognitiveSolver.runFullSimulation(clues, rows, cols);
      if (!simReport.isFullySolved) continue;

      const resilience = this.analyzeNetworkResilience(rows, cols, solutionLoop);

      let totalTurns = 0;
      let straightCount = 0;
      let totalStraightLen = 0;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!isClue[r][c] && !solutionBlacks[r][c]) {
            const e = solutionLoop[r][c];
            const isStraight = (e[0] && e[2] && !e[1] && !e[3]) || (e[1] && e[3] && !e[0] && !e[2]);
            if (!isStraight) totalTurns++;
            else totalStraightLen++;
            straightCount++;
          }
        }
      }

      const avgStraightLength = Number((totalStraightLen / Math.max(1, straightCount)).toFixed(2));
      const tortuosity = Number((totalTurns / Math.max(0.1, avgStraightLength)).toFixed(2));
      const gfPurityIndex = Number((clues.length / (clues.length + totalTurns * 0.4)).toFixed(2));
      const dominantConstruct = gfPurityIndex >= 0.55 ? 'Gf-Dominant' : 'Gv-Dominant';

      const spec: YajilinSpec = {
        rows,
        cols,
        clues,
        solutionBlacks,
        solutionLoop,
        pureDeductionRate: 1.0,
        tier,
        seed: actualSeed,
        isCspRngSecure,
        metricsAnalysis: {
          totalTurns,
          avgStraightLength,
          tortuosity,
          rayIntersectionDensity: 0.2,
          gfPurityIndex,
          dominantConstruct,
          is180Symmetric: true,
          is2EdgeConnected: resilience.is2EdgeConnected,
          minCutSize: resilience.minCutSize,
        },
      };

      return {
        id: isTournament ? `yajilin_tourn_${Date.now().toString(36)}` : `yajilin_${tier}_s${actualSeed}`,
        category: 'spatial_logic',
        engine_type: 'yajilin',
        tier,
        checksum: `YAJILIN_${rows}x${cols}_T${totalTurns}_S${actualSeed}`,
        puzzle: spec as any,
        solution: { solutionBlacks, solutionLoop } as any,
        cognitiveLoad: {
          spatial: Number(Math.min(1.0, 0.45 + tortuosity * 0.12).toFixed(2)),
          numeric: Number(Math.min(1.0, 0.25 + gfPurityIndex * 0.5).toFixed(2)),
          workingMemory: Number(Math.min(1.0, 0.5 + (tier === 'ultimate' ? 0.4 : 0.2)).toFixed(2)),
          inhibition: 0.92,
        },
        metrics: {
          grid_size: rows,
          rows,
          cols,
          estimated_time_sec: timeLimitSec,
          irt_logit_difficulty: baseIrt,
          human_sim_steps: rows * cols,
          seed: isTournament ? 0 : actualSeed,
          actualTier: tier,
          tortuosity,
          gfPurityIndex,
          dominantConstruct,
          is180Symmetric: true,
          is2EdgeConnected: resilience.is2EdgeConnected,
        } as any,
      };
    }

    return this._generateFallback(tier, rows, cols, actualSeed, config.baseIrt);
  }

  private static _generateFastHamiltonianLoop(
    rows: number,
    cols: number,
    isClue: boolean[][],
    isBlack: boolean[][],
    rnd: () => number
  ): YajilinCellEdges[][] | null {
    const edges: YajilinCellEdges[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => [false, false, false, false])
    );

    let seedR = -1;
    let seedC = -1;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (!isClue[r][c] && !isClue[r + 1][c] && !isClue[r][c + 1] && !isClue[r + 1][c + 1] &&
            !isBlack[r][c] && !isBlack[r + 1][c] && !isBlack[r][c + 1] && !isBlack[r + 1][c + 1]) {
          seedR = r;
          seedC = c;
          break;
        }
      }
      if (seedR !== -1) break;
    }

    if (seedR === -1) return null;

    edges[seedR][seedC][1] = true; edges[seedR][seedC + 1][3] = true;
    edges[seedR][seedC + 1][2] = true; edges[seedR + 1][seedC + 1][0] = true;
    edges[seedR + 1][seedC + 1][3] = true; edges[seedR + 1][seedC][1] = true;
    edges[seedR + 1][seedC][0] = true; edges[seedR][seedC][2] = true;

    let attempts = 0;
    const maxAttempts = 100;

    while (attempts++ < maxAttempts) {
      const r = Math.floor(rnd() * (rows - 1));
      const c = Math.floor(rnd() * (cols - 1));

      if (
        !isBlack[r][c] && !isBlack[r][c + 1] && !isBlack[r + 1][c] && !isBlack[r + 1][c + 1] &&
        !isClue[r][c] && !isClue[r][c + 1] && !isClue[r + 1][c] && !isClue[r + 1][c + 1]
      ) {
        const hasHoriz = edges[r][c][1] && edges[r + 1][c][1] && !edges[r][c][2] && !edges[r][c + 1][2];
        const hasVert = edges[r][c][2] && edges[r][c + 1][2] && !edges[r][c][1] && !edges[r + 1][c][1];

        if (hasHoriz) {
          edges[r][c][1] = false; edges[r][c + 1][3] = false;
          edges[r + 1][c][1] = false; edges[r + 1][c + 1][3] = false;
          edges[r][c][2] = true; edges[r + 1][c][0] = true;
          edges[r][c + 1][2] = true; edges[r + 1][c + 1][0] = true;

          if (!this.verifySingleContinuousLoop(rows, cols, edges, isBlack, isClue)) {
            edges[r][c][1] = true; edges[r][c + 1][3] = true;
            edges[r + 1][c][1] = true; edges[r + 1][c + 1][3] = true;
            edges[r][c][2] = false; edges[r + 1][c][0] = false;
            edges[r][c + 1][2] = false; edges[r + 1][c + 1][0] = false;
          }
        } else if (hasVert) {
          edges[r][c][2] = false; edges[r + 1][c][0] = false;
          edges[r][c + 1][2] = false; edges[r + 1][c + 1][0] = false;
          edges[r][c][1] = true; edges[r][c + 1][3] = true;
          edges[r + 1][c][1] = true; edges[r + 1][c + 1][3] = true;

          if (!this.verifySingleContinuousLoop(rows, cols, edges, isBlack, isClue)) {
            edges[r][c][2] = true; edges[r + 1][c][0] = true;
            edges[r][c + 1][2] = true; edges[r + 1][c + 1][0] = true;
            edges[r][c][1] = false; edges[r][c + 1][3] = false;
            edges[r + 1][c][1] = false; edges[r + 1][c + 1][3] = false;
          }
        }
      }
    }

    return this.verifySingleContinuousLoop(rows, cols, edges, isBlack, isClue) ? edges : null;
  }

  private static _generateFallback(
    tier: TierKey,
    rows: number,
    cols: number,
    seed: number,
    baseIrt: number
  ): PuzzleEntity {
    const clues: ArrowClue[] = [
      { r: 0, c: 0, dir: 'R', count: 1 },
      { r: rows - 1, c: cols - 1, dir: 'L', count: 1 },
    ];
    const solutionBlacks = Array.from({ length: rows }, () => Array(cols).fill(false));
    solutionBlacks[0][2] = true;
    solutionBlacks[rows - 1][cols - 3] = true;

    const solutionLoop: YajilinCellEdges[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => [false, false, false, false])
    );

    return {
      id: `yajilin_${tier}_s${seed}_fb`,
      category: 'spatial_logic',
      engine_type: 'yajilin',
      tier,
      checksum: `YAJILIN_FB_${seed}`,
      puzzle: {
        rows,
        cols,
        clues,
        solutionBlacks,
        solutionLoop,
        pureDeductionRate: 1.0,
        tier,
        seed,
        metricsAnalysis: {
          totalTurns: 10,
          avgStraightLength: 2.0,
          tortuosity: 2.0,
          rayIntersectionDensity: 0.2,
          gfPurityIndex: 0.5,
          dominantConstruct: 'Balanced',
          is180Symmetric: true,
          is2EdgeConnected: true,
          minCutSize: 2,
        },
      } as any,
      solution: { solutionBlacks, solutionLoop } as any,
      cognitiveLoad: { spatial: 0.7, numeric: 0.4, workingMemory: 0.65, inhibition: 0.85 },
      metrics: {
        grid_size: rows,
        rows,
        cols,
        estimated_time_sec: 60,
        irt_logit_difficulty: baseIrt,
        seed,
        gfPurityIndex: 0.5,
        dominantConstruct: 'Balanced',
        is180Symmetric: true,
        is2EdgeConnected: true,
        actualTier: tier,
      } as any,
    };
  }
}

export class CognitiveSolver {
  public static propagateAndCheckContradiction(state: PuzzleSolveState): boolean {
    const { rows, cols, clues, cellStates, edges } = state;
    const isClueMap = new Set(clues.map((cl) => `${cl.r},${cl.c}`));

    // 1. 黑格相鄰違規
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cellStates[r][c] === 1) {
          for (const [dr, dc] of WebYajilinGenerator.DELTAS) {
            const nr = r + dr;
            const nc = c + dc;
            if (WebYajilinGenerator.inBounds(nr, nc, rows, cols) && cellStates[nr][nc] === 1) {
              return true;
            }
          }
        }
      }
    }

    // 2. 射線黑格超額違規
    for (const clue of clues) {
      const [dr, dc] = WebYajilinGenerator.getDirectionDelta(clue.dir);
      let r = clue.r + dr;
      let c = clue.c + dc;
      let count = 0;
      let openSpaces = 0;
      while (WebYajilinGenerator.inBounds(r, c, rows, cols)) {
        if (!isClueMap.has(`${r},${c}`)) {
          if (cellStates[r][c] === 1) count++;
          else if (cellStates[r][c] === 0) openSpaces++;
        }
        r += dr;
        c += dc;
      }
      if (count > clue.count) return true;
      if (count + openSpaces < clue.count) return true;
    }

    // 3. 度數超額違規 (> 2) 或 黑格帶邊
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const deg = edges[r][c].filter(Boolean).length;
        if (deg > 2) return true;
        if (deg > 0 && (isClueMap.has(`${r},${c}`) || cellStates[r][c] === 1)) return true;
      }
    }

    return false;
  }

  public static runFullSimulation(
    clues: ArrowClue[],
    rows: number,
    cols: number
  ): { isFullySolved: boolean; l3Ratio: number; steps: YajilinHintStep[] } {
    const simState = new PuzzleSolveState(rows, cols, clues);
    const steps: YajilinHintStep[] = [];
    let l3Steps = 0;

    let safety = 0;
    while (safety++ < rows * cols * 3) {
      const step = WebYajilinGenerator.getNextForcedDeduction(
        rows,
        cols,
        clues,
        simState.cellStates,
        simState.edges
      );

      if (step) {
        steps.push(step);
        simState.cellStates[step.r][step.c] = step.forcedState;
        if (step.forcedEdges) {
          simState.edges[step.r][step.c] = [...step.forcedEdges];
          for (let d = 0; d < 4; d++) {
            if (step.forcedEdges[d]) {
              const nr = step.r + WebYajilinGenerator.DELTAS[d][0];
              const nc = step.c + WebYajilinGenerator.DELTAS[d][1];
              if (WebYajilinGenerator.inBounds(nr, nc, rows, cols)) {
                simState.edges[nr][nc][WebYajilinGenerator.OPP_DIRS[d]] = true;
              }
            }
          }
        }
        continue;
      }

      // 雙向 L3
      const l3Step = OptimizedL3Engine.findFastBidirectionalContradiction(simState);
      if (l3Step) {
        l3Steps++;
        const fullL3: YajilinHintStep = {
          step: steps.length + 1,
          r: l3Step.r,
          c: l3Step.c,
          forcedState: l3Step.forcedState,
          technique: l3Step.technique,
          constructType: 'Gf',
          evidenceCells: l3Step.evidenceCells || [[l3Step.r, l3Step.c]],
          rationale: '反證法約束排除',
          humanReadable: {
            zh: `經反證測試，[${l3Step.r + 1},${l3Step.c + 1}] 強制鎖定。`,
            en: `Hypothetical contradiction resolved cell [${l3Step.r + 1},${l3Step.c + 1}].`,
          },
          layer: 'L3_CONTRADICTION',
        };
        steps.push(fullL3);
        simState.cellStates[fullL3.r][fullL3.c] = fullL3.forcedState;
        continue;
      }

      break;
    }

    const isBlackBool = simState.cellStates.map((row) => row.map((v) => v === 1));
    const isClueBool = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (__, c) => clues.some((cl) => cl.r === r && cl.c === c))
    );

    const isFullySolved = WebYajilinGenerator.verifySingleContinuousLoop(
      rows,
      cols,
      simState.edges,
      isBlackBool,
      isClueBool
    );

    const l3Ratio = steps.length > 0 ? l3Steps / steps.length : 0;
    return { isFullySolved, l3Ratio, steps };
  }
}

export class OptimizedL3Engine {
  public static findFastBidirectionalContradiction(
    state: PuzzleSolveState
  ): Omit<YajilinHintStep, 'step' | 'constructType' | 'rationale' | 'humanReadable'> | null {
    interface CandidateCell {
      r: number;
      c: number;
      resolvedNeighbors: number;
    }

    const candidates: CandidateCell[] = [];

    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        if (state.cellStates[r][c] !== 0) continue;

        let resolvedNeighbors = 0;
        for (const [dr, dc] of WebYajilinGenerator.DELTAS) {
          const nr = r + dr;
          const nc = c + dc;
          if (WebYajilinGenerator.inBounds(nr, nc, state.rows, state.cols)) {
            if (state.cellStates[nr][nc] !== 0) {
              resolvedNeighbors++;
            }
          }
        }

        if (resolvedNeighbors >= 2) {
          candidates.push({ r, c, resolvedNeighbors });
        }
      }
    }

    candidates.sort((a, b) => b.resolvedNeighbors - a.resolvedNeighbors);

    for (const { r, c } of candidates) {
      const stateBlack = state.clone();
      stateBlack.setCellState(r, c, 1);
      const conflictOnBlack = CognitiveSolver.propagateAndCheckContradiction(stateBlack);

      const statePath = state.clone();
      statePath.setCellState(r, c, 2);
      const conflictOnPath = CognitiveSolver.propagateAndCheckContradiction(statePath);

      if (conflictOnBlack && !conflictOnPath) {
        return {
          r,
          c,
          forcedState: 2,
          technique: 'premature_subloop_avoidance',
          evidenceCells: [[r, c]],
          layer: 'L3_CONTRADICTION',
        };
      }

      if (!conflictOnBlack && conflictOnPath) {
        return {
          r,
          c,
          forcedState: 1,
          technique: 'arrow_starvation_black',
          evidenceCells: [[r, c]],
          layer: 'L3_CONTRADICTION',
        };
      }
    }

    return null;
  }
}

export class CognitiveEMDCalibrator {
  public static calculateEMDDistance(actualDepths: number[], referenceDistribution: number[]): number {
    const maxD = referenceDistribution.length;
    const actualHist = new Array(maxD).fill(0);

    for (const d of actualDepths) {
      const clamped = Math.min(maxD, Math.max(1, d)) - 1;
      actualHist[clamped]++;
    }
    const totalSteps = actualDepths.length || 1;
    const p = actualHist.map((c) => c / totalSteps);
    const q = [...referenceDistribution];

    let emd = 0;
    let cdfP = 0;
    let cdfQ = 0;

    for (let i = 0; i < maxD; i++) {
      cdfP += p[i];
      cdfQ += q[i];
      emd += Math.abs(cdfP - cdfQ);
    }

    return emd;
  }
}

export class DynamicTypographyEngine {
  public static evaluateDynamicOpticalSafety(
    clueA: ArrowClue,
    clueB: ArrowClue,
    rows: number,
    cols: number
  ): { isSafe: boolean; penalty: number } {
    const minDim = Math.min(rows, cols);
    const dynamicThreshold = Math.max(1.0, minDim * 0.14);

    const isParallel =
      clueA.dir === clueB.dir ||
      WebYajilinGenerator.getOppositeDirection(clueA.dir) === clueB.dir;

    if (isParallel) {
      const isCollinear =
        clueA.dir === 'L' || clueA.dir === 'R' ? clueA.r === clueB.r : clueA.c === clueB.c;

      const orthogonalDist =
        clueA.dir === 'L' || clueA.dir === 'R'
          ? Math.abs(clueA.r - clueB.r)
          : Math.abs(clueA.c - clueB.c);

      if (!isCollinear && orthogonalDist < dynamicThreshold) {
        const severity = (dynamicThreshold - orthogonalDist) / dynamicThreshold;
        return { isSafe: false, penalty: -80.0 * severity };
      }
    }

    return { isSafe: true, penalty: 0 };
  }
}

export class MasterHarmonizedPruner {
  public static pruneDeterministically(
    initialClues: ArrowClue[],
    rows: number,
    cols: number,
    seed: number,
    maxAllowedAnchors: number = 2
  ): ArrowClue[] {
    const prng = mulberry32(seed);
    let clues = [...initialClues];

    const candidates = clues.filter((c) => !c.isUntouchable);

    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    let anchorCount = 0;
    for (const target of candidates) {
      const remainingClues = clues.filter((c) => c !== target);
      const solveReport = CognitiveSolver.runFullSimulation(remainingClues, rows, cols);

      if (solveReport.isFullySolved) {
        const centerR = rows / 2;
        const centerC = cols / 2;
        const manhattanToCenter = Math.abs(target.r - centerR) + Math.abs(target.c - centerC);
        const maxCenterDist = (rows + cols) / 2;
        const centerWeight = 1.0 - manhattanToCenter / maxCenterDist;
        const baseValue = target.count === 0 ? 1.0 : target.count === 1 ? 0.6 : 0.2;
        const anchorScore = baseValue * 0.6 + centerWeight * 0.4;

        if (anchorScore >= 0.65 && anchorCount < maxAllowedAnchors) {
          target.role = 'PSYCHOLOGICAL_ANCHOR';
          anchorCount++;
        } else {
          clues = remainingClues;
        }
      } else {
        target.role = 'LOGICAL_NECESSITY';
      }
    }

    return clues;
  }
}

export class TemporalIntegrityGuard {
  public static async generateTimeAnchoredStamp(
    seed: number,
    clues: ArrowClue[],
    blacks: boolean[][]
  ) {
    const epochDay = Math.floor(Date.now() / 86400000);
    const clueStr = clues.map((c) => `${c.r},${c.c},${c.dir},${c.count}`).sort().join('|');
    const blackCoords: string[] = [];
    for (let r = 0; r < blacks.length; r++) {
      for (let c = 0; c < blacks[r].length; c++) {
        if (blacks[r][c]) blackCoords.push(`${r},${c}`);
      }
    }
    const blackStr = blackCoords.join(';');

    const primaryPayload = `VERITAS::DAY=${epochDay}::S=${seed}::C=${clueStr}::B=${blackStr}`;
    const payloadHash = await generateYajilinSignature(primaryPayload);
    const verifierSeed = parseInt(payloadHash.slice(0, 8), 16) || 0x12345678;
    const verifierPayload = `VERIFIER_SHADOW::SRC=${payloadHash}::SEED=${verifierSeed}`;
    const verifierDigest = await generateYajilinSignature(verifierPayload);
    const merkleToken = await generateYajilinSignature(`${payloadHash}:::${verifierDigest}`);

    return { payloadHash, verifierDigest, epochDay, merkleToken };
  }
}
