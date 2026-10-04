import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useConnection } from "@/lib/ConnectionProvider";
import { useAuth } from "@/lib/useAuth";
import {
  LayoutDashboard,
  Building2,
  ClipboardCheck,
  FileSpreadsheet,
  Table2,
  Map,
  Users,
  Settings as SettingsIcon,
  User,
  Menu,
  ChevronLeft,
  LogOut
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Paths here are deliberately relative — Layout prefixes them per role below,
// so each destination is described once instead of once per role.
// `adminOnly` hides a link from officers; the actual gate is the route map
// (Masterlist Import is mounted only under the admin branch).
const baseNavItems: { path: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean }[] = [
  { path: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "establishments", label: "Establishments", icon: Building2 },
  { path: "inspections", label: "Inspections", icon: ClipboardCheck },
  { path: "gis-map", label: "GIS Map", icon: Map },
  { path: "inspectors", label: "Inspectors", icon: Users },
  { path: "masterlist", label: "Masterlist", icon: Table2, adminOnly: true },
  { path: "import", label: "Masterlist Import", icon: FileSpreadsheet, adminOnly: true },
  { path: "settings", label: "Settings", icon: SettingsIcon },
];



// [REF: ADMIN_SHELL]
export function Layout() {
  const { isOnline } = useConnection();
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);

  // [REF: ROLE_NAV]
  //
  // Admins and officers see the same six destinations under different path
  // prefixes. This only builds the links: whether a role may actually open a
  // route is decided by AuthGuard and the route map, never here — so adding an
  // item to baseNavItems does not grant anyone access to it.
  const rolePrefix = role === 'admin' ? '/admin' : '/officer';
  const navItems = baseNavItems
    .filter(item => !item.adminOnly || role === 'admin')
    .map(item => ({ ...item, path: `${rolePrefix}/${item.path}` }));

  const handleSignOut = async () => {
    await signOut(auth);
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className={`${isSidebarExpanded ? "w-64" : "w-[60px]"} bg-white flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10 transition-all duration-300 relative`}>
        <div className={`p-6 flex items-center ${isSidebarExpanded ? "justify-between" : "justify-center"}`}>
          {isSidebarExpanded && (
            <h1 className="font-bold text-slate-900 tracking-tight text-base leading-tight">
              Batangas City<br/>City Health Office
            </h1>
          )}
          <button 
            onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors flex-shrink-0"
          >
            {isSidebarExpanded ? <ChevronLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              title={!isSidebarExpanded ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors font-bold ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                } ${!isSidebarExpanded && "justify-center px-0"}`
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {isSidebarExpanded && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
        {/* Header */}
        <header className="bg-white px-8 py-4 flex items-center justify-end shadow-[0_4px_24px_rgba(0,0,0,0.02)] z-10">
          <div className="flex items-center gap-4">
            {!isOnline && (
              <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-bold border border-amber-100">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                No connection
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-3 outline-none rounded-full focus-visible:ring-2 focus-visible:ring-primary/20">
                <span className="text-slate-900 font-bold hidden sm:inline">
                  {user?.email ?? "Account"}
                </span>
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shadow-sm">
                  <User className="w-5 h-5 text-primary-foreground" />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-bold text-slate-900 truncate">{user?.email}</p>
                  <p className="text-xs text-slate-500 capitalize mt-0.5">{role ?? "—"}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate(`${rolePrefix}/settings`)}>
                  <SettingsIcon className="w-4 h-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
                  <LogOut className="w-4 h-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {/* [REF: OFFLINE_BANNER] Connection warning. The app reads and writes
              straight to the cloud, so without a connection there is nothing to
              show and nothing can be saved — say so plainly rather than letting
              screens look empty. */}
          {!isOnline && (
            <div className="bg-amber-50 border-b border-amber-200 px-8 py-2.5 flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
              <p className="text-sm text-amber-800 font-medium">
                You are offline. This app needs an internet connection — records won't load or save until you reconnect.
              </p>
            </div>
          )}
          {/* The shell (html/body and every ancestor here) is overflow-hidden;
              this wrapper is the ONE scroll container for page content, so
              anything taller than the viewport scrolls here. */}
          <div className="p-6 flex-1 overflow-y-auto min-h-0">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}