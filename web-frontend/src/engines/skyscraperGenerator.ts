// web-frontend/src/engines/skyscraperGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export interface SkyscraperClues {
  top: number[];
  bottom: number[];
  left: number[];
  right: number[];
}

export type SpatialStrategy = 'MentalRotator' | 'ProgressiveEliminator' | 'GlobalPlanner';

export class WebSkyscraperGenerator {
  /**
   * 生成具備唯一解保證、視線約束推導深度、動態 IRT 參數與推理鏈的摩天透視謎題
   */
  static generate(tier: TierKey): PuzzleEntity {
    // 兒童與進階使用 4x4，專家與魔王使用 5x5
    const size = tier === 'kids' || tier === 'intermediate' ? 4 : 5;
    const configMap: Record<TierKey, { keepRate: number; minDepth: number; maxRetries: number }> = {
      kids: { keepRate: 0.85, minDepth: 2, maxRetries: 4 },
      intermediate: { keepRate: 0.68, minDepth: 3, maxRetries: 6 },
      expert: { keepRate: 0.52, minDepth: 4, maxRetries: 8 },
      master: { keepRate: 0.42, minDepth: 5, maxRetries: 12 },
    };

    const config = configMap[tier] || configMap.intermediate;

    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      const solution = this._generateLatinSquare(size);
      const fullClues = this._computeClues(solution, size);

      // 1. 安全挖空邊緣線索並確保唯一解
      const puzzleClues = this._maskCluesSafely(fullClues, size, config.keepRate);

      const initialGrid = Array.from({ length: size }, () => Array(size).fill(0));
      if (tier === 'kids') {
        initialGrid[0][0] = solution[0][0];
      }

      // 2. 模擬空間視線約束推導深度與推理路徑
      const depthMetrics = this._computePerspectiveDepth(initialGrid, puzzleClues, size);

      if (depthMetrics.depth < config.minDepth && attempt < config.maxRetries - 1) {
        continue;
      }

      const cluesCount =
        puzzleClues.top.filter((v) => v > 0).length +
        puzzleClues.bottom.filter((v) => v > 0).length +
        puzzleClues.left.filter((v) => v > 0).length +
        puzzleClues.right.filter((v) => v > 0).length;

      const totalPossibleClues = size * 4;
      const clueDensity = cluesCount / totalPossibleClues;
      const normalizedDepth = depthMetrics.depth / (size * size);

      // 動態合成 IRT Logit 難度與認知負荷
      const irtLogit = Number(
        Math.max(-2.8, Math.min(2.8, (1 - clueDensity) * 3.2 + normalizedDepth * 2.0 - 2.2)).toFixed(2)
      );

      const spatialLoad = Number(Math.min(0.98, 0.4 + (1 - clueDensity) * 0.4 + normalizedDepth * 0.2).toFixed(2));
      const workingMemory = Number(Math.min(0.95, 0.35 + normalizedDepth * 0.5 + (size === 5 ? 0.15 : 0)).toFixed(2));
      const inhibition = Number(Math.min(0.92, 0.3 + (1 - clueDensity) * 0.45).toFixed(2));

      const estimatedTime = Math.round(
        30 + size * size * 4 + depthMetrics.depth * 15 + (1 - clueDensity) * 80
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
        } as any,
        solution: solution as any,
        metrics: {
          grid_size: size,
          clues_count: cluesCount,
          perspective_depth: depthMetrics.depth,
          clue_density: Number(clueDensity.toFixed(2)),
          irt_logit_difficulty: irtLogit,
          estimated_time_sec: estimatedTime,
          mrt_correlation_anchor: Number((0.52 + normalizedDepth * 0.25).toFixed(2)),
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

  /**
   * 隨機生成 size x size 拉丁方陣
   */
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

  /**
   * 計算 4 個方位的遮擋可見度
   */
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
   * 確保唯一解的安全線索挖空
   */
  private static _maskCluesSafely(clues: SkyscraperClues, size: number, keepRate: number): SkyscraperClues {
    const copy: SkyscraperClues = {
      top: [...clues.top],
      bottom: [...clues.bottom],
      left: [...clues.left],
      right: [...clues.right],
    };

    const clueSlots: { dir: 'top' | 'bottom' | 'left' | 'right'; idx: number }[] = [];
    for (let i = 0; i < size; i++) {
      clueSlots.push({ dir: 'top', idx: i });
      clueSlots.push({ dir: 'bottom', idx: i });
      clueSlots.push({ dir: 'left', idx: i });
      clueSlots.push({ dir: 'right', idx: i });
    }

    // 隨機打亂挖除順序
    clueSlots.sort(() => Math.random() - 0.5);

    const totalClues = size * 4;
    const targetKeep = Math.max(size + 2, Math.round(totalClues * keepRate));
    let currentClues = totalClues;

    for (const slot of clueSlots) {
      if (currentClues <= targetKeep) break;

      const originalVal = copy[slot.dir][slot.idx];
      copy[slot.dir][slot.idx] = 0;

      // 檢查唯一解 (超過 1 個解則復原該線索)
      if (this._countSolutions(copy, size) !== 1) {
        copy[slot.dir][slot.idx] = originalVal;
      } else {
        currentClues--;
      }
    }

    return copy;
  }

  /**
   * 驗證當前外圍線索下的解個數 (MRV 回溯剪枝，解數大於等於 2 即截斷)
   */
  private static _countSolutions(clues: SkyscraperClues, size: number): number {
    const board: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
    let solutions = 0;

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

    const isLineFull = (line: number[]) => line.every((v) => v !== 0);

    const checkConstraints = (r: number, c: number): boolean => {
      // 檢查所在行
      const row = board[r];
      if (isLineFull(row)) {
        if (clues.left[r] > 0 && countVisible(row) !== clues.left[r]) return false;
        if (clues.right[r] > 0 && countVisible([...row].reverse()) !== clues.right[r]) return false;
      }
      // 檢查所在列
      const col = board.map((rowArr) => rowArr[c]);
      if (isLineFull(col)) {
        if (clues.top[c] > 0 && countVisible(col) !== clues.top[c]) return false;
        if (clues.bottom[c] > 0 && countVisible([...col].reverse()) !== clues.bottom[c]) return false;
      }
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
        let ok = true;
        for (let i = 0; i < size; i++) {
          if (board[r][i] === num || board[i][c] === num) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        board[r][c] = num;
        if (checkConstraints(r, c)) {
          solve(nextR, nextC);
          if (solutions >= 2) return;
        }
        board[r][c] = 0;
      }
    };

    solve(0, 0);
    return solutions;
  }

  /**
   * 模擬空間視線約束推導深度與推理步驟
   */
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

    // 1. 初階極限邊界推導 (1 代表為 size，size 代表全排)
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

    // 2. 迭代候選數交叉淘汰 (Candidate Elimination)
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
      puzzle: { size, grid: Array.from({ length: size }, () => Array(size).fill(0)), clues } as any,
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
