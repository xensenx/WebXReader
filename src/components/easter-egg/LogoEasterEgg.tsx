import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { endLogoDrag, isLogoDrag } from '../../features/easter-egg/logo-drag';
import { newGameSeed } from '../../features/easter-egg/falling-blocks';
import { FileDropOverlay } from '../common/FileDropOverlay';
import { Modal } from '../common/Modal';
import { FallingBlocks } from './FallingBlocks';

export function LogoEasterEgg() {
  const { pathname } = useLocation();
  return <LogoDropSession key={pathname} />;
}

function LogoDropSession() {
  const [dragOver, setDragOver] = useState(false);
  const [gameSeed, setGameSeed] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function acceptLogoDrag(event: DragEvent) {
      if (!isLogoDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }

    function handleDragLeave(event: DragEvent) {
      if (event.relatedTarget || !isLogoDrag(event.dataTransfer)) return;
      const { clientX, clientY } = event;
      if (clientX <= 0 || clientY <= 0 || clientX >= window.innerWidth || clientY >= window.innerHeight) {
        setDragOver(false);
      }
    }

    function finishDrag() {
      endLogoDrag();
      setDragOver(false);
    }

    function handleDrop(event: DragEvent) {
      if (!isLogoDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      finishDrag();
      setGameSeed(newGameSeed());
    }

    // Recognize the logo before import zones can treat the native image drag as a file.
    window.addEventListener('dragenter', acceptLogoDrag, true);
    window.addEventListener('dragover', acceptLogoDrag, true);
    window.addEventListener('dragleave', handleDragLeave, true);
    window.addEventListener('drop', handleDrop, true);
    window.addEventListener('dragend', finishDrag, true);
    return () => {
      window.removeEventListener('dragenter', acceptLogoDrag, true);
      window.removeEventListener('dragover', acceptLogoDrag, true);
      window.removeEventListener('dragleave', handleDragLeave, true);
      window.removeEventListener('drop', handleDrop, true);
      window.removeEventListener('dragend', finishDrag, true);
      endLogoDrag();
    };
  }, []);

  return (
    <>
      {dragOver && <FileDropOverlay />}
      <Modal isOpen={gameSeed !== null} onClose={() => setGameSeed(null)} title="You’ve discovered an Easter egg!"
        initialFocusRef={boardRef}>
        {gameSeed !== null && <FallingBlocks seed={gameSeed} boardRef={boardRef} />}
      </Modal>
    </>
  );
}
