/**
 * Root Application Component with Routes and Providers.
 */

import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SettingsProvider } from './app/providers/SettingsContext';
import { LibraryView } from './components/library/LibraryView';
import { ReaderView } from './components/reader/ReaderView';
import { SettingsView } from './components/settings/SettingsView';
import { InformationPage } from './components/settings/InformationPage';

export default function App() {
  return (
    <SettingsProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<LibraryView />} />
          <Route path="/read/:bookId" element={<ReaderView />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="/about" element={<InformationPage kind="about" />} />
          <Route path="/privacy-policy" element={<InformationPage kind="privacy" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </SettingsProvider>
  );
}
