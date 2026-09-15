import { describe, it, expect } from 'vitest';
import { WebNonogramGenerator, NonogramExecutionContext, CellState } from '../../engines/nonogramGenerator';

describe('Nonogram Engine Architecture & Robustness Tests', () => {
  // === 1. 深層熔斷與超時防護 ===
  it('反證法深搜遇超時（-1ms）應即刻還原盤面並退回保底', () => {
    const expiredCtx = new NonogramExecutionContext(20, -1);

    const startTime = performance.now();
    const puzzle = WebNonogramGenerator.generate('legendary', 9999, expiredCtx);
    const duration = performance.now() - startTime;

    expect(puzzle.id).toContain('fb');
    expect(puzzle.metrics.actualTier).toBe('legendary');
    expect(duration).toBeLessThan(50);
  });

  // === 2. Context 可重入性與記憶體隔離 ===
  it('獨立 Context 應在相同種子下保證產出嚴格一致', () => {
    const ctxA = new NonogramExecutionContext(10, 2000);
    const ctxB = new NonogramExecutionContext(10, 2000);

    const puzzleA = WebNonogramGenerator.generate('kids', 42, ctxA);
    const puzzleB = WebNonogramGenerator.generate('kids', 42, ctxB);

    expect(JSON.stringify(puzzleA.solution)).toBe(JSON.stringify(puzzleB.solution));
    expect(puzzleA.checksum).toBe(puzzleB.checksum);
    expect(puzzleA.puzzle.rowClues).toEqual(puzzleB.puzzle.rowClues);
  });

  it('交錯呼叫不同規格題目不會污染 Memoization 快取緩衝區', () => {
    const ctxA = new NonogramExecutionContext(15, 2500);
    const ctxB = new NonogramExecutionContext(15, 2500);

    const a1 = WebNonogramGenerator.generate('kids', 1, ctxA);
    const b1 = WebNonogramGenerator.generate('intermediate', 2, ctxB);
    const a2 = WebNonogramGenerator.generate('kids', 1, ctxA);

    expect(JSON.stringify(a1.solution)).toBe(JSON.stringify(a2.solution));
    expect(a1.puzzle.criticalPathDepth).toBe(a2.puzzle.criticalPathDepth);
  });

  // === 3. DP 核心求解器單元邊界測試 ===
  it('solveLineDPFast 應精準計算 [0] 線索為全盤標叉', () => {
    const ctx = new NonogramExecutionContext(10, 2000);
    const line: CellState[] = [0, 0, 0, 0, 0];
    const result = WebNonogramGenerator.solveLineDPFast(5, [0], line, ctx);

    expect(result.hasValid).toBe(true);
    expect(result.commonCrossMask).toBe(0b11111);
    expect(result.commonFilledMask).toBe(0);
    expect(result.validCount).toBe(1);
  });

  it('solveLineDPFast 對矛盾狀態（已有黑格卻要求全空）應返回 hasValid = false', () => {
    const ctx = new NonogramExecutionContext(10, 2000);
    const line: CellState[] = [1, 0, 0, 0, 0];
    const result = WebNonogramGenerator.solveLineDPFast(5, [0], line, ctx);

    expect(result.hasValid).toBe(false);
    expect(result.validCount).toBe(0);
  });

  it('solveLineDPFast 應正確計算區間重疊黑格（如長度 5 線索 4）', () => {
    const ctx = new NonogramExecutionContext(10, 2000);
    const line: CellState[] = [0, 0, 0, 0, 0];
    const result = WebNonogramGenerator.solveLineDPFast(5, [4], line, ctx);

    expect(result.hasValid).toBe(true);
    // 長度 5 放 4，中段索引 1..=3 必為黑格 (0b01110 = 14)
    expect((result.commonFilledMask & (1 << 1)) !== 0).toBe(true);
    expect((result.commonFilledMask & (1 << 2)) !== 0).toBe(true);
    expect((result.commonFilledMask & (1 << 3)) !== 0).toBe(true);
  });

  // === 4. 生成盤面全域約束驗證 ===
  it('正常生成的題目其 solution 必須 100% 滿足行列提示數', () => {
    const ctx = new NonogramExecutionContext(20, 3000);
    const puzzle = WebNonogramGenerator.generate('expert', 555, ctx);

    expect(puzzle.id).not.toContain('fb');

    const spec = puzzle.puzzle as any;
    // 驗證行線索
    for (let r = 0; r < spec.rows; r++) {
      const extractedRow = WebNonogramGenerator.extractLineClues(spec.solution[r]);
      expect(extractedRow).toEqual(spec.rowClues[r]);
    }

    // 驗證列線索
    for (let c = 0; c < spec.cols; c++) {
      const colCells: boolean[] = [];
      for (let r = 0; r < spec.rows; r++) {
        colCells.push(spec.solution[r][c]);
      }
      const extractedCol = WebNonogramGenerator.extractLineClues(colCells);
      expect(extractedCol).toEqual(spec.colClues[c]);
    }
  });
});
