import React, { createContext, useContext, useEffect, useState } from 'react';

interface ConnectionContextType {
  isOnline: boolean;
}

const ConnectionContext = createContext<ConnectionContextType>({ isOnline: true });

export const useConnection = () => useContext(ConnectionContext);

// [REF: CONNECTION_STATUS]
//
// The app is cloud-only: with no connection there is nothing to read and nowhere
// to write. This provider exists purely so the shell can tell the user that,
// rather than letting screens sit empty or letting a save fail without
// explanation. It deliberately does NOT queue work for later — the old
// store-locally-and-sync-later path is gone.
export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <ConnectionContext.Provider value={{ isOnline }}>
      {children}
    </ConnectionContext.Provider>
  );
}
