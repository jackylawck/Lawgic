import { MasyuBoard } from '../components/MasyuBoard';

export const RENDERERS: Record<string, React.ComponentType<any>> = {
  maze: MazeBoard,
  sudoku: SudokuBoard,
  nonogram: NonogramBoard,
  picross: NonogramBoard,
  nurikabe: NurikabeBoard,
  futoshiki: FutoshikiBoard,
  hitori: HitoriBoard,
  kakuro: KakuroBoard,
  masyu: MasyuBoard, // <-- 註冊珍珠迴路
  skyscraper: SkyscraperBoard,
  hashi: HashiBoard,
  hashiwokakero: HashiBoard,
  kropki: KropkiBoard,
  slitherlink: SlitherlinkBoard,
  tents: TentsBoard,
  tentstrees: TentsBoard,
  lightup: LightUpBoard,
  akari: LightUpBoard,
};
