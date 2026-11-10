import { useLayoutEffect } from 'react';
import { Clock3 } from 'lucide-react';

import { MainPageHeader } from './MainPageHeader';
import styles from './PlannedFeaturePage.module.css';

interface PlannedFeaturePageProps {
  title: string;
}

export function PlannedFeaturePage({ title }: PlannedFeaturePageProps) {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className={styles.container}>
      <MainPageHeader />

      <main className={styles.main}>
        <section className={styles.notice} aria-labelledby="planned-feature-title">
          <div className={styles.iconWrap} aria-hidden="true">
            <Clock3 size={22} />
          </div>
          <span className={styles.eyebrow}>Planned feature</span>
          <h2 id="planned-feature-title" className={styles.noticeTitle}>
            {title} is coming in a future update
          </h2>
          <p className={styles.description}>
            This is a planned feature that will be added in the future.
          </p>
          <p className={styles.developmentNote} role="note">
            <strong>WebXReader is still in the early stages of development.</strong> More features
            will be added over time.
          </p>
        </section>
      </main>
    </div>
  );
}
