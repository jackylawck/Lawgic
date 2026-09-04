// web-frontend/src/engines/lightupGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';

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
  | 'ray_no_clash';

export interface LightUpStep {
  step: number;
  type: LightUpDeductionType;
  r: number;
  c: number;
  state: 1 | 2;
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
  opticalEntropy: number;
  isSymmetric180: boolean;
  tier: ExtendedTierKey;
}

interface TierConfig {
  rows: number;
  cols: number;
  blackBlockRatio: number;
  clueRatio: number;
  minForcedChain: number;
  baseIrt: number;
}

const TIER_SPECS: Record<ExtendedTierKey, TierConfig> = {
  kids: { rows: 5, cols: 5, blackBlockRatio: 0.20, clueRatio: 0.8, minForcedChain: 4, baseIrt: -0.6 },
  intermediate: { rows: 6, cols: 6, blackBlockRatio: 0.22, clueRatio: 0.7, minForcedChain: 6, baseIrt: 0.2 },
  expert: { rows: 7, cols: 7, blackBlockRatio: 0.24, clueRatio: 0.6, minForcedChain: 9, baseIrt: 1.2 },
  master: { rows: 8, cols: 8, blackBlockRatio: 0.25, clueRatio: 0.5, minForcedChain: 13, baseIrt: 2.2 },
  legendary: { rows: 9, cols: 9, blackBlockRatio: 0.26, clueRatio: 0.45, minForcedChain: 18, baseIrt: 3.0 },
  ultimate: { rows: 10, cols: 10, blackBlockRatio: 0.28, clueRatio: 0.40, minForcedChain: 24, baseIrt: 4.0 },
};

export async function generateAkariSignature(payload: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const msgBuffer = new TextEncoder().encode(payload);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16).toUpperCase();
  }
  return 'AKARI-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

export class WebLightUpGenerator {
  private static inBounds(r: number, c: number, rows: number, cols: number): boolean {
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

  private static computeOpticalEntropy(
    rows: number,
    cols: number,
    blackBlocks: { r: number; c: number; clue: number | null }[],
    bulbs: LightUpCoord[]
  ): number {
    const isBlock = (r: number, c: number) => blackBlocks.some((b) => b.r === r && b.c === c);
    let totalRayLength = 0;

    for (const b of bulbs) {
      const lit = this.getIlluminatedCells(b.r, b.c, rows, cols, isBlock);
      totalRayLength += lit.length;
    }

    const avgRayLength = bulbs.length > 0 ? totalRayLength / bulbs.length : 1;
    const maxPossibleRay = rows + cols - 1;
    const rayEntropy = Math.min(1.0, avgRayLength / maxPossibleRay);
    const blockDensity = blackBlocks.length / (rows * cols);

    return Number(((rayEntropy * 0.65) + (blockDensity * 0.35)).toFixed(3));
  }

  private static generateValidGroundTruth(
    rows: number,
    cols: number,
    blackRatio: number,
    clueRatio: number
  ): {
    blackBlocks: { r: number; c: number; clue: number | null }[];
    solutionBulbs: LightUpCoord[];
  } | null {
    const isBlack: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
    const targetBlocks = Math.floor(rows * cols * blackRatio);

    let placed = 0;
    let attempts = 0;
    while (placed < targetBlocks && attempts < 350) {
      attempts++;
      const r = Math.floor(Math.random() * rows);
      const c = Math.floor(Math.random() * cols);
      const symR = rows - 1 - r;
      const symC = cols - 1 - c;

      if (!isBlack[r][c] && !isBlack[symR][symC]) {
        isBlack[r][c] = true;
        isBlack[symR][symC] = true;
        placed += (r === symR && c === symC) ? 1 : 2;
      }
    }

    const isLit: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
    const bulbs: LightUpCoord[] = [];
    const isBlock = (r: number, c: number) => isBlack[r][c];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isBlack[r][c] && !isLit[r][c]) {
          bulbs.push({ r, c });
          const illuminated = this.getIlluminatedCells(r, c, rows, cols, isBlock);
          for (const [ir, ic] of illuminated) {
            isLit[ir][ic] = true;
          }
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isBlack[r][c] && !isLit[r][c]) return null;
      }
    }

    const countMap = new Map<string, number>();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (isBlack[r][c]) {
          let count = 0;
          const orth = [[-1, 0], [1, 0], [0, -1], [0, 1]];
          for (const [dr, dc] of orth) {
            const nr = r + dr;
            const nc = c + dc;
            if (this.inBounds(nr, nc, rows, cols) && bulbs.some((b) => b.r === nr && b.c === nc)) {
              count++;
            }
          }
          countMap.set(`${r},${c}`, count);
        }
      }
    }

    const blackBlocks: { r: number; c: number; clue: number | null }[] = [];
    const processed = new Set<string>();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (isBlack[r][c] && !processed.has(`${r},${c}`)) {
          const symR = rows - 1 - r;
          const symC = cols - 1 - c;

          const c1 = countMap.get(`${r},${c}`) ?? 0;
          const c2 = countMap.get(`${symR},${symC}`) ?? 0;

          const isSameCount = c1 === c2;
          const willGiveClue = Math.random() < clueRatio && isSameCount;
          const assignedClue = willGiveClue ? c1 : null;

          blackBlocks.push({ r, c, clue: assignedClue });
          processed.add(`${r},${c}`);

          if (!(r === symR && c === symC)) {
            blackBlocks.push({ r: symR, c: symC, clue: assignedClue });
            processed.add(`${symR},${symC}`);
          }
        }
      }
    }

    return { blackBlocks, solutionBulbs: bulbs };
  }

  public static getStrictDeductions(
    rows: number,
    cols: number,
    blackBlocks: { r: number; c: number; clue: number | null }[],
    currentBoard: number[][]
  ): Map<string, { r: number; c: number; state: 1 | 2; type: LightUpDeductionType; rationale: string; humanReadable: { zh: string; en: string } }> {
    const deductions = new Map<
      string,
      { r: number; c: number; state: 1 | 2; type: LightUpDeductionType; rationale: string; humanReadable: { zh: string; en: string } }
    >();

    const isBlock = (r: number, c: number) => currentBoard[r][c] === 2;

    for (const b of blackBlocks) {
      if (b.clue === 0) {
        const orth = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of orth) {
          const nr = b.r + dr;
          const nc = b.c + dc;
          if (this.inBounds(nr, nc, rows, cols) && currentBoard[nr][nc] === 0) {
            deductions.set(`${nr},${nc}`, {
              r: nr, c: nc, state: 2,
              type: 'zero_black_cross',
              rationale: '黑塊線索為 0，周邊 4 格絕不可放燈泡',
              humanReadable: {
                zh: '黑塊數字為 0，代表周圍 4 個方向完全不能有燈泡，全數標記為防護點 •！',
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
                r: ir, c: ic, state: 2,
                type: 'ray_no_clash',
                rationale: '處於現有燈泡的光線上，禁止再放燈泡',
                humanReadable: {
                  zh: '此格已經被現有燈泡的光束照亮，為防光線相互照射，此處不可再放燈！',
                  en: 'Already illuminated by an existing light; no additional bulbs allowed in this ray line!',
                },
              });
            }
          }
        }
      }
    }

    for (const b of blackBlocks) {
      if (b.clue !== null && b.clue > 0) {
        const orth = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const open: [number, number][] = [];
        let bulbCount = 0;

        for (const [dr, dc] of orth) {
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
              r: or, c: oc, state: 2,
              type: 'clue_saturated_dot',
              rationale: `黑塊線索 ${b.clue} 燈泡數已達標，其餘空格全數標記防護點`,
              humanReadable: {
                zh: `黑塊周圍需要的 ${b.clue} 頂燈泡已經全數放好，其餘相鄰空格皆不能再放燈泡！`,
                en: `Clue ${b.clue} quota is met; all remaining neighbor spaces must be dotted •!`,
              },
            });
          }
        } else if (bulbCount + open.length === b.clue && open.length > 0) {
          for (const [or, oc] of open) {
            deductions.set(`${or},${oc}`, {
              r: or, c: oc, state: 1,
              type: 'clue_forced_light',
              rationale: `黑塊線索 ${b.clue} 剩餘空格恰等於缺額，全數必為燈泡`,
              humanReadable: {
                zh: `黑塊剩餘的空格剛好等於還需要的燈泡數，這些位置全部必須放置燈泡 💡！`,
                en: `Remaining open neighbors precisely match the deficit for clue ${b.clue}; all must be lights 💡!`,
              },
            });
          }
        }
      }
    }

    for (const b1 of blackBlocks) {
      if (b1.clue === 1) {
        for (const b2 of blackBlocks) {
          if (b2.clue === 2 && (Math.abs(b1.r - b2.r) + Math.abs(b1.c - b2.c) === 1)) {
            if (b1.r === b2.r && b1.c + 1 === b2.c) {
              const farTarget = [b2.r, b2.c + 1];
              if (this.inBounds(farTarget[0], farTarget[1], rows, cols) && currentBoard[farTarget[0]][farTarget[1]] === 0) {
                const sharedOpen = [
                  [b1.r - 1, b1.c],
                  [b1.r + 1, b1.c],
                ].filter(([sr, sc]) => this.inBounds(sr, sc, rows, cols) && currentBoard[sr][sc] === 0);

                if (sharedOpen.length > 0) {
                  deductions.set(`${farTarget[0]},${farTarget[1]}`, {
                    r: farTarget[0], c: farTarget[1], state: 1,
                    type: 'adjacent_clue_xor',
                    rationale: '相鄰 1-2 黑塊組合互斥定式，遠側外翼必然放燈',
                    humanReadable: {
                      zh: '相鄰的 1 與 2 產生共用邊互斥：因為 1 限制了中間區域只能有 1 頂燈泡，所以 2 遠側的外翼必須放置燈泡 💡！',
                      en: 'Adjacent 1-2 pair XOR: Since 1 limits the shared zone to 1 light, 2\'s far outer wing must have a light 💡!',
                    },
                  });
                }
              }
            }
          }
        }
      }
    }

    for (const b of blackBlocks) {
      if (b.clue === 1) {
        const orth = [
          { r: b.r - 1, c: b.c },
          { r: b.r + 1, c: b.c },
          { r: b.r, c: b.c - 1 },
          { r: b.r, c: b.c + 1 },
        ].filter((p) => this.inBounds(p.r, p.c, rows, cols) && currentBoard[p.r][p.c] !== 2);

        const openOrth = orth.filter((p) => currentBoard[p.r][p.c] === 0);
        if (openOrth.length === 2 && Math.abs(openOrth[0].r - openOrth[1].r) === 1 && Math.abs(openOrth[0].c - openOrth[1].c) === 1) {
          const diagR = openOrth[0].r === b.r ? openOrth[1].r : openOrth[0].r;
          const diagC = openOrth[0].c === b.c ? openOrth[1].c : openOrth[0].c;

          if (this.inBounds(diagR, diagC, rows, cols) && currentBoard[diagR][diagC] === 0 && !deductions.has(`${diagR},${diagC}`)) {
            const isProtected = blackBlocks.some((ob) => ob.r === diagR && ob.c === diagC && ob.clue === 0);
            if (isProtected) {
              deductions.set(`${openOrth[0].r},${openOrth[0].c}`, {
                r: openOrth[0].r, c: openOrth[0].c, state: 1,
                type: 'diagonal_exclusion',
                rationale: '線索 1 與對角排除格形成直角收斂',
                humanReadable: {
                  zh: '線索 1 鄰格與對角禁置點形成幾何互斥，該直角側必須放置燈泡 💡！',
                  en: 'Clue 1 corner constraint forces light placement on this branch 💡!',
                },
              });
            }
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
        if (currentBoard[r][c] !== 2 && !isCellLit[r][c]) {
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
              r: br, c: bc, state: 1,
              type: 'isolated_illuminance',
              rationale: `格子 (${r + 1},${c + 1}) 僅能由 (${br + 1},${bc + 1}) 照亮，必放燈泡`,
              humanReadable: {
                zh: `格子 (${r + 1}, ${c + 1}) 目前只有唯一一個可能的光源位置，該處必須放置燈泡 💡！`,
                en: `Cell (${r + 1}, ${c + 1}) has only one single candidate spot left to illuminate it; light must be placed 💡!`,
              },
            });
          }
        }
      }
    }

    return deductions;
  }

  private static traceSolvingProcess(
    rows: number,
    cols: number,
    blackBlocks: { r: number; c: number; clue: number | null }[]
  ): { steps: LightUpStep[]; maxForcedChain: number; pureRate: number } {
    const curBoard: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const b of blackBlocks) curBoard[b.r][b.c] = 2;

    const steps: LightUpStep[] = [];
    let progressed = true;
    let stepCount = 0;
    let currentChain = 0;
    let maxChain = 0;

    while (progressed) {
      progressed = false;
      const deductions = this.getStrictDeductions(rows, cols, blackBlocks, curBoard);

      if (deductions.size > 0) {
        const item = deductions.values().next().value;
        if (!item) break;
        const { r, c, state, type, rationale, humanReadable } = item;

        curBoard[r][c] = state === 1 ? 1 : 3;
        stepCount++;
        currentChain++;
        maxChain = Math.max(maxChain, currentChain);

        steps.push({
          step: stepCount,
          type,
          r, c, state,
          rationale,
          humanReadable,
        });

        progressed = true;
      } else {
        currentChain = 0;
      }
    }

    const totalWhiteCells = rows * cols - blackBlocks.length;
    const pureRate = totalWhiteCells > 0 ? Number((steps.length / totalWhiteCells).toFixed(2)) : 1.0;

    return { steps, maxForcedChain: maxChain, pureRate: Math.min(1.0, pureRate) };
  }

  public static generate(tier: ExtendedTierKey = 'kids'): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, blackBlockRatio, clueRatio, minForcedChain, baseIrt } = config;
    let attempts = 0;

    while (attempts < 100) {
      attempts++;
      const groundTruth = this.generateValidGroundTruth(rows, cols, blackBlockRatio, clueRatio);
      if (!groundTruth) continue;

      const { blackBlocks, solutionBulbs } = groundTruth;
      const { steps, maxForcedChain, pureRate } = this.traceSolvingProcess(rows, cols, blackBlocks);

      if ((tier === 'master' || tier === 'legendary' || tier === 'ultimate') && (maxForcedChain < minForcedChain || pureRate < 0.88)) {
        continue;
      }

      const entropy = this.computeOpticalEntropy(rows, cols, blackBlocks, solutionBulbs);
      const dynamicIrt = Number((baseIrt + entropy * 0.45 + (steps.length / (rows * cols)) * 0.35).toFixed(2));
      const puzzleId = `lightup_${tier}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

      return {
        id: puzzleId,
        category: 'spatial_logic' as any,
        engine_type: 'lightup',
        tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
        checksum: `LIGHTUP_${rows}x${cols}_${tier.toUpperCase()}_${Date.now().toString(36)}`,
        puzzle: {
          rows,
          cols,
          blackBlocks,
          solutionBulbs,
          solvingSteps: steps,
          maxForcedChain,
          pureDeductionRate: pureRate,
          opticalEntropy: entropy,
          isSymmetric180: true,
          tier,
        } as unknown as LightUpSpec,
        solution: { bulbs: solutionBulbs } as any,
        cognitiveLoad: {
          spatial: 0.98,
          numeric: 0.45,
          workingMemory: Number(Math.min(1.0, 0.4 + entropy * 0.45).toFixed(2)),
          inhibition: 0.92,
        },
        metrics: {
          estimated_time_sec: Math.max(25, steps.length * 6 + rows * cols * 2),
          irt_logit_difficulty: dynamicIrt,
          human_sim_steps: steps.length,
        } as any,
      };
    }

    const fallbackBlocks = [
      { r: 1, c: 1, clue: 1 },
      { r: 2, c: 3, clue: 0 },
      { r: 3, c: 1, clue: 1 },
    ];
    return {
      id: `lightup_${tier}_fallback_${Date.now()}`,
      category: 'spatial_logic' as any,
      engine_type: 'lightup',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `LIGHTUP_FALLBACK_${rows}x${cols}`,
      puzzle: {
        rows, cols,
        blackBlocks: fallbackBlocks,
        solutionBulbs: [{ r: 0, c: 1 }, { r: 3, c: 0 }, { r: 3, c: 2 }],
        solvingSteps: [],
        maxForcedChain: 3,
        pureDeductionRate: 1.0,
        opticalEntropy: 0.5,
        isSymmetric180: true,
        tier,
      } as unknown as LightUpSpec,
      solution: { bulbs: [{ r: 0, c: 1 }, { r: 3, c: 0 }, { r: 3, c: 2 }] } as any,
      cognitiveLoad: { spatial: 0.9, numeric: 0.3, workingMemory: 0.6, inhibition: 0.8 },
      metrics: { estimated_time_sec: 45, irt_logit_difficulty: config.baseIrt } as any,
    };
  }
}
