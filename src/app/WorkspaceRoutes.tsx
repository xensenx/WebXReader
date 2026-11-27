import { useCallback, useState, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LibraryView } from '../components/library/LibraryView';
import { ReaderView } from '../components/reader/ReaderView';
import { SettingsView } from '../components/settings/SettingsView';
import { InformationPage } from '../components/settings/InformationPage';
import { PlannedFeaturePage } from '../components/common/PlannedFeaturePage';
import { SeriesView } from '../components/series/SeriesView';
import { LogoEasterEgg } from '../components/easter-egg/LogoEasterEgg';
import { WELCOME_PATH } from './legal';

export default function WorkspaceRoutes({ welcomeDialog }: { welcomeDialog?: ReactElement }) {
  const [libraryReady, setLibraryReady] = useState(false);
  const markLibraryReady = useCallback(() => setLibraryReady(true), []);
  const libraryBlocked = Boolean(welcomeDialog);
  const library = (
    <div inert={libraryBlocked} aria-hidden={libraryBlocked || undefined}>
      <LibraryView onReady={libraryBlocked ? markLibraryReady : undefined} />
    </div>
  );
  return (
    <>
      <Routes>
        <Route path="/" element={library} />
        <Route path={WELCOME_PATH} element={library} />
        <Route path="/read/:bookId" element={<ReaderView />} />
        <Route path="/settings" element={<SettingsView />} />
        <Route path="/series" element={<SeriesView />} />
        <Route path="/series/:seriesId" element={<SeriesView />} />
        <Route path="/private-mode" element={<PlannedFeaturePage title="Private mode" />} />
        <Route path="/stats" element={<PlannedFeaturePage title="Stats" />} />
        <Route path="/about" element={<InformationPage kind="about" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {libraryReady && welcomeDialog}
      {!libraryBlocked && <LogoEasterEgg />}
    </>
  );
}
