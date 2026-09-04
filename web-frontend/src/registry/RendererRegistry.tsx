// web-frontend/src/registry/RendererRegistry.tsx
import React from 'react';
import { PuzzleEntity } from '../generated';

// 匯入所有遊戲 Board 組件
import { MazeBoard } from '../components/MazeBoard';
import { SudokuBoard } from '../components/SudokuBoard';
import { NonogramBoard } from '../components/NonogramBoard';
import { NurikabeBoard } from '../components/NurikabeBoard';
import { SkyscraperBoard } from '../components/SkyscraperBoard';
import { HashiBoard } from '../components/HashiBoard';
import { KropkiBoard } from '../components/KropkiBoard';
import { SlitherlinkBoard } from '../components/SlitherlinkBoard';
import { TentsBoard } from '../components/TentsBoard';
import { LightUpBoard } from '../components/LightUpBoard';
import { FutoshikiBoard } from '../components/FutoshikiBoard';
import { HitoriBoard } from '../components/HitoriBoard';
import { KakuroBoard } from '../components/KakuroBoard';
import { MasyuBoard } from '../components/MasyuBoard';
import { DominoesBoard } from '../components/DominoesBoard';
import { HeyawakeBoard } from '../components/HeyawakeBoard';

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
};

interface PuzzleRendererProps {
  puzzle: PuzzleEntity;
  tournamentMode?: boolean;
}

export const PuzzleRenderer: React.FC<PuzzleRendererProps> = ({ puzzle, tournamentMode }) => {
  const Component = RENDERERS[puzzle.engine_type];

  if (!Component) {
    return (
      <div className="p-4 text-center font-mono text-rose-400 text-xs border border-rose-900 bg-rose-950/30 rounded-lg">
        [Engine Error] Renderer not found for type: &quot;{puzzle.engine_type}&quot;
      </div>
    );
  }

  return <Component puzzle={puzzle} tournamentMode={tournamentMode} />;
};
