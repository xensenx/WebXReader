import { PageFlip, type PageFlipSettings } from 'page-flip';

type RendererAction = (...args: unknown[]) => unknown;
type Invalidation = 'update' | 'setLeftPage' | 'setRightPage' | 'setPageRect' | 'clearShadow' | 'reload';

interface PageFlipRenderer extends Record<Invalidation, RendererAction> {
  start(): void;
  render(time: number): void;
  startAnimation: RendererAction;
  timer: number;
  animation: unknown;
}

/**
 * StPageFlip 2.0.7 draws on every frame and leaves its frame loop alive
 * after destroy(). Install the scheduler before loadFromHTML starts it.
 * Keep this version-specific adapter at the library boundary.
 */
export class OnDemandPageFlip extends PageFlip {
  private frame: number | undefined;

  constructor(element: HTMLElement, settings: PageFlipSettings) {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    super(element, reducedMotion ? { ...settings, flippingTime: 1, showPageCorners: false } : settings);
    let renderer: PageFlipRenderer;
    Object.defineProperty(this, 'render', {
      configurable: true,
      get: () => renderer,
      set: (value: PageFlipRenderer) => {
        renderer = value;
        this.scheduleRenderer(value);
      },
    });
  }

  private scheduleRenderer(renderer: PageFlipRenderer) {
    if (typeof renderer.render !== 'function') return;
    const invalidate = () => {
      if (this.frame !== undefined) return;
      this.frame = requestAnimationFrame(() => {
        // A frame's timestamp can precede a flip started just before it.
        renderer.render(performance.now());
        this.frame = undefined;
        if (renderer.animation) invalidate();
      });
    };
    const methods: Invalidation[] = ['update', 'setLeftPage', 'setRightPage', 'setPageRect', 'clearShadow', 'reload'];
    for (const name of methods) {
      const original = renderer[name];
      renderer[name] = (...args) => {
        const result = original.apply(renderer, args);
        invalidate();
        return result;
      };
    }
    const startAnimation = renderer.startAnimation;
    renderer.startAnimation = (...args) => {
      renderer.timer = performance.now();
      const result = startAnimation.apply(renderer, args);
      invalidate();
      return result;
    };
    renderer.start = () => { renderer.update(); };
  }

  override destroy() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    super.destroy();
  }
}
