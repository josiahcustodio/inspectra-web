import { Outlet, NavLink } from "react-router";
import { useSync } from "../../lib/SyncProvider";
import { 
  LayoutDashboard, 
  Building2, 
  ClipboardCheck, 
  Map, 
  Users, 
  Settings as SettingsIcon,
  Search,
  User
} from "lucide-react";
import { Input } from "./ui/input";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/establishments", label: "Establishments", icon: Building2 },
  { path: "/inspections", label: "Inspections", icon: ClipboardCheck },
  { path: "/gis-map", label: "GIS Map", icon: Map },
  { path: "/inspectors", label: "Inspectors", icon: Users },
  { path: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Layout() {
  const { isOnline, isSyncing } = useSync();

  return (
    <div className="flex h-screen bg-[#fafafa]">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h1 className="font-bold text-[#333333]">Clowtec Admin Center</h1>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? "bg-[#f0f4ed] text-[#87A96B]"
                    : "text-[#333333] hover:bg-gray-50"
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between">
          <div className="flex-1 max-w-xl relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#999999]" />
            <Input
              type="text"
              placeholder="Search by name, ID, or barangay..."
              className="pl-10 bg-[#f3f3f5] border-none"
            />
          </div>
          <div className="flex items-center gap-4">
            {!isOnline && (
              <div className="flex items-center gap-2 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                Offline Mode
              </div>
            )}
            {isSyncing && (
              <span className="text-xs text-[#999999] animate-pulse">Syncing...</span>
            )}
            <span className="text-[#333333]">Hello, Supervisor</span>
            <div className="w-10 h-10 rounded-full bg-[#87A96B] flex items-center justify-center">
              <User className="w-5 h-5 text-white" />
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          {/* Offline Warning Banner */}
          {!isOnline && (
            <div className="bg-amber-50 border-b border-amber-200 px-8 py-2.5 flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
              <p className="text-sm text-amber-800 font-medium">
                You are offline. Data is being saved locally and will sync automatically when your connection is restored.
              </p>
            </div>
          )}
          <div className="p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}