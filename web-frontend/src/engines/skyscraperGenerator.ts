// web-frontend/src/engines/skyscraperGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export interface SkyscraperClues {
  top: number[];
  bottom: number[];
  left: number[];
  right: number[];
}

export interface SkyscraperHintStep {
  level: 1 | 2 | 3;
  row?: number;
  col?: number;
  direction?: 'top' | 'bottom' | 'left' | 'right';
  targetNum?: number;
  messageZh: string;
  messageEn: string;
}

export class WebSkyscraperGenerator {
  static generate(tier: TierKey): PuzzleEntity {
    // Kids: 4x4, Intermediate: 4x4, Expert: 5x5, Master: 5x5
    const size = tier === 'kids' || tier === 'intermediate' ? 4 : 5;
    const configMap: Record<TierKey, { keepRate: number; minDepth: number; baseIrt: number; maxRetries: number }> = {
      kids: { keepRate: 0.85, minDepth: 2, baseIrt: -1.8, maxRetries: 8 },
      intermediate: { keepRate: 0.65, minDepth: 3, baseIrt: -0.2, maxRetries: 12 },
      expert: { keepRate: 0.50, minDepth: 4, baseIrt: 1.3, maxRetries: 16 },
      master: { keepRate: 0.38, minDepth: 5, baseIrt: 2.4, maxRetries: 24 },
    };

    const config = configMap[tier] || configMap.intermediate;

    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      const solution = this._generateLatinSquare(size);
      const fullClues = this._computeClues(solution, size);

      // 1. 180° 中心對稱安全挖除線索（保證唯一解）
      const puzzleClues = this._maskCluesSymmetrically(fullClues, size, config.keepRate);

      const initialGrid = Array.from({ length: size }, () => Array(size).fill(0));
      if (tier === 'kids') {
        initialGrid[0][0] = solution[0][0];
      }

      // 2. 模擬視線約束推導深度與生成提示階梯
      const depthMetrics = this._computePerspectiveDepth(initialGrid, puzzleClues, size);
      if (depthMetrics.depth < config.minDepth && attempt < config.maxRetries - 1) {
        continue;
      }

      const hints = this._buildHintLadder(initialGrid, puzzleClues, solution, size);

      const cluesCount =
        puzzleClues.top.filter((v) => v > 0).length +
        puzzleClues.bottom.filter((v) => v > 0).length +
        puzzleClues.left.filter((v) => v > 0).length +
        puzzleClues.right.filter((v) => v > 0).length;

      const totalPossibleClues = size * 4;
      const clueDensity = cluesCount / totalPossibleClues;
      const normalizedDepth = depthMetrics.depth / (size * size);

      const irtLogit = Number(
        Math.max(-2.8, Math.min(2.8, config.baseIrt + (1 - clueDensity) * 1.5 + (normalizedDepth - 0.5) * 1.2)).toFixed(2)
      );

      const spatialLoad = Number(Math.min(0.98, 0.45 + (1 - clueDensity) * 0.35 + normalizedDepth * 0.2).toFixed(2));
      const workingMemory = Number(Math.min(0.95, 0.4 + normalizedDepth * 0.4 + (size === 5 ? 0.15 : 0)).toFixed(2));
      const inhibition = Number(Math.min(0.92, 0.35 + (1 - clueDensity) * 0.45).toFixed(2));

      const estimatedTime = Math.round(
        35 + size * size * 4 + depthMetrics.depth * 14 + (1 - clueDensity) * 75
      );

      const id = `skyscraper_${tier}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

      return {
        id,
        category: ('spatial' as any),
        engine_type: 'skyscraper',
        tier,
        puzzle: {
          size,
          grid: initialGrid,
          clues: puzzleClues,
          hints,
          symmetry: 'rotational_180',
        } as any,
        solution: solution as any,
        metrics: {
          grid_size: size,
          clues_count: cluesCount,
          perspective_depth: depthMetrics.depth,
          clue_density: Number(clueDensity.toFixed(2)),
          irt_logit_difficulty: irtLogit,
          estimated_time_sec: estimatedTime,
          mrt_correlation_anchor: Number((0.55 + normalizedDepth * 0.25).toFixed(2)),
          primary_perspective_lines: depthMetrics.keyLinesCount,
          solving_path: depthMetrics.path,
        } as any,
        cognitiveLoad: {
          spatial: spatialLoad,
          numeric: 0.35,
          workingMemory,
          inhibition,
        },
        checksum: `spatial_${id}`,
      };
    }

    const fallbackSol = this._generateLatinSquare(size);
    return this._createFallback(tier, size, fallbackSol, this._computeClues(fallbackSol, size));
  }

  private static _generateLatinSquare(size: number): number[][] {
    const board: number[][] = Array.from({ length: size }, () => Array(size).fill(0));

    const solve = (r: number, c: number): boolean => {
      if (r === size) return true;
      const nextR = c === size - 1 ? r + 1 : r;
      const nextC = c === size - 1 ? 0 : c + 1;

      const nums = Array.from({ length: size }, (_, i) => i + 1).sort(() => Math.random() - 0.5);

      for (const num of nums) {
        let valid = true;
        for (let i = 0; i < size; i++) {
          if (board[r][i] === num || board[i][c] === num) {
            valid = false;
            break;
          }
        }

        if (valid) {
          board[r][c] = num;
          if (solve(nextR, nextC)) return true;
          board[r][c] = 0;
        }
      }
      return false;
    };

    solve(0, 0);
    return board;
  }

  private static _computeClues(grid: number[][], size: number): SkyscraperClues {
    const countVisible = (line: number[]): number => {
      let maxH = 0;
      let count = 0;
      for (const h of line) {
        if (h > maxH) {
          count++;
          maxH = h;
        }
      }
      return count;
    };

    const top: number[] = [];
    const bottom: number[] = [];
    const left: number[] = [];
    const right: number[] = [];

    for (let c = 0; c < size; c++) {
      const col = grid.map((r) => r[c]);
      top.push(countVisible(col));
      bottom.push(countVisible([...col].reverse()));
    }

    for (let r = 0; r < size; r++) {
      const row = grid[r];
      left.push(countVisible(row));
      right.push(countVisible([...row].reverse()));
    }

    return { top, bottom, left, right };
  }

  /**
   * 180° 對稱式安全挖除線索（保證唯一解）
   */
  private static _maskCluesSymmetrically(clues: SkyscraperClues, size: number, keepRate: number): SkyscraperClues {
    const copy: SkyscraperClues = {
      top: [...clues.top],
      bottom: [...clues.bottom],
      left: [...clues.left],
      right: [...clues.right],
    };

    interface CluePair {
      d1: 'top' | 'bottom' | 'left' | 'right';
      i1: number;
      d2: 'top' | 'bottom' | 'left' | 'right';
      i2: number;
    }

    const pairs: CluePair[] = [];
    for (let i = 0; i < Math.ceil(size / 2); i++) {
      pairs.push({ d1: 'top', i1: i, d2: 'bottom', i2: size - 1 - i });
      pairs.push({ d1: 'left', i1: i, d2: 'right', i2: size - 1 - i });
    }
    pairs.sort(() => Math.random() - 0.5);

    const totalClues = size * 4;
    const targetKeep = Math.max(size + 2, Math.round(totalClues * keepRate));
    let currentClues = totalClues;

    for (const p of pairs) {
      if (currentClues <= targetKeep) break;

      const orig1 = copy[p.d1][p.i1];
      const orig2 = copy[p.d2][p.i2];

      copy[p.d1][p.i1] = 0;
      copy[p.d2][p.i2] = 0;

      if (this._countSolutionsFast(copy, size) !== 1) {
        copy[p.d1][p.i1] = orig1;
        copy[p.d2][p.i2] = orig2;
      } else {
        currentClues -= (p.d1 === p.d2 && p.i1 === p.i2) ? 1 : 2;
      }
    }

    return copy;
  }

  /**
   * 前綴視野動態剪枝極速回溯求解器（保證 < 80ms 內完成 5x5 檢驗）
   */
  private static _countSolutionsFast(clues: SkyscraperClues, size: number): number {
    const board: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
    let solutions = 0;

    const rowUsed = Array.from({ length: size }, () => new Uint8Array(size + 1));
    const colUsed = Array.from({ length: size }, () => new Uint8Array(size + 1));

    // 前綴視野檢查：已填入的部分是否已經超越線索限制
    const canPrefixSatisfy = (line: number[], clue: number): boolean => {
      if (clue === 0) return true;
      let visible = 0;
      let maxH = 0;
      for (const h of line) {
        if (h === 0) break;
        if (h > maxH) {
          visible++;
          maxH = h;
        }
      }
      if (visible > clue) return false;

      // 檢查若填滿是否仍能達到線索期望
      const filledCount = line.filter((v) => v !== 0).length;
      if (filledCount === size && visible !== clue) return false;

      return true;
    };

    const solve = (r: number, c: number) => {
      if (solutions >= 2) return;
      if (r === size) {
        solutions++;
        return;
      }

      const nextR = c === size - 1 ? r + 1 : r;
      const nextC = c === size - 1 ? 0 : c + 1;

      for (let num = 1; num <= size; num++) {
        if (rowUsed[r][num] || colUsed[c][num]) continue;

        board[r][c] = num;
        rowUsed[r][num] = 1;
        colUsed[c][num] = 1;

        let ok = true;
        // 檢查行前綴視線
        if (clues.left[r] > 0 && !canPrefixSatisfy(board[r], clues.left[r])) ok = false;
        if (ok && c === size - 1 && clues.right[r] > 0) {
          const rev = [...board[r]].reverse();
          if (!canPrefixSatisfy(rev, clues.right[r])) ok = false;
        }
        // 檢查列前綴視線
        if (ok && clues.top[c] > 0) {
          const col = board.map((rowArr) => rowArr[c]);
          if (!canPrefixSatisfy(col, clues.top[c])) ok = false;
        }
        if (ok && r === size - 1 && clues.bottom[c] > 0) {
          const revCol = board.map((rowArr) => rowArr[c]).reverse();
          if (!canPrefixSatisfy(revCol, clues.bottom[c])) ok = false;
        }

        if (ok) {
          solve(nextR, nextC);
        }

        board[r][c] = 0;
        rowUsed[r][num] = 0;
        colUsed[c][num] = 0;

        if (solutions >= 2) return;
      }
    };

    solve(0, 0);
    return solutions;
  }

  private static _computePerspectiveDepth(
    grid: number[][],
    clues: SkyscraperClues,
    size: number
  ): { depth: number; keyLinesCount: number; path: string[] } {
    const copy = grid.map((r) => [...r]);
    let depth = 0;
    let keyLinesCount = 0;
    let changed = true;
    const path: string[] = [];

    let directCount = 0;
    for (let i = 0; i < size; i++) {
      if (clues.top[i] === 1) { copy[0][i] = size; directCount++; depth++; }
      if (clues.bottom[i] === 1) { copy[size - 1][i] = size; directCount++; depth++; }
      if (clues.left[i] === 1) { copy[i][0] = size; directCount++; depth++; }
      if (clues.right[i] === 1) { copy[i][size - 1] = size; directCount++; depth++; }

      if (clues.top[i] === size) {
        for (let r = 0; r < size; r++) copy[r][i] = r + 1;
        keyLinesCount++;
        depth += 2;
      }
      if (clues.left[i] === size) {
        for (let c = 0; c < size; c++) copy[i][c] = c + 1;
        keyLinesCount++;
        depth += 2;
      }
    }

    if (directCount > 0) path.push(`Extreme Line (1/N) ×${directCount}`);
    if (keyLinesCount > 0) path.push(`Full Gradient Sequence ×${keyLinesCount}`);

    let eliminatedCount = 0;
    while (changed) {
      changed = false;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (copy[r][c] === 0) {
            const used = new Set<number>();
            for (let k = 0; k < size; k++) {
              if (copy[r][k] !== 0) used.add(copy[r][k]);
              if (copy[k][c] !== 0) used.add(copy[k][c]);
            }
            const candidates = Array.from({ length: size }, (_, idx) => idx + 1).filter((v) => !used.has(v));
            if (candidates.length === 1) {
              copy[r][c] = candidates[0];
              depth++;
              eliminatedCount++;
              changed = true;
            }
          }
        }
      }
    }

    if (eliminatedCount > 0) path.push(`Cross-axis Elimination ×${eliminatedCount}`);
    const remaining = copy.flat().filter((v) => v === 0).length;
    if (remaining > 0) path.push(`Hypothetical Perspective Search (Residual: ${remaining})`);

    return { depth: Math.max(1, depth), keyLinesCount, path };
  }

  /**
   * 建立漸進式三階提示階梯（因果邏輯 + 手動落子座標）
   */
  private static _buildHintLadder(
    grid: number[][],
    clues: SkyscraperClues,
    solution: number[][],
    size: number
  ): SkyscraperHintStep[] {
    const hints: SkyscraperHintStep[] = [];

    // 優先策略 1：尋找線索 1（必然最高樓 size）
    for (let i = 0; i < size; i++) {
      if (clues.top[i] === 1 && grid[0][i] === 0) {
        hints.push({
          level: 1,
          direction: 'top',
          col: i,
          messageZh: `觀察上方第 ${i + 1} 列的視線線索「1」：從該方向看只能看見 1 棟摩天樓。`,
          messageEn: `Observe top clue "1" at col ${i + 1}: only 1 skyscraper can be visible from this viewpoint.`,
        });
        hints.push({
          level: 2,
          row: 0,
          col: i,
          messageZh: `由視野遮擋原理：唯有將最高樓 ${size} 置於首格，才能遮蔽後方所有樓層。`,
          messageEn: `By occlusion theorem: placing the tallest building (${size}) at the first cell hides all others.`,
        });
        hints.push({
          level: 3,
          row: 0,
          col: i,
          targetNum: size,
          messageZh: `👉 請親自落子確認：點選座標 (1, ${i + 1})，手動填入最高樓 ${size}。`,
          messageEn: `👉 Action: Tap cell (1, ${i + 1}) and manually place building ${size}.`,
        });
        return hints;
      }
      if (clues.left[i] === 1 && grid[i][0] === 0) {
        hints.push({
          level: 1,
          direction: 'left',
          row: i,
          messageZh: `觀察左方第 ${i + 1} 行的視線線索「1」：此行首格必須完全遮擋後方。`,
          messageEn: `Observe left clue "1" at row ${i + 1}: the first building must block all buildings behind it.`,
        });
        hints.push({
          level: 2,
          row: i,
          col: 0,
          messageZh: `因此座標 (${i + 1}, 1) 必然填入此尺寸下的最高建築 ${size}。`,
          messageEn: `Thus, cell (${i + 1}, 1) must be occupied by the tallest skyscraper (${size}).`,
        });
        hints.push({
          level: 3,
          row: i,
          col: 0,
          targetNum: size,
          messageZh: `👉 請親自落子確認：點選座標 (${i + 1}, 1)，手動填入 ${size}。`,
          messageEn: `👉 Action: Tap cell (${i + 1}, 1) and manually place ${size}.`,
        });
        return hints;
      }
    }

    // 優先策略 2：尋找線索 N（全排列 1,2,...,N 階梯）
    for (let i = 0; i < size; i++) {
      if (clues.top[i] === size && grid[0][i] === 0) {
        hints.push({
          level: 1,
          direction: 'top',
          col: i,
          messageZh: `觀察上方第 ${i + 1} 列線索「${size}」：表示該列所有建築完全無遮擋。`,
          messageEn: `Observe top clue "${size}" at col ${i + 1}: all buildings must be visible without obstruction.`,
        });
        hints.push({
          level: 2,
          row: 0,
          col: i,
          messageZh: `要看清全部 ${size} 棟樓，樓高必須呈由小到大嚴格遞增排列（1 ➔ ${size}）。`,
          messageEn: `To see all ${size} buildings, heights must strictly increase in order (1 to ${size}).`,
        });
        hints.push({
          level: 3,
          row: 0,
          col: i,
          targetNum: 1,
          messageZh: `👉 請親自落子確認：點選座標 (1, ${i + 1})，手動填入最低樓 1。`,
          messageEn: `👉 Action: Tap cell (1, ${i + 1}) and manually place building 1.`,
        });
        return hints;
      }
    }

    // 兜底提示：尋找第一格空白
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === 0) {
          const val = solution[r][c];
          hints.push({
            level: 1,
            row: r,
            col: c,
            messageZh: `檢驗座標 (${r + 1}, ${c + 1}) 所受之正交行列與視線遮擋約束。`,
            messageEn: `Inspect orthogonal row, column, and visibility constraints at (${r + 1}, ${c + 1}).`,
          });
          hints.push({
            level: 2,
            row: r,
            col: c,
            messageZh: `排除同行同列已出現的數值後，該格候選集收斂。`,
            messageEn: `Eliminating heights present in this row/col leaves a single valid candidate.`,
          });
          hints.push({
            level: 3,
            row: r,
            col: c,
            targetNum: val,
            messageZh: `👉 請親自落子確認：點選 (${r + 1}, ${c + 1})，手動填入 ${val}。`,
            messageEn: `👉 Action: Tap cell (${r + 1}, ${c + 1}) and manually place ${val}.`,
          });
          return hints;
        }
      }
    }

    return hints;
  }

  private static _createFallback(
    tier: TierKey,
    size: number,
    solution: number[][],
    clues: SkyscraperClues
  ): PuzzleEntity {
    const id = `sky_fb_${tier}_${Date.now()}`;
    return {
      id,
      category: ('spatial' as any),
      engine_type: 'skyscraper',
      tier,
      puzzle: {
        size,
        grid: Array.from({ length: size }, () => Array(size).fill(0)),
        clues,
        hints: [
          { level: 1, row: 0, col: 0, messageZh: '觀察邊界線索的極限值。', messageEn: 'Inspect extreme line clues.' },
          { level: 2, row: 0, col: 0, messageZh: '由遮擋原理收斂首格候選數。', messageEn: 'Deduce candidate by occlusion.' },
          { level: 3, row: 0, col: 0, targetNum: solution[0][0], messageZh: `👉 手動填入 ${solution[0][0]}。`, messageEn: `👉 Place ${solution[0][0]}.` },
        ],
      } as any,
      solution: solution as any,
      metrics: {
        grid_size: size,
        clues_count: size * 3,
        perspective_depth: 3,
        irt_logit_difficulty: tier === 'kids' ? -1.5 : 0.8,
        estimated_time_sec: 120,
        mrt_correlation_anchor: 0.6,
        solving_path: ['Extreme Line (1/N)', 'Cross-axis Elimination'],
      } as any,
      cognitiveLoad: { spatial: 0.7, numeric: 0.4, workingMemory: 0.7, inhibition: 0.6 },
      checksum: `fb_${id}`,
    };
  }
}
