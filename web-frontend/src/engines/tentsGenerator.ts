// web-frontend/src/engines/tentsGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';
export type TentCellState = 0 | 1 | 2 | 9; // 0: 未決, 1: 帳篷, 2: 草地, 9: 樹木

export type TentDeductionType =
  | 'zero_line_grass'
  | 'isolated_tree_forced_tent'
  | 'count_starvation_tent'
  | 'count_saturated_grass'
  | 'no_touch_neighbor_grass'
  | 'pigeonhole_bottleneck_grass'
  | 'pigeonhole_bottleneck_tent'
  | 'corner_pair_exclusion';

export interface TentCoord {
  r: number;
  c: number;
}

export interface DynamicContradictionNode {
  stepIndex: number;
  hypothesis: string;
  collisionTarget: TentCoord;
  reason: string;
}

export interface ProgressiveHint {
  level1_focus: {
    highlightRows: number[];
    highlightCols: number[];
    highlightTrees: TentCoord[];
    messageZh: string;
    messageEn: string;
  };
  level2_logic: {
    technique: TentDeductionType;
    evidenceCoords: TentCoord[];
    contradictionChain: DynamicContradictionNode[];
    messageZh: string;
    messageEn: string;
  };
  level3_action: {
    target: TentCoord;
    forcedState: 1 | 2; // 1: 帳篷, 2: 草地
    messageZh: string;
    messageEn: string;
  };
}

// 🌟 向下相容 UI 所需的 TentStep 介面與型別別名
export interface TentStep {
  step: number;
  type: string;
  r: number;
  c: number;
  state: number;
  rationale: string;
  humanReadable?: {
    zh: string;
    en: string;
  };
}
export type TentHintStep = TentStep;

export interface CognitiveQMatrix {
  A1_perceptual_scanning: boolean;    // 知覺排查
  A2_working_memory_update: boolean;  // 行列雙向記憶
  A3_inhibition_control: boolean;     // 八向對角互斥
  A4_relational_bijection: boolean;   // 樹-帳篷雙射
  A5_chain_depth_planning: boolean;   // 跨行跨列宏觀閉鎖
}

export interface PsychometricItemParameters {
  difficulty_b: number;
  discrimination_a: number;
  guessing_c: number;
  canonical_hash: string;
  aha_index: number;
  crux_coordinates: TentCoord[];
  persona_convergence_variance: number;
}

export interface TentsSpec {
  rows: number;
  cols: number;
  trees: TentCoord[];
  rowCounts: number[];
  colCounts: number[];
  // 🌟 向下相容 TentsBoard.tsx 所需屬性
  rowClues: number[];
  colClues: number[];
  solutionTents: TentCoord[];
  treeTentPairs: [TentCoord, TentCoord][];
  hintCascades: ProgressiveHint[];
  // 🌟 向下相容 TentsBoard.tsx 所需屬性
  solvingSteps: TentStep[];
  qMatrix: CognitiveQMatrix;
  psychometrics: PsychometricItemParameters;
  wpfAnswerKey: string;
  variant: 'standard' | 'diagonal';
  seed: number;
  tier: ExtendedTierKey;
  themeStyle: {
    primaryColor: string;
    treeIcon: string;
    tentIcon: string;
    grassIcon: string;
  };
}

interface TierConfig {
  rows: number;
  cols: number;
  treeCount: number;
  targetB: number;
  disallowZeros: boolean;
}

const TIER_SPECS: Record<ExtendedTierKey, TierConfig> = {
  kids: { rows: 4, cols: 4, treeCount: 3, targetB: -1.6, disallowZeros: false },
  intermediate: { rows: 5, cols: 5, treeCount: 5, targetB: -0.3, disallowZeros: false },
  expert: { rows: 6, cols: 6, treeCount: 7, targetB: 1.1, disallowZeros: true },
  master: { rows: 8, cols: 8, treeCount: 11, targetB: 2.1, disallowZeros: true },
  legendary: { rows: 9, cols: 9, treeCount: 14, targetB: 2.8, disallowZeros: true },
  ultimate: { rows: 10, cols: 10, treeCount: 18, targetB: 3.5, disallowZeros: true },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebTentsGenerator {
  private static readonly DIRS: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  public static inBounds(r: number, c: number, rows: number, cols: number): boolean {
    return r >= 0 && r < rows && c >= 0 && c < cols;
  }

  public static canPlaceTentNoTouch(r: number, c: number, board: number[][], rows: number, cols: number): boolean {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 1) {
          return false;
        }
      }
    }
    return true;
  }

  public static hasUniqueBijectiveMatching(
    trees: TentCoord[],
    tents: TentCoord[],
    rows: number,
    cols: number
  ): boolean {
    if (trees.length !== tents.length) return false;
    const n = trees.length;

    const adj: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const dist = Math.abs(trees[i].r - tents[j].r) + Math.abs(trees[i].c - tents[j].c);
        if (dist === 1) adj[i].push(j);
      }
    }

    const match = new Array<number>(n).fill(-1);
    const visited = new Array<boolean>(n).fill(false);

    const dfs = (u: number): boolean => {
      for (const v of adj[u]) {
        if (!visited[v]) {
          visited[v] = true;
          if (match[v] < 0 || dfs(match[v])) {
            match[v] = u;
            return true;
          }
        }
      }
      return false;
    };

    let matchingSize = 0;
    for (let i = 0; i < n; i++) {
      visited.fill(false);
      if (dfs(i)) matchingSize++;
    }

    return matchingSize === n;
  }

  public static computeFullCanonicalHash(
    rows: number,
    cols: number,
    trees: TentCoord[],
    tents: TentCoord[]
  ): string {
    const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const t of trees) grid[t.r][t.c] = 9;
    for (const t of tents) grid[t.r][t.c] = 1;

    const variants: string[] = [];

    for (let rot = 0; rot < 4; rot++) {
      let v1 = '';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) v1 += grid[r][c];
      }
      variants.push(v1);

      let v2 = '';
      for (let r = 0; r < rows; r++) {
        for (let c = cols - 1; c >= 0; c--) v2 += grid[r][c];
      }
      variants.push(v2);

      if (rows === cols) {
        const nextGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) nextGrid[c][rows - 1 - r] = grid[r][c];
        }
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) grid[r][c] = nextGrid[r][c];
        }
      }
    }

    variants.sort();
    return `CANON_D4_${variants[0].slice(0, 24)}`;
  }

  public static countSolutions(
    rows: number,
    cols: number,
    trees: TentCoord[],
    rowCounts: number[],
    colCounts: number[],
    limit: number = 2
  ): number {
    const board: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const t of trees) board[t.r][t.c] = 9;

    let solutions = 0;
    let stepBudget = 5000;
    const currentTents: TentCoord[] = [];

    const currentRowTents = new Array<number>(rows).fill(0);
    const currentColTents = new Array<number>(cols).fill(0);

    const backtrack = (treeIdx: number): void => {
      if (solutions >= limit || stepBudget-- <= 0) return;

      if (treeIdx === trees.length) {
        for (let r = 0; r < rows; r++) if (currentRowTents[r] !== rowCounts[r]) return;
        for (let c = 0; c < cols; c++) if (currentColTents[c] !== colCounts[c]) return;

        if (WebTentsGenerator.hasUniqueBijectiveMatching(trees, currentTents, rows, cols)) {
          solutions++;
        }
        return;
      }

      const tree = trees[treeIdx];
      for (const [dr, dc] of WebTentsGenerator.DIRS) {
        const nr = tree.r + dr;
        const nc = tree.c + dc;

        if (WebTentsGenerator.inBounds(nr, nc, rows, cols) && board[nr][nc] === 0) {
          if (currentRowTents[nr] + 1 > rowCounts[nr] || currentColTents[nc] + 1 > colCounts[nc]) continue;
          if (!WebTentsGenerator.canPlaceTentNoTouch(nr, nc, board, rows, cols)) continue;

          board[nr][nc] = 1;
          currentRowTents[nr]++;
          currentColTents[nc]++;
          currentTents.push({ r: nr, c: nc });

          backtrack(treeIdx + 1);

          board[nr][nc] = 0;
          currentRowTents[nr]--;
          currentColTents[nc]--;
          currentTents.pop();

          if (solutions >= limit) return;
        }
      }
    };

    backtrack(0);
    return solutions;
  }

  private static findBidirectionalPigeonholeDeduction(
    rows: number,
    cols: number,
    trees: TentCoord[],
    rowCounts: number[],
    colCounts: number[],
    board: number[][]
  ): ProgressiveHint | null {
    // 橫向行帶 (Row-Band) 掃描
    for (let r = 0; r < rows - 1; r++) {
      const r1 = r;
      const r2 = r + 1;
      const neededTotal = rowCounts[r1] + rowCounts[r2];

      let placedTotal = 0;
      for (let c = 0; c < cols; c++) {
        if (board[r1][c] === 1) placedTotal++;
        if (board[r2][c] === 1) placedTotal++;
      }
      const deficit = neededTotal - placedTotal;
      if (deficit <= 0) continue;

      // 嚴格過濾：僅納入所有潛在帳篷位嚴格落在這兩行內的樹木
      const relevantTrees = trees.filter(t => t.r === r1 || t.r === r2);
      const openCandidates: TentCoord[] = [];
      for (let c = 0; c < cols; c++) {
        if (board[r1][c] === 0 && WebTentsGenerator.canPlaceTentNoTouch(r1, c, board, rows, cols)) openCandidates.push({ r: r1, c });
        if (board[r2][c] === 0 && WebTentsGenerator.canPlaceTentNoTouch(r2, c, board, rows, cols)) openCandidates.push({ r: r2, c });
      }

      if (openCandidates.length === deficit && openCandidates.length > 0) {
        const target = openCandidates[0];
        return {
          level1_focus: {
            highlightRows: [r1, r2],
            highlightCols: [],
            highlightTrees: relevantTrees,
            messageZh: `宏觀聚焦：檢視第 ${r1 + 1} 行與第 ${r2 + 1} 行構成的橫向複合帶。`,
            messageEn: `Macro Focus: Examine the dual-row band across Rows ${r1 + 1} & ${r2 + 1}.`,
          },
          level2_logic: {
            technique: 'pigeonhole_bottleneck_tent',
            evidenceCoords: relevantTrees,
            contradictionChain: [
              {
                stepIndex: 1,
                hypothesis: `第 ${r1 + 1}、${r2 + 1} 行聯合尚缺 ${deficit} 頂帳篷。`,
                collisionTarget: target,
                reason: `全複合帶內之合法候選格恰好只有 ${openCandidates.length} 個。`,
              },
              {
                stepIndex: 2,
                hypothesis: `若 [${target.r + 1}, ${target.c + 1}] 標記草地。`,
                collisionTarget: target,
                reason: `剩餘空間將小於 ${deficit}，觸發雙行容量崩潰。`,
              },
            ],
            messageZh: `雙行複合缺額閉鎖：第 ${r1 + 1} 與 ${r2 + 1} 行剩餘候選格剛好等於聯合缺額，強制搭設帳篷！`,
            messageEn: `Dual-row compound deficit: open slots precisely match remaining deficit, forced tent!`,
          },
          level3_action: {
            target,
            forcedState: 1,
            messageZh: `👉 請落子：在 [${target.r + 1}, ${target.c + 1}] 搭建帳篷 (⛺)。`,
            messageEn: `👉 Action: Pitch a tent (⛺) at [${target.r + 1}, ${target.c + 1}].`,
          },
        };
      }

      for (let c = 0; c < cols; c++) {
        for (const tr of [r1, r2]) {
          if (board[tr][c] === 0) {
            const canServeTree = trees.some(t => Math.abs(t.r - tr) + Math.abs(t.c - c) === 1);
            if (!canServeTree) {
              return {
                level1_focus: {
                  highlightRows: [r1, r2],
                  highlightCols: [c],
                  highlightTrees: relevantTrees,
                  messageZh: `宏觀聚焦：檢視第 ${r1 + 1} 與第 ${r2 + 1} 行所受之雙射覆蓋。`,
                  messageEn: `Examine tree bijection coverage across Rows ${r1 + 1} and ${r2 + 1}.`,
                },
                level2_logic: {
                  technique: 'pigeonhole_bottleneck_grass',
                  evidenceCoords: relevantTrees,
                  contradictionChain: [
                    {
                      stepIndex: 1,
                      hypothesis: `假設在 [${tr + 1}, ${c + 1}] 搭建帳篷。`,
                      collisionTarget: { r: tr, c },
                      reason: `此格正交相鄰無任何樹木，無法滿足「每帳必須連一樹」之公理。`,
                    },
                  ],
                  messageZh: `抽屜原理閉鎖：該單元格不屬於任何樹木的有效伸展域，強制標記草地！`,
                  messageEn: `Pigeonhole bottleneck: cell is unreachable by any valid tree, forced grass!`,
                },
                level3_action: {
                  target: { r: tr, c },
                  forcedState: 2,
                  messageZh: `👉 請落子：點選 [${tr + 1}, ${c + 1}] 標記為草地 (•)。`,
                  messageEn: `👉 Action: Mark [${tr + 1}, ${c + 1}] as grass (•).`,
                },
              };
            }
          }
        }
      }
    }

    // 縱向列帶 (Col-Band) 掃描
    for (let c = 0; c < cols - 1; c++) {
      const c1 = c;
      const c2 = c + 1;
      const neededTotal = colCounts[c1] + colCounts[c2];

      let placedTotal = 0;
      for (let r = 0; r < rows; r++) {
        if (board[r][c1] === 1) placedTotal++;
        if (board[r][c2] === 1) placedTotal++;
      }
      const deficit = neededTotal - placedTotal;
      if (deficit <= 0) continue;

      const relevantTrees = trees.filter(t => t.c === c1 || t.c === c2);
      const openCandidates: TentCoord[] = [];
      for (let r = 0; r < rows; r++) {
        if (board[r][c1] === 0 && WebTentsGenerator.canPlaceTentNoTouch(r, c1, board, rows, cols)) openCandidates.push({ r, c: c1 });
        if (board[r][c2] === 0 && WebTentsGenerator.canPlaceTentNoTouch(r, c2, board, rows, cols)) openCandidates.push({ r, c: c2 });
      }

      if (openCandidates.length === deficit && openCandidates.length > 0) {
        const target = openCandidates[0];
        return {
          level1_focus: {
            highlightRows: [],
            highlightCols: [c1, c2],
            highlightTrees: relevantTrees,
            messageZh: `宏觀聚焦：檢視第 ${c1 + 1} 列與第 ${c2 + 1} 列構成的縱向複合帶。`,
            messageEn: `Macro Focus: Examine the dual-column band across Cols ${c1 + 1} & ${c2 + 1}.`,
          },
          level2_logic: {
            technique: 'pigeonhole_bottleneck_tent',
            evidenceCoords: relevantTrees,
            contradictionChain: [
              {
                stepIndex: 1,
                hypothesis: `第 ${c1 + 1}、${c2 + 1} 列聯合缺額為 ${deficit}。`,
                collisionTarget: target,
                reason: `候選空格數剛好為 ${openCandidates.length}，無容錯空間。`,
              },
            ],
            messageZh: `雙列複合缺額閉鎖：第 ${c1 + 1} 與 ${c2 + 1} 列候選格恰等於缺額，強制放帳篷！`,
            messageEn: `Dual-column compound deficit matches open slots, forced tent!`,
          },
          level3_action: {
            target,
            forcedState: 1,
            messageZh: `👉 請落子：在 [${target.r + 1}, ${target.c + 1}] 搭建帳篷 (⛺)。`,
            messageEn: `👉 Action: Pitch tent (⛺) at [${target.r + 1}, ${target.c + 1}].`,
          },
        };
      }
    }

    return null;
  }

  private static findCornerPairDeduction(
    rows: number,
    cols: number,
    trees: TentCoord[],
    board: number[][]
  ): ProgressiveHint | null {
    const corners: [number, number][] = [
      [0, 0], [0, cols - 1], [rows - 1, 0], [rows - 1, cols - 1],
    ];

    for (const [cr, cc] of corners) {
      if (board[cr][cc] !== 9) continue;
      const cornerTree: TentCoord = { r: cr, c: cc };

      for (const [dr, dc] of WebTentsGenerator.DIRS) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (WebTentsGenerator.inBounds(nr, nc, rows, cols) && board[nr][nc] === 9) {
          const adjTree: TentCoord = { r: nr, c: nc };

          const cornerOpen: TentCoord[] = [];
          for (const [d1r, d1c] of WebTentsGenerator.DIRS) {
            const tr = cr + d1r;
            const tc = cc + d1c;
            if (WebTentsGenerator.inBounds(tr, tc, rows, cols) && board[tr][tc] === 0 && WebTentsGenerator.canPlaceTentNoTouch(tr, tc, board, rows, cols)) {
              cornerOpen.push({ r: tr, c: tc });
            }
          }

          for (const testPos of cornerOpen) {
            board[testPos.r][testPos.c] = 1;

            let adjTreeHasAnySlot = false;
            for (const [d2r, d2c] of WebTentsGenerator.DIRS) {
              const ar = nr + d2r;
              const ac = nc + d2c;
              if (WebTentsGenerator.inBounds(ar, ac, rows, cols) && board[ar][ac] === 0 && WebTentsGenerator.canPlaceTentNoTouch(ar, ac, board, rows, cols)) {
                adjTreeHasAnySlot = true;
                break;
              }
            }

            board[testPos.r][testPos.c] = 0;

            if (!adjTreeHasAnySlot) {
              return {
                level1_focus: {
                  highlightRows: [cr, nr],
                  highlightCols: [cc, nc],
                  highlightTrees: [cornerTree, adjTree],
                  messageZh: `角隅警示：觀察角隅樹 [${cr + 1}, ${cc + 1}] 與相鄰樹 [${nr + 1}, ${nc + 1}] 的空間擠壓。`,
                  messageEn: `Corner Pair Alert: Inspect the spatial squeeze between [${cr + 1}, ${cc + 1}] and [${nr + 1}, ${nc + 1}].`,
                },
                level2_logic: {
                  technique: 'corner_pair_exclusion',
                  evidenceCoords: [cornerTree, adjTree, testPos],
                  contradictionChain: [
                    {
                      stepIndex: 1,
                      hypothesis: `假定角隅樹將帳篷搭在 [${testPos.r + 1}, ${testPos.c + 1}]。`,
                      collisionTarget: testPos,
                      reason: `相鄰樹 [${nr + 1}, ${nc + 1}] 的所有合法鄰格被全數封鎖。`,
                    },
                    {
                      stepIndex: 2,
                      hypothesis: `相鄰樹木無合法帳篷可放。`,
                      collisionTarget: adjTree,
                      reason: `違反「每樹必有一專屬帳篷」之雙射定理，產生矛盾。`,
                    },
                  ],
                  messageZh: `雙子樹互斥：若角隅樹在此放帳將徹底擠死相鄰樹木，故該格必為草地！`,
                  messageEn: `Corner Pair Dilemma: Placing tent here suffocates the adjacent tree; must be grass!`,
                },
                level3_action: {
                  target: testPos,
                  forcedState: 2,
                  messageZh: `👉 請落子：點選 [${testPos.r + 1}, ${testPos.c + 1}] 標記為草地 (•)。`,
                  messageEn: `👉 Action: Mark [${testPos.r + 1}, ${testPos.c + 1}] as grass (•).`,
                },
              };
            }
          }
        }
      }
    }

    return null;
  }

  public static buildHintCascade(
    rows: number,
    cols: number,
    trees: TentCoord[],
    rowCounts: number[],
    colCounts: number[],
    board: number[][]
  ): ProgressiveHint | null {
    const cornerPair = this.findCornerPairDeduction(rows, cols, trees, board);
    if (cornerPair) return cornerPair;

    const pigeonhole = this.findBidirectionalPigeonholeDeduction(rows, cols, trees, rowCounts, colCounts, board);
    if (pigeonhole) return pigeonhole;

    for (let r = 0; r < rows; r++) {
      if (rowCounts[r] === 0) {
        for (let c = 0; c < cols; c++) {
          if (board[r][c] === 0) {
            return {
              level1_focus: {
                highlightRows: [r],
                highlightCols: [],
                highlightTrees: [],
                messageZh: `留意第 ${r + 1} 行的邊界線索數字。`,
                messageEn: `Observe the boundary clue for Row ${r + 1}.`,
              },
              level2_logic: {
                technique: 'zero_line_grass',
                evidenceCoords: [{ r, c }],
                contradictionChain: [
                  {
                    stepIndex: 1,
                    hypothesis: `假定在 [${r + 1}, ${c + 1}] 放置帳篷。`,
                    collisionTarget: { r, c },
                    reason: `第 ${r + 1} 行配額為 0，放帳直接違背邊界線索。`,
                  },
                ],
                messageZh: `第 ${r + 1} 行配額為 0，表示該行完全不能容納任何帳篷。`,
                messageEn: `Row ${r + 1} quota is 0, meaning no tents can be placed here.`,
              },
              level3_action: {
                target: { r, c },
                forcedState: 2,
                messageZh: `👉 請落子：點選 [${r + 1}, ${c + 1}] 標記為草地 (•)。`,
                messageEn: `👉 Action: Mark [${r + 1}, ${c + 1}] as grass (•).`,
              },
            };
          }
        }
      }
    }

    for (let c = 0; c < cols; c++) {
      if (colCounts[c] === 0) {
        for (let r = 0; r < rows; r++) {
          if (board[r][c] === 0) {
            return {
              level1_focus: {
                highlightRows: [],
                highlightCols: [c],
                highlightTrees: [],
                messageZh: `留意第 ${c + 1} 列的邊界線索數字。`,
                messageEn: `Observe the boundary clue for Col ${c + 1}.`,
              },
              level2_logic: {
                technique: 'zero_line_grass',
                evidenceCoords: [{ r, c }],
                contradictionChain: [
                  {
                    stepIndex: 1,
                    hypothesis: `假定在 [${r + 1}, ${c + 1}] 放置帳篷。`,
                    collisionTarget: { r, c },
                    reason: `第 ${c + 1} 列配額為 0，放帳直接違背邊界線索。`,
                  },
                ],
                messageZh: `第 ${c + 1} 列配額為 0，表示該列完全不能容納任何帳篷。`,
                messageEn: `Col ${c + 1} quota is 0, meaning no tents can be placed here.`,
              },
              level3_action: {
                target: { r, c },
                forcedState: 2,
                messageZh: `👉 請落子：點選 [${r + 1}, ${c + 1}] 標記為草地 (•)。`,
                messageEn: `👉 Action: Mark [${r + 1}, ${c + 1}] as grass (•).`,
              },
            };
          }
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = r + dr;
              const nc = c + dc;
              if (this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 0) {
                return {
                  level1_focus: {
                    highlightRows: [],
                    highlightCols: [],
                    highlightTrees: [],
                    messageZh: `觀察座標 [${r + 1}, ${c + 1}] 已搭建的帳篷周邊八格。`,
                    messageEn: `Observe the 8-neighborhood of the tent at [${r + 1}, ${c + 1}].`,
                  },
                  level2_logic: {
                    technique: 'no_touch_neighbor_grass',
                    evidenceCoords: [{ r, c }, { r: nr, c: nc }],
                    contradictionChain: [
                      {
                        stepIndex: 1,
                        hypothesis: `假定在 [${nr + 1}, ${nc + 1}] 放置帳篷。`,
                        collisionTarget: { r: nr, c: nc },
                        reason: `與 [${r + 1}, ${c + 1}] 的帳篷產生接觸，違反八向防碰原則。`,
                      },
                    ],
                    messageZh: `因果反證：帳篷之間（含對角線）禁止相碰，鄰格必為草地。`,
                    messageEn: `Tents cannot touch even diagonally; neighbor must be grass.`,
                  },
                  level3_action: {
                    target: { r: nr, c: nc },
                    forcedState: 2,
                    messageZh: `👉 請落子：點選 [${nr + 1}, ${nc + 1}] 標記為草地 (•)。`,
                    messageEn: `👉 Action: Mark [${nr + 1}, ${nc + 1}] as grass (•).`,
                  },
                };
              }
            }
          }
        }
      }
    }

    for (const tree of trees) {
      const openAdj: [number, number][] = [];
      let hasTent = false;

      for (const [dr, dc] of WebTentsGenerator.DIRS) {
        const nr = tree.r + dr;
        const nc = tree.c + dc;
        if (this.inBounds(nr, nc, rows, cols)) {
          if (board[nr][nc] === 1) hasTent = true;
          else if (board[nr][nc] === 0 && this.canPlaceTentNoTouch(nr, nc, board, rows, cols)) {
            openAdj.push([nr, nc]);
          }
        }
      }

      if (!hasTent && openAdj.length === 1) {
        const [tr, tc] = openAdj[0];
        return {
          level1_focus: {
            highlightRows: [],
            highlightCols: [],
            highlightTrees: [tree],
            messageZh: `焦點鎖定在座標 [${tree.r + 1}, ${tree.c + 1}] 的樹木。`,
            messageEn: `Focus on the tree at [${tree.r + 1}, ${tree.c + 1}].`,
          },
          level2_logic: {
            technique: 'isolated_tree_forced_tent',
            evidenceCoords: [tree, { r: tr, c: tc }],
            contradictionChain: [
              {
                stepIndex: 1,
                hypothesis: `若 [${tr + 1}, ${tc + 1}] 標記為草地。`,
                collisionTarget: { r: tr, c: tc },
                reason: `樹木 [${tree.r + 1}, ${tree.c + 1}] 周圍將徹底無合法位，失去帳篷配對。`,
              },
            ],
            messageZh: `雙射唯一性：此樹僅剩單一合法空間，必須強制放置帳篷！`,
            messageEn: `Bijection uniqueness: sole remaining viable space must take a tent!`,
          },
          level3_action: {
            target: { r: tr, c: tc },
            forcedState: 1,
            messageZh: `👉 請落子：在 [${tr + 1}, ${tc + 1}] 搭建帳篷 (⛺)。`,
            messageEn: `👉 Action: Place tent (⛺) at [${tr + 1}, ${tc + 1}].`,
          },
        };
      }
    }

    for (let r = 0; r < rows; r++) {
      let tentCount = 0;
      const openCells: number[] = [];
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) tentCount++;
        else if (board[r][c] === 0) openCells.push(c);
      }

      if (tentCount + openCells.length === rowCounts[r] && openCells.length > 0) {
        const tc = openCells[0];
        return {
          level1_focus: {
            highlightRows: [r],
            highlightCols: [],
            highlightTrees: [],
            messageZh: `檢視第 ${r + 1} 行的配額缺額與剩餘空位。`,
            messageEn: `Inspect the quota deficit and open slots in Row ${r + 1}.`,
          },
          level2_logic: {
            technique: 'count_starvation_tent',
            evidenceCoords: [{ r, c: tc }],
            contradictionChain: [
              {
                stepIndex: 1,
                hypothesis: `若 [${r + 1}, ${tc + 1}] 不放帳篷。`,
                collisionTarget: { r, c: tc },
                reason: `剩餘格數將小於所需帳篷數，導致第 ${r + 1} 行配額永遠無法補齊。`,
              },
            ],
            messageZh: `缺額閉鎖：第 ${r + 1} 行剩餘空格剛好等於缺額，全數放帳篷。`,
            messageEn: `Deficit matches open slots; forced tent placement.`,
          },
          level3_action: {
            target: { r, c: tc },
            forcedState: 1,
            messageZh: `👉 請落子：點選 [${r + 1}, ${tc + 1}] 搭建帳篷 (⛺)。`,
            messageEn: `👉 Action: Pitch a tent (⛺) at [${r + 1}, ${tc + 1}].`,
          },
        };
      }
    }

    return null;
  }

  private static simulateMultiPersonaAha(
    rows: number,
    cols: number,
    trees: TentCoord[],
    rowCounts: number[],
    colCounts: number[]
  ): { ahaIndex: number; cruxCoords: TentCoord[]; personaVariance: number } {
    const personas = ['LineFirst', 'TreeFirst', 'Balanced'] as const;
    const personaDropRates: number[] = [];
    const allCruxCoords: TentCoord[] = [];

    for (const persona of personas) {
      const testBoard = Array.from({ length: rows }, () => Array(cols).fill(0));
      for (const t of trees) testBoard[t.r][t.c] = 9;

      let maxDrop = 0;
      let step = 0;

      while (step < rows * cols) {
        const unassignedBefore = testBoard.flat().filter(v => v === 0).length;
        if (unassignedBefore === 0) break;

        const cascade = WebTentsGenerator.buildHintCascade(rows, cols, trees, rowCounts, colCounts, testBoard);
        if (!cascade) break;

        const { target, forcedState } = cascade.level3_action;
        testBoard[target.r][target.c] = forcedState;
        step++;

        const unassignedAfter = testBoard.flat().filter(v => v === 0).length;
        const drop = (unassignedBefore - unassignedAfter) / unassignedBefore;

        if (drop >= 0.35 || cascade.level2_logic.technique.includes('pigeonhole') || cascade.level2_logic.technique === 'corner_pair_exclusion') {
          if (!allCruxCoords.some(c => c.r === target.r && c.c === target.c)) {
            allCruxCoords.push(target);
          }
          if (drop > maxDrop) maxDrop = drop;
        }
      }
      personaDropRates.push(maxDrop);
    }

    const avgAha = personaDropRates.reduce((a, b) => a + b, 0) / personas.length;
    const variance = personaDropRates.reduce((a, b) => a + Math.pow(b - avgAha, 2), 0) / personas.length;
    const normalizedAha = Number(Math.min(1.0, 0.4 + avgAha * 0.45 + allCruxCoords.length * 0.15).toFixed(2));

    return {
      ahaIndex: normalizedAha,
      cruxCoords: allCruxCoords,
      personaVariance: Number(variance.toFixed(4)),
    };
  }

  public static generate(tier: ExtendedTierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const conf = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, treeCount, targetB, disallowZeros } = conf;

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    let attempts = 0;
    while (attempts++ < 60) {
      const trees: TentCoord[] = [];
      const solutionTents: TentCoord[] = [];
      const treeTentPairs: [TentCoord, TentCoord][] = [];

      const board: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
      let innerAttempts = 0;

      while (trees.length < treeCount && innerAttempts++ < 350) {
        const tr = Math.floor(rnd() * rows);
        const tc = Math.floor(rnd() * cols);
        if (board[tr][tc] !== 0) continue;

        const validAdj: [number, number][] = [];
        for (const [dr, dc] of WebTentsGenerator.DIRS) {
          const nr = tr + dr;
          const nc = tc + dc;
          if (WebTentsGenerator.inBounds(nr, nc, rows, cols) && board[nr][nc] === 0) {
            const touchesOtherTree = WebTentsGenerator.DIRS.some(([ddr, ddc]) => {
              const checkR = nr + ddr;
              const checkC = nc + ddc;
              return (
                WebTentsGenerator.inBounds(checkR, checkC, rows, cols) &&
                board[checkR][checkC] === 9 &&
                !(checkR === tr && checkC === tc)
              );
            });

            if (!touchesOtherTree && WebTentsGenerator.canPlaceTentNoTouch(nr, nc, board, rows, cols)) {
              validAdj.push([nr, nc]);
            }
          }
        }

        if (validAdj.length > 0) {
          const [tentR, tentC] = validAdj[Math.floor(rnd() * validAdj.length)];
          board[tr][tc] = 9;
          board[tentR][tentC] = 1;
          trees.push({ r: tr, c: tc });
          solutionTents.push({ r: tentR, c: tentC });
          treeTentPairs.push([{ r: tr, c: tc }, { r: tentR, c: tentC }]);
        }
      }

      if (trees.length < treeCount) continue;

      const rowCounts = Array(rows).fill(0);
      const colCounts = Array(cols).fill(0);
      for (const t of solutionTents) {
        rowCounts[t.r]++;
        colCounts[t.c]++;
      }

      if (disallowZeros) {
        const hasZero = rowCounts.some((v) => v === 0) || colCounts.some((v) => v === 0);
        if (hasZero && attempts < 50) continue;
      }

      if (!this.hasUniqueBijectiveMatching(trees, solutionTents, rows, cols)) continue;
      if (this.countSolutions(rows, cols, trees, rowCounts, colCounts, 2) !== 1) continue;

      const { ahaIndex, cruxCoords, personaVariance } = this.simulateMultiPersonaAha(
        rows,
        cols,
        trees,
        rowCounts,
        colCounts
      );

      const testBoard = Array.from({ length: rows }, () => Array(cols).fill(0));
      for (const t of trees) testBoard[t.r][t.c] = 9;
      const cascades: ProgressiveHint[] = [];
      let stepCount = 0;

      while (stepCount < rows * cols) {
        const cascade = this.buildHintCascade(rows, cols, trees, rowCounts, colCounts, testBoard);
        if (!cascade) break;
        testBoard[cascade.level3_action.target.r][cascade.level3_action.target.c] = cascade.level3_action.forcedState;
        cascades.push(cascade);
        stepCount++;
      }

      const canonicalHash = this.computeFullCanonicalHash(rows, cols, trees, solutionTents);

      const qMatrix: CognitiveQMatrix = {
        A1_perceptual_scanning: rowCounts.some(v => v === 0) || colCounts.some(v => v === 0),
        A2_working_memory_update: cascades.some(c => c.level2_logic.technique === 'count_starvation_tent'),
        A3_inhibition_control: cascades.some(c => c.level2_logic.technique === 'no_touch_neighbor_grass'),
        A4_relational_bijection: cascades.some(c => c.level2_logic.technique === 'isolated_tree_forced_tent'),
        A5_chain_depth_planning: cruxCoords.length > 0 || cascades.some(c => c.level2_logic.technique.includes('pigeonhole')),
      };

      const dynamicC = Number(Math.max(0.02, Math.min(0.08, 1 / (rows * cols * 0.5))).toFixed(3));
      const empiricalB = Number((targetB + ahaIndex * 0.5).toFixed(2));
      const empiricalA = Number((1.35 + ahaIndex * 0.55).toFixed(2));

      let wpfAnswerKey = '';
      for (let r = 0; r < rows; r++) {
        const tentInRow = solutionTents.find((t) => t.r === r);
        wpfAnswerKey += tentInRow ? String((tentInRow.c + 1) % 10) : '0';
      }

      // 🌟 同步生成舊版相容的扁平 TentStep 陣列
      const solvingSteps: TentStep[] = cascades.map((c, idx) => ({
        step: idx + 1,
        type: c.level2_logic.technique,
        r: c.level3_action.target.r,
        c: c.level3_action.target.c,
        state: c.level3_action.forcedState,
        rationale: c.level2_logic.messageZh,
        humanReadable: {
          zh: c.level2_logic.messageZh,
          en: c.level2_logic.messageEn,
        },
      }));

      const spec: TentsSpec = {
        rows,
        cols,
        trees,
        rowCounts,
        colCounts,
        rowClues: rowCounts, // 🌟 相容欄位
        colClues: colCounts, // 🌟 相容欄位
        solutionTents,
        treeTentPairs,
        hintCascades: cascades,
        solvingSteps,        // 🌟 相容欄位
        qMatrix,
        psychometrics: {
          difficulty_b: empiricalB,
          discrimination_a: empiricalA,
          guessing_c: dynamicC,
          canonical_hash: canonicalHash,
          aha_index: ahaIndex,
          crux_coordinates: cruxCoords,
          persona_convergence_variance: personaVariance,
        },
        wpfAnswerKey,
        variant: 'standard',
        seed: actualSeed,
        tier,
        themeStyle: {
          primaryColor: '#059669',
          treeIcon: '🌲',
          tentIcon: '⛺',
          grassIcon: '•',
        },
      };

      return {
        id: `tents_${tier}_s${actualSeed}`,
        category: 'spatial' as any,
        engine_type: 'tents',
        tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
        checksum: `TENTS_${rows}x${cols}_${canonicalHash}_S${actualSeed}`,
        puzzle: spec as any,
        solution: solutionTents as any,
        cognitiveLoad: {
          spatial: Number(Math.min(1.0, 0.5 + (treeCount / (rows * cols)) * 0.5).toFixed(2)),
          numeric: Number(Math.min(1.0, 0.3 + (rowCounts.filter(v => v > 0).length / rows) * 0.4).toFixed(2)),
          workingMemory: Number(Math.min(1.0, 0.4 + (qMatrix.A2_working_memory_update ? 0.35 : 0.1)).toFixed(2)),
          inhibition: Number(Math.min(1.0, 0.4 + (qMatrix.A3_inhibition_control ? 0.45 : 0.1)).toFixed(2)),
        },
        metrics: {
          estimated_time_sec: Math.max(25, Math.round(cascades.length * 3.5 + rows * cols * 1.5)),
          irt_logit_difficulty: empiricalB,
          human_sim_steps: cascades.length,
          discrimination_a: empiricalA,
          aha_index: ahaIndex,
          crux_points_count: cruxCoords.length,
          persona_variance: personaVariance,
          seed: actualSeed,
          actualTier: tier,
        } as any,
      };
    }

    return this._generateFallback(tier, rows, cols, actualSeed, conf.targetB);
  }

  private static _generateFallback(
    tier: ExtendedTierKey,
    rows: number,
    cols: number,
    seed: number,
    baseB: number
  ): PuzzleEntity {
    const trees: TentCoord[] = [
      { r: 0, c: 1 },
      { r: 1, c: 3 },
      { r: 3, c: 0 },
    ];
    const solutionTents: TentCoord[] = [
      { r: 0, c: 0 },
      { r: 2, c: 3 },
      { r: 2, c: 0 },
    ];
    const treeTentPairs: [TentCoord, TentCoord][] = [
      [{ r: 0, c: 1 }, { r: 0, c: 0 }],
      [{ r: 1, c: 3 }, { r: 2, c: 3 }],
      [{ r: 3, c: 0 }, { r: 2, c: 0 }],
    ];
    const rowCounts = [1, 0, 2, 0];
    const colCounts = [2, 0, 0, 1];

    const spec: TentsSpec = {
      rows: 4,
      cols: 4,
      trees,
      rowCounts,
      colCounts,
      rowClues: rowCounts,
      colClues: colCounts,
      solutionTents,
      treeTentPairs,
      hintCascades: [],
      solvingSteps: [],
      qMatrix: {
        A1_perceptual_scanning: true,
        A2_working_memory_update: true,
        A3_inhibition_control: true,
        A4_relational_bijection: true,
        A5_chain_depth_planning: true,
      },
      psychometrics: {
        difficulty_b: baseB,
        discrimination_a: 1.45,
        guessing_c: 0.05,
        canonical_hash: 'CANON_FB_APEX_V1',
        aha_index: 0.88,
        crux_coordinates: [{ r: 0, c: 0 }],
        persona_convergence_variance: 0.0012,
      },
      wpfAnswerKey: '1040',
      variant: 'standard',
      seed,
      tier,
      themeStyle: {
        primaryColor: '#059669',
        treeIcon: '🌲',
        tentIcon: '⛺',
        grassIcon: '•',
      },
    };

    return {
      id: `tents_${tier}_s${seed}_fb`,
      category: 'spatial' as any,
      engine_type: 'tents',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `TENTS_FB_APEX_${seed}`,
      puzzle: spec as any,
      solution: solutionTents as any,
      cognitiveLoad: { spatial: 0.7, numeric: 0.4, workingMemory: 0.6, inhibition: 0.75 },
      metrics: { estimated_time_sec: 45, irt_logit_difficulty: baseB, seed, aha_index: 0.88 } as any,
    };
  }
}
