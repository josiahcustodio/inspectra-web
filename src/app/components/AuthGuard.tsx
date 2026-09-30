import { Navigate, useLocation, Outlet } from 'react-router';
import { useAuth } from '../../lib/useAuth';

interface AuthGuardProps {
  allowedRoles?: ('admin' | 'officer')[];
}

// [REF: WEB_AUTH_GUARD]
export function AuthGuard({ allowedRoles }: AuthGuardProps) {
  const { session, role, emailVerified, isLoading, error, retryProfile } = useAuth();
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

  // Email/password accounts must verify before they can use the app.
  // Google sign-in is pre-verified, so this only ever blocks email signups.
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
      // Role is still resolving from Firestore after auth — hold here
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      );
    }
    if (!allowedRoles.includes(role)) {
      // User doesn't have the right role, redirect to their specific dashboard
      return <Navigate to={`/${role}/dashboard`} replace />;
    }
  }

  return <Outlet />;
}
