// web-frontend/src/engines/slitherlinkGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey;
export type EdgeType = 'h' | 'v';
export type EdgeState = 0 | 1 | 2; // 0: 未決, 1: 實線, 2: 標叉 (x)

export type SlitherDeductionType =
  | 'zero_cross'
  | 'corner_three'
  | 'corner_one_two'
  | 'adjacent_threes'
  | 'one_three_conflict'
  | 'chain_of_twos'
  | 'diagonal_twos'
  | 'diagonal_30'
  | 'degree_extension'
  | 'degree_saturation'
  | 'premature_avoidance'
  | 'hypothesis_contradiction'
  | 'clue_completion';

export type CognitiveDomain = 'candidate' | 'geometric' | 'topological' | 'hypothetical';

export const TECHNIQUE_DOMAINS: Record<SlitherDeductionType, CognitiveDomain> = {
  zero_cross: 'candidate',
  clue_completion: 'candidate',
  corner_three: 'geometric',
  corner_one_two: 'geometric',
  adjacent_threes: 'geometric',
  one_three_conflict: 'geometric',
  diagonal_30: 'geometric',
  chain_of_twos: 'geometric',
  diagonal_twos: 'geometric',
  degree_extension: 'topological',
  degree_saturation: 'topological',
  premature_avoidance: 'topological',
  hypothesis_contradiction: 'hypothetical',
};

export const TECHNIQUE_WEIGHTS: Record<SlitherDeductionType, number> = {
  zero_cross: 1,
  clue_completion: 2,
  degree_saturation: 2,
  degree_extension: 3,
  corner_one_two: 5,
  corner_three: 4,
  adjacent_threes: 6,
  one_three_conflict: 7,
  diagonal_30: 8,
  chain_of_twos: 9,
  diagonal_twos: 9,
  premature_avoidance: 10,
  hypothesis_contradiction: 16,
};

export const TECHNIQUE_I18N: Record<string, { zh: string; en: string; ja: string; de: string }> = {
  zero_cross: { zh: '零線標叉', en: 'Zero Cross', ja: 'ゼロ交差', de: 'Null-Kreuz' },
  corner_three: { zh: '角落線索 3', en: 'Corner 3', ja: '角の3定石', de: 'Ecken-3' },
  corner_one_two: { zh: '角落幾何約束', en: 'Corner Constraint', ja: '角の幾何制約', de: 'Ecken-Bedingung' },
  adjacent_threes: { zh: '相鄰雙 3 平行線', en: 'Adjacent 3-3', ja: '隣接ダブル3', de: 'Benachbarte 3-3' },
  one_three_conflict: { zh: '1-3 相鄰互斥', en: '1-3 Conflict', ja: '1-3 隣接排他', de: '1-3 Konflikt' },
  diagonal_twos: { zh: '對角雙 2 排斥', en: 'Diagonal 2-2', ja: '対角ダブル2', de: 'Diagonale 2-2' },
  diagonal_30: { zh: '斜對角 3-0 排斥', en: 'Diagonal 3-0 Lock', ja: '斜め3-0ロック', de: 'Diagonale 3-0' },
  degree_saturation: { zh: '頂點度數飽和', en: 'Degree Saturation', ja: '頂点次数飽和', de: 'Knotengrad-Sättigung' },
  degree_extension: { zh: '防斷頭延伸', en: 'Loop Extension', ja: 'ループ延伸', de: 'Schleifen-Verlängerung' },
  premature_avoidance: { zh: '防早熟閉環死鎖', en: 'Premature Loop Defense', ja: '早熟閉環回避', de: 'Anti-Subschleife' },
  hypothesis_contradiction: { zh: '長鏈反證矛盾', en: 'Proof by Contradiction', ja: '背理法矛盾', de: 'Widerspruchsbeweis' },
  clue_completion: { zh: '單元格線索收斂', en: 'Clue Completion', ja: 'ヒント確定収束', de: 'Hinweis-Abschluss' },
};

export interface SlitherEdge {
  type: EdgeType;
  r: number;
  c: number;
}

export interface ContradictionNode {
  edge: SlitherEdge;
  assumedState: 1 | 2;
  step: number;
  reason: string;
}

export interface SlitherStep {
  step: number;
  type: SlitherDeductionType;
  edge: SlitherEdge;
  state: 1 | 2;
  complexityWeight: number;
  candidateFanOut: number;
  rationale: string;
  isTrial?: boolean;
  contradictionChain?: ContradictionNode[];
  contradictionDepth?: number;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface SlitherlinkHintStep {
  step: number;
  type: 'H' | 'V';
  r: number;
  c: number;
  forcedState: EdgeState;
  technique: SlitherDeductionType | string;
  evidenceCells: [number, number][];
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface WpcDiagnosticReport {
  pureRate: number;
  diversityIndex: number;
  strictlyOrdered: boolean;
  meanFanOut: number;
  stdDevFanOut: number;
  startingAnchorCount: number;
  maxContradictionDepth: number;
  spatialEntropy: number;
  humanTraceabilityScore: number;
  techniqueCategories: Record<CognitiveDomain, number>;
  cognitiveInflectionPoints: { step: number; fromDomain: CognitiveDomain; toDomain: CognitiveDomain; technique: string }[];
  wpcGrade: 'S' | 'A' | 'B' | 'C';
  wpcCommentZh: string;
  mentalTemplate: {
    openingGambit: string;
    midgameTheme: string;
    climaxLocation: string;
    closingSequence: string;
  };
}

export interface SlitherlinkSpec {
  rows: number;
  cols: number;
  clues: (number | null)[][];
  grid?: (number | null)[][];
  solutionH: boolean[][];
  solutionV: boolean[][];
  solvingSteps: SlitherStep[];
  maxForcedChain: number;
  pureDeductionRate: number;
  topologicalEntropy: number;
  isSymmetric180: boolean;
  tier: TierKey;
  seed: number;
  wpcReport: WpcDiagnosticReport;
}

interface TierConfig {
  rows: number;
  cols: number;
  clueRemovalRate: number;
  minTechniqueWeight: number;
  allowSymmetry: boolean;
  baseIrt: number;
  timeLimitSec: number;
}

const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { rows: 4, cols: 4, clueRemovalRate: 0.15, minTechniqueWeight: 10, allowSymmetry: true, baseIrt: 0.65, timeLimitSec: 90 },
  intermediate: { rows: 5, cols: 5, clueRemovalRate: 0.28, minTechniqueWeight: 22, allowSymmetry: true, baseIrt: 1.45, timeLimitSec: 150 },
  expert: { rows: 6, cols: 6, clueRemovalRate: 0.38, minTechniqueWeight: 45, allowSymmetry: false, baseIrt: 2.35, timeLimitSec: 240 },
  master: { rows: 7, cols: 7, clueRemovalRate: 0.46, minTechniqueWeight: 70, allowSymmetry: false, baseIrt: 3.15, timeLimitSec: 360 },
  legendary: { rows: 8, cols: 8, clueRemovalRate: 0.52, minTechniqueWeight: 100, allowSymmetry: false, baseIrt: 3.75, timeLimitSec: 480 },
  ultimate: { rows: 10, cols: 10, clueRemovalRate: 0.58, minTechniqueWeight: 140, allowSymmetry: false, baseIrt: 4.35, timeLimitSec: 600 },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class FastVertexDSU {
  parent: Int32Array;
  size: Int32Array;

  constructor(n: number) {
    this.parent = new Int32Array(n);
    this.size = new Int32Array(n).fill(1);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }

  find(i: number): number {
    let root = i;
    while (root !== this.parent[root]) root = this.parent[root];
    let curr = i;
    while (curr !== root) {
      const nxt = this.parent[curr];
      this.parent[curr] = root;
      curr = nxt;
    }
    return root;
  }

  union(i: number, j: number): boolean {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI === rootJ) return false;
    if (this.size[rootI] < this.size[rootJ]) {
      this.parent[rootI] = rootJ;
      this.size[rootJ] += this.size[rootI];
    } else {
      this.parent[rootJ] = rootI;
      this.size[rootI] += this.size[rootJ];
    }
    return true;
  }
}

export class WebSlitherlinkGenerator {
  public static isStrictSingleLoop(
    hEdges: boolean[][],
    vEdges: boolean[][],
    rows: number,
    cols: number
  ): boolean {
    const ptCols = cols + 1;
    const pointDegree = new Uint8Array((rows + 1) * ptCols);
    let totalEdges = 0;

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (hEdges[r]?.[c]) {
          pointDegree[r * ptCols + c]++;
          pointDegree[r * ptCols + c + 1]++;
          totalEdges++;
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        if (vEdges[r]?.[c]) {
          pointDegree[r * ptCols + c]++;
          pointDegree[(r + 1) * ptCols + c]++;
          totalEdges++;
        }
      }
    }

    if (totalEdges < 4) return false;

    let startR = -1;
    let startC = -1;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const deg = pointDegree[r * ptCols + c];
        if (deg !== 0 && deg !== 2) return false;
        if (deg === 2 && startR === -1) {
          startR = r;
          startC = c;
        }
      }
    }

    if (startR === -1) return false;

    let visitedEdges = 0;
    let currR = startR;
    let currC = startC;
    let prevR = -1;
    let prevC = -1;

    while (visitedEdges < totalEdges) {
      const neighbors: [number, number, boolean][] = [
        [currR, currC - 1, currC > 0 && !!hEdges[currR]?.[currC - 1]],
        [currR, currC + 1, currC < cols && !!hEdges[currR]?.[currC]],
        [currR - 1, currC, currR > 0 && !!vEdges[currR - 1]?.[currC]],
        [currR + 1, currC, currR < rows && !!vEdges[currR]?.[currC]],
      ];

      let found = false;
      for (let i = 0; i < 4; i++) {
        const [nr, nc, active] = neighbors[i];
        if (active && !(nr === prevR && nc === prevC)) {
          prevR = currR;
          prevC = currC;
          currR = nr;
          currC = nc;
          visitedEdges++;
          found = true;
          break;
        }
      }

      if (!found) break;
      if (currR === startR && currC === startC) break;
    }

    return visitedEdges === totalEdges;
  }

  public static verifySingleLoop(
    rows: number,
    cols: number,
    hEdges: boolean[][],
    vEdges: boolean[][]
  ): boolean {
    return this.isStrictSingleLoop(hEdges, vEdges, rows, cols);
  }

  private static generateOrganicValidLoop(
    rows: number,
    cols: number,
    isSymmetric: boolean,
    rnd: () => number
  ): { hEdges: boolean[][]; vEdges: boolean[][] } {
    const inside: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
    const halfR = Math.floor(rows / 2);

    for (let r = 0; r < rows; r++) {
      const fillAll = r % 2 === 0;
      for (let c = 0; c < cols; c++) {
        if (fillAll || (r < halfR ? c === 0 : c === cols - 1)) {
          inside[r][c] = true;
        }
      }
    }

    if (isSymmetric) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (inside[r][c]) inside[rows - 1 - r][cols - 1 - c] = true;
        }
      }
    }

    const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let mutations = 0;
    while (mutations++ < 140) {
      const r = Math.floor(rnd() * rows);
      const c = Math.floor(rnd() * cols);

      let diagConflict = false;
      const diagOffsets: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      for (let i = 0; i < 4; i++) {
        const [dr, dc] = diagOffsets[i];
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          if (inside[nr][nc] !== inside[r][c] && inside[r + dr][c] === inside[r][c] && inside[r][c + dc] === inside[r][c]) {
            diagConflict = true;
            break;
          }
        }
      }

      if (!diagConflict) {
        const hasAdj = dirs.some(([dr, dc]) => {
          const nr = r + dr;
          const nc = c + dc;
          return nr >= 0 && nr < rows && nc >= 0 && nc < cols && inside[nr][nc] !== inside[r][c];
        });

        if (hasAdj) {
          inside[r][c] = !inside[r][c];
          if (isSymmetric) {
            inside[rows - 1 - r][cols - 1 - c] = inside[r][c];
          }
        }
      }
    }

    const hEdges: boolean[][] = Array.from({ length: rows + 1 }, () => Array(cols).fill(false));
    const vEdges: boolean[][] = Array.from({ length: rows }, () => Array(cols + 1).fill(false));

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        const top = r > 0 ? inside[r - 1][c] : false;
        const bottom = r < rows ? inside[r][c] : false;
        hEdges[r][c] = top !== bottom;
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const left = c > 0 ? inside[r][c - 1] : false;
        const right = c < cols ? inside[r][c] : false;
        vEdges[r][c] = left !== right;
      }
    }

    return { hEdges, vEdges };
  }

  private static extractClues(
    rows: number,
    cols: number,
    hEdges: boolean[][],
    vEdges: boolean[][]
  ): (number | null)[][] {
    const clues: (number | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let count = 0;
        if (hEdges[r]?.[c]) count++;
        if (hEdges[r + 1]?.[c]) count++;
        if (vEdges[r]?.[c]) count++;
        if (vEdges[r]?.[c + 1]) count++;
        clues[r][c] = count;
      }
    }
    return clues;
  }

  public static getStrictDeductions(
    rows: number,
    cols: number,
    clues: (number | null)[][],
    curH: number[][],
    curV: number[][]
  ): Map<string, { edge: SlitherEdge; state: 1 | 2; type: SlitherDeductionType; rationale: string; humanReadable: { zh: string; en: string } }> {
    const deductions = new Map<string, { edge: SlitherEdge; state: 1 | 2; type: SlitherDeductionType; rationale: string; humanReadable: { zh: string; en: string } }>();
    const ptCols = cols + 1;
    const totalVertices = (rows + 1) * ptCols;
    const dsu = new FastVertexDSU(totalVertices);
    const degree = new Uint8Array(totalVertices);

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (curH[r][c] === 1) {
          const u = r * ptCols + c;
          const v = r * ptCols + (c + 1);
          degree[u]++;
          degree[v]++;
          dsu.union(u, v);
        }
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        if (curV[r][c] === 1) {
          const u = r * ptCols + c;
          const v = (r + 1) * ptCols + c;
          degree[u]++;
          degree[v]++;
          dsu.union(u, v);
        }
      }
    }

    let remainingClueDemand = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cl = clues[r][c];
        if (cl !== null) {
          let placed = 0;
          if (curH[r][c] === 1) placed++;
          if (curH[r + 1][c] === 1) placed++;
          if (curV[r][c] === 1) placed++;
          if (curV[r][c + 1] === 1) placed++;
          if (cl > placed) remainingClueDemand += (cl - placed);
        }
      }
    }

    // 定式 1: 嚴格早熟死環防禦 (Premature Avoidance)
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (curH[r][c] === 0) {
          const u = r * ptCols + c;
          const v = r * ptCols + (c + 1);
          if (degree[u] === 1 && degree[v] === 1 && dsu.find(u) === dsu.find(v)) {
            if (remainingClueDemand > 0 || dsu.size[dsu.find(u)] < totalVertices * 0.3) {
              deductions.set(`h_${r}_${c}`, {
                edge: { type: 'h', r, c },
                state: 2,
                type: 'premature_avoidance',
                rationale: '拓撲防早熟閉環定理：其餘線索未完備，此處連線形成死鎖',
                humanReadable: {
                  zh: '防早熟閉環定理：其餘線索未完備，此處連線將形成封閉死環，強制標叉 (x)！',
                  en: 'Anti-subloop theorem: Premature closure while clues remain; must mark cross (x)!',
                },
              });
            }
          }
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        if (curV[r][c] === 0) {
          const u = r * ptCols + c;
          const v = (r + 1) * ptCols + c;
          if (degree[u] === 1 && degree[v] === 1 && dsu.find(u) === dsu.find(v)) {
            if (remainingClueDemand > 0 || dsu.size[dsu.find(u)] < totalVertices * 0.3) {
              deductions.set(`v_${r}_${c}`, {
                edge: { type: 'v', r, c },
                state: 2,
                type: 'premature_avoidance',
                rationale: '拓撲防早熟閉環定理：其餘線索未完備，此處連線形成死鎖',
                humanReadable: {
                  zh: '防早熟閉環定理：其餘線索未完備，此處連線將形成封閉死環，強制標叉 (x)！',
                  en: 'Anti-subloop theorem: Premature closure while clues remain; must mark cross (x)!',
                },
              });
            }
          }
        }
      }
    }

    // 定式 2: 線索 0 周邊標叉
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (clues[r][c] === 0) {
          const checkAdd = (type: EdgeType, er: number, ec: number) => {
            const v = type === 'h' ? curH[er][ec] : curV[er][ec];
            if (v === 0) {
              deductions.set(`${type}_${er}_${ec}`, {
                edge: { type, r: er, c: ec },
                state: 2,
                type: 'zero_cross',
                rationale: '線索 0 四周禁絕任何線段',
                humanReadable: {
                  zh: '線索 0 四周不能有任何線段，必須標記叉號 (x)。',
                  en: 'Zero clue forbids surrounding lines; mark cross (x).',
                },
              });
            }
          };
          checkAdd('h', r, c);
          checkAdd('h', r + 1, c);
          checkAdd('v', r, c);
          checkAdd('v', r, c + 1);
        }
      }
    }

    // 定式 3: 角落 3 定式
    const corners3: [number, number, [EdgeType, number, number][]][] = [
      [0, 0, [['h', 0, 0], ['v', 0, 0]]],
      [0, cols - 1, [['h', 0, cols - 1], ['v', 0, cols]]],
      [rows - 1, 0, [['h', rows, 0], ['v', rows - 1, 0]]],
      [rows - 1, cols - 1, [['h', rows, cols - 1], ['v', rows - 1, cols]]],
    ];

    for (let i = 0; i < 4; i++) {
      const [cr, cc, outerEdges] = corners3[i];
      if (clues[cr][cc] === 3) {
        for (let j = 0; j < outerEdges.length; j++) {
          const [t, er, ec] = outerEdges[j];
          if ((t === 'h' ? curH[er][ec] : curV[er][ec]) === 0) {
            deductions.set(`${t}_${er}_${ec}`, {
              edge: { type: t, r: er, c: ec },
              state: 1,
              type: 'corner_three',
              rationale: '盤面角落線索 3 外側兩邊強制連線',
              humanReadable: {
                zh: '角落線索 3：外側靠邊的兩條軌道必須強制通線！',
                en: 'Corner 3 forces outer border tracks to connect!',
              },
            });
          }
        }
      }
    }

    // 定式 4: 相鄰雙 3
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols && clues[r][c] === 3 && clues[r][c + 1] === 3) {
          const targets: [EdgeType, number, number][] = [
            ['v', r, c],
            ['v', r, c + 1],
            ['v', r, c + 2],
          ];
          for (let i = 0; i < targets.length; i++) {
            const [t, er, ec] = targets[i];
            if ((t === 'h' ? curH[er][ec] : curV[er][ec]) === 0) {
              deductions.set(`${t}_${er}_${ec}`, {
                edge: { type: t, r: er, c: ec },
                state: 1,
                type: 'adjacent_threes',
                rationale: '相鄰雙 3 經典定式：外側與共用邊連線',
                humanReadable: {
                  zh: '相鄰雙 3 經典定式：外側與共用邊必須連線。',
                  en: 'Adjacent 3-3 forces outer and common edges to connect.',
                },
              });
            }
          }
        }
        if (r + 1 < rows && clues[r][c] === 3 && clues[r + 1][c] === 3) {
          const targets: [EdgeType, number, number][] = [
            ['h', r, c],
            ['h', r + 1, c],
            ['h', r + 2, c],
          ];
          for (let i = 0; i < targets.length; i++) {
            const [t, er, ec] = targets[i];
            if ((t === 'h' ? curH[er][ec] : curV[er][ec]) === 0) {
              deductions.set(`${t}_${er}_${ec}`, {
                edge: { type: t, r: er, c: ec },
                state: 1,
                type: 'adjacent_threes',
                rationale: '垂直相鄰雙 3 外側與共用橫邊連線',
                humanReadable: {
                  zh: '垂直相鄰雙 3：外側軌道與共用橫邊必須通線。',
                  en: 'Vertical 3-3 requires outer boundaries and common edge to connect.',
                },
              });
            }
          }
        }
      }
    }

    // 定式 5: 相鄰 1-3 互斥與對偶定式
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols) {
          const c1 = clues[r][c];
          const c2 = clues[r][c + 1];
          if ((c1 === 1 && c2 === 3) || (c1 === 3 && c2 === 1)) {
            const outerV = c1 === 3 ? c : c + 2;
            if (curV[r][c + 1] === 2 && curV[r][outerV] === 0) {
              deductions.set(`v_${r}_${outerV}`, {
                edge: { type: 'v', r, c: outerV },
                state: 1,
                type: 'one_three_conflict',
                rationale: '1-3 相鄰定式：共用邊標叉推動線索 3 外側邊通線',
                humanReadable: {
                  zh: '1 與 3 相鄰：共用邊標叉時，線索 3 外側邊必通！',
                  en: 'Adjacent 1-3: Blocked shared edge forces 3 outer edge.',
                },
              });
            }
          }
        }
      }
    }

    // 定式 6: 對角雙 2 定式 (Diagonal 2-2 Lock)
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (clues[r][c] === 2 && clues[r + 1][c + 1] === 2) {
          if (curH[r][c] === 2 && curV[r + 1][c + 2] === 0) {
            deductions.set(`v_${r + 1}_${c + 2}`, {
              edge: { type: 'v', r: r + 1, c: c + 2 },
              state: 1,
              type: 'diagonal_twos',
              rationale: '對角雙 2 約束：主對角左上外側受阻，右下對偶外邊受迫通線',
              humanReadable: {
                zh: '對角雙 2 定式：左上受阻，右下外側垂直邊必須連線！',
                en: 'Diagonal 2-2: Upper-left blocked forces lower-right outer line.',
              },
            });
          }
          if (curV[r][c] === 2 && curH[r + 2][c + 1] === 0) {
            deductions.set(`h_${r + 2}_${c + 1}`, {
              edge: { type: 'h', r: r + 2, c: c + 1 },
              state: 1,
              type: 'diagonal_twos',
              rationale: '對角雙 2 約束：主對角左側外立邊受阻，底部對偶橫邊必須通線',
              humanReadable: {
                zh: '對角雙 2 定式：左側立邊標叉，底部對偶橫邊強制通線！',
                en: 'Diagonal 2-2: Left vertical blocked forces bottom outer horizontal line.',
              },
            });
          }
        }
        if (clues[r][c + 1] === 2 && clues[r + 1][c] === 2) {
          if (curH[r][c + 1] === 2 && curV[r + 1][c] === 0) {
            deductions.set(`v_${r + 1}_${c}`, {
              edge: { type: 'v', r: r + 1, c },
              state: 1,
              type: 'diagonal_twos',
              rationale: '對角雙 2 約束：副對角右上外側受阻，左下對偶外邊受迫通線',
              humanReadable: {
                zh: '對角雙 2 定式：右上受阻，左下外側垂直邊必須連線！',
                en: 'Diagonal 2-2: Upper-right blocked forces lower-left outer line.',
              },
            });
          }
          if (curV[r][c + 2] === 2 && curH[r + 2][c] === 0) {
            deductions.set(`h_${r + 2}_${c}`, {
              edge: { type: 'h', r: r + 2, c },
              state: 1,
              type: 'diagonal_twos',
              rationale: '對角雙 2 約束：副對角右側外立邊受阻，底部對偶橫邊必須通線',
              humanReadable: {
                zh: '對角雙 2 定式：右側標叉，底部左側橫邊強制通線！',
                en: 'Diagonal 2-2: Right blocked forces bottom-left horizontal line.',
              },
            });
          }
        }
      }
    }

    // 定式 7: 斜對角 3-0 排斥定式
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (clues[r][c] === 3) {
          const diagChecks: [number, number, [EdgeType, number, number][]][] = [
            [r - 1, c - 1, [['h', r + 1, c], ['v', r, c + 1]]],
            [r - 1, c + 1, [['h', r + 1, c], ['v', r, c]]],
            [r + 1, c - 1, [['h', r, c], ['v', r, c + 1]]],
            [r + 1, c + 1, [['h', r, c], ['v', r, c]]],
          ];
          for (let d = 0; d < 4; d++) {
            const [or, oc, farEdges] = diagChecks[d];
            if (or >= 0 && or < rows && oc >= 0 && oc < cols && clues[or][oc] === 0) {
              for (let fe = 0; fe < farEdges.length; fe++) {
                const [ft, fr, fc] = farEdges[fe];
                if ((ft === 'h' ? curH[fr][fc] : curV[fr][fc]) === 0) {
                  deductions.set(`${ft}_${fr}_${fc}`, {
                    edge: { type: ft, r: fr, c: fc },
                    state: 1,
                    type: 'diagonal_30',
                    rationale: '斜對角 3-0 排斥定式：遠離 0 的兩條外側邊必須連線',
                    humanReadable: {
                      zh: '3 與 0 對角相鄰：遠離 0 的兩條外側邊必須連線！',
                      en: 'Diagonal 3-0 forces opposite outer edges to connect.',
                    },
                  });
                }
              }
            }
          }
        }
      }
    }

    // 定式 8: 頂點度數飽和與延伸
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const edges: { type: EdgeType; er: number; ec: number; val: number }[] = [];
        if (c > 0) edges.push({ type: 'h', er: r, ec: c - 1, val: curH[r][c - 1] });
        if (c < cols) edges.push({ type: 'h', er: r, ec: c, val: curH[r][c] });
        if (r > 0) edges.push({ type: 'v', er: r - 1, ec: c, val: curV[r - 1][c] });
        if (r < rows) edges.push({ type: 'v', er: r, ec: c, val: curV[r][c] });

        const activeCount = edges.filter((e) => e.val === 1).length;
        if (activeCount === 2) {
          for (let i = 0; i < edges.length; i++) {
            const e = edges[i];
            if (e.val === 0) {
              deductions.set(`${e.type}_${e.er}_${e.ec}`, {
                edge: { type: e.type, r: e.er, c: e.ec },
                state: 2,
                type: 'degree_saturation',
                rationale: '頂點度數已滿 (2)，其餘分支邊標叉',
                humanReadable: {
                  zh: '交叉點已有兩條線進出，其餘方向必須標記叉號 (x)。',
                  en: 'Vertex reached degree 2; remaining edges crossed out.',
                },
              });
            }
          }
        } else if (activeCount === 1) {
          const available = edges.filter((e) => e.val === 0);
          if (available.length === 1) {
            const target = available[0];
            deductions.set(`${target.type}_${target.er}_${target.ec}`, {
              edge: { type: target.type, r: target.er, c: target.ec },
              state: 1,
              type: 'degree_extension',
              rationale: '單一連續迴路禁止斷頭，線路必須向前延伸',
              humanReadable: {
                zh: '迴路不能有孤立死胡同，此邊必須繼續向前延伸。',
                en: 'Loop cannot terminate; line extends through open edge.',
              },
            });
          }
        }
      }
    }

    // 定式 9: 線索完成與剩餘邊收尾
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const clue = clues[r][c];
        if (clue !== null && clue > 0) {
          const edges: { type: EdgeType; er: number; ec: number; val: number }[] = [
            { type: 'h', er: r, ec: c, val: curH[r][c] },
            { type: 'h', er: r + 1, ec: c, val: curH[r + 1][c] },
            { type: 'v', er: r, ec: c, val: curV[r][c] },
            { type: 'v', er: r, ec: c + 1, val: curV[r][c + 1] },
          ];

          const active = edges.filter((e) => e.val === 1).length;
          const blocked = edges.filter((e) => e.val === 2).length;
          const open = edges.filter((e) => e.val === 0);

          if (active === clue && open.length > 0) {
            for (let i = 0; i < open.length; i++) {
              const op = open[i];
              deductions.set(`${op.type}_${op.er}_${op.ec}`, {
                edge: { type: op.type, r: op.er, c: op.ec },
                state: 2,
                type: 'clue_completion',
                rationale: `線索 ${clue} 已滿足，剩餘空白邊全數標叉`,
                humanReadable: {
                  zh: `單元格已滿足線索 ${clue}，其餘邊全部標記叉號 (x)。`,
                  en: `Cell has reached clue ${clue}; remaining open edges crossed out.`,
                },
              });
            }
          } else if (4 - blocked === clue && open.length > 0) {
            for (let i = 0; i < open.length; i++) {
              const op = open[i];
              deductions.set(`${op.type}_${op.er}_${op.ec}`, {
                edge: { type: op.type, r: op.er, c: op.ec },
                state: 1,
                type: 'clue_completion',
                rationale: `線索 ${clue} 扣除叉號後剩餘邊界全數必通`,
                humanReadable: {
                  zh: `排除叉號後剛好剩 ${clue} 條邊，必須全部連線！`,
                  en: `Exactly ${clue} edges remain; all must connect!`,
                },
              });
            }
          }
        }
      }
    }

    return deductions;
  }

  public static getNextForcedDeduction(
    rows: number,
    cols: number,
    clues: (number | null)[][],
    hEdges: (EdgeState | number)[][],
    vEdges: (EdgeState | number)[][]
  ): SlitherlinkHintStep | null {
    const curH = hEdges.map((row) => [...row]);
    const curV = vEdges.map((row) => [...row]);

    const deductions = this.getStrictDeductions(rows, cols, clues, curH, curV);
    if (deductions.size === 0) return null;

    const first = deductions.values().next().value;
    if (!first) return null;

    return {
      step: 1,
      type: first.edge.type.toUpperCase() as 'H' | 'V',
      r: first.edge.r,
      c: first.edge.c,
      forcedState: first.state as EdgeState,
      technique: first.type,
      evidenceCells: [[Math.min(rows - 1, first.edge.r), Math.min(cols - 1, first.edge.c)]],
      rationale: first.rationale,
      humanReadable: first.humanReadable,
    };
  }

  private static checkImmediateConflict(
    rows: number,
    cols: number,
    clues: (number | null)[][],
    h: number[][],
    v: number[][]
  ): { conflict: boolean; reason: string } {
    const ptCols = cols + 1;
    const dsu = new FastVertexDSU((rows + 1) * ptCols);
    const deg = new Uint8Array((rows + 1) * ptCols);

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (h[r][c] === 1) {
          const u = r * ptCols + c;
          const w = r * ptCols + c + 1;
          if (++deg[u] > 2 || ++deg[w] > 2) return { conflict: true, reason: '度數溢出 (Degree > 2)' };
          dsu.union(u, w);
        }
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        if (v[r][c] === 1) {
          const u = r * ptCols + c;
          const w = (r + 1) * ptCols + c;
          if (++deg[u] > 2 || ++deg[w] > 2) return { conflict: true, reason: '度數溢出 (Degree > 2)' };
          dsu.union(u, w);
        }
      }
    }

    let remainingClueDemand = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const clue = clues[r][c];
        if (clue === null) continue;
        const lines = (h[r][c] === 1 ? 1 : 0) + (h[r + 1][c] === 1 ? 1 : 0) + (v[r][c] === 1 ? 1 : 0) + (v[r][c + 1] === 1 ? 1 : 0);
        const crosses = (h[r][c] === 2 ? 1 : 0) + (h[r + 1][c] === 2 ? 1 : 0) + (v[r][c] === 2 ? 1 : 0) + (v[r][c + 1] === 2 ? 1 : 0);
        if (lines > clue) return { conflict: true, reason: `線索 ${clue} 超額飽和` };
        if (4 - crosses < clue) return { conflict: true, reason: `線索 ${clue} 可用邊不足` };
        if (clue > lines) remainingClueDemand += (clue - lines);
      }
    }

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (h[r][c] === 0) {
          const u = r * ptCols + c;
          const w = r * ptCols + c + 1;
          if (deg[u] === 1 && deg[w] === 1 && dsu.find(u) === dsu.find(w) && remainingClueDemand > 0) {
            return { conflict: true, reason: '局部提前閉環死鎖' };
          }
        }
      }
    }

    return { conflict: false, reason: '' };
  }

  private static probeHumanBoundedContradiction(
    rows: number,
    cols: number,
    clues: (number | null)[][],
    curH: number[][],
    curV: number[][]
  ): {
    edge: SlitherEdge;
    state: 2;
    chain: ContradictionNode[];
    depth: number;
    rationale: string;
    humanReadable: { zh: string; en: string };
  } | null {
    const edgeCandidates: SlitherEdge[] = [];
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) if (curH[r][c] === 0) edgeCandidates.push({ type: 'h', r, c });
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) if (curV[r][c] === 0) edgeCandidates.push({ type: 'v', r, c });
    }

    const MAX_HUMAN_DEPTH = 7;
    const BEAM_WIDTH = 3;

    for (const cand of edgeCandidates) {
      const rootH = curH.map((row) => [...row]);
      const rootV = curV.map((row) => [...row]);
      if (cand.type === 'h') rootH[cand.r][cand.c] = 1;
      else rootV[cand.r][cand.c] = 1;

      interface ProbeState {
        h: number[][];
        v: number[][];
        chain: ContradictionNode[];
        depth: number;
      }

      const frontier: ProbeState[] = [{
        h: rootH,
        v: rootV,
        chain: [{ edge: cand, assumedState: 1, step: 0, reason: '假設實線' }],
        depth: 0,
      }];

      while (frontier.length > 0) {
        const current = frontier.shift()!;
        const conflictCheck = this.checkImmediateConflict(rows, cols, clues, current.h, current.v);

        if (conflictCheck.conflict) {
          return {
            edge: cand,
            state: 2,
            chain: current.chain,
            depth: current.depth,
            rationale: `第 ${current.depth} 步觸發矛盾：${conflictCheck.reason}`,
            humanReadable: {
              zh: `可追溯反證：前向推演 ${current.depth} 步引發${conflictCheck.reason}，此處強制標叉 (x)！`,
              en: `Human Traceable Proof: Depth ${current.depth} leads to ${conflictCheck.reason}; forced cross (x)!`,
            },
          };
        }

        if (current.depth >= MAX_HUMAN_DEPTH) continue;

        const deductions = this.getStrictDeductions(rows, cols, clues, current.h, current.v);
        if (deductions.size === 0) continue;

        const sortedDeductions = Array.from(deductions.values())
          .sort((a, b) => (TECHNIQUE_WEIGHTS[b.type] || 0) - (TECHNIQUE_WEIGHTS[a.type] || 0))
          .slice(0, BEAM_WIDTH);

        for (const d of sortedDeductions) {
          const nextH = current.h.map((r) => [...r]);
          const nextV = current.v.map((r) => [...r]);
          if (d.edge.type === 'h') nextH[d.edge.r][d.edge.c] = d.state;
          else nextV[d.edge.r][d.edge.c] = d.state;

          frontier.push({
            h: nextH,
            v: nextV,
            chain: [...current.chain, { edge: d.edge, assumedState: d.state, step: current.depth + 1, reason: d.rationale }],
            depth: current.depth + 1,
          });
        }
      }
    }

    return null;
  }

  public static countSolutionsCognitivelyBounded(
    rows: number,
    cols: number,
    clues: (number | null)[][]
  ): { count: number; steps: SlitherStep[] } {
    const curH: number[][] = Array.from({ length: rows + 1 }, () => Array(cols).fill(0));
    const curV: number[][] = Array.from({ length: rows }, () => Array(cols + 1).fill(0));
    const steps: SlitherStep[] = [];

    let stepCount = 0;
    let progressed = true;

    while (progressed) {
      progressed = false;
      const deductions = this.getStrictDeductions(rows, cols, clues, curH, curV);

      if (deductions.size > 0) {
        let chosen = Array.from(deductions.values()).find(
          (d) => d.type === 'premature_avoidance' || d.type === 'diagonal_twos' || d.type === 'adjacent_threes'
        );
        if (!chosen) chosen = deductions.values().next().value;

        const { edge, state, type, rationale, humanReadable } = chosen!;
        if (edge.type === 'h') curH[edge.r][edge.c] = state;
        else curV[edge.r][edge.c] = state;

        stepCount++;
        steps.push({
          step: stepCount,
          type,
          edge,
          state,
          complexityWeight: TECHNIQUE_WEIGHTS[type] || 2,
          candidateFanOut: deductions.size,
          rationale,
          humanReadable,
        });

        progressed = true;
      } else {
        const contra = this.probeHumanBoundedContradiction(rows, cols, clues, curH, curV);
        if (contra) {
          if (contra.edge.type === 'h') curH[contra.edge.r][contra.edge.c] = 2;
          else curV[contra.edge.r][contra.edge.c] = 2;

          stepCount++;
          steps.push({
            step: stepCount,
            type: 'hypothesis_contradiction',
            edge: contra.edge,
            state: 2,
            complexityWeight: TECHNIQUE_WEIGHTS.hypothesis_contradiction,
            candidateFanOut: 1,
            contradictionChain: contra.chain,
            contradictionDepth: contra.depth,
            rationale: contra.rationale,
            humanReadable: contra.humanReadable,
          });

          progressed = true;
        }
      }
    }

    const finalH = curH.map((r) => r.map((cell) => cell === 1));
    const finalV = curV.map((r) => r.map((cell) => cell === 1));
    const isSingleLoop = this.isStrictSingleLoop(finalH, finalV, rows, cols);

    let allCluesSatisfied = true;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cl = clues[r][c];
        if (cl !== null) {
          let count = 0;
          if (finalH[r][c]) count++;
          if (finalH[r + 1][c]) count++;
          if (finalV[r][c]) count++;
          if (finalV[r][c + 1]) count++;
          if (count !== cl) {
            allCluesSatisfied = false;
            break;
          }
        }
      }
      if (!allCluesSatisfied) break;
    }

    return {
      count: isSingleLoop && allCluesSatisfied ? 1 : 0,
      steps,
    };
  }

  public static evaluateWpcMastery(
    rows: number,
    cols: number,
    steps: SlitherStep[],
    startingAnchors: number
  ): WpcDiagnosticReport {
    const n = steps.length;
    if (n === 0) {
      return {
        pureRate: 1.0,
        diversityIndex: 0,
        strictlyOrdered: true,
        meanFanOut: 1.0,
        stdDevFanOut: 0.0,
        startingAnchorCount: startingAnchors,
        maxContradictionDepth: 0,
        spatialEntropy: 1.0,
        humanTraceabilityScore: 1.0,
        techniqueCategories: { candidate: 0, geometric: 0, topological: 0, hypothetical: 0 },
        cognitiveInflectionPoints: [],
        wpcGrade: 'A',
        wpcCommentZh: '空白盤面或已完成狀態。',
        mentalTemplate: {
          openingGambit: '無起始線索',
          midgameTheme: '無中局演進',
          climaxLocation: '無轉折高潮',
          closingSequence: '直接閉合',
        },
      };
    }

    const domainCounts: Record<CognitiveDomain, number> = {
      candidate: 0,
      geometric: 0,
      topological: 0,
      hypothetical: 0,
    };
    const techFreq = new Map<string, number>();
    let weightedScore = 0;
    let hypoPenalty = 0;
    let maxHypoDepth = 0;

    const quadCounts = [0, 0, 0, 0];
    const midR = rows / 2;
    const midC = cols / 2;

    for (const s of steps) {
      const domain = TECHNIQUE_DOMAINS[s.type] || 'candidate';
      domainCounts[domain]++;
      techFreq.set(s.type, (techFreq.get(s.type) || 0) + 1);

      const w = TECHNIQUE_WEIGHTS[s.type] || 2;
      if (s.type === 'hypothesis_contradiction') {
        hypoPenalty += w;
        maxHypoDepth = Math.max(maxHypoDepth, s.contradictionDepth || 1);
      } else {
        weightedScore += w;
      }

      const qIdx = (s.edge.r < midR ? 0 : 2) + (s.edge.c < midC ? 0 : 1);
      quadCounts[qIdx]++;
    }

    let spatialEntropy = 0;
    for (let i = 0; i < 4; i++) {
      if (quadCounts[i] > 0) {
        const p = quadCounts[i] / n;
        spatialEntropy -= p * Math.log2(p);
      }
    }
    spatialEntropy = Number((spatialEntropy / 2).toFixed(3));

    const pureRate = Number((weightedScore / Math.max(1, weightedScore + hypoPenalty)).toFixed(3));
    let sumSq = 0;
    for (const c of techFreq.values()) {
      const p = c / n;
      sumSq += p * p;
    }
    const diversityIndex = Number((1 - sumSq).toFixed(3));

    const fanOuts = steps.map((s) => s.candidateFanOut || 1);
    const meanFanOut = fanOuts.reduce((a, b) => a + b, 0) / n;
    const variance = fanOuts.reduce((a, b) => a + Math.pow(b - meanFanOut, 2), 0) / n;
    const stdDevFanOut = Math.sqrt(variance);

    let depthFactor = 1.0;
    if (maxHypoDepth > 3) depthFactor = Math.max(0.2, 1.0 - (maxHypoDepth - 3) * 0.2);
    const anchorFactor = startingAnchors === 1 ? 1.0 : startingAnchors <= 3 ? 0.92 : 0.82;
    const humanTraceabilityScore = Number(
      (pureRate * 0.45 + depthFactor * 0.25 + anchorFactor * 0.15 + spatialEntropy * 0.15).toFixed(3)
    );

    const cognitiveInflectionPoints: WpcDiagnosticReport['cognitiveInflectionPoints'] = [];
    for (let i = 1; i < n; i++) {
      const prevDom = TECHNIQUE_DOMAINS[steps[i - 1].type] || 'candidate';
      const currDom = TECHNIQUE_DOMAINS[steps[i].type] || 'candidate';
      if (prevDom !== currDom) {
        cognitiveInflectionPoints.push({
          step: steps[i].step,
          fromDomain: prevDom,
          toDomain: currDom,
          technique: steps[i].type,
        });
      }
    }

    let wpcGrade: 'S' | 'A' | 'B' | 'C' = 'C';
    let wpcCommentZh = '';

    const zeroContradiction = domainCounts.hypothetical === 0;
    if (zeroContradiction && diversityIndex >= 0.65 && meanFanOut <= 1.06 && spatialEntropy >= 0.85) {
      wpcGrade = 'S';
      wpcCommentZh = '傳奇神話之作：全盤零假設反證，100% 純定式收斂。空間呼吸感均勻，四象限展開行雲流水，屬世界錦標賽決賽席位封神題。';
    } else if (maxHypoDepth <= 2 && humanTraceabilityScore >= 0.85) {
      wpcGrade = 'A';
      wpcCommentZh = '世界級頂尖題：僅包含極短前向直覺探測，定式覆蓋緊湊均衡，具備卓越的推導張力。';
    } else if (maxHypoDepth <= 5 && humanTraceabilityScore >= 0.70) {
      wpcGrade = 'B';
      wpcCommentZh = '標準競技題：推導流暢，定式具備一定挑戰度，適合計時排位選拔。';
    } else {
      wpcGrade = 'C';
      wpcCommentZh = '計算發散題：局部依賴深度試錯或熱點空間高度偏置。';
    }

    const firstStep = steps[0];
    const topTechnique = Array.from(techFreq.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'clue_completion';
    const majorInflection = cognitiveInflectionPoints[0];

    const mentalTemplate = {
      openingGambit: `開局以 (${firstStep.edge.r}, ${firstStep.edge.c}) 處的【${firstStep.type}】作為唯一精準錨點建立突破口。`,
      midgameTheme: `中盤核心仰賴【${topTechnique}】主導走線，維持極低的分支發散度。`,
      climaxLocation: majorInflection
        ? `第 ${majorInflection.step} 步發生範疇躍遷，由【${majorInflection.fromDomain}】切入【${majorInflection.toDomain}】，引發全域拓撲定局。`
        : '全局保持平滑推導，無劇烈範疇衝突。',
      closingSequence: `收官階段由連鎖候選數與頂點延伸安全收斂閉環。`,
    };

    return {
      pureRate,
      diversityIndex,
      strictlyOrdered: zeroContradiction && meanFanOut <= 1.05 && stdDevFanOut <= 0.3,
      meanFanOut: Number(meanFanOut.toFixed(3)),
      stdDevFanOut: Number(stdDevFanOut.toFixed(3)),
      startingAnchorCount: startingAnchors,
      maxContradictionDepth: maxHypoDepth,
      spatialEntropy,
      humanTraceabilityScore,
      techniqueCategories: domainCounts,
      cognitiveInflectionPoints,
      wpcGrade,
      wpcCommentZh,
      mentalTemplate,
    };
  }

  public static generate(tier: TierKey = 'expert', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.expert;
    const { rows, cols, clueRemovalRate, minTechniqueWeight, allowSymmetry, baseIrt, timeLimitSec } = config;
    const seed = inputSeed ?? Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(seed);

    let attempts = 0;
    const maxAttempts = 40;

    while (attempts++ < maxAttempts) {
      const { hEdges, vEdges } = this.generateOrganicValidLoop(rows, cols, allowSymmetry, rnd);
      if (!this.isStrictSingleLoop(hEdges, vEdges, rows, cols)) continue;

      const fullClues = this.extractClues(rows, cols, hEdges, vEdges);
      const puzzleClues = fullClues.map((row) => [...row]);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rnd() < clueRemovalRate) {
            puzzleClues[r][c] = null;
            if (allowSymmetry) puzzleClues[rows - 1 - r][cols - 1 - c] = null;
          }
        }
      }

      const curHInit = Array.from({ length: rows + 1 }, () => Array(cols).fill(0));
      const curVInit = Array.from({ length: rows }, () => Array(cols + 1).fill(0));
      const initialDeductions = this.getStrictDeductions(rows, cols, puzzleClues, curHInit, curVInit);
      const startingAnchors = initialDeductions.size;
      if (startingAnchors === 0) continue;

      const boundedResult = this.countSolutionsCognitivelyBounded(rows, cols, puzzleClues);
      if (boundedResult.count !== 1) continue;

      const totalWeight = boundedResult.steps.reduce((acc, s) => acc + s.complexityWeight, 0);
      if (totalWeight < minTechniqueWeight) continue;

      const wpcReport = this.evaluateWpcMastery(rows, cols, boundedResult.steps, startingAnchors);

      if ((tier === 'master' || tier === 'legendary' || tier === 'ultimate') && wpcReport.wpcGrade === 'C') {
        continue;
      }

      const puzzleId = `slither_${tier}_s${seed}`;
      const spec: SlitherlinkSpec = {
        rows,
        cols,
        clues: puzzleClues,
        grid: puzzleClues,
        solutionH: hEdges,
        solutionV: vEdges,
        solvingSteps: boundedResult.steps,
        maxForcedChain: boundedResult.steps.length,
        pureDeductionRate: wpcReport.pureRate,
        topologicalEntropy: wpcReport.spatialEntropy,
        isSymmetric180: allowSymmetry,
        seed,
        tier,
        wpcReport,
      };

      return {
        id: puzzleId,
        category: 'loop_logic',
        engine_type: 'slitherlink',
        tier,
        checksum: `SLITHER_${rows}x${cols}_MYTHIC_${seed}`,
        puzzle: spec,
        solution: { solutionH: hEdges, solutionV: vEdges },
        cognitiveLoad: {
          spatial: 0.98,
          numeric: 0.3,
          workingMemory: Number(Math.min(1.0, 0.4 + (totalWeight / 180) * 0.5).toFixed(2)),
          inhibition: 0.95,
        },
        metrics: {
          grid_size: rows,
          rows,
          cols,
          estimated_time_sec: timeLimitSec,
          irt_logit_difficulty: baseIrt,
          wpc_grade: wpcReport.wpcGrade,
          human_traceability_score: wpcReport.humanTraceabilityScore,
          spatial_entropy: wpcReport.spatialEntropy,
          seed,
          actualTier: tier,
        } as any,
      };
    }

    return this._generateFallback(tier, rows, cols, seed, baseIrt, timeLimitSec);
  }

  private static _generateFallback(
    tier: TierKey,
    rows: number,
    cols: number,
    seed: number,
    baseIrt: number,
    timeLimitSec: number
  ): PuzzleEntity {
    const hEdges: boolean[][] = Array.from({ length: rows + 1 }, () => Array(cols).fill(false));
    const vEdges: boolean[][] = Array.from({ length: rows }, () => Array(cols + 1).fill(false));

    for (let c = 0; c < cols; c++) {
      hEdges[0][c] = true;
      hEdges[rows][c] = true;
    }
    for (let r = 0; r < rows; r++) {
      vEdges[r][0] = true;
      vEdges[r][cols] = true;
    }

    const fallbackClues = this.extractClues(rows, cols, hEdges, vEdges);
    const spec: SlitherlinkSpec = {
      rows,
      cols,
      clues: fallbackClues,
      grid: fallbackClues,
      solutionH: hEdges,
      solutionV: vEdges,
      solvingSteps: [],
      maxForcedChain: 4,
      pureDeductionRate: 1.0,
      topologicalEntropy: 0.5,
      isSymmetric180: true,
      seed,
      tier,
      wpcReport: {
        pureRate: 1.0,
        diversityIndex: 0.5,
        strictlyOrdered: true,
        meanFanOut: 1.0,
        stdDevFanOut: 0.0,
        startingAnchorCount: 1,
        maxContradictionDepth: 0,
        spatialEntropy: 1.0,
        humanTraceabilityScore: 1.0,
        techniqueCategories: { candidate: 1, geometric: 0, topological: 0, hypothetical: 0 },
        cognitiveInflectionPoints: [],
        wpcGrade: 'B',
        wpcCommentZh: '保底邊界迴路。',
        mentalTemplate: {
          openingGambit: '邊界外圍開局',
          midgameTheme: '單一路徑延伸',
          climaxLocation: '無轉折點',
          closingSequence: '直接封閉',
        },
      },
    };

    return {
      id: `slither_${tier}_fallback_s${seed}`,
      category: 'loop_logic',
      engine_type: 'slitherlink',
      tier,
      checksum: `SLITHER_FB_${rows}x${cols}_${seed}`,
      puzzle: spec,
      solution: { solutionH: hEdges, solutionV: vEdges },
      cognitiveLoad: { spatial: 0.9, numeric: 0.3, workingMemory: 0.6, inhibition: 0.8 },
      metrics: {
        grid_size: rows,
        rows,
        cols,
        estimated_time_sec: timeLimitSec,
        irt_logit_difficulty: baseIrt,
        seed,
        actualTier: tier,
      } as any,
    };
  }
}
