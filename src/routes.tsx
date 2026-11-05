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
import { Audit } from "@/pages/Audit";
import { AccountStatus } from "@/pages/AccountStatus";
import { Login } from "@/pages/Login";
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
  if (role === 'department_head') return <Navigate to="/head/dashboard" replace />;
  // [REF: ROLE_REDIRECT_NON_STAFF]
  // The roles with no web portal: inspectors and owners work in the mobile
  // app, pending accounts are not activated. Before these branches existed, a
  // session holding one fell through to the spinner at the bottom of this
  // function and stayed there.
  if (role === 'pending' || role === 'owner' || role === 'officer') {
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
  // No /signup: staff accounts are created by an administrator, never by the
  // visitor. The Supabase sign-up endpoint itself is still reachable, which is
  // why handle_new_user() stamps every new account 'pending' (grants nothing).
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
              // Admin branch only: audit_log_select is is_admin() in RLS.
              { path: "audit", Component: Audit },
              { path: "settings", Component: Settings },
            ],
          }
        ],
      },
      {
        // Read-only portal. RLS (09_audit_trail.sql) denies this role every
        // write, so the pages hide their edit controls on role === 'admin'.
        path: "head",
        element: <AuthGuard allowedRoles={['department_head']} />,
        children: [
          {
            element: <Layout />,
            children: [
              { path: "dashboard", Component: Dashboard },
              { path: "establishments", Component: Establishments },
              { path: "inspections", Component: Inspections },
              { path: "gis-map", Component: GISMap },
              { path: "inspectors", Component: Inspectors },
              { path: "masterlist", Component: Masterlist },
              { path: "settings", Component: Settings },
            ],
          }
        ],
      }
    ],
  },
]);
