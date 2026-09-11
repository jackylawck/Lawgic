// web-frontend/src/registry/RendererRegistry.tsx
import React, { lazy, Suspense, useMemo } from 'react';
import { PuzzleEntity, PuzzleSpec } from '../generated';
import {
  ENGINE_METADATA,
  EngineTypeKey,
  normalizeEngineType,
  normalizeAlias,
} from './engineMetadata';

/**
 * ⚠️ 相容性過渡層下線標準 (Compatibility Facade Sunset Policy)
 * 追蹤 Issue: https://github.com/jackylawck/Lawgic/issues/1
 * 代碼標記: TECH-DEBT-REGISTRY-FACADE
 */

export interface BaseBoardProps {
  puzzleData: PuzzleEntity;
  puzzle: PuzzleSpec;
  rawEntity: PuzzleEntity;
  clues?: unknown;
  grid?: unknown;
  solution?: unknown;
  rows: number;
  cols: number;
  size: number;
  tier: string;
  difficulty: string;
  tournamentMode: boolean;
  seed?: number;
  [key: string]: unknown;
}

class PermanentModuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentModuleError';
  }
}

const safeLazyWithRetry = <P extends object = BaseBoardProps>(
  importFn: () => Promise<any>,
  exportName: string,
  retries = 3
): React.LazyExoticComponent<React.ComponentType<P>> => {
  return lazy(() => {
    const run = (attemptsLeft: number): Promise<{ default: React.ComponentType<P> }> => {
      return importFn()
        .then((m) => {
          const Component = m[exportName] || m.default;
          if (!Component) {
            throw new PermanentModuleError(
              `Component "${exportName}" is not properly exported from module.`
            );
          }
          return { default: Component };
        })
        .catch((err) => {
          if (err instanceof PermanentModuleError) {
            throw err;
          }

          if (attemptsLeft <= 1) {
            console.error(`[RendererRegistry] Failed to load chunk for "${exportName}":`, err);
            throw err;
          }

          const delay = 300 * Math.pow(2, retries - attemptsLeft);
          return new Promise((resolve) => setTimeout(() => resolve(run(attemptsLeft - 1)), delay));
        });
    };
    return run(retries);
  });
};

const MazeBoard = safeLazyWithRetry(() => import('../components/MazeBoard'), 'MazeBoard');
const SudokuBoard = safeLazyWithRetry(() => import('../components/SudokuBoard'), 'SudokuBoard');
const NonogramBoard = safeLazyWithRetry(() => import('../components/NonogramBoard'), 'NonogramBoard');
const NurikabeBoard = safeLazyWithRetry(() => import('../components/NurikabeBoard'), 'NurikabeBoard');
const SkyscraperBoard = safeLazyWithRetry(() => import('../components/SkyscraperBoard'), 'SkyscraperBoard');
const HashiBoard = safeLazyWithRetry(() => import('../components/HashiBoard'), 'HashiBoard');
const KropkiBoard = safeLazyWithRetry(() => import('../components/KropkiBoard'), 'KropkiBoard');
const SlitherlinkBoard = safeLazyWithRetry(() => import('../components/SlitherlinkBoard'), 'SlitherlinkBoard');
const TentsBoard = safeLazyWithRetry(() => import('../components/TentsBoard'), 'TentsBoard');
const LightUpBoard = safeLazyWithRetry(() => import('../components/LightUpBoard'), 'LightUpBoard');
const FutoshikiBoard = safeLazyWithRetry(() => import('../components/FutoshikiBoard'), 'FutoshikiBoard');
const HitoriBoard = safeLazyWithRetry(() => import('../components/HitoriBoard'), 'HitoriBoard');
const KakuroBoard = safeLazyWithRetry(() => import('../components/KakuroBoard'), 'KakuroBoard');
const MasyuBoard = safeLazyWithRetry(() => import('../components/MasyuBoard'), 'MasyuBoard');
const DominoesBoard = safeLazyWithRetry(() => import('../components/DominoesBoard'), 'DominoesBoard');
const HeyawakeBoard = safeLazyWithRetry(() => import('../components/HeyawakeBoard'), 'HeyawakeBoard');
const YajilinBoard = safeLazyWithRetry(() => import('../components/YajilinBoard'), 'YajilinBoard');
const ShikakuBoard = safeLazyWithRetry(() => import('../components/ShikakuBoard'), 'ShikakuBoard');

export const CognitiveDashboard = safeLazyWithRetry<Record<string, never>>(
  () => import('../components/CognitiveDashboard'),
  'CognitiveDashboard'
);

// 主名元件綁定（若漏填任何一款引擎，TypeScript 會精確報錯）
const COMPONENT_MAP: Record<EngineTypeKey, React.ComponentType<BaseBoardProps>> = {
  maze: MazeBoard,
  sudoku: SudokuBoard,
  nonogram: NonogramBoard,
  nurikabe: NurikabeBoard,
  skyscraper: SkyscraperBoard,
  hashi: HashiBoard,
  kropki: KropkiBoard,
  slitherlink: SlitherlinkBoard,
  tents: TentsBoard,
  lightup: LightUpBoard,
  futoshiki: FutoshikiBoard,
  hitori: HitoriBoard,
  kakuro: KakuroBoard,
  masyu: MasyuBoard,
  dominoes: DominoesBoard,
  heyawake: HeyawakeBoard,
  yajilin: YajilinBoard,
  shikaku: ShikakuBoard,
};

// 全量別名直接自 ENGINE_METADATA 衍生，徹底消滅手寫重複維護
export const RENDERERS: Record<string, React.ComponentType<BaseBoardProps>> = (() => {
  const map: Record<string, React.ComponentType<BaseBoardProps>> = { ...COMPONENT_MAP };
  for (const [canonical, meta] of Object.entries(ENGINE_METADATA)) {
    const Component = COMPONENT_MAP[canonical as EngineTypeKey];
    if (!Component) continue;
    for (const alias of meta.aliases) {
      map[normalizeAlias(alias)] = Component;
    }
  }
  return Object.freeze(map);
})();

interface PuzzleRendererProps {
  puzzle: PuzzleEntity;
  tournamentMode?: boolean;
}

const BoardLoadingFallback: React.FC = () => (
  <div className="flex flex-col items-center justify-center p-8 min-h-[380px] font-mono select-none">
    <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin mb-3" />
    <span className="text-[10px] text-slate-400 tracking-wider uppercase animate-pulse">
      Initializing Logic Engine...
    </span>
  </div>
);

export const PuzzleRenderer: React.FC<PuzzleRendererProps> = ({ puzzle, tournamentMode = false }) => {
  const normalizedType = useMemo(() => {
    return normalizeEngineType(puzzle?.engine_type || '');
  }, [puzzle?.engine_type]);

  const Component = useMemo(() => {
    return RENDERERS[normalizedType];
  }, [normalizedType]);

  const normalizedProps = useMemo<BaseBoardProps | null>(() => {
    if (!puzzle) return null;

    const topLevelFields = puzzle as unknown as Record<string, unknown>;
    const spec: PuzzleSpec =
      puzzle.puzzle && typeof puzzle.puzzle === 'object' ? puzzle.puzzle : {};

    const rows = Number(spec.rows ?? spec.height ?? spec.size ?? topLevelFields.size ?? 6);
    const cols = Number(spec.cols ?? spec.width ?? spec.size ?? topLevelFields.size ?? 6);
    const size = Math.max(rows, cols);
    const activeTier = String(puzzle.tier ?? spec.tier ?? spec.difficulty ?? 'kids');

    const clues = spec.clues ?? topLevelFields.clues ?? spec.grid;
    const grid = spec.grid ?? topLevelFields.grid ?? spec.clues;
    const solution = spec.solution ?? puzzle.solution ?? topLevelFields.solution;
    const metricsSeed = puzzle.metrics?.seed;

    return {
      ...spec,
      puzzleData: puzzle,
      puzzle: spec,
      rawEntity: puzzle,
      clues,
      grid,
      solution,
      rows,
      cols,
      size,
      tier: activeTier,
      difficulty: activeTier,
      tournamentMode: Boolean(tournamentMode),
      seed: spec.seed ?? metricsSeed,
    };
  }, [puzzle, tournamentMode]);

  if (!Component || !normalizedProps) {
    return (
      <div className="p-4 text-center font-mono text-rose-400 text-xs border border-rose-900/60 bg-rose-950/40 rounded-xl max-w-md mx-auto my-6 shadow-xl">
        <div className="text-base mb-1">⚠️</div>
        <div className="font-bold uppercase tracking-wider mb-1">[Engine Missing]</div>
        <div className="text-[11px] text-slate-300">
          Renderer not found for engine type:{' '}
          <span className="text-rose-300 font-bold">&quot;{puzzle?.engine_type}&quot;</span>
        </div>
      </div>
    );
  }

  const componentKey =
    puzzle.id || `${normalizedType}_${normalizedProps.tier}_${normalizedProps.seed ?? 'no_seed'}`;

  return (
    <Suspense fallback={<BoardLoadingFallback />}>
      <Component key={componentKey} {...normalizedProps} />
    </Suspense>
  );
};
