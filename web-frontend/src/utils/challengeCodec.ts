// web-frontend/src/utils/challengeCodec.ts
import { PuzzleEntity } from '../generated';
import { ExtendedTierKey } from '../hooks/useLearnerProfile';

/**
 * 線索資料型別契約
 * 
 * - 支援扁平陣列、二維矩陣、字串（如 CSV）、或結構化字典物件。
 * - 具體業務結構之語意驗證由下游特定遊戲引擎實作，此編解碼器僅確保 JSON 序列化合法性。
 */
export type ClueData = number[] | number[][] | string | Record<string, unknown> | null;
export type GridData = number[][] | string[][] | null;

export interface CompactChallengePayload {
  readonly e: string;            // engine_type
  readonly t: string;            // tier / difficulty
  readonly r: number;            // rows
  readonly c: number;            // cols
  readonly k?: ClueData;         // clues
  readonly g?: GridData;         // grid (若與 clues 獨立)
  readonly s?: GridData;         // solution
  readonly h?: string;           // checksum / deterministic hash
  readonly i?: number;           // irt logit difficulty
  readonly seed?: number;        // random seed
  readonly v?: readonly string[];// variants
  readonly pdr?: number;         // pure deduction rate (若經後端/WASM求解器驗證)
}

interface CognitiveProfile {
  readonly category: 'spatial_logic' | 'numeric_logic' | 'pattern_logic';
  readonly cognitiveLoad: {
    readonly spatial: number;
    readonly numeric: number;
    readonly workingMemory: number;
    readonly inhibition: number;
  };
}

const ENGINE_METADATA_MAP: Record<string, CognitiveProfile> = {
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
} as const;

const FALLBACK_IRT_MAP: Readonly<Record<string, number>> = {
  kids: 0.65,
  intermediate: 1.45,
  expert: 2.35,
  master: 3.15,
  legendary: 3.75,
  ultimate: 4.35,
} as const;

const MAX_GRID_DIMENSION = 64;
const MIN_GRID_DIMENSION = 1;

/**
 * ChallengeCodec
 * 
 * ⚠️ 安全架構與信任邊界聲明：
 * 1. 職責劃分：此編解碼器專注於 URL-safe 序列化與客戶端即時分享。
 * 2. 資料安全性：Payload 採明文 Base64 傳遞，無後端 HMAC 簽名，不保證防篡改性。
 *    任何具排位、競賽獎勵之業務結算，必須由後端根據 Seed/Solution 進行重放校驗。
 * 3. 雜湊限制：內建的 `computeDeterministicHash` 採用非加密 FNV-1a 算法，
 *    僅用於提供確定性 ID 派生與傳輸完整性檢查，不可視為防碰撞之安全密碼學校驗。
 */
export class ChallengeCodec {
  private static toUrlSafeBase64(str: string): string {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
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
   * 計算確定性內容摘要（非加密雜湊，用於 ID 派生與傳輸損壞檢測）
   */
  private static computeDeterministicHash(content: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < content.length; i++) {
      hash ^= content.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

  /**
   * 序列化 PuzzleEntity 為 URL-safe 短碼
   */
  public static encode(puzzle: PuzzleEntity): string {
    if (!puzzle) return '';

    const raw = puzzle as unknown as Record<string, unknown>;
    const spec = (typeof puzzle.puzzle === 'object' && puzzle.puzzle !== null) 
      ? (puzzle.puzzle as Record<string, unknown>) 
      : {};

    const engineType = puzzle.engine_type 
      || (spec.engine_type as string) 
      || (raw.type as string) 
      || 'maze';

    const tier = String(
      puzzle.tier || spec.tier || spec.difficulty || raw.difficulty || 'intermediate'
    );

    const rows = Math.min(
      MAX_GRID_DIMENSION, 
      Math.max(MIN_GRID_DIMENSION, Number(spec.rows || spec.height || spec.size || raw.size || 6))
    );
    const cols = Math.min(
      MAX_GRID_DIMENSION, 
      Math.max(MIN_GRID_DIMENSION, Number(spec.cols || spec.width || spec.size || raw.size || 6))
    );

    const irt = puzzle.metrics?.irt_logit_difficulty !== undefined
      ? Number(puzzle.metrics.irt_logit_difficulty.toFixed(2))
      : undefined;

    const cluesData = (spec.clues !== undefined ? spec.clues : (spec.grid !== undefined ? spec.grid : raw.clues)) as ClueData;
    const gridData = (spec.grid !== undefined && spec.grid !== spec.clues) ? (spec.grid as GridData) : undefined;
    const seed = typeof spec.seed === 'number' ? spec.seed : (puzzle.metrics as { seed?: number } | undefined)?.seed;

    // 設計決策：solution 使用 || 是刻意的，空陣列或空字串視為「無 solution」，應依序 fallback
    const solutionData = (puzzle.solution || spec.solution || raw.solution || null) as GridData;

    const rawPayload: Omit<CompactChallengePayload, 'h'> = {
      e: engineType,
      t: tier,
      r: rows,
      c: cols,
      k: cluesData,
      g: gridData,
      s: solutionData,
      i: irt,
      seed,
      v: Array.isArray(spec.variants || raw.variants) 
        ? ((spec.variants || raw.variants) as readonly string[]) 
        : undefined,
      pdr: typeof spec.pureDeductionRate === 'number' ? spec.pureDeductionRate : undefined,
    };

    const contentString = JSON.stringify(rawPayload);
    const checksum = puzzle.checksum || `H_${this.computeDeterministicHash(contentString)}`;

    const payload: CompactChallengePayload = {
      ...rawPayload,
      h: checksum,
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
      const payload: unknown = JSON.parse(jsonStr);

      if (
        !payload ||
        typeof payload !== 'object' ||
        typeof (payload as CompactChallengePayload).e !== 'string' ||
        typeof (payload as CompactChallengePayload).r !== 'number' ||
        typeof (payload as CompactChallengePayload).c !== 'number'
      ) {
        return null;
      }

      const verifiedPayload = payload as CompactChallengePayload;

      if (
        verifiedPayload.r < MIN_GRID_DIMENSION || verifiedPayload.r > MAX_GRID_DIMENSION ||
        verifiedPayload.c < MIN_GRID_DIMENSION || verifiedPayload.c > MAX_GRID_DIMENSION
      ) {
        return null;
      }

      const rows = verifiedPayload.r;
      const cols = verifiedPayload.c;
      const engineKey = verifiedPayload.e;

      const meta = ENGINE_METADATA_MAP[engineKey] ?? {
        category: 'spatial_logic',
        cognitiveLoad: { spatial: 0.8, numeric: 0.6, workingMemory: 0.7, inhibition: 0.7 },
      };

      const tier = (verifiedPayload.t as ExtendedTierKey) || 'intermediate';
      const irt = verifiedPayload.i !== undefined ? Number(verifiedPayload.i) : (FALLBACK_IRT_MAP[tier] ?? 1.5);

      let cluesData: ClueData = verifiedPayload.k ?? null;
      let gridData: GridData = verifiedPayload.g ?? null;

      if (gridData === null && Array.isArray(cluesData) && Array.isArray(cluesData[0])) {
        gridData = cluesData as unknown as GridData;
      }

      // 雜湊對稱性修正：若無外部 checksum，對「不含 h 的 payload」計算雜湊，保持與 encode 輸入完全一致
      const { h: existingHash, ...payloadWithoutHash } = verifiedPayload;
      const effectiveChecksum = existingHash 
        || `H_${this.computeDeterministicHash(JSON.stringify(payloadWithoutHash))}`;

      const puzzleSpec: Record<string, unknown> = {
        rows,
        cols,
        clues: cluesData,
        grid: gridData,
        solution: verifiedPayload.s ?? null,
        seed: verifiedPayload.seed,
        pureDeductionRate: verifiedPayload.pdr ?? undefined,
      };

      if (verifiedPayload.v) {
        puzzleSpec.variants = verifiedPayload.v;
      }

      return {
        id: `challenge_${engineKey}_${effectiveChecksum}`,
        category: meta.category,
        engine_type: engineKey,
        tier,
        checksum: effectiveChecksum,
        puzzle: puzzleSpec,
        solution: verifiedPayload.s,
        cognitiveLoad: meta.cognitiveLoad,
        metrics: {
          /* 設計決策：estimated_time_sec 是 decode 時派生的估計值，不列入 payload 序列化以精簡 URL 長度 */
          estimated_time_sec: rows * cols * 2.5,
          irt_logit_difficulty: irt,
          seed: verifiedPayload.seed,
        },
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
