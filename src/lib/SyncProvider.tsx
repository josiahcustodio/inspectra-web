import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { syncAll } from './sync';

interface SyncContextType {
  isOnline: boolean;
  isSyncing: boolean;
  forceSync: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType>({
  isOnline: true,
  isSyncing: false,
  forceSync: async () => {},
});

export const useSync = () => useContext(SyncContext);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);

  const forceSync = useCallback(async () => {
    if (!navigator.onLine || isSyncingRef.current) return;
    
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      await syncAll();
    } catch (e) {
      console.error("Sync failed", e);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Trigger a sync when we come back online
      forceSync();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        forceSync();
      }
    };

    const handleFocus = () => {
      forceSync();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    // Initial sync on startup if online
    if (navigator.onLine) {
      forceSync();
    }

    // Set up periodic background sync every 15 seconds for real-time feel
    const intervalId = setInterval(() => {
      if (navigator.onLine) {
        forceSync();
      }
    }, 15 * 1000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      clearInterval(intervalId);
    };
  }, [forceSync]);

  return (
    <SyncContext.Provider value={{ isOnline, isSyncing, forceSync }}>
      {children}
    </SyncContext.Provider>
  );
}
