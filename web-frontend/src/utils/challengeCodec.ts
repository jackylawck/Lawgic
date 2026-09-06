// web-frontend/src/utils/challengeCodec.ts
import { PuzzleEntity } from '../generated';
import { ExtendedTierKey } from '../hooks/useLearnerProfile';

export interface CompactChallengePayload {
  e: string;        // engine_type
  t: string;        // tier / difficulty
  r: number;        // rows
  c: number;        // cols
  k?: any;          // clues
  g?: any;          // grid (if different from clues)
  s?: any;          // solution
  h?: string;       // checksum
  i?: number;       // irt logit difficulty
  seed?: number;    // random seed
  v?: string[];     // variants / extra rules
}

// 補齊全套 18 款遊戲之 CHC 認知構念與範疇映射
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
  hashi: { category: 'spatial_logic', cognitiveLoad: { spatial: 0.88, numeric: 0.6, workingMemory: 0.6, inhibition: 0.7 } },
  kropki: { category: 'numeric_logic', cognitiveLoad: { spatial: 0.5, numeric: 0.8, workingMemory: 0.65, inhibition: 0.85 } },
  lightup: { category: 'spatial_logic', cognitiveLoad: { spatial: 0.8, numeric: 0.5, workingMemory: 0.6, inhibition: 0.8 } },
  kakuro: { category: 'numeric_logic', cognitiveLoad: { spatial: 0.4, numeric: 0.95, workingMemory: 0.8, inhibition: 0.7 } },
  hitori: { category: 'numeric_logic', cognitiveLoad: { spatial: 0.6, numeric: 0.8, workingMemory: 0.8, inhibition: 0.9 } },
  futoshiki: { category: 'numeric_logic', cognitiveLoad: { spatial: 0.45, numeric: 0.85, workingMemory: 0.75, inhibition: 0.8 } },
  masyu: { category: 'spatial_logic', cognitiveLoad: { spatial: 0.9, numeric: 0.2, workingMemory: 0.6, inhibition: 0.85 } },
  dominoes: { category: 'pattern_logic', cognitiveLoad: { spatial: 0.75, numeric: 0.5, workingMemory: 0.85, inhibition: 0.88 } },
  heyawake: { category: 'spatial_logic', cognitiveLoad: { spatial: 0.85, numeric: 0.4, workingMemory: 0.75, inhibition: 0.85 } },
};

export class ChallengeCodec {
  private static toUrlSafeBase64(str: string): string {
    const base64 = btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => {
      return String.fromCharCode(parseInt(p1, 16));
    }));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

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
   * 將 PuzzleEntity 序列化為 URL-safe 短碼
   */
  public static encode(puzzle: PuzzleEntity): string {
    if (!puzzle) return '';

    const rawAny = puzzle as any;
    const spec = (puzzle.puzzle && typeof puzzle.puzzle === 'object') ? (puzzle.puzzle as any) : {};

    const engineType = puzzle.engine_type || rawAny.type || 'maze';
    const tier = String(puzzle.tier || spec.tier || spec.difficulty || rawAny.difficulty || 'intermediate');

    const rows = Number(spec.rows || spec.height || spec.size || rawAny.size || 6);
    const cols = Number(spec.cols || spec.width || spec.size || rawAny.size || 6);

    const irt = puzzle.metrics?.irt_logit_difficulty !== undefined
      ? Number(puzzle.metrics.irt_logit_difficulty.toFixed(2))
      : undefined;

    const payload: CompactChallengePayload = {
      e: engineType,
      t: tier,
      r: rows,
      c: cols,
      k: spec.clues !== undefined ? spec.clues : (spec.grid !== undefined ? spec.grid : rawAny.clues),
      g: (spec.grid !== undefined && spec.grid !== spec.clues) ? spec.grid : undefined,
      s: puzzle.solution || spec.solution || rawAny.solution || null,
      h: puzzle.checksum || `CHK_${Date.now().toString(36)}`,
      i: irt,
      seed: spec.seed || (puzzle.metrics as any)?.seed,
      v: spec.variants || rawAny.variants || undefined,
    };

    try {
      return this.toUrlSafeBase64(JSON.stringify(payload));
    } catch {
      return '';
    }
  }

  /**
   * 解碼短碼並完整還原為符合前端規範之 PuzzleEntity
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
      const tier = (payload.t as ExtendedTierKey) || 'intermediate';

      // 階梯式難度對應之預設 IRT
      const fallbackIrtMap: Record<string, number> = {
        kids: 0.65,
        intermediate: 1.45,
        expert: 2.35,
        master: 3.15,
        legendary: 3.75,
        ultimate: 4.35,
      };
      const irt = payload.i !== undefined ? Number(payload.i) : (fallbackIrtMap[tier] || 1.5);

      // 嚴格還原盤面結構，分流 clues 與 grid
      let cluesData = payload.k;
      let gridData = payload.g;

      // 若未獨立傳輸 grid，且 clues 是數獨等 2D 盤面，則將其設為初始盤面
      if (gridData === undefined) {
        if (Array.isArray(cluesData) && Array.isArray(cluesData[0])) {
          gridData = cluesData;
        } else {
          gridData = null;
        }
      }

      const puzzleSpec: any = {
        rows,
        cols,
        clues: cluesData,
        grid: gridData,
        solution: payload.s,
        seed: payload.seed,
        pureDeductionRate: 1.0,
      };

      if (payload.v) {
        puzzleSpec.variants = payload.v;
      }

      return {
        id: `challenge_${payload.e}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        category: meta.category as any,
        engine_type: payload.e,
        tier: tier as any,
        checksum: payload.h || `VERIFIED_${Date.now().toString(36)}`,
        puzzle: puzzleSpec,
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
   * 生成跨端可點擊的對決連結
   */
  public static generateShareUrl(puzzle: PuzzleEntity): string {
    const code = this.encode(puzzle);
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lawgic.app';
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
    return `${origin}${pathname}#challenge=${code}`;
  }
}
