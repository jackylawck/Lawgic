// web-frontend/src/registry/RendererRegistry.tsx
import React, { lazy, Suspense } from 'react';
import { PuzzleEntity } from '../generated';

export interface BaseBoardProps {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

// 採用 React.lazy 實現動態代碼分割，按需載入 Board Chunk
const MazeBoard = lazy(() => import('../components/MazeBoard').then(m => ({ default: m.MazeBoard })));
const SudokuBoard = lazy(() => import('../components/SudokuBoard').then(m => ({ default: m.SudokuBoard })));
const NonogramBoard = lazy(() => import('../components/NonogramBoard').then(m => ({ default: m.NonogramBoard })));
const NurikabeBoard = lazy(() => import('../components/NurikabeBoard').then(m => ({ default: m.NurikabeBoard })));
const SkyscraperBoard = lazy(() => import('../components/SkyscraperBoard').then(m => ({ default: m.SkyscraperBoard })));
const HashiBoard = lazy(() => import('../components/HashiBoard').then(m => ({ default: m.HashiBoard })));
const KropkiBoard = lazy(() => import('../components/KropkiBoard').then(m => ({ default: m.KropkiBoard })));
const SlitherlinkBoard = lazy(() => import('../components/SlitherlinkBoard').then(m => ({ default: m.SlitherlinkBoard })));
const TentsBoard = lazy(() => import('../components/TentsBoard').then(m => ({ default: m.TentsBoard })));
const LightUpBoard = lazy(() => import('../components/LightUpBoard').then(m => ({ default: m.LightUpBoard })));
const FutoshikiBoard = lazy(() => import('../components/FutoshikiBoard').then(m => ({ default: m.FutoshikiBoard })));
const HitoriBoard = lazy(() => import('../components/HitoriBoard').then(m => ({ default: m.HitoriBoard })));
const KakuroBoard = lazy(() => import('../components/KakuroBoard').then(m => ({ default: m.KakuroBoard })));
const MasyuBoard = lazy(() => import('../components/MasyuBoard').then(m => ({ default: m.MasyuBoard })));
const DominoesBoard = lazy(() => import('../components/DominoesBoard').then(m => ({ default: m.DominoesBoard })));
const HeyawakeBoard = lazy(() => import('../components/HeyawakeBoard').then(m => ({ default: m.HeyawakeBoard })));
const YajilinBoard = lazy(() => import('../components/YajilinBoard').then(m => ({ default: m.YajilinBoard })));

export const RENDERERS: Record<string, React.ComponentType<BaseBoardProps>> = {
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
  yajilin: YajilinBoard, // 第 15 款：矢印迴路
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
  const normalizedType = puzzle.engine_type?.toLowerCase().trim();
  const Component = RENDERERS[normalizedType];

  if (!Component) {
    return (
      <div className="p-4 text-center font-mono text-rose-400 text-xs border border-rose-900/60 bg-rose-950/40 rounded-xl max-w-md mx-auto my-6 shadow-xl">
        <div className="text-base mb-1">⚠️</div>
        <div className="font-bold uppercase tracking-wider mb-1">[Engine Missing]</div>
        <div className="text-[11px] text-slate-300">
          Renderer not found for engine type: <span className="text-rose-300 font-bold">&quot;{puzzle.engine_type}&quot;</span>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<BoardLoadingFallback />}>
      <Component puzzle={puzzle} puzzleData={puzzle} tournamentMode={tournamentMode} />
    </Suspense>
  );
};
