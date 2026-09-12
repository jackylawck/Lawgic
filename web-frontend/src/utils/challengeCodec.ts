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
const MAX_RAW_PAYLOAD_LENGTH = 65536; // 64KB 防 DoS 長度限制

export class ChallengeCodec {
  private static toUrlSafeBase64(str: string): string {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const len = bytes.byteLength;
    const CHUNK_SIZE = 0x8000;
    for (let i = 0; i < len; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(bytes.subarray(i, Math.min(i + CHUNK_SIZE, len)))
      );
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private static fromUrlSafeBase64(base64: string): string {
    if (base64.length > MAX_RAW_PAYLOAD_LENGTH) {
      throw new Error('PAYLOAD_SIZE_EXCEEDED');
    }
    let sanitized = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (sanitized.length % 4) {
      sanitized += '=';
    }
    const binary = atob(sanitized);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  private static computeDeterministicHash(content: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < content.length; i++) {
      hash ^= content.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

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

  public static decode(code: string): PuzzleEntity | null {
    if (!code || typeof code !== 'string') return null;

    try {
      const jsonStr = this.fromUrlSafeBase64(code.trim());
      
      if (jsonStr.includes(':') && !jsonStr.startsWith('{')) {
        const [engineType, tier = 'kids', seedStr] = jsonStr.split(':');
        const seed = seedStr ? parseInt(seedStr, 10) : undefined;
        return this.createPlaceholderEntity(engineType, tier, seed);
      }

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
        solution: verifiedPayload.s ?? null,
        cognitiveLoad: meta.cognitiveLoad,
        metrics: {
          estimated_time_sec: rows * cols * 2.5,
          irt_logit_difficulty: irt,
          seed: verifiedPayload.seed,
        },
      };
    } catch {
      return null;
    }
  }

  private static createPlaceholderEntity(engineType: string, tier: string, seed?: number): PuzzleEntity {
    const meta = ENGINE_METADATA_MAP[engineType] ?? {
      category: 'spatial_logic',
      cognitiveLoad: { spatial: 0.8, numeric: 0.6, workingMemory: 0.7, inhibition: 0.7 },
    };
    const effectiveSeed = seed ?? 1000;
    const computedChecksum = `H_${this.computeDeterministicHash(`${engineType}_${tier}_${effectiveSeed}`)}`;

    return {
      id: `shortcut_${engineType}_${tier}_${effectiveSeed}`,
      category: meta.category,
      engine_type: engineType,
      tier: tier as ExtendedTierKey,
      checksum: computedChecksum,
      solution: null,
      puzzle: { rows: 6, cols: 6, seed: effectiveSeed },
      cognitiveLoad: meta.cognitiveLoad,
      metrics: {
        estimated_time_sec: 120,
        irt_logit_difficulty: FALLBACK_IRT_MAP[tier] ?? 1.0,
        seed: effectiveSeed,
      },
    };
  }

  public static parseRouteHash(hash: string): PuzzleEntity | null {
    if (!hash) return null;
    if (hash.startsWith('#challenge=')) {
      return this.decode(hash.slice('#challenge='.length));
    }
    if (hash.startsWith('#c=')) {
      return this.decode(hash.slice('#c='.length));
    }
    return null;
  }

  public static generateShareUrl(puzzle: PuzzleEntity): string {
    const code = this.encode(puzzle);
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lawgic.app';
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
    return `${origin}${pathname}#challenge=${code}`;
  }
}
