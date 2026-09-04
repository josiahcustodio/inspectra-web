
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";
  import { SyncProvider } from "./lib/SyncProvider.tsx";
  import { AuthProvider } from "./lib/useAuth.tsx";

  createRoot(document.getElementById("root")!).render(
    <AuthProvider>
      <SyncProvider>
        <App />
      </SyncProvider>
    </AuthProvider>
  );