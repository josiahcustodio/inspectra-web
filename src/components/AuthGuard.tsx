import { Navigate, useLocation, Outlet } from 'react-router';
import { useAuth } from '@/lib/useAuth';

import type { AppRole } from '@/lib/useAuth';

interface AuthGuardProps {
  allowedRoles?: Exclude<AppRole, null>[];
}

// [REF: WEB_AUTH_GUARD]
export function AuthGuard({ allowedRoles }: AuthGuardProps) {
  const { session, role, emailVerified, needsMfa, mfaEnrolled, isLoading, error, retryProfile } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Not logged in
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Signed in but still owing the second factor — RLS refuses every read in
  // this state, so park on /login where the OTP pane finishes the sign-in.
  if (needsMfa) {
    return <Navigate to="/login" replace />;
  }

  // Email/password accounts must verify before they can use the app.
  if (!emailVerified) {
    return <Navigate to="/verify-email" replace />;
  }

  // Role-based route check: if allowedRoles is defined but role hasn't loaded yet,
  // show a loading state rather than silently bypassing the check.
  if (allowedRoles) {
    if (!role) {
      if (error) {
        return (
          <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 text-center px-4">
            <p className="text-slate-600">Couldn't load your account details. Check your connection and try again.</p>
            <button onClick={() => retryProfile()} className="text-primary font-medium hover:underline">
              Retry
            </button>
          </div>
        );
      }
      // Role is still resolving from the profiles table after auth — hold here
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      );
    }
    // Administrators and department heads must enrol a second factor
    // (11_admin_mfa_required.sql + 13_head_mfa_required.sql refuse every
    // other read until they do). Settings holds the enrolment.
    const settingsPath = role === 'admin' ? '/admin/settings' : '/head/settings';
    if ((role === 'admin' || role === 'department_head') && !mfaEnrolled && location.pathname !== settingsPath) {
      return <Navigate to={settingsPath} replace />;
    }
    if (!allowedRoles.includes(role)) {
      // Back to the index, which is the one place that knows where each role
      // belongs. Building a path from the role (`/${role}/dashboard`) broke
      // the moment roles without a dashboard existed: 'pending' and 'owner'
      // would have been sent to /pending/dashboard and bounced in a loop.
      return <Navigate to="/" replace />;
    }
  }

  return <Outlet />;
}
