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

// 輔助函式：相容 named export 與 default export，防範動態載入失敗
const safeLazy = (importFn: () => Promise<any>, exportName: string) => {
  return lazy(() =>
    importFn().then((m) => {
      const Component = m[exportName] || m.default;
      if (!Component) {
        throw new Error(`Component ${exportName} not exported properly.`);
      }
      return { default: Component };
    })
  );
};

// 代碼分割載入全套 18 款謎題組件
const MazeBoard = safeLazy(() => import('../components/MazeBoard'), 'MazeBoard');
const SudokuBoard = safeLazy(() => import('../components/SudokuBoard'), 'SudokuBoard');
const NonogramBoard = safeLazy(() => import('../components/NonogramBoard'), 'NonogramBoard');
const NurikabeBoard = safeLazy(() => import('../components/NurikabeBoard'), 'NurikabeBoard');
const SkyscraperBoard = safeLazy(() => import('../components/SkyscraperBoard'), 'SkyscraperBoard');
const HashiBoard = safeLazy(() => import('../components/HashiBoard'), 'HashiBoard');
const KropkiBoard = safeLazy(() => import('../components/KropkiBoard'), 'KropkiBoard');
const SlitherlinkBoard = safeLazy(() => import('../components/SlitherlinkBoard'), 'SlitherlinkBoard');
const TentsBoard = safeLazy(() => import('../components/TentsBoard'), 'TentsBoard');
const LightUpBoard = safeLazy(() => import('../components/LightUpBoard'), 'LightUpBoard');
const FutoshikiBoard = safeLazy(() => import('../components/FutoshikiBoard'), 'FutoshikiBoard');
const HitoriBoard = safeLazy(() => import('../components/HitoriBoard'), 'HitoriBoard');
const KakuroBoard = safeLazy(() => import('../components/KakuroBoard'), 'KakuroBoard');
const MasyuBoard = safeLazy(() => import('../components/MasyuBoard'), 'MasyuBoard');
const DominoesBoard = safeLazy(() => import('../components/DominoesBoard'), 'DominoesBoard');
const HeyawakeBoard = safeLazy(() => import('../components/HeyawakeBoard'), 'HeyawakeBoard');
const YajilinBoard = safeLazy(() => import('../components/YajilinBoard'), 'YajilinBoard');
const ShikakuBoard = safeLazy(() => import('../components/ShikakuBoard'), 'ShikakuBoard');

export const CognitiveDashboard = safeLazy(
  () => import('../components/CognitiveDashboard'),
  'CognitiveDashboard'
);

export const RENDERERS: Record<string, React.ComponentType<any>> = {
  maze: MazeBoard,
  sudoku: SudokuBoard,
  nonogram: NonogramBoard,
  picross: NonogramBoard,
  nurikabe: NurikabeBoard,
  skyscraper: SkyscraperBoard,
  hashi: HashiBoard,
  hashiwokakero: HashiBoard,
  kropki: KropkiBoard,
  slitherlink: SlitherlinkBoard,
  tents: TentsBoard,
  tentstrees: TentsBoard,
  lightup: LightUpBoard,
  akari: LightUpBoard,
  futoshiki: FutoshikiBoard,
  hitori: HitoriBoard,
  kakuro: KakuroBoard,
  masyu: MasyuBoard,
  dominoes: DominoesBoard,
  heyawake: HeyawakeBoard,
  yajilin: YajilinBoard,
  shikaku: ShikakuBoard,
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
  const normalizedType = puzzle?.engine_type?.toLowerCase().trim() || '';
  const Component = RENDERERS[normalizedType];

  // 全方位規格轉接與資料歸一化 (Normalization)
  const normalizedProps = useMemo(() => {
    if (!puzzle) return null;

    const spec = (puzzle.puzzle && typeof puzzle.puzzle === 'object') ? puzzle.puzzle : {};
    
    // 萃取維度
    const rows = Number(spec.rows || spec.height || spec.size || puzzle.size || 6);
    const cols = Number(spec.cols || spec.width || spec.size || puzzle.size || 6);
    const size = Math.max(rows, cols);

    // 萃取難度標籤，優先使用最外層確認過的 tier
    const activeTier = String(puzzle.tier || spec.tier || spec.difficulty || 'kids');

    // 萃取題目數據 (同時相容 clues 與 grid)
    const clues = spec.clues !== undefined ? spec.clues : (puzzle.clues !== undefined ? puzzle.clues : spec.grid);
    const grid = spec.grid !== undefined ? spec.grid : (puzzle.grid !== undefined ? puzzle.grid : spec.clues);
    const solution = puzzle.solution !== undefined ? puzzle.solution : spec.solution;

    return {
      // 展開原始 spec
      ...spec,
      // 確保基礎核心欄位精準覆蓋，不被 spec 內部的 undefined 污染
      puzzleData: puzzle,
      puzzle: spec, // 許多 Board 習慣以 props.puzzle 取用內部數據
      rawEntity: puzzle,
      clues,
      grid,
      solution,
      rows,
      cols,
      size,
      tier: activeTier,
      difficulty: activeTier,
      tournamentMode: !!tournamentMode,
      seed: spec.seed || (puzzle.metrics as any)?.seed,
    };
  }, [puzzle, tournamentMode]);

  if (!Component || !normalizedProps) {
    return (
      <div className="p-4 text-center font-mono text-rose-400 text-xs border border-rose-900/60 bg-rose-950/40 rounded-xl max-w-md mx-auto my-6 shadow-xl">
        <div className="text-base mb-1">⚠️</div>
        <div className="font-bold uppercase tracking-wider mb-1">[Engine Missing]</div>
        <div className="text-[11px] text-slate-300">
          Renderer not found for engine type: <span className="text-rose-300 font-bold">&quot;{puzzle?.engine_type}&quot;</span>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<BoardLoadingFallback />}>
      {/* 加上 key 確保盤面在題目 ID 或難度變更時乾淨重置生命週期 */}
      <Component key={puzzle.id || `${normalizedType}_${normalizedProps.tier}`} {...normalizedProps} />
    </Suspense>
  );
};
