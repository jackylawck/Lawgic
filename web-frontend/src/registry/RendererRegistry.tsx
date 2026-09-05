// web-frontend/src/registry/RendererRegistry.tsx
import React, { lazy, Suspense } from 'react';
import { PuzzleEntity } from '../generated';

export interface BaseBoardProps {
  puzzleData?: any;
  puzzle?: any;
  tournamentMode?: boolean;
  [key: string]: any;
}

// 輔助函式：相容 named export 與 default export，防止 m[name] 為 undefined 導致崩潰
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

// 動態代碼分割載入 18 款謎題組件
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

// 認知儀表板
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

export const PuzzleRenderer: React.FC<PuzzleRendererProps> = ({ puzzle, tournamentMode }) => {
  const normalizedType = puzzle?.engine_type?.toLowerCase().trim();
  const Component = RENDERERS[normalizedType];

  if (!Component) {
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

  // 規格轉接器 (Universal Adapter)：
  // 1. 保留完整 puzzle 與 puzzleData
  // 2. 將內部 spec (puzzle.puzzle) 中的屬性展開到 props，相容不同時期的 Board 存取方式
  const innerSpec = (puzzle?.puzzle && typeof puzzle.puzzle === 'object') ? puzzle.puzzle : {};
  const mergedProps: BaseBoardProps = {
    ...innerSpec,
    puzzle,
    puzzleData: puzzle,
    tournamentMode: !!tournamentMode,
  };

  return (
    <Suspense fallback={<BoardLoadingFallback />}>
      <Component {...mergedProps} />
    </Suspense>
  );
};
