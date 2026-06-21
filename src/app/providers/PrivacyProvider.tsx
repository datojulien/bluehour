import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface PrivacyContextValue {
  privacyMode: boolean;
  togglePrivacyMode: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue | undefined>(undefined);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [privacyMode, setPrivacyMode] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPrivacyMode((current) => !current);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const value = useMemo(
    () => ({
      privacyMode,
      togglePrivacyMode: () => setPrivacyMode((current) => !current)
    }),
    [privacyMode]
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  const value = useContext(PrivacyContext);
  if (!value) {
    throw new Error("usePrivacy must be used inside PrivacyProvider");
  }

  return value;
}
