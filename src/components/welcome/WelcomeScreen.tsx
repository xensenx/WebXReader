import { useId, useLayoutEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { ArrowRight, BookOpen, LibraryBig, ShieldCheck, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PRIVACY_PATH, TERMS_PATH, WELCOME_PATH } from '../../app/legal';
import { getAppNavigationState } from '../../app/navigation';
import { Button } from '../common/Button';
import styles from './WelcomeScreen.module.css';

const guidance = [
  {
    icon: Upload,
    title: 'Import your books',
    description: 'Choose Import Book or drag files in from your device.',
  },
  {
    icon: LibraryBig,
    title: 'Organize your collection',
    description: 'Group books into series and customize their covers.',
  },
  {
    icon: BookOpen,
    title: 'Read your way',
    description: 'Customize reading settings, bookmark pages, and resume where you left off.',
  },
];

export interface WelcomePosition {
  document: 'terms' | 'privacy';
  scrollTop: number;
}

interface WelcomeScreenProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  saving: boolean;
  error: string;
  onContinue: () => void;
  positionRef: RefObject<WelcomePosition | null>;
}

export function StartupStatus() {
  return <main className={styles.startup}><p role="status">Loading WebXReader…</p></main>;
}

export function WelcomeScreen({ checked, onCheckedChange, saving, error, onContinue, positionRef }: WelcomeScreenProps) {
  const checkboxId = useId();
  const panel = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const termsLink = useRef<HTMLAnchorElement>(null);
  const privacyLink = useRef<HTMLAnchorElement>(null);
  const legalNavigation = getAppNavigationState(WELCOME_PATH);

  useLayoutEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();

    const saved = positionRef.current;
    const focus = saved ? (saved.document === 'terms' ? termsLink.current : privacyLink.current) : heading.current;
    dialog.scrollTop = saved?.scrollTop ?? 0;
    focus?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [positionRef]);

  function rememberPosition(event: MouseEvent<HTMLAnchorElement>, document: WelcomePosition['document']) {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    positionRef.current = { document, scrollTop: panel.current?.scrollTop ?? 0 };
  }

  return (
    <dialog className={styles.panel} ref={panel} aria-labelledby="welcome-heading" aria-modal="true" closedby="none"
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => { if (event.key === 'Escape') event.preventDefault(); }}>
      <header className={styles.intro}>
        <img className={styles.logo} src={`${import.meta.env.BASE_URL}webxreader.svg`} width={72} height={44} alt="" />
        <h1 id="welcome-heading" ref={heading} tabIndex={-1}>Welcome to WebXReader!</h1>
        <p>WebXReader is a completely free, privacy-focused, open-source application for reading, organizing and managing your digital books — entirely within your browser.</p>
      </header>

      <section className={styles.guidance} aria-labelledby="getting-started-heading">
        <h2 id="getting-started-heading">Getting started</h2>
        <ul>
          {guidance.map(({ icon: Icon, title, description }) => (
            <li key={title}>
              <Icon className={styles.icon} size={16} aria-hidden="true" />
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.notice} aria-labelledby="local-library-heading">
        <ShieldCheck className={styles.icon} size={16} aria-hidden="true" />
        <div>
          <h2 id="local-library-heading">Your library belongs to you.</h2>
          <p>Your library is stored in this browser. Keep regular backups, since clearing site data may remove it.</p>
        </div>
      </section>

      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); onContinue(); }}>
        <div className={styles.agreement}>
          <label className={styles.checkTarget} htmlFor={checkboxId}>
            <input id={checkboxId} type="checkbox" checked={checked} disabled={saving} aria-labelledby={`${checkboxId}-label`}
              onChange={(event) => onCheckedChange(event.target.checked)} />
          </label>
          <p id={`${checkboxId}-label`}>
            <label htmlFor={checkboxId}>I agree to the</label>{' '}
            <Link ref={termsLink} to={TERMS_PATH} state={legalNavigation} onClick={(event) => rememberPosition(event, 'terms')}>Terms of Use</Link>
            {' and acknowledge the '}
            <Link ref={privacyLink} to={PRIVACY_PATH} state={legalNavigation} onClick={(event) => rememberPosition(event, 'privacy')}>Privacy Policy</Link>.
          </p>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <Button className={styles.continue} type="submit" variant="primary" disabled={!checked} loading={saving}>
          Continue to my library
          <ArrowRight size={15} aria-hidden="true" />
        </Button>
      </form>
    </dialog>
  );
}
