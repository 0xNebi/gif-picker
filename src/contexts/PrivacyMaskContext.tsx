import { createContext, useContext, type ReactNode } from "react";

import { useWindowFocused } from "../hooks/useWindowFocused";

const PrivacyMaskContext = createContext(false);

export function usePrivacyMask(): boolean {
  return useContext(PrivacyMaskContext);
}

interface PrivacyMaskProviderProps {
  enabled: boolean;
  children: ReactNode;
}

export function PrivacyMaskProvider({
  enabled,
  children,
}: PrivacyMaskProviderProps) {
  const focused = useWindowFocused();
  const masked = enabled && !focused;

  return (
    <PrivacyMaskContext.Provider value={masked}>
      {children}
    </PrivacyMaskContext.Provider>
  );
}