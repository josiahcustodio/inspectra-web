import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, firebaseDb } from './firebase';

export type AppRole = 'admin' | 'officer' | null;

interface AuthState {
  user: User | null;
  session: boolean;
  role: AppRole;
  emailVerified: boolean;
  isLoading: boolean;
  error: Error | null;
  refreshUser: () => Promise<void>;
  retryProfile: () => Promise<void>;
}

const noopAsync = async () => {};

const AuthContext = createContext<AuthState>({
  user: null,
  session: false,
  role: null,
  emailVerified: false,
  isLoading: true,
  error: null,
  refreshUser: noopAsync,
  retryProfile: noopAsync,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    session: false,
    role: null,
    emailVerified: false,
    isLoading: true,
    error: null,
    refreshUser: noopAsync,
    retryProfile: noopAsync,
  });

  useEffect(() => {
    let mounted = true;

    // [REF: WEB_PROFILE_BOOTSTRAP]
    const loadProfile = async (user: User) => {
      try {
        // Get Role from profiles collection
        const profileRef = doc(firebaseDb, 'profiles', user.uid);
        const profileSnap = await getDoc(profileRef);

        let role: AppRole;
        if (profileSnap.exists()) {
          // Validate rather than trust-cast: a malformed/stale role value here
          // must never propagate, since RoleRedirect has no route for it and
          // would bounce the user in a loop between "/" and "/login".
          const rawRole = profileSnap.data().role;
          role = rawRole === 'admin' || rawRole === 'officer' ? rawRole : 'officer';
        } else {
          // Bootstrap: mirrors the Flutter client's AuthService.ensureProfile
          // and the firestore.rules profiles/{uid} `create` rule — a user may
          // only ever self-create their OWN profile as 'officer', never
          // 'admin'. Without this write, no profile doc is ever persisted and
          // every admin-gated rule elsewhere silently fails for this user.
          role = 'officer';
          await setDoc(profileRef, {
            role: 'officer',
            email: user.email,
            created_at: new Date().toISOString(),
          });
        }

        if (mounted) {
          setAuthState(prev => ({
            ...prev,
            user,
            session: true,
            role: role || 'officer',
            emailVerified: user.emailVerified,
            isLoading: false,
            error: null,
          }));
        }
      } catch (error) {
        if (mounted) {
          // The Firestore profile read failed, but Firebase Auth itself
          // still has this user signed in — keep session/user set so
          // AuthGuard doesn't bounce them to /login. role stays whatever it
          // was (usually null), and retryProfile lets the UI offer a retry
          // instead of leaving them stuck behind an infinite spinner.
          setAuthState(prev => ({
            ...prev,
            user,
            session: true,
            emailVerified: user.emailVerified,
            isLoading: false,
            error: error as Error,
          }));
        }
      }
    };

    const refreshUser = async () => {
      if (!auth.currentUser) return;
      await auth.currentUser.reload();
      if (auth.currentUser && mounted) {
        setAuthState(prev => ({
          ...prev,
          user: auth.currentUser,
          emailVerified: auth.currentUser!.emailVerified,
        }));
      }
    };

    const retryProfile = async () => {
      if (!auth.currentUser) return;
      setAuthState(prev => ({ ...prev, isLoading: true, error: null }));
      await loadProfile(auth.currentUser);
    };

    // [REF: WEB_AUTH_STATE]
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (mounted) {
          setAuthState(prev => ({
            ...prev,
            user: null,
            session: false,
            role: null,
            emailVerified: false,
            isLoading: false,
            refreshUser: noopAsync,
            retryProfile: noopAsync,
          }));
        }
        return;
      }

      setAuthState(prev => ({ ...prev, refreshUser, retryProfile }));
      await loadProfile(user);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
