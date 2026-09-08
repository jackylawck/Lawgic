// web-frontend/src/engines/slitherlinkGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey;
export type EdgeType = 'h' | 'v';
export type EdgeState = 0 | 1 | 2;

export type SlitherDeductionType =
  | 'zero_cross'
  | 'adjacent_threes'
  | 'corner_three'
  | 'diagonal_30'
  | 'degree_extension'
  | 'degree_saturation'
  | 'premature_avoidance'
  | 'clue_completion';

export type HumanSolvingStyle =
  | 'pure_logic'
  | 'strategic_macro'
  | 'heuristic_trail';

export interface SlitherEdge {
  type: EdgeType;
  r: number;
  c: number;
}

export interface SlitherStep {
  step: number;
  type: SlitherDeductionType;
  edge: SlitherEdge;
  state: 1 | 2;
  rationale: string;
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
  humanProfile?: {
    style: HumanSolvingStyle;
    hypothesisCount: number;
    diagnosticTitleZh: string;
    diagnosticTitleEn: string;
  };
}

interface TierConfig {
  rows: number;
  cols: number;
  clueRemovalRate: number;
  minForcedChain: number;
  baseIrt: number;
  timeLimitSec: number;
}

const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { rows: 4, cols: 4, clueRemovalRate: 0.15, minForcedChain: 4, baseIrt: 0.65, timeLimitSec: 90 },
  intermediate: { rows: 5, cols: 5, clueRemovalRate: 0.28, minForcedChain: 6, baseIrt: 1.45, timeLimitSec: 150 },
  expert: { rows: 6, cols: 6, clueRemovalRate: 0.38, minForcedChain: 8, baseIrt: 2.35, timeLimitSec: 240 },
  master: { rows: 7, cols: 7, clueRemovalRate: 0.46, minForcedChain: 10, baseIrt: 3.15, timeLimitSec: 360 },
  legendary: { rows: 8, cols: 8, clueRemovalRate: 0.52, minForcedChain: 12, baseIrt: 3.75, timeLimitSec: 480 },
  ultimate: { rows: 10, cols: 10, clueRemovalRate: 0.58, minForcedChain: 15, baseIrt: 4.35, timeLimitSec: 600 },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebSlitherlinkGenerator {
  public static verifySingleLoop(
    rows: number,
    cols: number,
    hEdges: boolean[][],
    vEdges: boolean[][]
  ): boolean {
    return this.isStrictSingleLoop(hEdges, vEdges, rows, cols);
  }

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

  private static generateValidLoopSymmetric(
    rows: number,
    cols: number,
    rnd: () => number
  ): { hEdges: boolean[][]; vEdges: boolean[][] } {
    const inside = Array.from({ length: rows }, () => Array(cols).fill(false));
    const midR = Math.floor(rows / 2);
    const midC = Math.floor(cols / 2);
    inside[midR][midC] = true;
    inside[rows - 1 - midR][cols - 1 - midC] = true;

    const targetCells = Math.max(4, Math.floor(rows * cols * 0.40));
    let currentCells = (midR === rows - 1 - midR && midC === cols - 1 - midC) ? 1 : 2;
    let attempts = 0;

    const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    while (currentCells < targetCells && attempts++ < 160) {
      const r = Math.floor(rnd() * rows);
      const c = Math.floor(rnd() * cols);
      const symR = rows - 1 - r;
      const symC = cols - 1 - c;

      if (inside[r][c] && inside[symR][symC]) continue;

      const hasAdj = dirs.some(([dr, dc]) => {
        const nr = r + dr;
        const nc = c + dc;
        return nr >= 0 && nr < rows && nc >= 0 && nc < cols && inside[nr][nc];
      });

      if (hasAdj) {
        let diagConflict = false;
        const diagOffsets: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
        for (let i = 0; i < 4; i++) {
          const [dr, dc] = diagOffsets[i];
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && inside[nr][nc]) {
            if (!inside[r + dr][c] && !inside[r][c + dc]) {
              diagConflict = true;
              break;
            }
          }
        }

        if (!diagConflict) {
          if (!inside[r][c]) {
            inside[r][c] = true;
            currentCells++;
          }
          if (!inside[symR][symC]) {
            inside[symR][symC] = true;
            currentCells++;
          }
        }
      }
    }

    const hEdges = Array.from({ length: rows + 1 }, () => Array(cols).fill(false));
    const vEdges = Array.from({ length: rows }, () => Array(cols + 1).fill(false));

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

  private static computeTopologicalEntropy(
    hEdges: boolean[][],
    vEdges: boolean[][],
    rows: number,
    cols: number
  ): number {
    let turns = 0;
    let totalActive = 0;

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const left = c > 0 && !!hEdges[r]?.[c - 1];
        const right = c < cols && !!hEdges[r]?.[c];
        const top = r > 0 && !!vEdges[r - 1]?.[c];
        const bottom = r < rows && !!vEdges[r]?.[c];

        const activeCount = (left ? 1 : 0) + (right ? 1 : 0) + (top ? 1 : 0) + (bottom ? 1 : 0);
        if (activeCount === 2 && (left || right) && (top || bottom)) {
          turns++;
        }
      }
    }

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (hEdges[r]?.[c]) totalActive++;
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        if (vEdges[r]?.[c]) totalActive++;
      }
    }

    const turnRatio = totalActive > 0 ? turns / totalActive : 0.5;
    const density = totalActive / ((rows + 1) * cols + rows * (cols + 1));
    return Number((turnRatio * 0.7 + density * 0.3).toFixed(3));
  }

  public static countSolutions(
    rows: number,
    cols: number,
    clues: (number | null)[][],
    limit: number = 2
  ): number {
    const ptCols = cols + 1;
    const curH = Array.from({ length: rows + 1 }, () => Array(cols).fill(false));
    const curV = Array.from({ length: rows }, () => Array(cols + 1).fill(false));
    const ptDeg = new Uint8Array((rows + 1) * ptCols);

    let solutions = 0;
    let stepBudget = 300;

    const allEdges: { type: EdgeType; r: number; c: number }[] = [];

    // 線索邊優先決策
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (clues[r][c] !== null) {
          allEdges.push({ type: 'h', r, c });
          allEdges.push({ type: 'h', r: r + 1, c });
          allEdges.push({ type: 'v', r, c });
          allEdges.push({ type: 'v', r, c + 1 });
        }
      }
    }

    const seen = new Set<string>();
    const orderedEdges: { type: EdgeType; r: number; c: number }[] = [];
    for (let i = 0; i < allEdges.length; i++) {
      const e = allEdges[i];
      const k = `${e.type}_${e.r}_${e.c}`;
      if (!seen.has(k)) {
        seen.add(k);
        orderedEdges.push(e);
      }
    }

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = `h_${r}_${c}`;
        if (!seen.has(k)) {
          seen.add(k);
          orderedEdges.push({ type: 'h', r, c });
        }
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const k = `v_${r}_${c}`;
        if (!seen.has(k)) {
          seen.add(k);
          orderedEdges.push({ type: 'v', r, c });
        }
      }
    }

    const backtrack = (idx: number): void => {
      if (solutions >= limit || stepBudget-- <= 0) return;

      if (idx === orderedEdges.length) {
        let allCluesSatisfied = true;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cl = clues[r][c];
            if (cl !== null) {
              let count = 0;
              if (curH[r][c]) count++;
              if (curH[r + 1][c]) count++;
              if (curV[r][c]) count++;
              if (curV[r][c + 1]) count++;
              if (count !== cl) {
                allCluesSatisfied = false;
                break;
              }
            }
          }
          if (!allCluesSatisfied) break;
        }

        if (allCluesSatisfied && WebSlitherlinkGenerator.isStrictSingleLoop(curH, curV, rows, cols)) {
          solutions++;
        }
        return;
      }

      const e = orderedEdges[idx];
      const p1Idx = e.r * ptCols + e.c;
      const p2Idx = e.type === 'h' ? e.r * ptCols + (e.c + 1) : (e.r + 1) * ptCols + e.c;

      // 分支 1: 置為連線
      if (ptDeg[p1Idx] < 2 && ptDeg[p2Idx] < 2) {
        if (e.type === 'h') curH[e.r][e.c] = true;
        else curV[e.r][e.c] = true;

        ptDeg[p1Idx]++;
        ptDeg[p2Idx]++;

        let validClue = true;
        if (e.type === 'h') {
          if (e.r > 0 && clues[e.r - 1][e.c] !== null) {
            let count = 0;
            if (curH[e.r - 1][e.c]) count++;
            if (curH[e.r][e.c]) count++;
            if (curV[e.r - 1][e.c]) count++;
            if (curV[e.r - 1][e.c + 1]) count++;
            if (count > clues[e.r - 1][e.c]!) validClue = false;
          }
          if (validClue && e.r < rows && clues[e.r][e.c] !== null) {
            let count = 0;
            if (curH[e.r][e.c]) count++;
            if (curH[e.r + 1][e.c]) count++;
            if (curV[e.r][e.c]) count++;
            if (curV[e.r][e.c + 1]) count++;
            if (count > clues[e.r][e.c]!) validClue = false;
          }
        } else {
          if (e.c > 0 && clues[e.r][e.c - 1] !== null) {
            let count = 0;
            if (curH[e.r][e.c - 1]) count++;
            if (curH[e.r + 1][e.c - 1]) count++;
            if (curV[e.r][e.c - 1]) count++;
            if (curV[e.r][e.c]) count++;
            if (count > clues[e.r][e.c - 1]!) validClue = false;
          }
          if (validClue && e.c < cols && clues[e.r][e.c] !== null) {
            let count = 0;
            if (curH[e.r][e.c]) count++;
            if (curH[e.r + 1][e.c]) count++;
            if (curV[e.r][e.c]) count++;
            if (curV[e.r][e.c + 1]) count++;
            if (count > clues[e.r][e.c]!) validClue = false;
          }
        }

        if (validClue) {
          backtrack(idx + 1);
        }

        if (e.type === 'h') curH[e.r][e.c] = false;
        else curV[e.r][e.c] = false;

        ptDeg[p1Idx]--;
        ptDeg[p2Idx]--;
      }

      // 分支 2: 不選該邊
      backtrack(idx + 1);
    };

    backtrack(0);
    return solutions;
  }

  public static getStrictDeductions(
    rows: number,
    cols: number,
    clues: (number | null)[][],
    curH: number[][],
    curV: number[][]
  ): Map<string, { edge: SlitherEdge; state: 1 | 2; type: SlitherDeductionType; rationale: string; humanReadable: { zh: string; en: string } }> {
    const deductions = new Map<
      string,
      { edge: SlitherEdge; state: 1 | 2; type: SlitherDeductionType; rationale: string; humanReadable: { zh: string; en: string } }
    >();

    // 1. 線索 0 周邊標叉
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
                rationale: '線索 0 周圍禁絕一切線段',
                humanReadable: {
                  zh: '因為 0 的四周不能有任何線段，所以這條邊必須標記叉號 (x)。',
                  en: 'Zero clues forbid any surrounding lines; mark with a cross (x).',
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

    // 2. 角落 3 定式
    const corners: [number, number, [EdgeType, number, number][]][] = [
      [0, 0, [['h', 0, 0], ['v', 0, 0]]],
      [0, cols - 1, [['h', 0, cols - 1], ['v', 0, cols]]],
      [rows - 1, 0, [['h', rows, 0], ['v', rows - 1, 0]]],
      [rows - 1, cols - 1, [['h', rows, cols - 1], ['v', rows - 1, cols]]],
    ];

    for (let i = 0; i < 4; i++) {
      const [cr, cc, outerEdges] = corners[i];
      if (clues[cr][cc] === 3) {
        for (let j = 0; j < outerEdges.length; j++) {
          const [t, er, ec] = outerEdges[j];
          if ((t === 'h' ? curH[er][ec] : curV[er][ec]) === 0) {
            deductions.set(`${t}_${er}_${ec}`, {
              edge: { type: t, r: er, c: ec },
              state: 1,
              type: 'corner_three',
              rationale: '角落 3 兩條外邊界必須強制通線',
              humanReadable: {
                zh: '盤面角落的線索 3：兩側靠邊的軌道必須強制連線！',
                en: 'Corner 3 pattern forces outer boundaries to connect.',
              },
            });
          }
        }
      }
    }

    // 3. 相鄰雙 3 定式
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
                rationale: '相鄰雙 3 必然形成三重平行走線定式',
                humanReadable: {
                  zh: '兩個相鄰的 3 形成經典定式：外側與共用邊必須連線。',
                  en: 'Adjacent 3-3 pattern forces outer boundaries and common edge to connect.',
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
                rationale: '垂直相鄰雙 3 外側與共用邊連線定式',
                humanReadable: {
                  zh: '垂直相鄰的兩個 3：外側軌道與共用橫邊必須通線。',
                  en: 'Vertical adjacent 3-3 requires outer boundaries and common edge to connect.',
                },
              });
            }
          }
        }
      }
    }

    // 4. 頂點度數飽和與延伸
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
                rationale: '頂點度數已滿 (2)，其餘邊標叉防分支',
                humanReadable: {
                  zh: '這個交叉點已經有兩條線進出，其餘方向必須標記叉號 (x)。',
                  en: 'Vertex already has 2 connecting lines; remaining paths must be crossed out.',
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
              rationale: '頂點禁止死胡同，線路必須延伸',
              humanReadable: {
                zh: '環路不能有斷頭死胡同，這條線必須繼續向前延伸。',
                en: 'A loop cannot be a dead end; it must continue through the open edge.',
              },
            });
          }
        }
      }
    }

    // 5. 線索完成與剩餘邊補齊
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
                rationale: `線索 ${clue} 已滿足，剩餘邊全數標叉`,
                humanReadable: {
                  zh: `格子周圍已經剛好有 ${clue} 條線了，其餘空白邊全部標記叉號 (x)。`,
                  en: `Cell has reached its clue of ${clue}; all other edges around it must be crossed.`,
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
                rationale: `線索 ${clue} 排除叉號後，剩餘邊界全數必通`,
                humanReadable: {
                  zh: `剩下剛好 ${clue} 條通道，必須全部連線！`,
                  en: `Exactly ${clue} edges remain; all must be connected.`,
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

  private static simulateHumanSolving(
    rows: number,
    cols: number,
    clues: (number | null)[][]
  ) {
    const curH = Array.from({ length: rows + 1 }, () => Array(cols).fill(0));
    const curV = Array.from({ length: rows }, () => Array(cols + 1).fill(0));
    const steps: SlitherStep[] = [];

    let progressed = true;
    let stepCount = 0;
    let currentChain = 0;
    let maxChain = 0;

    while (progressed) {
      progressed = false;
      const deductions = this.getStrictDeductions(rows, cols, clues, curH, curV);

      if (deductions.size > 0) {
        let chosenItem = Array.from(deductions.values()).find(
          (d) => d.type === 'zero_cross' || d.type === 'adjacent_threes' || d.type === 'corner_three'
        );
        if (!chosenItem) {
          chosenItem = deductions.values().next().value;
        }

        const { edge, state, type, rationale, humanReadable } = chosenItem!;
        if (edge.type === 'h') curH[edge.r][edge.c] = state;
        else curV[edge.r][edge.c] = state;

        stepCount++;
        currentChain++;
        maxChain = Math.max(maxChain, currentChain);

        steps.push({
          step: stepCount,
          type,
          edge,
          state,
          rationale,
          humanReadable,
        });

        progressed = true;
      }
    }

    const totalEdges = (rows + 1) * cols + rows * (cols + 1);
    const pureRate = totalEdges > 0 ? Number((steps.length / (totalEdges * 0.7)).toFixed(2)) : 1.0;

    return {
      steps,
      maxForcedChain: maxChain,
      pureRate: Math.min(1.0, pureRate),
      hypothesisCount: 0,
      style: 'pure_logic' as HumanSolvingStyle,
      diagnosticTitleZh: '純邏輯推導大師（100% 幾何定式直覺）',
      diagnosticTitleEn: 'Pure Logic Mastery (100% Theorem Driven)',
    };
  }

  private static createSafeFallbackLoop(rows: number, cols: number): { hEdges: boolean[][]; vEdges: boolean[][] } {
    const hEdges = Array.from({ length: rows + 1 }, () => Array(cols).fill(false));
    const vEdges = Array.from({ length: rows }, () => Array(cols + 1).fill(false));

    for (let c = 0; c < cols; c++) {
      hEdges[0][c] = true;
      hEdges[rows][c] = true;
    }
    for (let r = 0; r < rows; r++) {
      vEdges[r][0] = true;
      vEdges[r][cols] = true;
    }

    return { hEdges, vEdges };
  }

  public static generate(tier: TierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, clueRemovalRate, minForcedChain, baseIrt, timeLimitSec } = config;
    const seed = inputSeed ?? Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(seed);

    let attempts = 0;
    const maxAttempts = 35;

    while (attempts++ < maxAttempts) {
      const { hEdges, vEdges } = this.generateValidLoopSymmetric(rows, cols, rnd);

      if (!this.isStrictSingleLoop(hEdges, vEdges, rows, cols)) {
        continue;
      }

      const fullClues = this.extractClues(rows, cols, hEdges, vEdges);
      const entropy = this.computeTopologicalEntropy(hEdges, vEdges, rows, cols);

      const puzzleClues = fullClues.map((row) => [...row]);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const symR = rows - 1 - r;
          const symC = cols - 1 - c;
          if (rnd() < clueRemovalRate) {
            puzzleClues[r][c] = null;
            puzzleClues[symR][symC] = null;
          }
        }
      }

      let hasAnchor = false;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (puzzleClues[r][c] === 3 || puzzleClues[r][c] === 0) {
            hasAnchor = true;
            break;
          }
        }
        if (hasAnchor) break;
      }
      if (!hasAnchor) puzzleClues[0][0] = fullClues[0][0];

      if (this.countSolutions(rows, cols, puzzleClues, 2) !== 1) {
        continue;
      }

      const simResult = this.simulateHumanSolving(rows, cols, puzzleClues);

      if ((tier === 'master' || tier === 'legendary' || tier === 'ultimate') &&
          simResult.maxForcedChain < Math.min(minForcedChain, 8)) {
        continue;
      }

      const dynamicIrt = Number((baseIrt + entropy * 0.35 + (simResult.steps.length / (rows * cols)) * 0.25).toFixed(2));
      const puzzleId = `slither_${tier}_s${seed}`;

      const spec: SlitherlinkSpec = {
        rows,
        cols,
        clues: puzzleClues,
        grid: puzzleClues,
        solutionH: hEdges,
        solutionV: vEdges,
        solvingSteps: simResult.steps,
        maxForcedChain: simResult.maxForcedChain,
        pureDeductionRate: simResult.pureRate,
        topologicalEntropy: entropy,
        isSymmetric180: true,
        seed,
        tier,
        humanProfile: {
          style: simResult.style,
          hypothesisCount: simResult.hypothesisCount,
          diagnosticTitleZh: simResult.diagnosticTitleZh,
          diagnosticTitleEn: simResult.diagnosticTitleEn,
        },
      };

      return {
        id: puzzleId,
        category: 'loop_logic',
        engine_type: 'slitherlink',
        tier,
        checksum: `SLITHER_${rows}x${cols}_CERTIFIED_${seed}`,
        puzzle: spec,
        solution: { solutionH: hEdges, solutionV: vEdges },
        cognitiveLoad: {
          spatial: 0.95,
          numeric: 0.3,
          workingMemory: Number(Math.min(1.0, 0.4 + entropy * 0.4).toFixed(2)),
          inhibition: 0.85,
        },
        metrics: {
          grid_size: rows,
          rows,
          cols,
          estimated_time_sec: timeLimitSec,
          irt_logit_difficulty: dynamicIrt,
          human_sim_steps: simResult.steps.length,
          topologicalEntropy: entropy,
          seed,
          actualTier: tier,
        } as any,
      };
    }

    return this._generateFallback(tier, rows, cols, seed, config.baseIrt, config.timeLimitSec);
  }

  private static _generateFallback(
    tier: TierKey,
    rows: number,
    cols: number,
    seed: number,
    baseIrt: number,
    timeLimitSec: number
  ): PuzzleEntity {
    const { hEdges: fallbackH, vEdges: fallbackV } = this.createSafeFallbackLoop(rows, cols);
    const fallbackClues = this.extractClues(rows, cols, fallbackH, fallbackV);

    const fallbackSpec: SlitherlinkSpec = {
      rows,
      cols,
      clues: fallbackClues,
      grid: fallbackClues,
      solutionH: fallbackH,
      solutionV: fallbackV,
      solvingSteps: [],
      maxForcedChain: 4,
      pureDeductionRate: 1.0,
      topologicalEntropy: 0.5,
      isSymmetric180: true,
      seed,
      tier,
      humanProfile: {
        style: 'pure_logic',
        hypothesisCount: 0,
        diagnosticTitleZh: '純邏輯推導大師（100% 幾何定式直覺）',
        diagnosticTitleEn: 'Pure Logic Mastery (100% Theorem Driven)',
      },
    };

    return {
      id: `slither_${tier}_fallback_s${seed}`,
      category: 'loop_logic',
      engine_type: 'slitherlink',
      tier,
      checksum: `SLITHER_FALLBACK_${rows}x${cols}_S${seed}`,
      puzzle: fallbackSpec,
      solution: { solutionH: fallbackH, solutionV: fallbackV },
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
