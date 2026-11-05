import React, { createContext, useContext, useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

// [REF: WEB_APP_ROLE]
// Mirrors public.app_role (migration/sql/01_schema.sql). Only two roles have a
// web portal: 'admin' (manages) and 'department_head' (read-only). 'officer'
// and 'owner' belong to the mobile app, 'pending' is an account nobody has
// activated. Those three are routed to AccountStatus rather than into the
// portal (09_audit_trail.sql: RLS denies writes to department_head, and
// everything to pending).
export type AppRole = 'admin' | 'department_head' | 'officer' | 'pending' | 'owner' | null;

const KNOWN_ROLES: readonly string[] = ['admin', 'department_head', 'officer', 'pending', 'owner'];

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
        // Role from the profiles table, written by the handle_new_user()
        // trigger the moment the auth user is born.
        const { data: profile, error: readError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        if (readError) throw new Error(readError.message);

        // [REF: NO_CLIENT_ROLE_FALLBACK]
        // Three officer fallbacks used to live in this block, and all three
        // had to go when handle_new_user() stopped making everyone an officer:
        //
        //  1. an unrecognised stored role became 'officer'. With 'pending' and
        //     'owner' now real values, that turned every unactivated account
        //     into an apparent inspector — RLS still refused their data, so
        //     the UI routed them into a portal of silently empty tables.
        //  2. a missing profiles row became 'officer' too.
        //  3. the client then INSERTED that row as `role: 'officer'`. That was
        //     the client half of the profiles_insert policy, which
        //     06_owner_role.sql drops precisely because it let any
        //     authenticated user name themselves an officer.
        //
        // Nothing legitimate is lost: the trigger is security definer and
        // creates the row server-side before this code can run.
        let role: AppRole;
        if (profile && KNOWN_ROLES.includes(profile.role)) {
          role = profile.role as AppRole;
        } else {
          // Either no row (the trigger has not landed, or failed) or a value
          // this build does not know. 'pending' is the only safe reading of
          // both: it grants nothing, and AccountStatus explains the state
          // instead of pretending the app is broken. A genuinely missing row
          // is an operations incident, not a routine state — the old
          // self-insert papered over it by handing out the keys.
          role = 'pending';
        }

        if (mounted) {
          setAuthState(prev => ({
            ...prev,
            user,
            session: true,
            // No `|| 'officer'` fallback: `role` is always one of the known
            // values by now, and a default here would reinstate exactly the
            // behaviour the block above removed.
            role,
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
