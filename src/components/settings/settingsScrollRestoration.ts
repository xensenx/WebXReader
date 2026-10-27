const SETTINGS_SCROLL_KEY = 'webxreader.settings-scroll-restoration';

export interface SettingsScrollPosition {
  scrollY: number;
  anchorId: string;
  anchorTop: number;
}

export function rememberSettingsScrollPosition(anchorId: string) {
  const anchor = document.getElementById(anchorId);
  const position: SettingsScrollPosition = {
    scrollY: window.scrollY,
    anchorId,
    anchorTop: anchor?.getBoundingClientRect().top ?? 0,
  };

  try {
    sessionStorage.setItem(SETTINGS_SCROLL_KEY, JSON.stringify(position));
  } catch {
    // Scrolling still works if browser storage is unavailable; restoration
    // simply falls back to the router's normal page position.
  }
}

export function consumeSettingsScrollPosition(): SettingsScrollPosition | null {
  try {
    const stored = sessionStorage.getItem(SETTINGS_SCROLL_KEY);
    if (!stored) return null;
    sessionStorage.removeItem(SETTINGS_SCROLL_KEY);

    const position = JSON.parse(stored) as Partial<SettingsScrollPosition>;
    if (
      typeof position.scrollY !== 'number' ||
      typeof position.anchorId !== 'string' ||
      typeof position.anchorTop !== 'number'
    ) return null;

    return {
      scrollY: position.scrollY,
      anchorId: position.anchorId,
      anchorTop: position.anchorTop,
    };
  } catch {
    return null;
  }
}

export function restoreSettingsScrollPosition(position: SettingsScrollPosition) {
  const anchor = document.getElementById(position.anchorId);
  if (anchor) {
    const offset = anchor.getBoundingClientRect().top - position.anchorTop;
    window.scrollTo(0, Math.max(0, window.scrollY + offset));
    return;
  }

  window.scrollTo(0, Math.max(0, position.scrollY));
}
