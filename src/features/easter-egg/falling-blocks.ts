export const BOARD_COLUMNS = 9;
export const BOARD_ROWS = 18;

type Cell = readonly [x: number, y: number];

export const SHAPES = [
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
  [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  [[0, 0], [0, 1], [1, 1], [2, 1]],
] as const satisfies readonly (readonly Cell[])[];

const ALL_SHAPES = SHAPES.map((_, index) => index);
const ROTATION_OFFSETS: readonly Cell[] = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];

interface Piece {
  shape: number;
  cells: readonly Cell[];
  x: number;
  y: number;
}

interface PieceBag {
  remaining: readonly number[];
  seed: number;
}

type Board = readonly (readonly (number | null)[])[];

export interface FallingBlocksGame {
  board: Board;
  piece: Piece;
  next: number;
  bag: PieceBag;
  rows: number;
  streak: number;
  score: number;
  status: 'playing' | 'paused' | 'over';
}

export type GameMove = 'left' | 'right' | 'rotate' | 'down' | 'drop' | 'tick' | 'pause';
export type GameAction = { type: GameMove } | { type: 'restart'; seed: number };

export function shapeWidth(cells: readonly Cell[]) {
  return Math.max(...cells.map(([x]) => x)) + 1;
}

export function shapeHeight(cells: readonly Cell[]) {
  return Math.max(...cells.map(([, y]) => y)) + 1;
}

function drawShape(bag: PieceBag) {
  const remaining = bag.remaining.length ? bag.remaining : ALL_SHAPES;
  const seed = (Math.imul(bag.seed, 1664525) + 1013904223) >>> 0;
  const index = Math.floor((seed / 0x1_0000_0000) * remaining.length);
  return { shape: remaining[index], bag: { remaining: remaining.filter((_, i) => i !== index), seed } };
}

function spawn(shape: number): Piece {
  const cells = SHAPES[shape];
  return { shape, cells, x: Math.floor((BOARD_COLUMNS - shapeWidth(cells)) / 2), y: 0 };
}

function emptyRow() {
  return Array<number | null>(BOARD_COLUMNS).fill(null);
}

export function newGameSeed() {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

export function createGame(seed: number): FallingBlocksGame {
  const first = drawShape({ remaining: [], seed });
  const second = drawShape(first.bag);
  return {
    board: Array.from({ length: BOARD_ROWS }, emptyRow),
    piece: spawn(first.shape),
    next: second.shape,
    bag: second.bag,
    rows: 0,
    streak: 0,
    score: 0,
    status: 'playing',
  };
}

export function levelForRows(rows: number) {
  return 1 + Math.floor(rows / 6);
}

export function gravityInterval(level: number) {
  return Math.max(110, Math.round(760 * 0.84 ** (level - 1)));
}

function fits(board: Board, { cells, x, y }: Piece) {
  return cells.every(([dx, dy]) => board[y + dy]?.[x + dx] === null);
}

export function landingY(board: Board, piece: Piece) {
  let y = piece.y;
  while (fits(board, { ...piece, y: y + 1 })) y++;
  return y;
}

function lockPiece(game: FallingBlocksGame, piece: Piece, dropPoints: number): FallingBlocksGame {
  const board = game.board.map((row) => row.slice());
  for (const [x, y] of piece.cells) board[piece.y + y][piece.x + x] = piece.shape;

  const remaining = board.filter((row) => row.includes(null));
  const cleared = BOARD_ROWS - remaining.length;
  const nextBoard = [...Array.from({ length: cleared }, emptyRow), ...remaining];
  const streak = cleared ? game.streak + 1 : 0;
  const points = cleared ? (cleared ** 2 * 100 + (streak - 1) * 50) * levelForRows(game.rows) : 0;
  const nextPiece = spawn(game.next);
  const draw = drawShape(game.bag);
  return {
    board: nextBoard,
    piece: nextPiece,
    next: draw.shape,
    bag: draw.bag,
    rows: game.rows + cleared,
    streak,
    score: game.score + dropPoints + points,
    status: fits(nextBoard, nextPiece) ? 'playing' : 'over',
  };
}

export function play(game: FallingBlocksGame, action: GameAction): FallingBlocksGame {
  if (action.type === 'restart') return createGame(action.seed);
  if (action.type === 'pause' && game.status !== 'over') {
    return { ...game, status: game.status === 'playing' ? 'paused' : 'playing' };
  }
  if (game.status !== 'playing') return game;

  const { board, piece } = game;
  switch (action.type) {
    case 'left':
    case 'right': {
      const moved = { ...piece, x: piece.x + (action.type === 'left' ? -1 : 1) };
      return fits(board, moved) ? { ...game, piece: moved } : game;
    }
    case 'rotate': {
      const height = shapeHeight(piece.cells);
      const cells = piece.cells.map(([x, y]): Cell => [height - 1 - y, x]);
      for (const [dx, dy] of ROTATION_OFFSETS) {
        const rotated = { ...piece, cells, x: piece.x + dx, y: piece.y + dy };
        if (fits(board, rotated)) return { ...game, piece: rotated };
      }
      return game;
    }
    case 'down':
    case 'tick': {
      const moved = { ...piece, y: piece.y + 1 };
      return fits(board, moved)
        ? { ...game, piece: moved }
        : lockPiece(game, piece, 0);
    }
    case 'drop': {
      const y = landingY(board, piece);
      return lockPiece(game, { ...piece, y }, (y - piece.y) * 2);
    }
    default:
      return game;
  }
}
