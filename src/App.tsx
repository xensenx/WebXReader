/**
 * Root Application Component with Routes and Providers.
 */

import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SettingsProvider } from './app/providers/SettingsContext';
import { SidePanelProvider } from './app/providers/SidePanelContext';
import { LibraryView } from './components/library/LibraryView';
import { ReaderView } from './components/reader/ReaderView';
import { SettingsView } from './components/settings/SettingsView';
import { InformationPage } from './components/settings/InformationPage';
import { PlannedFeaturePage } from './components/common/PlannedFeaturePage';
import { SeriesView } from './components/series/SeriesView';
import { LogoEasterEgg } from './components/easter-egg/LogoEasterEgg';

export default function App() {
  return (
    <SettingsProvider>
      <HashRouter>
        <SidePanelProvider>
          <Routes>
            <Route path="/" element={<LibraryView />} />
            <Route path="/read/:bookId" element={<ReaderView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="/series" element={<SeriesView />} />
            <Route path="/series/:seriesId" element={<SeriesView />} />
            <Route path="/private-mode" element={<PlannedFeaturePage title="Private mode" />} />
            <Route path="/stats" element={<PlannedFeaturePage title="Stats" />} />
            <Route path="/about" element={<InformationPage kind="about" />} />
            <Route path="/privacy-policy" element={<InformationPage kind="privacy" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <LogoEasterEgg />
        </SidePanelProvider>
      </HashRouter>
    </SettingsProvider>
  );
}
