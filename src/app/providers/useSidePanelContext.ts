import { useContext } from 'react';

import { SidePanelContext } from './sidePanelContextValue';

export function useSidePanelContext() {
  const context = useContext(SidePanelContext);
  if (!context) {
    throw new Error('useSidePanelContext must be used within a SidePanelProvider');
  }
  return context;
}
