// web-frontend/src/utils/challengeCodec.ts
import { PuzzleEntity } from '../generated';

export interface ChallengePayload {
  engine: string;
  tier: string;
  rows: number;
  cols: number;
  clues: any;
  solution: any;
  checksum: string;
  irt: number;
}

export class ChallengeCodec {
  public static encode(puzzle: PuzzleEntity): string {
    const payload: ChallengePayload = {
      engine: puzzle.engine_type,
      tier: puzzle.tier,
      rows: puzzle.puzzle?.rows || 5,
      cols: puzzle.puzzle?.cols || 5,
      clues: puzzle.puzzle?.clues || [],
      solution: puzzle.solution,
      checksum: puzzle.checksum,
      irt: puzzle.metrics?.irt_logit_difficulty || 1.0,
    };

    try {
      const jsonStr = JSON.stringify(payload);
      return btoa(encodeURIComponent(jsonStr));
    } catch {
      return '';
    }
  }

  public static decode(code: string): PuzzleEntity | null {
    try {
      const jsonStr = decodeURIComponent(atob(code));
      const payload: ChallengePayload = JSON.parse(jsonStr);

      return {
        id: `challenge_${payload.engine}_${Date.now().toString(36)}`,
        category: 'spatial_logic' as any,
        engine_type: payload.engine,
        tier: payload.tier as any,
        checksum: payload.checksum,
        puzzle: {
          rows: payload.rows,
          cols: payload.cols,
          clues: payload.clues,
          solution: payload.solution,
          pureDeductionRate: 1.0,
        },
        solution: payload.solution,
        cognitiveLoad: { spatial: 0.9, numeric: 0.5, workingMemory: 0.7, inhibition: 0.85 },
        metrics: {
          estimated_time_sec: payload.rows * payload.cols * 3,
          irt_logit_difficulty: payload.irt,
        },
      };
    } catch {
      return null;
    }
  }

  public static generateShareUrl(puzzle: PuzzleEntity): string {
    const code = this.encode(puzzle);
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}#challenge=${code}`;
  }
}
