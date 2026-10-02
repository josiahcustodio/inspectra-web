import { createBrowserRouter, Navigate } from "react-router";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { Establishments } from "@/pages/Establishments";
import { Inspections } from "@/pages/Inspections";
import { GISMap } from "@/pages/GISMap";
import { Inspectors } from "@/pages/Inspectors";
import { Settings } from "@/pages/Settings";
import { Login } from "@/pages/Login";
import { Signup } from "@/pages/Signup";
import { VerifyEmail } from "@/pages/VerifyEmail";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/useAuth";

// [REF: ROLE_REDIRECT]
const RoleRedirect = () => {
  const { role, session, emailVerified, isLoading, error, retryProfile } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  if (!emailVerified) return <Navigate to="/verify-email" replace />;
  if (role === 'admin') return <Navigate to="/admin/dashboard" replace />;
  if (role === 'officer') return <Navigate to="/officer/dashboard" replace />;

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
