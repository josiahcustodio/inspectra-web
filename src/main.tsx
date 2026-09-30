import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import { ConnectionProvider } from "./lib/ConnectionProvider.tsx";
import { AuthProvider } from "./lib/useAuth.tsx";
import { purgeLegacyOfflineStorage } from "./lib/legacyOfflineCleanup.ts";
import { Toaster } from "./app/components/ui/sonner.tsx";

// [REF: WEB_APP_BOOTSTRAP]
purgeLegacyOfflineStorage();

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <ConnectionProvider>
      <App />
      {/* Writes now go straight to Firestore and can genuinely fail, so the
          toasts those failures raise need somewhere to render. */}
      <Toaster richColors position="top-right" />
    </ConnectionProvider>
  </AuthProvider>
);
