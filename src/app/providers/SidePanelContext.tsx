import { useState, type ReactNode } from 'react';
import { SidePanelContext } from './sidePanelContextValue';

export function SidePanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <SidePanelContext.Provider value={{ isOpen, setIsOpen }}>
      {children}
    </SidePanelContext.Provider>
  );
}
