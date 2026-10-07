import { createRoot } from "react-dom/client";
import App from "@/App";
import "@/styles/index.css";
import { ConnectionProvider } from "@/lib/ConnectionProvider";
import { AuthProvider } from "@/lib/useAuth";
import { purgeLegacyOfflineStorage } from "@/lib/legacyOfflineCleanup";
import { Toaster } from "@/components/ui/sonner";

// [REF: WEB_APP_BOOTSTRAP]
purgeLegacyOfflineStorage();

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <ConnectionProvider>
      <App />
      {/* Writes now go straight to Postgres and can genuinely fail, so the
          toasts those failures raise need somewhere to render. */}
      <Toaster richColors position="top-right" />
    </ConnectionProvider>
  </AuthProvider>
);
