// web-frontend/src/utils/challengeCodec.ts
import { PuzzleEntity, TierKey } from '../generated';

// 精簡版傳輸結構，大幅縮減 URL 長度
export interface CompactChallengePayload {
  e: string;       // engine_type
  t: string;       // tier
  r: number;       // rows
  c: number;       // cols
  k?: any;         // clues / grid
  s?: any;         // solution
  h?: string;      // checksum
  i?: number;      // irt difficulty
  seed?: number;   // seed (if generator-based)
}

// 引擎類型對應的範疇與認知負載映射
const ENGINE_METADATA_MAP: Record<string, {
  category: 'spatial_logic' | 'numeric_logic' | 'pattern_logic';
  cognitiveLoad: { spatial: number; numeric: number; workingMemory: number; inhibition: number };
}> = {
  maze: { category: 'spatial_logic', cognitiveLoad: { spatial: 0.95, numeric: 0.2, workingMemory: 0.7, inhibition: 0.8 } },
  sudoku: { category: 'numeric_logic', cognitiveLoad: { spatial: 0.3, numeric: 0.95, workingMemory: 0.85, inhibition: 0.7 } },
  nonogram: { category: 'pattern_logic', cognitiveLoad: { spatial: 0.8, numeric: 0.7, workingMemory: 0.8, inhibition: 0.85 } },
  skyscraper: { category: 'spatial_logic', cognitiveLoad: { spatial: 0.9, numeric: 0.5, workingMemory: 0.8, inhibition: 0.7 } },
  slitherlink: { category: 'spatial_logic', cognitiveLoad: { spatial: 0.88, numeric: 0.4, workingMemory: 0.75, inhibition: 0.9 } },
  shikaku: { category: 'spatial_logic', cognitiveLoad: { spatial: 0.92, numeric: 0.9, workingMemory: 0.8, inhibition: 0.85 } },
  tents: { category: 'spatial_logic', cognitiveLoad: { spatial: 0.92, numeric: 0.45, workingMemory: 0.75, inhibition: 0.88 } },
  yajilin: { category: 'spatial_logic', cognitiveLoad: { spatial: 0.9, numeric: 0.45, workingMemory: 0.8, inhibition: 0.9 } },
};

export class ChallengeCodec {
  /**
   * 將字串轉為 URL-Safe Base64 (避免 + / = 破壞 URL 解析)
   */
  private static toUrlSafeBase64(str: string): string {
    const base64 = btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => {
      return String.fromCharCode(parseInt(p1, 16));
    }));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * 從 URL-Safe Base64 還原字串
   */
  private static fromUrlSafeBase64(base64: string): string {
    let sanitized = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (sanitized.length % 4) {
      sanitized += '=';
    }
    const binary = atob(sanitized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  /**
   * 題目編碼為緊湊型 URL 短碼
   */
  public static encode(puzzle: PuzzleEntity): string {
    if (!puzzle) return '';

    const spec = (puzzle.puzzle || {}) as any;
    const payload: CompactChallengePayload = {
      e: puzzle.engine_type || 'maze',
      t: puzzle.tier || 'kids',
      r: spec.rows || spec.size || 6,
      c: spec.cols || spec.size || 6,
      k: spec.clues || spec.grid || [],
      s: puzzle.solution || spec.solution || null,
      h: puzzle.checksum || `CHK_${Date.now().toString(36)}`,
      i: Number((puzzle.metrics?.irt_logit_difficulty || 1.2).toFixed(2)),
      seed: spec.seed || (puzzle.metrics as any)?.seed,
    };

    try {
      const jsonStr = JSON.stringify(payload);
      return this.toUrlSafeBase64(jsonStr);
    } catch {
      return '';
    }
  }

  /**
   * 解碼短碼並還原為標準 PuzzleEntity
   */
  public static decode(code: string): PuzzleEntity | null {
    if (!code || typeof code !== 'string') return null;

    try {
      const jsonStr = this.fromUrlSafeBase64(code.trim());
      const payload: CompactChallengePayload = JSON.parse(jsonStr);

      if (!payload.e || !payload.r || !payload.c) {
        return null;
      }

      const meta = ENGINE_METADATA_MAP[payload.e] || {
        category: 'spatial_logic',
        cognitiveLoad: { spatial: 0.8, numeric: 0.6, workingMemory: 0.7, inhibition: 0.7 },
      };

      const rows = Number(payload.r) || 6;
      const cols = Number(payload.c) || 6;
      const irt = Number(payload.i) || 1.2;

      return {
        id: `challenge_${payload.e}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        category: meta.category as any,
        engine_type: payload.e,
        tier: (payload.t as TierKey) || 'kids',
        checksum: payload.h || `VERIFIED_${Date.now().toString(36)}`,
        puzzle: {
          rows,
          cols,
          clues: payload.k,
          grid: payload.k,
          solution: payload.s,
          seed: payload.seed,
          pureDeductionRate: 1.0,
        },
        solution: payload.s,
        cognitiveLoad: meta.cognitiveLoad,
        metrics: {
          estimated_time_sec: rows * cols * 2.5,
          irt_logit_difficulty: irt,
          seed: payload.seed,
        } as any,
      };
    } catch {
      return null;
    }
  }

  /**
   * 生成跨端可點擊的對決連結 (相容 SSR 與各類社群平台)
   */
  public static generateShareUrl(puzzle: PuzzleEntity): string {
    const code = this.encode(puzzle);
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lawgic.app';
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
    return `${origin}${pathname}#challenge=${code}`;
  }
}
