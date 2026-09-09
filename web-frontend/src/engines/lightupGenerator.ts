// web-frontend/src/engines/lightupGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey;

export interface LightUpCoord {
  r: number;
  c: number;
}

export type LightUpDeductionType =
  | 'zero_black_cross'
  | 'clue_forced_light'
  | 'clue_saturated_dot'
  | 'adjacent_clue_xor'
  | 'diagonal_exclusion'
  | 'isolated_illuminance'
  | 'ray_no_clash'
  | 'pseudo_boolean_bound'
  | 'twosat_scc_collapse'
  | 'positive_reductio'
  | 'negative_reductio';

export interface LightUpStep {
  step: number;
  type: LightUpDeductionType;
  r: number;
  c: number;
  state: 1 | 2; // 1: 燈泡, 2: 防護留白點 (Dot)
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface LightUpSpec {
  rows: number;
  cols: number;
  blackBlocks: { r: number; c: number; clue: number | null }[];
  solutionBulbs: LightUpCoord[];
  solvingSteps: LightUpStep[];
  maxForcedChain: number;
  pureDeductionRate: number;
  decayMonotonicity: number;
  eurekaMoments: number;
  isSymmetric180: boolean;
  tier: TierKey;
  seed: number;
}

interface TierConfig {
  rows: number;
  cols: number;
  blackBlockRatio: number;
  clueRatio: number;
  baseIrt: number;
  timeLimitSec: number;
  allowSymmetry: boolean;
}

const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { rows: 5, cols: 5, blackBlockRatio: 0.2, clueRatio: 0.85, baseIrt: 0.65, timeLimitSec: 90, allowSymmetry: true },
  intermediate: { rows: 6, cols: 6, blackBlockRatio: 0.22, clueRatio: 0.75, baseIrt: 1.45, timeLimitSec: 150, allowSymmetry: true },
  expert: { rows: 7, cols: 7, blackBlockRatio: 0.24, clueRatio: 0.65, baseIrt: 2.35, timeLimitSec: 240, allowSymmetry: false },
  master: { rows: 8, cols: 8, blackBlockRatio: 0.25, clueRatio: 0.55, baseIrt: 3.15, timeLimitSec: 360, allowSymmetry: false },
  legendary: { rows: 9, cols: 9, blackBlockRatio: 0.26, clueRatio: 0.5, baseIrt: 3.75, timeLimitSec: 480, allowSymmetry: false },
  ultimate: { rows: 10, cols: 10, blackBlockRatio: 0.28, clueRatio: 0.45, baseIrt: 4.35, timeLimitSec: 600, allowSymmetry: false },
};

export const DEDUCTION_PRIORITY: Record<LightUpDeductionType, number> = {
  zero_black_cross: 100,
  clue_forced_light: 95,
  clue_saturated_dot: 90,
  ray_no_clash: 85,
  isolated_illuminance: 75,
  pseudo_boolean_bound: 65,
  adjacent_clue_xor: 55,
  diagonal_exclusion: 45,
  twosat_scc_collapse: 35,
  positive_reductio: 20,
  negative_reductio: 20,
};

export function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function generateAkariSignature(payload: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const msgBuffer = new TextEncoder().encode(payload);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      return `AKARI-${hex.slice(0, 16).toUpperCase()}`;
    } catch {
      // 降級隨機字串
    }
  }
  return 'AKARI-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

export class DynamicTopologyValidator {
  public static validate(tier: TierKey, rows: number, cols: number, isBlack: boolean[][]): boolean {
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (isBlack[r][c] && isBlack[r + 1][c] && isBlack[r][c + 1] && isBlack[r + 1][c + 1]) {
          return false;
        }
      }
    }

    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let isolatedCount = 0;
    let connectedCount = 0;
    let totalBlacks = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (isBlack[r][c]) {
          totalBlacks++;
          const neighborCount = dirs.filter(([dr, dc]) => {
            const nr = r + dr, nc = c + dc;
            return nr >= 0 && nr < rows && nc >= 0 && nc < cols && isBlack[nr][nc];
          }).length;

          if (neighborCount === 0) isolatedCount++;
          else connectedCount++;
        }
      }
    }

    if (totalBlacks === 0) return false;

    if (tier === 'master' || tier === 'legendary' || tier === 'ultimate') {
      return isolatedCount >= 1 && isolatedCount <= 3 && connectedCount / totalBlacks >= 0.5;
    } else {
      return connectedCount / totalBlacks >= 0.75;
    }
  }
}

export class PseudoBooleanPropagator {
  public static propagate(
    rows: number,
    cols: number,
    blackBlocks: { r: number; c: number; clue: number | null }[],
    board: number[][]
  ): LightUpStep[] {
    const steps: LightUpStep[] = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const b of blackBlocks) {
      if (b.clue === null) continue;
      const k = b.clue;

      let fixedLights = 0;
      const freeUnassigned: [number, number][] = [];

      for (const [dr, dc] of dirs) {
        const nr = b.r + dr;
        const nc = b.c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] !== 9) {
          if (board[nr][nc] === 1) {
            fixedLights++;
          } else if (board[nr][nc] === 0) {
            let hitByLight = false;
            for (const [sdr, sdc] of dirs) {
              let cr = nr + sdr, cc = nc + sdc;
              while (cr >= 0 && cr < rows && cc >= 0 && cc < cols && board[cr][cc] !== 9) {
                if (board[cr][cc] === 1) {
                  hitByLight = true;
                  break;
                }
                cr += sdr;
                cc += sdc;
              }
              if (hitByLight) break;
            }

            if (!hitByLight) {
              freeUnassigned.push([nr, nc]);
            }
          }
        }
      }

      if (fixedLights === k && freeUnassigned.length > 0) {
        for (const [ur, uc] of freeUnassigned) {
          steps.push({
            step: 1,
            type: 'pseudo_boolean_bound',
            r: ur,
            c: uc,
            state: 2,
            rationale: `偽布林上界飽和：黑塊 (${b.r + 1},${b.c + 1})[${k}] 已滿足配額，其餘自由變數置 0 (Dot)`,
            humanReadable: {
              zh: `線索數字 ${k} 燈泡配額已滿，周圍其餘可用空格標記防護點 •！`,
              en: `Quota for clue ${k} met; mark remaining open spaces with dot •!`,
            },
          });
        }
      }

      if (fixedLights + freeUnassigned.length === k && freeUnassigned.length > 0) {
        for (const [ur, uc] of freeUnassigned) {
          steps.push({
            step: 1,
            type: 'pseudo_boolean_bound',
            r: ur,
            c: uc,
            state: 1,
            rationale: `偽布林下界收緊：黑塊 (${b.r + 1},${b.c + 1})[${k}] 自由空間恰好滿足下界，全數置 1 (Light)`,
            humanReadable: {
              zh: `線索數字 ${k} 自由空格剛好等於缺額，全數強制放置燈泡 💡！`,
              en: `Free spaces match remaining deficit for clue ${k}; all must be lights 💡!`,
            },
          });
        }
      }
    }

    return steps;
  }
}

export class TwoSatEngine {
  public static solve(
    rows: number,
    cols: number,
    blackBlocks: { r: number; c: number; clue: number | null }[],
    board: number[][]
  ): LightUpStep[] {
    const steps: LightUpStep[] = [];
    const n = rows * cols * 2;
    const adj: number[][] = Array.from({ length: n }, () => []);
    const rev: number[][] = Array.from({ length: n }, () => []);

    const litToId = (r: number, c: number, val: 1 | 2) => (r * cols + c) * 2 + (val === 1 ? 0 : 1);

    const addImplication = (uR: number, uC: number, uVal: 1 | 2, vR: number, vC: number, vVal: 1 | 2) => {
      const u = litToId(uR, uC, uVal);
      const v = litToId(vR, vC, vVal);
      adj[u].push(v);
      rev[v].push(u);
    };

    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 0) {
          for (const [dr, dc] of dirs) {
            let cr = r + dr, cc = c + dc;
            while (cr >= 0 && cr < rows && cc >= 0 && cc < cols && board[cr][cc] !== 9) {
              if (board[cr][cc] === 0) {
                addImplication(r, c, 1, cr, cc, 2);
                addImplication(cr, cc, 1, r, c, 2);
              }
              cr += dr;
              cc += dc;
            }
          }
        }
      }
    }

    const visited = new Array(n).fill(false);
    const order: number[] = [];

    const dfs1 = (u: number) => {
      visited[u] = true;
      for (const v of adj[u]) {
        if (!visited[v]) dfs1(v);
      }
      order.push(u);
    };

    for (let i = 0; i < n; i++) {
      if (!visited[i]) dfs1(i);
    }

    const comp = new Array(n).fill(-1);
    let compCount = 0;

    const dfs2 = (u: number, c: number) => {
      comp[u] = c;
      for (const v of rev[u]) {
        if (comp[v] === -1) dfs2(v, c);
      }
    };

    for (let i = n - 1; i >= 0; i--) {
      const u = order[i];
      if (comp[u] === -1) {
        dfs2(u, compCount++);
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 0) {
          const lId = litToId(r, c, 1);
          const dId = litToId(r, c, 2);
          if (comp[lId] !== -1 && comp[dId] !== -1) {
            if (comp[lId] > comp[dId]) {
              steps.push({
                step: 1,
                type: 'twosat_scc_collapse',
                r,
                c,
                state: 1,
                rationale: `2-SAT 強連通拓撲崩塌：(${r + 1},${c + 1}) 蘊含路徑強制為 Light`,
                humanReadable: {
                  zh: `觸發 2-SAT 鏈條拓撲推演：此處強制點亮 💡！`,
                  en: `2-SAT implication resolved: light forced at this cell 💡!`,
                },
              });
            }
          }
        }
      }
    }

    return steps;
  }
}

export class LazySymmetricReductioEngine {
  public static deduce(
    rows: number,
    cols: number,
    blackBlocks: { r: number; c: number; clue: number | null }[],
    currentBoard: number[][],
    lastAffectedR: number = -1,
    lastAffectedC: number = -1,
    maxLookahead: number = 3
  ): LightUpStep | null {
    const candidateSpots = this.getSparseCandidates(rows, cols, currentBoard, lastAffectedR, lastAffectedC);

    for (const [candR, candC] of candidateSpots) {
      const boardLight = currentBoard.map((row) => [...row]);
      boardLight[candR][candC] = 1;
      if (this.detectFastConflict(rows, cols, blackBlocks, boardLight, maxLookahead)) {
        return {
          step: 1,
          type: 'positive_reductio',
          r: candR,
          c: candC,
          state: 2,
          rationale: `正向歸謬：假設在 [${candR + 1},${candC + 1}] 放燈必然引發衝突，故此處必為防護點 •`,
          humanReadable: {
            zh: `正向歸謬推演：此格若放燈必將陷入死局，此處必為防護點 •！`,
            en: `Proof by contradiction: placing light here causes dead-end, must be dot •!`,
          },
        };
      }

      const boardDot = currentBoard.map((row) => [...row]);
      boardDot[candR][candC] = 2;
      if (this.detectFastConflict(rows, cols, blackBlocks, boardDot, maxLookahead)) {
        return {
          step: 1,
          type: 'negative_reductio',
          r: candR,
          c: candC,
          state: 1,
          rationale: `反向歸謬：若在 [${candR + 1},${candC + 1}] 標記為防護點將導致無解，此處必放燈 💡`,
          humanReadable: {
            zh: `反向歸謬推演：此格若不放燈周圍線索將無法滿足，此處必放燈泡 💡！`,
            en: `Negative reductio: leaving this cell dark causes impossibility, must be light 💡!`,
          },
        };
      }
    }

    return null;
  }

  private static getSparseCandidates(
    rows: number,
    cols: number,
    board: number[][],
    lastR: number,
    lastC: number
  ): [number, number][] {
    const scored: { r: number; c: number; score: number }[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 0) {
          let score = 0;
          if (lastR >= 0 && lastC >= 0) {
            const manhattan = Math.abs(r - lastR) + Math.abs(c - lastC);
            if (manhattan <= 2) score += 20;
          }
          const centerDist = Math.abs(r - rows / 2) + Math.abs(c - cols / 2);
          score -= centerDist;
          scored.push({ r, c, score });
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 6).map((item) => [item.r, item.c]);
  }

  private static detectFastConflict(
    rows: number,
    cols: number,
    blackBlocks: { r: number; c: number; clue: number | null }[],
    board: number[][],
    depth: number
  ): boolean {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (let step = 0; step < depth; step++) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (board[r][c] === 1) {
            for (const [dr, dc] of dirs) {
              let cr = r + dr, cc = c + dc;
              while (cr >= 0 && cr < rows && cc >= 0 && cc < cols && board[cr][cc] !== 9) {
                if (board[cr][cc] === 1) return true;
                cr += dr;
                cc += dc;
              }
            }
          }
        }
      }

      for (const b of blackBlocks) {
        if (b.clue === null) continue;
        let bulbs = 0, open = 0;
        for (const [dr, dc] of dirs) {
          const nr = b.r + dr, nc = b.c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] !== 9) {
            if (board[nr][nc] === 1) bulbs++;
            else if (board[nr][nc] === 0) open++;
          }
        }
        if (bulbs > b.clue) return true;
        if (bulbs + open < b.clue) return true;
      }

      const pbSteps = PseudoBooleanPropagator.propagate(rows, cols, blackBlocks, board);
      if (pbSteps.length === 0) break;
      for (const s of pbSteps) {
        if (board[s.r][s.c] !== 0 && board[s.r][s.c] !== s.state) return true;
        board[s.r][s.c] = s.state;
      }
    }

    return false;
  }
}

export class CognitiveFlowMeter {
  public static evaluate(
    steps: LightUpStep[],
    totalWhiteCells: number
  ): { decayScore: number; eurekaMoments: number; isHarmonic: boolean } {
    if (steps.length < 3) {
      return { decayScore: 1.0, eurekaMoments: 0, isHarmonic: true };
    }

    let eurekaMoments = 0;
    for (let i = 1; i < steps.length - 2; i++) {
      const isHighOrder = DEDUCTION_PRIORITY[steps[i].type] <= 60;
      if (isHighOrder) {
        eurekaMoments++;
      }
    }

    const highTierCount = steps.filter(
      (s) =>
        s.type === 'adjacent_clue_xor' ||
        s.type === 'twosat_scc_collapse' ||
        s.type === 'positive_reductio' ||
        s.type === 'negative_reductio'
    ).length;

    const isHarmonic = highTierCount > 0 ? eurekaMoments >= 1 : true;
    return {
      decayScore: Number(Math.min(1.0, 0.7 + eurekaMoments * 0.1).toFixed(2)),
      eurekaMoments,
      isHarmonic,
    };
  }
}

export class WebLightUpGenerator {
  public static inBounds(r: number, c: number, rows: number, cols: number): boolean {
    return r >= 0 && r < rows && c >= 0 && c < cols;
  }

  public static getIlluminatedCells(
    r: number,
    c: number,
    rows: number,
    cols: number,
    isBlackBlock: (r: number, c: number) => boolean
  ): [number, number][] {
    const list: [number, number][] = [[r, c]];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const [dr, dc] of dirs) {
      let currR = r + dr;
      let currC = c + dc;
      while (this.inBounds(currR, currC, rows, cols) && !isBlackBlock(currR, currC)) {
        list.push([currR, currC]);
        currR += dr;
        currC += dc;
      }
    }
    return list;
  }

  public static countSolutions(
    rows: number,
    cols: number,
    blackBlocks: { r: number; c: number; clue: number | null }[],
    limit: number = 2
  ): number {
    const isBlock = Array.from({ length: rows }, () => Array(cols).fill(false));
    const clueMap = new Map<string, number>();

    for (const b of blackBlocks) {
      isBlock[b.r][b.c] = true;
      if (b.clue !== null) clueMap.set(`${b.r},${b.c}`, b.clue);
    }

    const whiteCells: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isBlock[r][c]) whiteCells.push([r, c]);
      }
    }

    const cellBulb = Array.from({ length: rows }, () => Array(cols).fill(false));
    const cellLitCount = Array.from({ length: rows }, () => Array(cols).fill(0));
    let solutions = 0;
    let stepBudget = Math.max(500, rows * cols * 20);

    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    const checkCluesValid = (partial: boolean): boolean => {
      for (const [key, quota] of clueMap.entries()) {
        const [br, bc] = key.split(',').map(Number);
        let bulbs = 0;
        let open = 0;
        for (const [dr, dc] of dirs) {
          const nr = br + dr;
          const nc = bc + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            if (cellBulb[nr][nc]) bulbs++;
            else if (!isBlock[nr][nc] && cellLitCount[nr][nc] === 0) open++;
          }
        }
        if (bulbs > quota) return false;
        if (!partial && bulbs !== quota) return false;
        if (partial && bulbs + open < quota) return false;
      }
      return true;
    };

    const toggleBulbRay = (r: number, c: number, delta: number) => {
      cellBulb[r][c] = delta > 0;
      cellLitCount[r][c] += delta;
      for (const [dr, dc] of dirs) {
        let cr = r + dr;
        let cc = c + dc;
        while (cr >= 0 && cr < rows && cc >= 0 && cc < cols && !isBlock[cr][cc]) {
          cellLitCount[cr][cc] += delta;
          cr += dr;
          cc += dc;
        }
      }
    };

    const backtrack = (idx: number) => {
      if (solutions >= limit || stepBudget-- <= 0) return;

      if (idx === whiteCells.length) {
        if (checkCluesValid(false)) {
          const allLit = whiteCells.every(([wr, wc]) => cellLitCount[wr][wc] > 0);
          if (allLit) solutions++;
        }
        return;
      }

      const [r, c] = whiteCells[idx];

      if (cellLitCount[r][c] === 0) {
        toggleBulbRay(r, c, 1);
        if (checkCluesValid(true)) {
          backtrack(idx + 1);
        }
        toggleBulbRay(r, c, -1);
        backtrack(idx + 1);
      } else {
        backtrack(idx + 1);
      }
    };

    backtrack(0);
    return solutions;
  }

  public static getStrictDeductions(
    rows: number,
    cols: number,
    blackBlocks: { r: number; c: number; clue: number | null }[],
    currentBoard: number[][]
  ): Map<string, LightUpStep> {
    const deductions = new Map<string, LightUpStep>();
    const isBlock = (r: number, c: number) => currentBoard[r][c] === 9;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const b of blackBlocks) {
      if (b.clue === 0) {
        for (const [dr, dc] of dirs) {
          const nr = b.r + dr;
          const nc = b.c + dc;
          if (this.inBounds(nr, nc, rows, cols) && currentBoard[nr][nc] === 0) {
            deductions.set(`${nr},${nc}`, {
              step: 1,
              type: 'zero_black_cross',
              r: nr,
              c: nc,
              state: 2,
              rationale: '黑塊線索為 0，周邊 4 格絕不可放燈泡',
              humanReadable: {
                zh: '黑塊數字為 0，周邊 4 向完全不能放燈，全數標記防護點 •！',
                en: 'Clue 0 forbids any lights nearby; mark with protective dot •!',
              },
            });
          }
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (currentBoard[r][c] === 1) {
          const illuminated = this.getIlluminatedCells(r, c, rows, cols, isBlock);
          for (const [ir, ic] of illuminated) {
            if (!(ir === r && ic === c) && currentBoard[ir][ic] === 0) {
              deductions.set(`${ir},${ic}`, {
                step: 1,
                type: 'ray_no_clash',
                r: ir,
                c: ic,
                state: 2,
                rationale: '處於現有燈泡的光線上，禁止再放燈泡',
                humanReadable: {
                  zh: '此格已經被現有燈泡光束照亮，此處不可再放燈！',
                  en: 'Already illuminated; no additional bulbs allowed in this line of sight!',
                },
              });
            }
          }
        }
      }
    }

    for (const b of blackBlocks) {
      if (b.clue !== null && b.clue > 0) {
        const open: [number, number][] = [];
        let bulbCount = 0;

        for (const [dr, dc] of dirs) {
          const nr = b.r + dr;
          const nc = b.c + dc;
          if (this.inBounds(nr, nc, rows, cols)) {
            if (currentBoard[nr][nc] === 1) bulbCount++;
            else if (currentBoard[nr][nc] === 0) open.push([nr, nc]);
          }
        }

        if (bulbCount === b.clue && open.length > 0) {
          for (const [or, oc] of open) {
            deductions.set(`${or},${oc}`, {
              step: 1,
              type: 'clue_saturated_dot',
              r: or,
              c: oc,
              state: 2,
              rationale: `黑塊線索 ${b.clue} 燈泡已達標，其餘空格全數標記防護點`,
              humanReadable: {
                zh: `黑塊數字 ${b.clue} 燈泡數已達標，其餘空格皆標記為防護點 •！`,
                en: `Clue ${b.clue} quota met; all remaining spaces must be dotted •!`,
              },
            });
          }
        } else if (bulbCount + open.length === b.clue && open.length > 0) {
          for (const [or, oc] of open) {
            deductions.set(`${or},${oc}`, {
              step: 1,
              type: 'clue_forced_light',
              r: or,
              c: oc,
              state: 1,
              rationale: `黑塊線索 ${b.clue} 剩餘空格恰等於缺額，全數必為燈泡`,
              humanReadable: {
                zh: `黑塊剩餘空格恰好等於缺額，全數必須放置燈泡 💡！`,
                en: `Remaining spaces match deficit for clue ${b.clue}; all must be lights 💡!`,
              },
            });
          }
        }
      }
    }

    const isCellLit = Array.from({ length: rows }, () => Array(cols).fill(false));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (currentBoard[r][c] === 1) {
          const litList = this.getIlluminatedCells(r, c, rows, cols, isBlock);
          for (const [lr, lc] of litList) isCellLit[lr][lc] = true;
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (currentBoard[r][c] !== 9 && !isCellLit[r][c]) {
          const potentialBulbSpots: [number, number][] = [];
          const testDirs = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];

          for (const [dr, dc] of testDirs) {
            let currR = r + dr;
            let currC = c + dc;
            while (this.inBounds(currR, currC, rows, cols) && !isBlock(currR, currC)) {
              if (currentBoard[currR][currC] === 0) {
                potentialBulbSpots.push([currR, currC]);
              }
              if (dr === 0 && dc === 0) break;
              currR += dr;
              currC += dc;
            }
          }

          if (potentialBulbSpots.length === 1) {
            const [br, bc] = potentialBulbSpots[0];
            deductions.set(`${br},${bc}`, {
              step: 1,
              type: 'isolated_illuminance',
              r: br,
              c: bc,
              state: 1,
              rationale: `格子 (${r + 1},${c + 1}) 僅能由 (${br + 1},${bc + 1}) 照亮，必放燈泡`,
              humanReadable: {
                zh: `格子 [${r + 1}, ${c + 1}] 僅存單一光源位置，該處必放燈泡 💡！`,
                en: `Cell [${r + 1}, ${c + 1}] has only one candidate spot; must place light 💡!`,
              },
            });
          }
        }
      }
    }

    const pbSteps = PseudoBooleanPropagator.propagate(rows, cols, blackBlocks, currentBoard);
    for (const p of pbSteps) {
      if (!deductions.has(`${p.r},${p.c}`)) {
        deductions.set(`${p.r},${p.c}`, p);
      }
    }

    return deductions;
  }

  private static traceSolvingProcess(
    rows: number,
    cols: number,
    blackBlocks: { r: number; c: number; clue: number | null }[]
  ): { steps: LightUpStep[]; maxForcedChain: number; pureRate: number; eurekaMoments: number; monotonicity: number } {
    const curBoard: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const b of blackBlocks) curBoard[b.r][b.c] = 9;

    const steps: LightUpStep[] = [];
    let progressed = true;
    let stepCount = 0;
    let currentChain = 0;
    let maxChain = 0;
    let lastR = -1;
    let lastC = -1;

    while (progressed) {
      progressed = false;
      const deductions = this.getStrictDeductions(rows, cols, blackBlocks, curBoard);

      if (deductions.size > 0) {
        const sorted = Array.from(deductions.values()).sort((a, b) => {
          const pA = DEDUCTION_PRIORITY[a.type] ?? 0;
          const pB = DEDUCTION_PRIORITY[b.type] ?? 0;
          return pB - pA;
        });

        const chosen = sorted[0];
        curBoard[chosen.r][chosen.c] = chosen.state;
        lastR = chosen.r;
        lastC = chosen.c;
        stepCount++;
        currentChain++;
        maxChain = Math.max(maxChain, currentChain);

        steps.push({
          step: stepCount,
          type: chosen.type,
          r: chosen.r,
          c: chosen.c,
          state: chosen.state,
          rationale: chosen.rationale,
          humanReadable: chosen.humanReadable,
        });

        progressed = true;
      } else {
        const twoSatSteps = TwoSatEngine.solve(rows, cols, blackBlocks, curBoard);
        if (twoSatSteps.length > 0) {
          const chosen = twoSatSteps[0];
          curBoard[chosen.r][chosen.c] = chosen.state;
          lastR = chosen.r;
          lastC = chosen.c;
          stepCount++;
          steps.push({ ...chosen, step: stepCount });
          progressed = true;
          continue;
        }

        const reductioStep = LazySymmetricReductioEngine.deduce(
          rows,
          cols,
          blackBlocks,
          curBoard,
          lastR,
          lastC,
          3
        );

        if (reductioStep) {
          curBoard[reductioStep.r][reductioStep.c] = reductioStep.state;
          lastR = reductioStep.r;
          lastC = reductioStep.c;
          stepCount++;
          steps.push({ ...reductioStep, step: stepCount });
          progressed = true;
          continue;
        }

        currentChain = 0;
      }
    }

    const totalWhiteCells = rows * cols - blackBlocks.length;
    const pureRate = totalWhiteCells > 0 ? Number((steps.length / totalWhiteCells).toFixed(2)) : 1.0;
    const flow = CognitiveFlowMeter.evaluate(steps, totalWhiteCells);

    return {
      steps,
      maxForcedChain: maxChain,
      pureRate: Math.min(1.0, pureRate),
      eurekaMoments: flow.eurekaMoments,
      monotonicity: flow.decayScore,
    };
  }

  private static generateValidGroundTruth(
    rows: number,
    cols: number,
    blackRatio: number,
    clueRatio: number,
    allowSymmetry: boolean,
    tier: TierKey,
    rnd: () => number
  ): {
    blackBlocks: { r: number; c: number; clue: number | null }[];
    solutionBulbs: LightUpCoord[];
  } | null {
    const isBlack: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
    const targetBlocks = Math.floor(rows * cols * blackRatio);

    let placed = 0;
    let attempts = 0;
    while (placed < targetBlocks && attempts < 250) {
      attempts++;
      const r = Math.floor(rnd() * rows);
      const c = Math.floor(rnd() * cols);

      if (allowSymmetry) {
        const symR = rows - 1 - r;
        const symC = cols - 1 - c;
        if (!isBlack[r][c] && !isBlack[symR][symC]) {
          isBlack[r][c] = true;
          isBlack[symR][symC] = true;
          placed += r === symR && c === symC ? 1 : 2;
        }
      } else {
        if (!isBlack[r][c]) {
          isBlack[r][c] = true;
          placed++;
        }
      }
    }

    if (!DynamicTopologyValidator.validate(tier, rows, cols, isBlack)) {
      return null;
    }

    const isBlock = (r: number, c: number) => isBlack[r][c];
    const isLit: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
    const bulbs: LightUpCoord[] = [];

    const whiteCoords: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isBlack[r][c]) whiteCoords.push([r, c]);
      }
    }

    whiteCoords.sort((a, b) => {
      const spanA = this.getIlluminatedCells(a[0], a[1], rows, cols, isBlock).length;
      const spanB = this.getIlluminatedCells(b[0], b[1], rows, cols, isBlock).length;
      return spanB - spanA + (rnd() - 0.5) * 2;
    });

    for (const [r, c] of whiteCoords) {
      if (isLit[r][c]) continue;

      const ray = this.getIlluminatedCells(r, c, rows, cols, isBlock);
      const clash = ray.some(([ir, ic]) => bulbs.some((b) => b.r === ir && b.c === ic));
      if (!clash) {
        bulbs.push({ r, c });
        for (const [ir, ic] of ray) {
          isLit[ir][ic] = true;
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isBlack[r][c] && !isLit[r][c]) return null;
      }
    }

    const blackBlocks: { r: number; c: number; clue: number | null }[] = [];
    const orth = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (isBlack[r][c]) {
          let count = 0;
          for (const [dr, dc] of orth) {
            const nr = r + dr;
            const nc = c + dc;
            if (this.inBounds(nr, nc, rows, cols) && bulbs.some((b) => b.r === nr && b.c === nc)) {
              count++;
            }
          }
          const willGiveClue = rnd() < clueRatio;
          blackBlocks.push({ r, c, clue: willGiveClue ? count : null });
        }
      }
    }

    return { blackBlocks, solutionBulbs: bulbs };
  }

  public static generate(tier: TierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const requestedSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, blackBlockRatio, clueRatio, baseIrt, timeLimitSec, allowSymmetry } = config;

    let perturbation = 0;
    const maxPerturbations = 25;

    while (perturbation < maxPerturbations) {
      const currentSeed = (requestedSeed + Math.imul(perturbation, 0x9e3779b9)) >>> 0;
      const rnd = mulberry32(currentSeed);

      let attempts = 0;
      const maxAttempts = 12;

      while (attempts++ < maxAttempts) {
        const groundTruth = this.generateValidGroundTruth(
          rows,
          cols,
          blackBlockRatio,
          clueRatio,
          allowSymmetry,
          tier,
          rnd
        );
        if (!groundTruth) continue;

        const { blackBlocks, solutionBulbs } = groundTruth;

        if (this.countSolutions(rows, cols, blackBlocks, 2) !== 1) {
          continue;
        }

        const { steps, maxForcedChain, pureRate, eurekaMoments, monotonicity } = this.traceSolvingProcess(
          rows,
          cols,
          blackBlocks
        );

        const minRequiredPureRate = tier === 'kids' ? 0.85 : tier === 'intermediate' ? 0.75 : 0.65;
        if (pureRate < minRequiredPureRate) {
          continue;
        }

        const dynamicIrt = Number((baseIrt + (1 - pureRate) * 0.5 + eurekaMoments * 0.15).toFixed(2));
        const puzzleId = `lightup_${tier}_s${requestedSeed}_p${perturbation}`;

        const spec: LightUpSpec = {
          rows,
          cols,
          blackBlocks,
          solutionBulbs,
          solvingSteps: steps,
          maxForcedChain,
          pureDeductionRate: pureRate,
          decayMonotonicity: monotonicity,
          eurekaMoments,
          isSymmetric180: allowSymmetry,
          tier,
          seed: currentSeed,
        };

        return {
          id: puzzleId,
          category: 'spatial_logic',
          engine_type: 'lightup',
          tier,
          checksum: `WPC_LIGHTUP_${rows}x${cols}_S${currentSeed}`,
          puzzle: spec as any,
          solution: { bulbs: solutionBulbs } as any,
          cognitiveLoad: {
            spatial: 0.98,
            numeric: 0.4,
            workingMemory: Number(Math.min(1.0, 0.45 + eurekaMoments * 0.12).toFixed(2)),
            inhibition: 0.95,
          },
          metrics: {
            grid_size: rows,
            rows,
            cols,
            estimated_time_sec: timeLimitSec,
            irt_logit_difficulty: dynamicIrt,
            human_sim_steps: steps.length,
            pureDeductionRate: pureRate,
            decayMonotonicity: monotonicity,
            eurekaMoments,
            requestedSeed,
            effectiveSeed: currentSeed,
            perturbationJumps: perturbation,
            actualTier: tier,
          } as any,
        };
      }

      perturbation++;
    }

    const emergencySalt = (requestedSeed ^ 0x5deece66d) >>> 0;
    return this.generate(tier, emergencySalt);
  }
}
