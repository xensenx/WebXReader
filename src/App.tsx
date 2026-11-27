/**
 * Root Application Component with Routes and Providers.
 */

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { SettingsProvider } from './app/providers/SettingsContext';
import { SidePanelProvider } from './app/providers/SidePanelContext';
import { useSettingsContext } from './app/providers/useSettingsContext';
import { hasAcceptedCurrentTerms, PRIVACY_PATH, TERMS_PATH, TERMS_VERSION, WELCOME_PATH } from './app/legal';
import { getTermsAcceptance, saveTermsAcceptance } from './core/storage/database';
import { InformationPage } from './components/settings/InformationPage';
import { WelcomeScreen, StartupStatus, type WelcomePosition } from './components/welcome/WelcomeScreen';

const WorkspaceRoutes = lazy(() => import('./app/WorkspaceRoutes'));

function ApplicationRoutes() {
  const { pathname } = useLocation();
  const { loading: settingsLoading } = useSettingsContext();
  const [acceptance, setAcceptance] = useState<'checking' | 'required' | 'accepted'>('checking');
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);
  const welcomePosition = useRef<WelcomePosition | null>(null);

  useEffect(() => {
    let active = true;
    void getTermsAcceptance().then((record) => {
      if (active) setAcceptance(hasAcceptedCurrentTerms(record) ? 'accepted' : 'required');
    }).catch(() => {
      if (!active) return;
      setError('WebXReader couldn’t read your acceptance from browser storage. You can accept and try again below.');
      setAcceptance('required');
    });
    return () => { active = false; };
  }, []);

  async function continueToLibrary() {
    if (!checked || acceptance !== 'required' || writing.current) return;
    writing.current = true;
    setSaving(true);
    setError('');
    try {
      await saveTermsAcceptance({ accepted: true, termsVersion: TERMS_VERSION, acceptedAt: Date.now() });
      setAcceptance('accepted');
    } catch {
      setError('WebXReader couldn’t save your acceptance. Check that browser storage is available and try again.');
    } finally {
      writing.current = false;
      setSaving(false);
    }
  }

  const atWelcome = pathname === WELCOME_PATH;
  const showWelcome = atWelcome && acceptance === 'required';
  const legalBackFallback = acceptance === 'accepted' ? '/' : WELCOME_PATH;
  return (
    <Routes>
      <Route path={PRIVACY_PATH} element={<InformationPage kind="privacy" backFallback={legalBackFallback} />} />
      <Route path={TERMS_PATH} element={<InformationPage kind="terms" backFallback={legalBackFallback} />} />
      <Route path="*" element={
        acceptance === 'checking' || (showWelcome && settingsLoading) ? <StartupStatus /> :
          acceptance === 'required' && !atWelcome ? <Navigate to={WELCOME_PATH} replace /> : (
            <>
              <Suspense fallback={<StartupStatus />}>
                <WorkspaceRoutes welcomeDialog={showWelcome ? (
                  <WelcomeScreen checked={checked} onCheckedChange={setChecked} saving={saving} error={error}
                    onContinue={() => void continueToLibrary()} positionRef={welcomePosition} />
                ) : undefined} />
              </Suspense>
              {atWelcome && acceptance === 'accepted' && <Navigate to="/" replace />}
            </>
          )
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <HashRouter>
        <SidePanelProvider>
          <ApplicationRoutes />
        </SidePanelProvider>
      </HashRouter>
    </SettingsProvider>
  );
}
