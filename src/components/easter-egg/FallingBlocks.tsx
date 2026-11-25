import { useEffect, useId, useReducer, type KeyboardEvent, type RefObject } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';
import {
  BOARD_COLUMNS, BOARD_ROWS, SHAPES, createGame, gravityInterval, landingY, levelForRows, newGameSeed, play,
  shapeHeight, shapeWidth, type GameMove,
} from '../../features/easter-egg/falling-blocks';
import { Button } from '../common/Button';
import styles from './FallingBlocks.module.css';

const KEY_MOVES = new Map<string, GameMove>([
  ['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'rotate'],
  ['ArrowDown', 'down'], [' ', 'drop'], ['p', 'pause'],
]);

const controls = [
  { move: 'left', label: 'Move left', Icon: ArrowLeft },
  { move: 'rotate', label: 'Rotate', Icon: RotateCw },
  { move: 'right', label: 'Move right', Icon: ArrowRight },
  { move: 'down', label: 'Move down', Icon: ArrowDown },
  { move: 'drop', label: 'Drop to floor', Icon: ArrowDownToLine },
] as const;

function Tile({ x, y, shape, ghost = false }: { x: number; y: number; shape: number; ghost?: boolean }) {
  return <rect x={x + 0.06} y={y + 0.06} width={0.88} height={0.88} rx={0.12}
    data-shape={shape} className={ghost ? `${styles.tile} ${styles.ghost}` : styles.tile} />;
}

interface FallingBlocksProps {
  seed: number;
  boardRef: RefObject<HTMLDivElement | null>;
}

export function FallingBlocks({ seed, boardRef }: FallingBlocksProps) {
  const [game, dispatch] = useReducer(play, seed, createGame);
  const instructionsId = useId();
  const { board, piece, next, score, rows, status } = game;
  const level = levelForRows(rows);
  const ghostY = status === 'over' ? piece.y : landingY(board, piece);
  const nextCells = SHAPES[next];
  const previewX = (3 - shapeWidth(nextCells)) / 2;
  const previewY = (3 - shapeHeight(nextCells)) / 2;

  useEffect(() => {
    if (status !== 'playing') return;
    const timer = window.setInterval(() => dispatch({ type: 'tick' }), gravityInterval(level));
    return () => window.clearInterval(timer);
  }, [level, status]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const move = KEY_MOVES.get(event.key.toLowerCase());
    if (!move || (move === 'drop' && event.target instanceof HTMLElement && event.target.closest('button'))) return;

    event.preventDefault();
    if (event.repeat && (move === 'drop' || move === 'pause')) return;
    dispatch({ type: move });
  }

  return (
    <div className={styles.game} onKeyDown={handleKeyDown}>
      <div className={styles.board} ref={boardRef} tabIndex={0} role="group"
        aria-label="Falling blocks board" aria-describedby={instructionsId}>
        <svg viewBox={`0 0 ${BOARD_COLUMNS} ${BOARD_ROWS}`} aria-hidden="true">
          {board.flatMap((row, y) => row.map((shape, x) => shape === null ? null : (
            <Tile key={`board-${x}-${y}`} x={x} y={y} shape={shape} />
          )))}
          {status !== 'over' && (
            <>
              {ghostY > piece.y && piece.cells.map(([x, y]) => (
                <Tile key={`ghost-${x}-${y}`} x={x + piece.x} y={y + ghostY} shape={piece.shape} ghost />
              ))}
              {piece.cells.map(([x, y]) => (
                <Tile key={`active-${x}-${y}`} x={x + piece.x} y={y + piece.y} shape={piece.shape} />
              ))}
            </>
          )}
        </svg>
        {status !== 'playing' && (
          <div className={styles.boardMessage} role="status">{status === 'paused' ? 'Paused' : 'Game over'}</div>
        )}
      </div>

      <div className={styles.sidebar}>
        <dl className={styles.stats}>
          <div><dt>Score</dt><dd>{score}</dd></div>
          <div><dt>Rows</dt><dd>{rows}</dd></div>
          <div><dt>Level</dt><dd>{level}</dd></div>
        </dl>
        <div className={styles.next}>
          <span>Next</span>
          <svg viewBox="-0.25 -0.25 3.5 3.5" aria-hidden="true">
            {nextCells.map(([x, y]) => <Tile key={`${x}-${y}`} x={x + previewX} y={y + previewY} shape={next} />)}
          </svg>
        </div>
        <div className={styles.controls} role="group" aria-label="Piece controls">
          {controls.map(({ move, label, Icon }) => (
            <Button key={move} type="button" size="sm" icon={<Icon size={16} />} aria-label={label} title={label}
              disabled={status !== 'playing'} onClick={() => dispatch({ type: move })} />
          ))}
        </div>
        <div className={styles.actions}>
          {status !== 'over' && <Button type="button" size="sm" onClick={() => dispatch({ type: 'pause' })}>
            {status === 'paused' ? 'Resume' : 'Pause'}
          </Button>}
          <Button type="button" size="sm" variant={status === 'over' ? 'primary' : 'secondary'}
            onClick={() => {
              dispatch({ type: 'restart', seed: newGameSeed() });
              boardRef.current?.focus();
            }}>
            {status === 'over' ? 'Play again' : 'Restart'}
          </Button>
        </div>
      </div>
      <p className={styles.instructions} id={instructionsId}>
        Move with ← →, rotate with ↑, lower with ↓, drop with Space, and pause with P. Clear full rows to level up.
      </p>
    </div>
  );
}
