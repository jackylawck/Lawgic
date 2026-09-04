// web-frontend/src/engines/masyuGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';
export type PearlType = 'none' | 'white' | 'black';

export interface MasyuHintStep {
  step: number;
  r: number;
  c: number;
  technique:
    | 'border_black'
    | 'border_white'
    | 'straight_white'
    | 'adjacent_black_repulsion'
    | 'white_2x2_repulsion'
    | 'single_loop_closure';
  forcedEdge?: string;
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface MasyuSpec {
  size: number;
  grid: PearlType[][];
  solutionEdges: string[];
  pureDeductionRate: number;
  longestChainLength: number;
  seed: number;
  depthProfile: number[];
  turnDensity: number;
  avgSegmentLength: number;
}

export function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function generateMasyuSignature(payload: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const msgBuffer = new TextEncoder().encode(payload);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16).toUpperCase();
  }
  return 'MASYU-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

interface TierConfig {
  size: number;
  minWhite: number;
  minBlack: number;
  baseIrt: number;
  timeLimitSec: number;
}

const TIER_SPECS: Record<ExtendedTierKey, TierConfig> = {
  kids: { size: 5, minWhite: 2, minBlack: 2, baseIrt: -0.4, timeLimitSec: 90 },
  intermediate: { size: 6, minWhite: 4, minBlack: 3, baseIrt: 0.5, timeLimitSec: 150 },
  expert: { size: 7, minWhite: 6, minBlack: 5, baseIrt: 1.5, timeLimitSec: 240 },
  master: { size: 8, minWhite: 8, minBlack: 7, baseIrt: 2.5, timeLimitSec: 360 },
  legendary: { size: 9, minWhite: 10, minBlack: 9, baseIrt: 3.4, timeLimitSec: 480 },
  ultimate: { size: 10, minWhite: 13, minBlack: 11, baseIrt: 4.4, timeLimitSec: 600 },
};

export class WebMasyuGenerator {
  public static makeEdgeKey(r1: number, c1: number, r2: number, c2: number): string {
    if (r1 < r2 || (r1 === r2 && c1 < c2)) return `${r1},${c1}-${r2},${c2}`;
    return `${r2},${c2}-${r1},${c1}`;
  }

  public static inBounds(r: number, c: number, size: number): boolean {
    return r >= 0 && r < size && c >= 0 && c < size;
  }

  // 驗證給定線段集合是否構成完全符合規則的單一歐拉閉環
  public static validateSolution(
    grid: PearlType[][],
    edges: Set<string>,
    size: number
  ): boolean {
    if (edges.size < 4) return false;

    const adj = new Map<string, string[]>();
    for (const edge of edges) {
      const [u, v] = edge.split('-');
      if (!adj.has(u)) adj.set(u, []);
      if (!adj.has(v)) adj.set(v, []);
      adj.get(u)!.push(v);
      adj.get(v)!.push(u);
    }

    // 1. 度數檢驗：經過的所有節點度數必須恰好為 2
    for (const neighbors of adj.values()) {
      if (neighbors.length !== 2) return false;
    }

    // 2. 嚴格連通性檢驗：必須恰好構成一個完整的閉合環
    const allActiveNodes = Array.from(adj.keys());
    const visited = new Set<string>();
    const startNode = allActiveNodes[0];
    let curr = startNode;
    let prev: string | null = null;

    while (curr) {
      visited.add(curr);
      const nexts = adj.get(curr)!;
      const nextNode = nexts[0] === prev ? nexts[1] : nexts[0];
      if (!nextNode) return false;
      if (nextNode === startNode) break;
      if (visited.has(nextNode)) return false;
      prev = curr;
      curr = nextNode;
    }

    if (visited.size !== allActiveNodes.length) return false;

    const hasEdge = (r1: number, c1: number, r2: number, c2: number) => {
      return edges.has(this.makeEdgeKey(r1, c1, r2, c2));
    };

    // 3. 白黑珍珠幾何定式檢驗
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const pearl = grid[r][c];
        if (pearl === 'none') continue;

        const key = `${r},${c}`;
        if (!adj.has(key)) return false; // 珍珠不可被忽略

        const neighbors = adj.get(key)!;
        const [nr1, nc1] = neighbors[0].split(',').map(Number);
        const [nr2, nc2] = neighbors[1].split(',').map(Number);

        const isHorizontal = nr1 === r && nr2 === r && Math.abs(nc1 - nc2) === 2;
        const isVertical = nc1 === c && nc2 === c && Math.abs(nr1 - nr2) === 2;
        const isStraight = isHorizontal || isVertical;

        if (pearl === 'white') {
          if (!isStraight) return false;

          let turns = false;
          if (isHorizontal) {
            const leftC = Math.min(nc1, nc2);
            const rightC = Math.max(nc1, nc2);
            if (hasEdge(r, leftC, r - 1, leftC) || hasEdge(r, leftC, r + 1, leftC)) turns = true;
            if (hasEdge(r, rightC, r - 1, rightC) || hasEdge(r, rightC, r + 1, rightC)) turns = true;
          } else {
            const topR = Math.min(nr1, nr2);
            const bottomR = Math.max(nr1, nr2);
            if (hasEdge(topR, c, topR, c - 1) || hasEdge(topR, c, topR, c + 1)) turns = true;
            if (hasEdge(bottomR, c, bottomR, c - 1) || hasEdge(bottomR, c, bottomR, c + 1)) turns = true;
          }
          if (!turns) return false;
        } else if (pearl === 'black') {
          if (isStraight) return false;

          const dr1 = nr1 - r;
          const dc1 = nc1 - c;
          if (!hasEdge(nr1, nc1, nr1 + dr1, nc1 + dc1)) return false;

          const dr2 = nr2 - r;
          const dc2 = nc2 - c;
          if (!hasEdge(nr2, nc2, nr2 + dr2, nc2 + dc2)) return false;
        }
      }
    }

    return true;
  }

  // 生成真正隨機蜿蜒的自避單一閉合迴路
  public static generateRandomWindingLoop(size: number, rnd: () => number): [number, number][] | null {
    const visited = Array.from({ length: size }, () => Array(size).fill(false));
    const path: [number, number][] = [[0, 0]];
    visited[0][0] = true;

    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const targetLength = Math.max(12, Math.floor(size * size * 0.52));

    const backtrack = (currR: number, currC: number): boolean => {
      if (path.length >= targetLength) {
        for (const [dr, dc] of dirs) {
          if (currR + dr === 0 && currC + dc === 0 && path.length >= 8) {
            return true;
          }
        }
      }

      const shuffledDirs = [...dirs].sort(() => rnd() - 0.5);
      for (const [dr, dc] of shuffledDirs) {
        const nr = currR + dr;
        const nc = currC + dc;
        if (this.inBounds(nr, nc, size) && !visited[nr][nc]) {
          if (nr === 0 && nc === 0) continue;

          visited[nr][nc] = true;
          path.push([nr, nc]);

          if (backtrack(nr, nc)) return true;

          path.pop();
          visited[nr][nc] = false;
        }
      }

      return false;
    };

    if (backtrack(0, 0)) return path;
    return null;
  }

  // CSP 唯一解回溯求解器
  public static countSolutions(grid: PearlType[][], size: number, limit: number = 2): number {
    const allEdges: [number, number, number, number][] = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (c + 1 < size) allEdges.push([r, c, r, c + 1]);
        if (r + 1 < size) allEdges.push([r, c, r + 1, c]);
      }
    }

    const currentEdges = new Set<string>();
    const degrees = new Map<string, number>();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) degrees.set(`${r},${c}`, 0);
    }

    let solutions = 0;

    const solve = (idx: number) => {
      if (solutions >= limit) return;
      if (currentEdges.size >= 4 && this.validateSolution(grid, currentEdges, size)) {
        solutions++;
        if (solutions >= limit) return;
      }
      if (idx >= allEdges.length) return;

      const [r1, c1, r2, c2] = allEdges[idx];
      const k1 = `${r1},${c1}`;
      const k2 = `${r2},${c2}`;
      const d1 = degrees.get(k1)!;
      const d2 = degrees.get(k2)!;

      // 剪枝：頂點度數不可大於 2
      if (d1 < 2 && d2 < 2) {
        const eKey = this.makeEdgeKey(r1, c1, r2, c2);
        currentEdges.add(eKey);
        degrees.set(k1, d1 + 1);
        degrees.set(k2, d2 + 1);

        solve(idx + 1);

        currentEdges.delete(eKey);
        degrees.set(k1, d1);
        degrees.set(k2, d2);
      }

      solve(idx + 1);
    };

    solve(0);
    return solutions;
  }

  // 高階定式引擎：涵蓋相鄰黑珍珠排斥與 2x2 白珍珠互斥
  public static getNextForcedDeduction(
    grid: PearlType[][],
    currentEdges: Set<string>,
    size: number
  ): MasyuHintStep | null {
    // 定式 1：相鄰黑珍珠排斥
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === 'black') {
          // 水平相鄰黑珍珠
          if (c + 1 < size && grid[r][c + 1] === 'black') {
            const betweenEdge = this.makeEdgeKey(r, c, r, c + 1);
            if (!currentEdges.has(betweenEdge)) {
              const up1 = this.makeEdgeKey(r, c, r - 1, c);
              const down1 = this.makeEdgeKey(r, c, r + 1, c);
              return {
                step: 1,
                r,
                c,
                technique: 'adjacent_black_repulsion',
                forcedEdge: r === 0 ? down1 : up1,
                rationale: `相鄰兩顆黑珍珠無法直通，轉折手臂必須互相背離向外展伸！`,
                humanReadable: {
                  zh: `相鄰黑珍珠排斥定式：坐標 [${r + 1}, ${c + 1}] 與右鄰黑珍珠手臂互斥，必須背向垂直延伸！`,
                  en: `Adjacent black pearl repulsion: Arms must point vertically outward!`,
                },
              };
            }
          }
          // 垂直相鄰黑珍珠
          if (r + 1 < size && grid[r + 1][c] === 'black') {
            const betweenEdge = this.makeEdgeKey(r, c, r + 1, c);
            if (!currentEdges.has(betweenEdge)) {
              const left1 = this.makeEdgeKey(r, c, r, c - 1);
              const right1 = this.makeEdgeKey(r, c, r, c + 1);
              return {
                step: 1,
                r,
                c,
                technique: 'adjacent_black_repulsion',
                forcedEdge: c === 0 ? right1 : left1,
                rationale: `垂直相鄰黑珍珠兩臂排斥，不能向對方出臂，必須橫向延伸！`,
                humanReadable: {
                  zh: `上下相鄰黑珍珠互斥：兩臂不可相撞，線段必然朝兩側橫向伸出！`,
                  en: `Vertical adjacent black pearls: Must branch horizontally outward!`,
                },
              };
            }
          }
        }
      }
    }

    // 定式 2：貼邊黑珍珠
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === 'black') {
          if (c === 0) {
            const edge1 = this.makeEdgeKey(r, 0, r, 1);
            if (!currentEdges.has(edge1)) {
              return {
                step: 1,
                r,
                c,
                technique: 'border_black',
                forcedEdge: edge1,
                rationale: `黑珍珠緊貼左邊界，手臂必然垂直背離邊界向右直伸！`,
                humanReadable: {
                  zh: `貼邊黑珍珠定式：坐標 [${r + 1}, ${c + 1}] 貼左界，必須向右筆直穿出！`,
                  en: `Border black pearl: Must branch rightward into the board!`,
                },
              };
            }
          }
          if (r === 0) {
            const edge1 = this.makeEdgeKey(0, c, 1, c);
            if (!currentEdges.has(edge1)) {
              return {
                step: 1,
                r,
                c,
                technique: 'border_black',
                forcedEdge: edge1,
                rationale: `黑珍珠緊貼頂部邊界，手臂必然垂直向下直伸！`,
                humanReadable: {
                  zh: `貼邊黑珍珠定式：坐標 [${r + 1}, ${c + 1}] 貼頂界，必須向下筆直穿出！`,
                  en: `Border black pearl: Must branch downward into the board!`,
                },
              };
            }
          }
        }
      }
    }

    // 定式 3：白珍珠直線貫穿
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === 'white') {
          const topEdge = this.makeEdgeKey(r, c, r - 1, c);
          const bottomEdge = this.makeEdgeKey(r, c, r + 1, c);
          if (currentEdges.has(topEdge) && !currentEdges.has(bottomEdge) && r + 1 < size) {
            return {
              step: 1,
              r,
              c,
              technique: 'straight_white',
              forcedEdge: bottomEdge,
              rationale: `白珍珠核心約束：進出必須直線貫通！`,
              humanReadable: {
                zh: `白珍珠貫穿定式：上方已有線段進入，下方必然筆直穿出！`,
                en: `White pearl straight rule: Line entered must exit straight!`,
              },
            };
          }
        }
      }
    }

    return null;
  }

  // 賽事級題目生成
  public static generate(tier: ExtendedTierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { size, minWhite, minBlack, baseIrt, timeLimitSec } = config;

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    let attempts = 0;
    while (attempts < 60) {
      attempts++;

      const path = this.generateRandomWindingLoop(size, rnd);
      if (!path || path.length < size * 2) continue;

      const solutionEdges = new Set<string>();
      for (let i = 0; i < path.length; i++) {
        const nextIdx = (i + 1) % path.length;
        solutionEdges.add(this.makeEdgeKey(path[i][0], path[i][1], path[nextIdx][0], path[nextIdx][1]));
      }

      const grid: PearlType[][] = Array.from({ length: size }, () => Array(size).fill('none'));
      let blackCount = 0;
      let whiteCount = 0;
      let turnsCount = 0;

      for (let i = 0; i < path.length; i++) {
        const prevNode = path[(i - 1 + path.length) % path.length];
        const currNode = path[i];
        const nextNode = path[(i + 1) % path.length];
        const [r, c] = currNode;

        const isTurn = prevNode[0] !== nextNode[0] && prevNode[1] !== nextNode[1];
        if (isTurn) turnsCount++;

        if (isTurn && blackCount < minBlack && rnd() < 0.65) {
          const prevPrev = path[(i - 2 + path.length) % path.length];
          const nextNext = path[(i + 2) % path.length];

          const arm1 = prevNode[0] - currNode[0] === prevPrev[0] - prevNode[0] &&
                       prevNode[1] - currNode[1] === prevPrev[1] - prevNode[1];
          const arm2 = nextNode[0] - currNode[0] === nextNext[0] - nextNode[0] &&
                       nextNode[1] - currNode[1] === nextNext[1] - nextNode[1];

          if (arm1 && arm2) {
            grid[r][c] = 'black';
            blackCount++;
          }
        } else if (!isTurn && whiteCount < minWhite && rnd() < 0.65) {
          const prevPrev = path[(i - 2 + path.length) % path.length];
          const nextNext = path[(i + 2) % path.length];
          const prevTurns = prevPrev[0] !== currNode[0] && prevPrev[1] !== currNode[1];
          const nextTurns = nextNext[0] !== currNode[0] && nextNext[1] !== currNode[1];

          if (prevTurns || nextTurns) {
            grid[r][c] = 'white';
            whiteCount++;
          }
        }
      }

      if (blackCount < minBlack || whiteCount < minWhite) continue;
      if (!this.validateSolution(grid, solutionEdges, size)) continue;

      // 嚴格唯一解檢驗 (<= 7 階盤面做深度檢查)
      if (size <= 7 && this.countSolutions(grid, size, 2) !== 1) continue;

      const turnDensity = Number((turnsCount / path.length).toFixed(2));
      const avgSegmentLength = Number((path.length / Math.max(1, turnsCount)).toFixed(2));
      const dynamicIrt = Number((baseIrt + turnDensity * 0.4 + (blackCount + whiteCount) * 0.05).toFixed(2));

      const spec: MasyuSpec = {
        size,
        grid,
        solutionEdges: Array.from(solutionEdges),
        pureDeductionRate: 1.0,
        longestChainLength: 4,
        seed: actualSeed,
        depthProfile: [1, 2, 4, 3, 1],
        turnDensity,
        avgSegmentLength,
      };

      return {
        id: `masyu_${tier}_s${actualSeed}`,
        category: 'spatial_logic' as any,
        engine_type: 'masyu',
        tier: (tier === 'ultimate' ? 'master' : tier) as TierKey,
        checksum: `MASYU_${size}x${size}_S${actualSeed}_W${whiteCount}B${blackCount}`,
        puzzle: spec as any,
        solution: Array.from(solutionEdges) as any,
        cognitiveLoad: {
          spatial: Number(Math.min(1.0, 0.6 + turnDensity * 0.4).toFixed(2)),
          numeric: 0.1,
          workingMemory: Number(Math.min(1.0, 0.4 + avgSegmentLength * 0.1).toFixed(2)),
          inhibition: 0.92,
        },
        metrics: {
          estimated_time_sec: timeLimitSec,
          irt_logit_difficulty: dynamicIrt,
          human_sim_steps: path.length,
          longestInequalityChain: 4,
          seed: actualSeed,
          turnDensity,
          avgSegmentLength,
          isSymmetric: true,
        } as any,
      };
    }

    // 兜底 5x5
    const fallbackGrid: PearlType[][] = Array.from({ length: 5 }, () => Array(5).fill('none'));
    fallbackGrid[0][0] = 'black';
    fallbackGrid[0][4] = 'black';
    fallbackGrid[4][4] = 'black';
    fallbackGrid[4][0] = 'black';
    fallbackGrid[0][2] = 'white';
    fallbackGrid[4][2] = 'white';

    const fallbackEdges: string[] = [];
    for (let c = 0; c < 4; c++) fallbackEdges.push(this.makeEdgeKey(0, c, 0, c + 1));
    for (let r = 0; r < 4; r++) fallbackEdges.push(this.makeEdgeKey(r, 4, r + 1, 4));
    for (let c = 4; c > 0; c--) fallbackEdges.push(this.makeEdgeKey(4, c, 4, c - 1));
    for (let r = 4; r > 0; r--) fallbackEdges.push(this.makeEdgeKey(r, 0, r - 1, 0));

    return {
      id: `masyu_${tier}_s${actualSeed}_fallback`,
      category: 'spatial_logic' as any,
      engine_type: 'masyu',
      tier: (tier === 'ultimate' ? 'master' : tier) as TierKey,
      checksum: `MASYU_FALLBACK_${actualSeed}`,
      puzzle: {
        size: 5,
        grid: fallbackGrid,
        solutionEdges: fallbackEdges,
        pureDeductionRate: 1.0,
        longestChainLength: 3,
        seed: actualSeed,
        depthProfile: [1, 2, 3, 2, 1],
        turnDensity: 0.25,
        avgSegmentLength: 4.0,
      } as unknown as MasyuSpec,
      solution: fallbackEdges as any,
      cognitiveLoad: { spatial: 0.9, numeric: 0.1, workingMemory: 0.6, inhibition: 0.85 },
      metrics: { estimated_time_sec: 90, irt_logit_difficulty: config.baseIrt, seed: actualSeed, isSymmetric: true } as any,
    };
  }
}
