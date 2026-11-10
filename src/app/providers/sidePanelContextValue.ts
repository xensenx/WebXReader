import { createContext } from 'react';

export interface SidePanelContextValue {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const SidePanelContext = createContext<SidePanelContextValue | null>(null);
