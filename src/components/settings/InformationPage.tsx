import { useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ExternalLink,
  Globe2,
  ShieldCheck,
} from 'lucide-react';

import styles from './InformationPage.module.css';

type InformationPageKind = 'about' | 'privacy';

interface InformationPageProps {
  kind: InformationPageKind;
}

export function InformationPage({ kind }: InformationPageProps) {
  const navigate = useNavigate();
  const isPrivacyPage = kind === 'privacy';
  const title = isPrivacyPage ? 'Privacy Policy' : 'About WebXReader';

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [kind]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => navigate('/settings')}
          title="Back to Settings"
          aria-label="Back to Settings"
          type="button"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className={styles.title}>{title}</h1>
      </header>

      <main className={styles.main}>
        {isPrivacyPage ? <PrivacyPolicy /> : <AboutWebXReader />}
      </main>
    </div>
  );
}

function AboutWebXReader() {
  const mirrors = [
    { label: 'Primary', href: 'https://webxreader.web.app/', host: 'webxreader.web.app' },
    { label: 'Mirror one', href: 'https://webxreader.pages.dev/', host: 'webxreader.pages.dev' },
    { label: 'Mirror two', href: 'https://webxreader.vercel.app/', host: 'webxreader.vercel.app' },
    { label: 'Mirror three', href: 'https://webxreader.netlify.app/', host: 'webxreader.netlify.app' },
  ];

  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <BookOpen size={19} />
        <div>
          <h2 className={styles.cardTitle}>A reader built around your library</h2>
          <p className={styles.intro}>
            WebXReader is a private, local-first web reader for novels and other long-form reading.
            Bring your own books, arrange your library, and make the reading experience your own.
          </p>
        </div>
      </div>

      <div className={styles.facts}>
        <div className={styles.fact}>
          <CalendarDays size={17} />
          <span className={styles.factCopy}>
            <span className={styles.factLabel}>First published</span>
            <time className={styles.factValue} dateTime="2026-10-25">October 25, 2026</time>
          </span>
        </div>
        <div className={styles.fact}>
          <Globe2 size={17} />
          <span className={styles.factCopy}>
            <span className={styles.factLabel}>Source license</span>
            <span className={styles.factValue}>GNU AGPL v3.0</span>
          </span>
        </div>
      </div>

      <div className={styles.prose}>
        <section className={styles.proseSection}>
          <h3>Made for local reading</h3>
          <p>
            Your imported books, reading progress, bookmarks, annotations, and preferences are kept
            in this browser. WebXReader has no account system or cloud library. It supports TXT,
            Markdown, HTML, RTF, FictionBook (FB2), MOBI, Kindle Format 8 (AZW3), Word Documents (DOCX, DOC), DjVu Documents (DJVU, DJV), MHTML Web Archives (MHT, MHTML), General Archives (ZIP, RAR), Standalone Images (PNG, JPEG), EPUB, PDF, and Comic Books (CBZ, CBR, CB7), with reading layouts and typography you can adjust.
          </p>
        </section>

        <section className={styles.proseSection}>
          <h3>Open source</h3>
          <p>
            WebXReader is published under the GNU Affero General Public License, version 3. You can
            review the source, contribute, or read the full license text below.
          </p>
          <div className={styles.linkRow}>
            <a href="https://github.com/xensenx/WebXReader" target="_blank" rel="noopener noreferrer">
              View the source on GitHub <ExternalLink size={15} />
            </a>
            <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">
              Read the AGPL v3.0 <ExternalLink size={15} />
            </a>
          </div>
        </section>

        <section className={styles.proseSection}>
          <h3>Site mirrors</h3>
          <p>Choose any of the available WebXReader sites.</p>
          <div className={styles.mirrorGrid}>
            {mirrors.map((mirror) => (
              <a
                key={mirror.label}
                className={styles.mirrorLink}
                href={mirror.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={styles.mirrorCopy}>
                  <span className={styles.mirrorLabel}>{mirror.label}</span>
                  <span className={styles.mirrorUrl}>{mirror.host}</span>
                </span>
                <ExternalLink size={15} />
              </a>
            ))}
          </div>
          <div className={styles.summary}>
            Your library data is not shared between these mirrors. Each site stores books,
            bookmarks, reading progress, and preferences separately in your browser.
          </div>
        </section>

      </div>
    </article>
  );
}

function PrivacyPolicy() {
  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <ShieldCheck size={19} />
        <div>
          <h2 className={styles.cardTitle}>Your reading data stays on your device</h2>
          <p className={styles.updated}>Last updated October 28, 2026</p>
        </div>
      </div>

      <div className={styles.summary}>
        WebXReader does not run accounts, analytics, advertising, or a remote library service. The
        app does not send your books or personal reading data to WebXReader servers.
      </div>

      <div className={styles.prose}>
        <section className={styles.proseSection}>
          <h3>Information stored in your browser</h3>
          <p>
            WebXReader stores imported book files and metadata, covers, reading progress,
            bookmarks, annotations, and per-book reader settings in IndexedDB on your device. This
            library and reading data is not uploaded by WebXReader.
          </p>
          <p>
            General site preferences, including your theme, default reading settings, library
            layout, sort order, and import preferences, are stored separately in this browser's
            local storage. If the browser blocks local storage, WebXReader uses a separate
            preferences record in IndexedDB. Clearing library data in WebXReader leaves these
            preferences in place. To remove them too, clear this site's data in your browser.
          </p>
          <p>
            The offline feature may also save the application shell and static app files in Cache
            Storage. You can remove your library data from Settings or clear this site’s data using
            your browser. Browser storage can also be cleared or evicted by the browser.
          </p>
        </section>

        <section className={styles.proseSection}>
          <h3>Backups and imported books</h3>
          <p>
            Exporting a backup creates a file on your device when you choose to do so. Restoring a
            backup reads the file you select in your browser; WebXReader does not upload it.
          </p>
          <p>
            Imported publications may contain links or references to remote resources. If you open
            an external link, or a publication loads a remote resource, your browser may contact that
            third-party site directly.
          </p>
        </section>

        <section className={styles.proseSection}>
          <h3>Hosting and external services</h3>
          <p>
            When you visit a hosted copy of WebXReader, its hosting provider receives the network
            requests needed to deliver the site and may process standard connection information,
            such as your IP address, browser details, and requested files, in server logs. These
            logs are controlled by the hosting provider, not by the WebXReader app.
          </p>
          <p>
            Links to GitHub, Ko-fi, and xensenx.dev take you to services outside the reader. Those
            services have their own privacy practices. Information you submit through a contact form
            or donation page is handled by that service and its operator.
          </p>
        </section>

        <section className={styles.proseSection}>
          <h3>Contact</h3>
          <p>
            For privacy questions, contact the maintainer through the email address or forms on
            xensenx.dev.
          </p>
          <a href="https://xensenx.dev/" target="_blank" rel="noopener noreferrer">
            Visit xensenx.dev <ExternalLink size={15} />
          </a>
        </section>
      </div>
    </article>
  );
}
