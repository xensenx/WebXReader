import { ensureDjvuInitialized, WasmDocument, withDjvuPage } from '../../core/parsing/djvu-init';
import type { ReaderSearchResult } from '../../components/reader/search-types';
import { createTextExcerpt, findTextMatches } from '../../utils/text-search';
import { DEFAULT_DJVU_PAGE_SIZE, type DjvuMessage, type DjvuResponse } from './djvu-render-protocol';

const port = self as unknown as {
  onmessage: (event: MessageEvent<DjvuMessage>) => void;
  postMessage: (message: DjvuResponse, transfer?: Transferable[]) => void;
};

let doc: WasmDocument | undefined;
let searchVersion = 0;
const textCache = new Map<number, string>();
const yieldToWorker = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function scan<T>(count: number, visit: (index: number) => T | undefined, isCancelled = () => false) {
  const values: T[] = [];
  let nextSlice = performance.now() + 8;
  for (let index = 0; index < count; index++) {
    if (performance.now() >= nextSlice) {
      await yieldToWorker();
      nextSlice = performance.now() + 8;
    }
    if (isCancelled()) break;
    const value = visit(index);
    if (value !== undefined) values.push(value);
  }
  return values;
}

port.onmessage = async ({ data }) => {
  const reply = (value: unknown, transfer?: Transferable[]) => port.postMessage({ id: data.id, value }, transfer);
  try {
    if (data.kind === 'cancelSearch') {
      searchVersion++;
      return;
    }
    if (data.kind === 'open') {
      await ensureDjvuInitialized();
      doc = WasmDocument.from_bytes(new Uint8Array(data.fileData));
      const count = doc.page_count();
      if (!count) throw new Error('The DjVu document contains no pages.');
      reply(count);
      return;
    }
    const document = doc;
    if (!document) throw new Error('The DjVu document is not open.');

    const readSize = (index: number) => {
      try {
        return withDjvuPage(document, index, (page) => ({
          width: page.width_at(96) || DEFAULT_DJVU_PAGE_SIZE.width,
          height: page.height_at(96) || DEFAULT_DJVU_PAGE_SIZE.height,
        }));
      } catch {
        return DEFAULT_DJVU_PAGE_SIZE;
      }
    };
    if (data.kind === 'sizes') {
      reply(await scan(document.page_count(), readSize));
    } else if (data.kind === 'size') {
      reply(readSize(data.page - 1));
    } else if (data.kind === 'render') {
      withDjvuPage(document, data.page - 1, (page) => {
        const width = page.width_at(data.dpi);
        const height = page.height_at(data.dpi);
        if (width > 3200 || height > 3200 || width * height > 3_000_000) {
          throw new Error('This DjVu page exceeds the render size limit.');
        }
        const pixels = page.render(data.dpi).buffer;
        reply({ width, height, pixels }, [pixels]);
      });
    } else if (data.kind === 'search') {
      const version = ++searchVersion;
      const results: ReaderSearchResult[] = [];
      await scan(document.page_count(), (index) => {
        let text = textCache.get(index);
        if (text === undefined) {
          try { text = withDjvuPage(document, index, (page) => page.text() || ''); }
          catch { text = ''; }
          if (textCache.size >= 64) textCache.delete(textCache.keys().next().value!);
          textCache.set(index, text);
        }
        const pageNumber = index + 1;
        findTextMatches(text, data.query, 100 - results.length, true).forEach((match, matchIndex) => {
          results.push({
            chapterId: String(pageNumber), chapterTitle: `Page ${pageNumber}`,
            ...createTextExcerpt(text, match), offset: match.start, matchIndex, pageNumber,
          });
        });
      }, () => version !== searchVersion || results.length >= 100);
      reply(version === searchVersion ? results : []);
    }
  } catch (error) {
    port.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
