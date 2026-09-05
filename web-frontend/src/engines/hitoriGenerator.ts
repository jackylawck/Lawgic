// 1. 在 HitoriSpec 介面中加入缺失屬性
export interface HitoriSpec {
  size: number;
  board: number[][];
  solution: number[][]; // 1: 黑, 2: 白
  pureDeductionRate: number;
  longestChainLength: number;
  crux: CruxInfo;
  isSymmetric: boolean;
  seed: number;
  depthProfile: number[];
  maxDecisionDepth?: number;
  rhythmType?: 'peaked' | 'climbing' | 'wavy';
  equivalenceClassCount?: number;
  edgeConnectivity?: number;
  minCutBridges?: number;
  solvingSteps?: HitoriHintStep[];
}

// 2. 在 WebHitoriGenerator 類別中補回 isValidSolution 靜態方法
export class WebHitoriGenerator {
  // ... 保留其他方法 ...

  public static isValidSolution(board: number[][], state: number[][], size: number): boolean {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    
    // 檢查黑格不相鄰
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (state[r][c] === 1) {
          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (this.inBounds(nr, nc, size) && state[nr][nc] === 1) return false;
          }
        }
      }
    }

    // 檢查白格全域連通
    if (!this.isWhiteConnected(state, size)) return false;

    // 檢查每行白格數字不重複
    for (let r = 0; r < size; r++) {
      const seen = new Set<number>();
      for (let c = 0; c < size; c++) {
        if (state[r][c] === 2) {
          if (seen.has(board[r][c])) return false;
          seen.add(board[r][c]);
        }
      }
    }

    // 檢查每列白格數字不重複
    for (let c = 0; c < size; c++) {
      const seen = new Set<number>();
      for (let r = 0; r < size; r++) {
        if (state[r][c] === 2) {
          if (seen.has(board[r][c])) return false;
          seen.add(board[r][c]);
        }
      }
    }

    return true;
  }
}
