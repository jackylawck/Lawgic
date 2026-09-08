// web-frontend/src/registry/RendererRegistry.tsx
import React, { lazy, Suspense, useMemo } from 'react';
import { PuzzleEntity } from '../generated';

export interface BaseBoardProps {
  puzzleData: PuzzleEntity;
  puzzle: any;
  clues?: any;
  grid?: any;
  solution?: any;
  rows: number;
  cols: number;
  size: number;
  tier: string;
  difficulty: string;
  tournamentMode: boolean;
  [key: string]: any;
}

/**
 * 健壯的動態載入器：
 * 1. 相容 named export 與 default export
 * 2. 內建 3 次指數退避重試，抵抗弱網與 Service Worker 快取更新造成的 Chunk 載入中斷
 */
const safeLazyWithRetry = (importFn: () => Promise<any>, exportName: string, retries = 3) => {
  return lazy(() => {
    const run = (attemptsLeft: number): Promise<{ default: React.ComponentType<any> }> => {
      return importFn()
        .then((m) => {
          const Component = m[exportName] || m.default;
          if (!Component) {
            throw new Error(`Component "${exportName}" is not properly exported.`);
          }
          return { default: Component };
        })
        .catch((err) => {
          if (attemptsLeft <= 1) {
            console.error(`[RendererRegistry] Failed to load chunk for "${exportName}" after retries:`, err);
            throw err;
          }
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(run(attemptsLeft - 1));
            }, 300 * (4 - attemptsLeft));
          });
        });
    };
    return run(retries);
  });
};

// 代碼分割載入全套 18 款謎題組件（精確包含副檔名，防範 Rollup 解析歧義）
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

export const CognitiveDashboard = safeLazyWithRetry(
  () => import('../components/CognitiveDashboard'),
  'CognitiveDashboard'
);

// 國際賽事全別名註冊矩陣 (Alias Mapping)
export const RENDERERS: Record<string, React.ComponentType<any>> = {
  maze: MazeBoard,

  sudoku: SudokuBoard,

  nonogram: NonogramBoard,
  picross: NonogramBoard,
  griddlers: NonogramBoard,

  nurikabe: NurikabeBoard,

  skyscraper: SkyscraperBoard,
  skyscrapers: SkyscraperBoard,

  hashi: HashiBoard,
  hashiwokakero: HashiBoard,
  bridges: HashiBoard,

  kropki: KropkiBoard,
  kropki_dots: KropkiBoard,

  slitherlink: SlitherlinkBoard,
  fences: SlitherlinkBoard,
  loop: SlitherlinkBoard,

  tents: TentsBoard,
  tentstrees: TentsBoard,
  'tents-and-trees': TentsBoard,
  tents_and_trees: TentsBoard,

  lightup: LightUpBoard,
  akari: LightUpBoard,

  futoshiki: FutoshikiBoard,
  futo: FutoshikiBoard,
  hutosiki: FutoshikiBoard,

  hitori: HitoriBoard,

  kakuro: KakuroBoard,
  cross_sums: KakuroBoard,

  masyu: MasyuBoard,
  pearl: MasyuBoard,

  dominoes: DominoesBoard,
  domino: DominoesBoard,

  heyawake: HeyawakeBoard,
  heya: HeyawakeBoard,

  yajilin: YajilinBoard,
  arrow_loop: YajilinBoard,

  shikaku: ShikakuBoard,
  divide_by_squares: ShikakuBoard,
};

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
    return puzzle?.engine_type?.toLowerCase().trim().replace(/[\s-_]+/g, '_') || '';
  }, [puzzle?.engine_type]);

  // 支援直接映射與底線/破折號通用降級查詢
  const Component = useMemo(() => {
    return RENDERERS[normalizedType] || RENDERERS[normalizedType.replace(/_/g, '')];
  }, [normalizedType]);

  // 規格歸一化 (Normalization)
  const normalizedProps = useMemo(() => {
    if (!puzzle) return null;

    const rawAny = puzzle as any;
    const spec = puzzle.puzzle && typeof puzzle.puzzle === 'object' ? (puzzle.puzzle as any) : {};

    // 萃取維度
    const rows = Number(spec.rows || spec.height || spec.size || rawAny.size || 6);
    const cols = Number(spec.cols || spec.width || spec.size || rawAny.size || 6);
    const size = Math.max(rows, cols);

    // 難度標籤萃取
    const activeTier = String(puzzle.tier || spec.tier || spec.difficulty || 'kids');

    // 題目與解答數據抽取 (確保陣列或物件非 undefined)
    const clues = spec.clues !== undefined ? spec.clues : (rawAny.clues !== undefined ? rawAny.clues : spec.grid);
    const grid = spec.grid !== undefined ? spec.grid : (rawAny.grid !== undefined ? rawAny.grid : spec.clues);
    const solution = puzzle.solution !== undefined ? puzzle.solution : spec.solution;

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
      seed: spec.seed || (puzzle.metrics as any)?.seed,
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

  // 以 puzzle.id 作為核心 key，確保題目切換時組件狀態完整重新掛載
  return (
    <Suspense fallback={<BoardLoadingFallback />}>
      <Component key={puzzle.id || `${normalizedType}_${normalizedProps.tier}`} {...normalizedProps} />
    </Suspense>
  );
};
