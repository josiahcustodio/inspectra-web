import { createBrowserRouter, Navigate } from "react-router";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { Establishments } from "@/pages/Establishments";
import { Inspections } from "@/pages/Inspections";
import { GISMap } from "@/pages/GISMap";
import { Inspectors } from "@/pages/Inspectors";
import { Masterlist } from "@/pages/Masterlist";
import { MasterlistImport } from "@/pages/MasterlistImport";
import { Settings } from "@/pages/Settings";
import { Access } from "@/pages/Access";
import { AccountStatus } from "@/pages/AccountStatus";
import { Login } from "@/pages/Login";
import { Signup } from "@/pages/Signup";
import { VerifyEmail } from "@/pages/VerifyEmail";
import { ResetPassword } from "@/pages/ResetPassword";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/useAuth";

// [REF: ROLE_REDIRECT]
const RoleRedirect = () => {
  const { role, session, emailVerified, needsMfa, isLoading, error, retryProfile } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  if (needsMfa) return <Navigate to="/login" replace />;
  if (!emailVerified) return <Navigate to="/verify-email" replace />;
  if (role === 'admin') return <Navigate to="/admin/dashboard" replace />;
  if (role === 'officer') return <Navigate to="/officer/dashboard" replace />;
  // [REF: ROLE_REDIRECT_NON_STAFF]
  // The two roles with no portal. Before these branches existed, a session
  // holding either one fell through to the spinner at the bottom of this
  // function and stayed there — which is what every new sign-up would have
  // done once handle_new_user() started writing 'pending'.
  if (role === 'pending' || role === 'owner') {
    return <Navigate to="/account" replace />;
  }

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

  // session + emailVerified but role hasn't resolved yet and no error — hold here.
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );
};

// [REF: WEB_ROUTE_MAP]
export const router = createBrowserRouter([
  {
    path: "/login",
    Component: Login,
  },
  {
    path: "/signup",
    Component: Signup,
  },
  {
    path: "/verify-email",
    Component: VerifyEmail,
  },
  {
    path: "/reset-password",
    Component: ResetPassword,
  },
  {
    // Deliberately outside both AuthGuard branches: the roles that land here
    // match neither, and guarding it would bounce them back to "/" in a loop.
    // The page renders nothing sensitive — it reads only the session's own
    // email and role.
    path: "/account",
    Component: AccountStatus,
  },

  {
    path: "/",
    children: [
      { index: true, Component: RoleRedirect },
      {
        path: "admin",
        element: <AuthGuard allowedRoles={['admin']} />,
        children: [
          {
            element: <Layout />,
            children: [
              { path: "dashboard", Component: Dashboard },
              { path: "establishments", Component: Establishments },
              { path: "inspections", Component: Inspections },
              { path: "gis-map", Component: GISMap },
              { path: "inspectors", Component: Inspectors },
              // Admin branch only — the full Excel-shaped masterlist view,
              // and the importer. The import machinery collections
              // (upload_batches, review_queue) are admin-only in
              // the RLS policies (migration/sql/02_rls.sql), so mounting the importer for officers would
              // give them a page whose every write fails.
              { path: "masterlist", Component: Masterlist },
              { path: "import", Component: MasterlistImport },
              // Admin branch only. Writing profiles.role is admin-gated in RLS
              // (profiles_update) and so is establishment_contacts, so an
              // officer would get a page whose every write fails.
              { path: "access", Component: Access },
              { path: "settings", Component: Settings },
            ],
          }
        ],
      },
      {
        path: "officer",
        element: <AuthGuard allowedRoles={['officer']} />,
        children: [
          {
            element: <Layout />,
            children: [
              { path: "dashboard", Component: Dashboard },
              { path: "establishments", Component: Establishments },
              { path: "inspections", Component: Inspections },
              { path: "gis-map", Component: GISMap },
              { path: "inspectors", Component: Inspectors },
              { path: "settings", Component: Settings },
            ],
          }
        ],
      }
    ],
  },
]);
