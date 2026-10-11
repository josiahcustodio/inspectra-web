import React, { createContext, useContext, useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type AppRole = 'admin' | 'officer' | null;

interface AuthState {
  user: User | null;
  session: boolean;
  role: AppRole;
  emailVerified: boolean;
  /** True when this account has a verified TOTP factor but the current
   *  session is still AAL1 — signed in, second factor not yet presented.
   *  RLS blocks every table read in that state, so the guards park the
   *  user on /login where the OTP pane completes the sign-in. */
  needsMfa: boolean;
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
  needsMfa: false,
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
    needsMfa: false,
    isLoading: true,
    error: null,
    refreshUser: noopAsync,
    retryProfile: noopAsync,
  });

  useEffect(() => {
    let mounted = true;

    // With Supabase the email-confirmation state lives on the user object.
    // Confirmation is required (see migration/apply_phase1.py), so a session
    // can only exist once the address is verified — this is true for every
    // live session; the guard pages keep working off it regardless.
    const verified = (user: User) => user.email_confirmed_at != null;

    // Web MFA is optional (mobile is where it's compulsory), but once a user
    // HAS enrolled, an AAL1 session must not browse data — the restrictive
    // RLS policies refuse it server-side, and this flag is how the UI knows
    // to ask for the code instead of rendering empty tables.
    const checkMfa = async (): Promise<boolean> => {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      return data?.currentLevel === 'aal1' && data?.nextLevel === 'aal2';
    };

    // [REF: WEB_PROFILE_BOOTSTRAP]
    const loadProfile = async (user: User) => {
      try {
        const needsMfa = await checkMfa();
        if (needsMfa) {
          // Don't touch profiles yet — RLS would refuse the read anyway.
          if (mounted) {
            setAuthState(prev => ({
              ...prev,
              user,
              session: true,
              needsMfa: true,
              emailVerified: verified(user),
              isLoading: false,
              error: null,
            }));
          }
          return;
        }
        // Role from the profiles table. The row is created by the
        // handle_new_user() trigger the moment the auth user is born, so
        // "no row yet" is a brief race at worst — fall back to a self-insert
        // for parity with the old client bootstrap (RLS pins it to our own
        // uid with role 'officer', so this can never grant anything).
        const { data: profile, error: readError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        if (readError) throw new Error(readError.message);

        let role: AppRole;
        if (profile) {
          // Validate rather than trust-cast: a malformed/stale role value here
          // must never propagate, since RoleRedirect has no route for it and
          // would bounce the user in a loop between "/" and "/login".
          const rawRole = profile.role;
          role = rawRole === 'admin' || rawRole === 'officer' ? rawRole : 'officer';
        } else {
          role = 'officer';
          // supabase-js returns errors rather than throwing — a discarded
          // failure here would leave the user with NO profiles row, where
          // user_role() is NULL and every RLS policy filters all rows: a
          // signed-in app in which every table is silently empty. Throw into
          // the catch below so the retryProfile UI surfaces instead.
          const { error: insertError } = await supabase.from('profiles').insert({
            id: user.id,
            role: 'officer',
            email: user.email,
          });
          if (insertError) {
            throw new Error(
              insertError.code
                ? `${insertError.code}: ${insertError.message}`
                : insertError.message,
            );
          }
        }

        if (mounted) {
          setAuthState(prev => ({
            ...prev,
            user,
            session: true,
            role: role || 'officer',
            emailVerified: verified(user),
            needsMfa: false,
            isLoading: false,
            error: null,
          }));
        }
      } catch (error) {
        if (mounted) {
          // The profile read failed, but the auth session itself is live —
          // keep session/user set so AuthGuard doesn't bounce them to /login.
          // role stays whatever it was (usually null), and retryProfile lets
          // the UI offer a retry instead of an infinite spinner.
          setAuthState(prev => ({
            ...prev,
            user,
            session: true,
            emailVerified: verified(user),
            isLoading: false,
            error: error as Error,
          }));
        }
      }
    };

    const refreshUser = async () => {
      // getUser() asks the auth server, so a verification that happened in
      // another tab (clicking the email link) is visible here — the cached
      // session alone would keep reporting the old state.
      const { data, error } = await supabase.auth.getUser();
      if (!error && data.user && mounted) {
        const user = data.user;
        setAuthState(prev => ({
          ...prev,
          user,
          emailVerified: verified(user),
        }));
      }
    };

    const retryProfile = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      setAuthState(prev => ({ ...prev, isLoading: true, error: null }));
      await loadProfile(data.user);
    };

    // [REF: WEB_AUTH_STATE]
    // The listener also fires INITIAL_SESSION on page load, so there is no
    // separate getSession() bootstrap. The body defers real work out of the
    // callback (supabase-js holds an internal auth lock while it runs;
    // awaiting other client calls inside it can deadlock).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        if (mounted) {
          setAuthState(prev => ({
            ...prev,
            user: null,
            session: false,
            role: null,
            emailVerified: false,
            needsMfa: false,
            isLoading: false,
            refreshUser: noopAsync,
            retryProfile: noopAsync,
          }));
        }
        return;
      }

      const user = session.user;
      setAuthState(prev => ({ ...prev, refreshUser, retryProfile }));
      setTimeout(() => {
        if (mounted) void loadProfile(user);
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
