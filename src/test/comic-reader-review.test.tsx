import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ComicDoubleSidedReader } from '../formats/engines/ComicDoubleSidedReader';
import { CbzReader, type CbzReaderHandle } from '../formats/engines/CbzReader';

const flips = vi.hoisted(() => [] as any[]);
vi.mock('page-flip', () => ({ PageFlip: class {
  settings: any;
  handlers: Record<string, (event: any) => void> = {};
  index: number;
  constructor(_el: HTMLElement, settings: any) {
    this.settings = settings;
    this.index = settings.startPage;
    flips.push(this);
  }
  loadFromHTML() {}
  on(name: string, callback: (event: any) => void) { this.handlers[name] = callback; }
  getCurrentPageIndex() { return this.index; }
  turnToPage = vi.fn((index: number) => { this.index = index; this.handlers.flip?.({ data: index }); });
  flip = this.turnToPage;
  flipPrev = vi.fn(() => this.turnToPage(Math.max(0, this.index - 2)));
  flipNext = vi.fn(() => this.turnToPage(this.index + 2));
  destroy = vi.fn();
} }));
afterEach(() => { flips.length = 0; vi.unstubAllGlobals(); });
const sizes = { 1: { width: 800, height: 1200 } };
const loadUrl = async () => 'blob:comic';
const latest = () => flips[flips.length - 1];

describe('comic review regressions', () => {
  it.each(['ltr', 'rtl'] as const)('maps %s sheets, page jumps, navigation and final spread progress', (readingDirection) => {
    const ref = React.createRef<CbzReaderHandle>();
    const progress = vi.fn();
    const { container } = render(<ComicDoubleSidedReader ref={ref} totalPages={5} readingDirection={readingDirection} pageSizes={sizes} loadUrl={loadUrl} onProgressUpdate={progress} />);
    const rtl = readingDirection === 'rtl';
    expect(latest().settings.startPage).toBe(rtl ? 4 : 0);
    const images = container.querySelectorAll('img');
    expect(images[0].dataset.comicPageImg).toBe(rtl ? '5' : '1');
    fireEvent.keyDown(container.firstChild!, { key: rtl ? 'ArrowLeft' : 'ArrowRight' });
    expect(rtl ? latest().flipPrev : latest().flipNext).toHaveBeenCalled();
    act(() => ref.current!.goToProgress(1));
    expect(latest().index).toBe(rtl ? 0 : 4);
    expect(progress).toHaveBeenLastCalledWith('5', 1, 4);
    act(() => ref.current!.goToPage(2));
    expect(latest().index).toBe(rtl ? 4 : 0);
  });

  it('keeps inversion on the same instance and rebuilds across zoom threshold preserving the page', () => {
    const props = { totalPages: 8, pageSizes: sizes, loadUrl, onProgressUpdate: vi.fn() };
    const { rerender, container } = render(<ComicDoubleSidedReader {...props} />);
    act(() => latest().turnToPage(4));
    const instance = latest();
    rerender(<ComicDoubleSidedReader {...props} invertColors />);
    expect(latest()).toBe(instance);
    expect(container.querySelector('[class*="pageInverted"]')).toBeTruthy();
    rerender(<ComicDoubleSidedReader {...props} invertColors readerZoom={2} />);
    expect(latest()).not.toBe(instance);
    expect(latest().settings.startPage).toBe(4);
    expect(latest().settings.useMouseEvents).toBe(false);
  });

  it('keeps the pointer content point fixed through consecutive zoom increases', () => {
    const props = { totalPages: 8, pageSizes: sizes, loadUrl, onProgressUpdate: vi.fn() };
    const { container, rerender } = render(<ComicDoubleSidedReader {...props} />);
    const root = container.firstChild as HTMLElement;
    root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 } as DOMRect);
    const anchor = { id: 1, viewportX: 600, viewportY: 400, scrollRatioX: 0, scrollRatioY: 0 };
    rerender(<ComicDoubleSidedReader {...props} readerZoom={2} zoomAnchor={anchor} />);
    const stage = container.querySelector('[class*="bookStage"]') as HTMLElement;
    expect(stage.style.getPropertyValue('--comic-pan-x')).toBe('-100px');
    rerender(<ComicDoubleSidedReader {...props} readerZoom={3} zoomAnchor={anchor} />);
    expect(stage.style.getPropertyValue('--comic-pan-x')).toBe('-200px');
  });

  it('ignores pending image loads after eviction and unmount', async () => {
    const requests: Array<{ page: number; resolve: (url: string) => void }> = [];
    const loader = (page: number) => new Promise<string>(resolve => requests.push({ page, resolve }));
    const { container, unmount } = render(<ComicDoubleSidedReader totalPages={30} pageSizes={sizes} loadUrl={loader} onProgressUpdate={vi.fn()} />);
    const image = container.querySelector('img')!;
    act(() => latest().turnToPage(24));
    await act(async () => requests.find(r => r.page === 0)!.resolve('blob:stale'));
    expect(image.hasAttribute('src')).toBe(false);
    const retained = container.querySelector('[data-comic-page-img="25"]')!;
    unmount();
    await act(async () => requests.find(r => r.page === 24)!.resolve('blob:unmounted'));
    expect(retained.hasAttribute('src')).toBe(false);
  });

  it('recalculates portrait layout on container resize while preserving the page', () => {
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { resize = cb; } observe() {} disconnect = disconnect; });
    const { container, unmount } = render(<ComicDoubleSidedReader totalPages={8} pageSizes={sizes} loadUrl={loadUrl} onProgressUpdate={vi.fn()} />);
    act(() => latest().turnToPage(4));
    Object.defineProperty(container.firstChild, 'clientWidth', { value: 500 });
    act(() => resize());
    expect(latest().settings.usePortrait).toBe(true);
    expect(latest().settings.startPage).toBe(4);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it.each(['ltr', 'rtl'] as const)('tracks %s horizontal scroll progress at both ends with multiple pages visible', async (readingDirection) => {
    const zip = new JSZip();
    for (let i = 1; i <= 6; i++) zip.file(`${i}.jpg`, 'image');
    const fileData = await zip.generateAsync({ type: 'arraybuffer' });
    const progress = vi.fn();
    const ref = React.createRef<CbzReaderHandle>();
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
    Element.prototype.scrollIntoView = vi.fn();
    const { container } = render(<CbzReader ref={ref} fileData={fileData} readingMode="horizontal" readingDirection={readingDirection} onProgressUpdate={progress} />);
    await waitFor(() => expect(ref.current!.getTotalPages()).toBe(6));
    const viewport = container.querySelector('[data-reader-viewport]') as HTMLElement;
    Object.defineProperties(viewport, { scrollWidth: { value: 1200 }, clientWidth: { value: 600 } });
    const pages = container.querySelectorAll('[data-comic-page]');
    expect(pages[0].getAttribute('data-comic-page')).toBe(readingDirection === 'rtl' ? '6' : '1');
    viewport.scrollLeft = readingDirection === 'rtl' ? 0 : 600;
    fireEvent.scroll(viewport);
    await waitFor(() => expect(progress).toHaveBeenLastCalledWith(expect.any(String), 1, expect.any(Number)));
    viewport.scrollLeft = readingDirection === 'rtl' ? 600 : 0;
    fireEvent.scroll(viewport);
    await waitFor(() => expect(progress).toHaveBeenLastCalledWith(expect.any(String), 0, expect.any(Number)));
    fireEvent.wheel(viewport, { deltaY: 100 });
    expect(viewport.scrollLeft).toBe(readingDirection === 'rtl' ? 500 : 100);
    fireEvent.keyDown(container.firstChild!, { key: readingDirection === 'rtl' ? 'ArrowLeft' : 'ArrowRight' });
    expect(ref.current!.getCurrentPage()).toBe(2);
  });

  it('delegates spread jumps and retains the child page when switching to scroll', async () => {
    const zip = new JSZip();
    for (let i = 1; i <= 8; i++) zip.file(`${i}.jpg`, 'image');
    const fileData = await zip.generateAsync({ type: 'arraybuffer' });
    const ref = React.createRef<CbzReaderHandle>();
    const props = { fileData, onProgressUpdate: vi.fn() };
    const scrollIntoView = vi.fn();
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
    Element.prototype.scrollIntoView = scrollIntoView;
    const { rerender } = render(<CbzReader {...props} ref={ref} readingMode="vertical" />);
    await waitFor(() => expect(flips.length).toBeGreaterThan(0));
    act(() => ref.current!.goToPage(99));
    expect(latest().index).toBe(6);
    expect(ref.current!.getCurrentPage()).toBe(7);
    act(() => ref.current!.goToProgress(0));
    expect(latest().index).toBe(0);
    act(() => latest().turnToPage(4));
    rerender(<CbzReader {...props} ref={ref} readingMode="horizontal" />);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(ref.current!.getCurrentPage()).toBe(5);
  });
});
