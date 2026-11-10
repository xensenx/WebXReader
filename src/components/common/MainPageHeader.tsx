import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  ExternalLink,
  Info,
  Layers,
  Menu,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';

import { useSidePanelContext } from '../../app/providers/useSidePanelContext';
import { IncognitoIcon } from './IncognitoIcon';
import { KoFiIcon } from './KoFiIcon';
import styles from './MainPageHeader.module.css';

const PANEL_TRANSITION_DURATION_MS = 200;

const PAGE_LINKS = [
  { path: '/', label: 'Library', icon: <BookOpen size={18} /> },
  { path: '/series', label: 'Series', icon: <Layers size={18} /> },
  { path: '/stats', label: 'Stats', icon: <BarChart3 size={18} /> },
  { path: '/private-mode', label: 'Private mode', icon: <IncognitoIcon size={18} /> },
];

const SECONDARY_PAGE_LINKS = [
  { path: '/settings', label: 'Settings', icon: <Settings size={18} /> },
  { path: '/privacy-policy', label: 'Privacy Policy', icon: <ShieldCheck size={18} /> },
  { path: '/about', label: 'About', icon: <Info size={18} /> },
];

export function MainPageHeader() {
  const { isOpen, setIsOpen } = useSidePanelContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [donateOpen, setDonateOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const donateTriggerRef = useRef<HTMLButtonElement>(null);
  const donateCloseRef = useRef<HTMLButtonElement>(null);
  const pendingNavigationRef = useRef<number | null>(null);
  const previousDonateOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (donateOpen) donateCloseRef.current?.focus();
    else closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (donateOpen) {
          setDonateOpen(false);
          donateTriggerRef.current?.focus();
          return;
        }
        setIsOpen(false);
        toggleRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [donateOpen, isOpen, setIsOpen]);

  useEffect(() => {
    if (donateOpen) donateCloseRef.current?.focus();
    else if (previousDonateOpenRef.current && isOpen) donateTriggerRef.current?.focus();
    previousDonateOpenRef.current = donateOpen;
  }, [donateOpen, isOpen]);

  useEffect(() => () => {
    if (pendingNavigationRef.current !== null) {
      window.clearTimeout(pendingNavigationRef.current);
    }
  }, []);

  const navigateFromPanel = (path: string) => {
    const isMainPage = path === '/' || path === '/series' || path === '/stats' ||
      path === '/private-mode';
    if (isMainPage) {
      setIsOpen(false);

      if (location.pathname === path) return;

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        navigate(path);
        return;
      }

      if (pendingNavigationRef.current !== null) {
        window.clearTimeout(pendingNavigationRef.current);
      }
      pendingNavigationRef.current = window.setTimeout(() => {
        pendingNavigationRef.current = null;
        navigate(path);
      }, PANEL_TRANSITION_DURATION_MS);
      return;
    }
    // Leave the shared open state intact for subpages so Back restores the panel.
    if (location.pathname !== path) navigate(path);
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.brand}>
          <img src="/webxreader.svg" alt="" className={styles.brandLogo} aria-hidden="true" />
          <span>WebXReader</span>
        </div>
        <button
          ref={toggleRef}
          className={styles.iconButton}
          onClick={() => setIsOpen(true)}
          title="Open menu"
          aria-label="Open menu"
          aria-expanded={isOpen}
          aria-controls="main-side-panel"
          aria-haspopup="dialog"
          type="button"
        >
          <Menu size={20} />
        </button>
      </header>

      <div
        className={`${styles.overlay} ${isOpen ? styles.overlayOpen : ''}`}
        aria-hidden={!isOpen || donateOpen}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setIsOpen(false);
            toggleRef.current?.focus();
          }
        }}
      >
        <aside
          id="main-side-panel"
          className={`${styles.panel} ${isOpen ? styles.panelOpen : ''}`}
          role="dialog"
          aria-modal={isOpen && !donateOpen}
          aria-labelledby="main-side-panel-title"
        >
          <div className={styles.panelHeader}>
            <h2 id="main-side-panel-title" className={styles.panelTitle}>Menu</h2>
            <button
              ref={closeRef}
              className={styles.iconButton}
              onClick={() => {
                setIsOpen(false);
                toggleRef.current?.focus();
              }}
              aria-label="Close menu"
              type="button"
            >
              <X size={20} />
            </button>
          </div>

          <nav className={styles.navigation} aria-label="Main menu">
            {PAGE_LINKS.map(({ path, label, icon }) => (
              <button
                key={path}
                className={styles.navigationItem}
                aria-current={location.pathname === path ? 'page' : undefined}
                onClick={() => navigateFromPanel(path)}
                type="button"
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
            <div className={styles.navigationDivider} role="separator" />
            {SECONDARY_PAGE_LINKS.map(({ path, label, icon }) => (
              <button
                key={path}
                className={styles.navigationItem}
                aria-current={location.pathname === path ? 'page' : undefined}
                onClick={() => navigateFromPanel(path)}
                type="button"
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
            <button
              ref={donateTriggerRef}
              className={styles.navigationItem}
              onClick={() => setDonateOpen(true)}
              type="button"
            >
              <span className={styles.koFiIcon}><KoFiIcon /></span>
              <span>Donate</span>
            </button>
          </nav>
        </aside>
      </div>

      {donateOpen && (
        <div
          className={styles.donateOverlay}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setDonateOpen(false);
              donateTriggerRef.current?.focus();
            }
          }}
        >
          <section
            className={styles.donateDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="donate-dialog-title"
          >
            <div className={styles.donateHeader}>
              <h2 id="donate-dialog-title" className={styles.donateTitle}>Donate</h2>
              <button
                ref={donateCloseRef}
                className={styles.iconButton}
                onClick={() => {
                  setDonateOpen(false);
                  donateTriggerRef.current?.focus();
                }}
                aria-label="Close donation details"
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <p className={styles.donateMessage}>
              WebXReader is 100% free and open source. A small donation helps fuel late-night
              debugging and keep development moving.
            </p>
            <p className={styles.guestDonationNote}>
              Ko-fi allows guest donations, so no sign-up is needed.
            </p>
            <a
              className={styles.donateAction}
              href="https://ko-fi.com/xensenx"
              onClick={() => {
                setDonateOpen(false);
                setIsOpen(false);
              }}
            >
              Support on Ko-fi <ExternalLink size={15} />
            </a>
          </section>
        </div>
      )}
    </>
  );
}
