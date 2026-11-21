import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDjvuRenderSession } from '../formats/engines/djvu-render-session';
import { getDjvuRasterDpi, type DjvuMessage, type DjvuResponse } from '../formats/engines/djvu-render-protocol';

let worker: TestWorker;

class TestWorker {
  onmessage?: (event: { data: DjvuResponse }) => void;
  messages: DjvuMessage[] = [];
  terminate = vi.fn();

  constructor() { worker = this; }

  postMessage(message: DjvuMessage) { this.messages.push(message); }

  complete(message: DjvuMessage) {
    this.onmessage?.({ data: { id: message.id, value: { width: 1, height: 1, pixels: new ArrayBuffer(4) } } });
  }
}

describe('DjVu rendering', () => {
  beforeEach(() => { vi.stubGlobal('Worker', TestWorker); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('serializes work, prioritizes visible pages, and discards skipped pages', async () => {
    const session = createDjvuRenderSession();
    const cancel = new AbortController();
    const current = session.render(1, 96, cancel.signal, true);
    const nearby = session.render(2, 96, new AbortController().signal, false);
    const visible = session.render(9, 96, new AbortController().signal, true);
    const skipped = new AbortController();
    const skippedResult = session.render(3, 96, skipped.signal, true);
    const cancelled = expect(current).rejects.toMatchObject({ name: 'AbortError' });
    const discarded = expect(skippedResult).rejects.toMatchObject({ name: 'AbortError' });
    skipped.abort();
    cancel.abort();
    expect(worker.messages).toEqual([expect.objectContaining({ page: 1 })]);
    worker.complete(worker.messages[0]);
    await cancelled;
    await discarded;
    expect(worker.messages[1]).toMatchObject({ page: 9 });
    worker.complete(worker.messages[1]);
    await visible;
    expect(worker.messages[2]).toMatchObject({ page: 2 });
    worker.complete(worker.messages[2]);
    await nearby;
    session.close();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('caps raster size for high zoom and unusually narrow scans', () => {
    for (const size of [{ width: 1700, height: 2200 }, { width: 380, height: 8000 }]) {
      const scale = getDjvuRasterDpi(size, 4, 3) / 96;
      expect(Math.max(size.width, size.height) * scale).toBeLessThanOrEqual(3200);
      expect(size.width * size.height * scale ** 2).toBeLessThanOrEqual(3_000_000);
    }
  });
});
