import { describe, it, expect } from 'vitest';
import { WebSlitherlinkGenerator, SlitherlinkExecutionContext } from '../../engines/slitherlinkGenerator';

describe('Slitherlink Engine Architecture & Robustness Tests', () => {
  // === 1. 深層熔斷與超時防護 ===
  it('應在時間預算耗盡時（-1ms）強制觸發深層熔斷並安全降級回退', () => {
    // 負值保證 deadlineMs < now，避開 performance.now() 解析度抖動
    const expiredCtx = new SlitherlinkExecutionContext(512, -1);

    const startTime = performance.now();
    const puzzle = WebSlitherlinkGenerator.generate('ultimate', 12345, expiredCtx);
    const duration = performance.now() - startTime;

    // 驗證退回 Fallback 標識
    expect(puzzle.id).toContain('fallback');
    expect(puzzle.metrics.actualTier).toBe('ultimate');
    // 熔斷必須在第一時間中斷，不得消耗超過 50ms
    expect(duration).toBeLessThan(50);
  });

  // === 2. Context 可重入性與記憶體隔離 ===
  it('獨立 Context 應在相同種子下產生確定性一致結果（證明無隨機全域狀態干擾）', () => {
    const ctx1 = new SlitherlinkExecutionContext(512, 3000);
    const ctx2 = new SlitherlinkExecutionContext(512, 3000);

    const p1 = WebSlitherlinkGenerator.generate('kids', 42, ctx1);
    const p2 = WebSlitherlinkGenerator.generate('kids', 42, ctx2);

    expect(JSON.stringify(p1.solution)).toBe(JSON.stringify(p2.solution));
    expect(p1.checksum).toBe(p2.checksum);
    expect(p1.puzzle.clues).toEqual(p2.puzzle.clues);
  });

  it('交錯重用 Context 不會造成內部 DSU 或度數陣列污染', () => {
    const ctx1 = new SlitherlinkExecutionContext(512, 3000);
    const ctx2 = new SlitherlinkExecutionContext(512, 3000);

    // 模擬交叉呼叫不同規模的題目
    const a1 = WebSlitherlinkGenerator.generate('kids', 1, ctx1);
    const b1 = WebSlitherlinkGenerator.generate('expert', 2, ctx2);
    const a2 = WebSlitherlinkGenerator.generate('kids', 1, ctx1);
    const b2 = WebSlitherlinkGenerator.generate('expert', 2, ctx2);

    // 重新跑同 seed 必須產出完全相同的拓撲結果，證明 DSU 每次被乾淨 reset
    expect(JSON.stringify(a1.solution)).toBe(JSON.stringify(a2.solution));
    expect(JSON.stringify(b1.solution)).toBe(JSON.stringify(b2.solution));
  });

  // === 3. 正常路徑產物完整性 ===
  it('在充裕預算內應成功產出具備 WPC 評級的完整題目', () => {
    const ctx = new SlitherlinkExecutionContext(512, 3000);
    const puzzle = WebSlitherlinkGenerator.generate('expert', 777, ctx);

    expect(puzzle.id).not.toContain('fallback');
    expect(['S', 'A', 'B', 'C']).toContain(puzzle.metrics.wpc_grade);
    expect(puzzle.puzzle.solvingSteps.length).toBeGreaterThan(0);
    expect(puzzle.puzzle.wpcReport.pureRate).toBeGreaterThan(0);
  });

  // === 4. 保底合法性（數學完備性保證）===
  it('超時觸發的 Fallback 盤面本身必須是嚴格單一閉合迴路', () => {
    const expiredCtx = new SlitherlinkExecutionContext(512, -1);
    const puzzle = WebSlitherlinkGenerator.generate('master', 999, expiredCtx);

    const { solutionH, solutionV, rows, cols } = puzzle.puzzle;
    const verifyCtx = new SlitherlinkExecutionContext((rows + 1) * (cols + 1), 1000);
    const isValid = WebSlitherlinkGenerator.verifySingleLoop(
      rows,
      cols,
      solutionH,
      solutionV,
      verifyCtx
    );

    expect(isValid).toBe(true);
  });
});
