import type { ReaderSearchResult } from '../../components/reader/search-types';
import type { DjvuPageSize, DjvuRaster, DjvuRequest, DjvuResponse } from './djvu-render-protocol';

interface RenderJob {
  page: number;
  dpi: number;
  signal: AbortSignal;
  resolve: (result: DjvuRaster) => void;
  reject: (error: unknown) => void;
}

export function createDjvuRenderSession() {
  const worker = new Worker(new URL('./djvu-render.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const queue: RenderJob[] = [];
  let lastId = 0;
  let rendering = false;
  let failure: Error | undefined;
  const abortError = () => new DOMException('DjVu render cancelled', 'AbortError');

  function close(error: Error = abortError()) {
    if (failure) return;
    failure = error;
    worker.terminate();
    pending.forEach(({ reject }) => reject(error));
    pending.clear();
    queue.splice(0).forEach(({ reject }) => reject(error));
  }

  worker.onmessage = ({ data }: MessageEvent<DjvuResponse>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if ('error' in data) request.reject(new Error(data.error));
    else request.resolve(data.value);
  };
  worker.onerror = (event) => close(new Error(event.message || 'DjVu worker could not start.'));
  worker.onmessageerror = () => close(new Error('Could not read the DjVu worker response.'));

  function request<T>(message: DjvuRequest): Promise<T> {
    if (failure) return Promise.reject(failure);
    return new Promise<T>((resolve, reject) => {
      const id = ++lastId;
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try { worker.postMessage({ ...message, id }); }
      catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  async function renderNext() {
    if (rendering || failure) return;
    const job = queue.shift();
    if (!job) return;
    rendering = true;
    try {
      if (job.signal.aborted) throw abortError();
      const raster = await request<DjvuRaster>({ kind: 'render', page: job.page, dpi: job.dpi });
      if (job.signal.aborted) throw abortError();
      job.resolve(raster);
    } catch (error) {
      job.reject(error);
    } finally {
      rendering = false;
      if (queue.length) void renderNext();
    }
  }

  return {
    close,
    open: (fileData: ArrayBuffer) => request<number>({ kind: 'open', fileData }),
    size: (page: number) => request<DjvuPageSize>({ kind: 'size', page }),
    sizes: () => request<DjvuPageSize[]>({ kind: 'sizes' }),
    search: (query: string) => request<ReaderSearchResult[]>({ kind: 'search', query }),
    cancelSearch: () => { if (!failure) worker.postMessage({ id: 0, kind: 'cancelSearch' }); },
    render(page: number, dpi: number, signal: AbortSignal, visible: boolean) {
      if (failure) return Promise.reject(failure);
      return new Promise<DjvuRaster>((resolve, reject) => {
        const job = { page, dpi, signal, resolve, reject };
        if (visible) queue.unshift(job);
        else queue.push(job);
        void renderNext();
      });
    },
  };
}

export type DjvuRenderSession = ReturnType<typeof createDjvuRenderSession>;
