import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Establishments } from "./pages/Establishments";
import { Inspections } from "./pages/Inspections";
import { GISMap } from "./pages/GISMap";
import { Inspectors } from "./pages/Inspectors";
import { Settings } from "./pages/Settings";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: "establishments", Component: Establishments },
      { path: "inspections", Component: Inspections },
      { path: "gis-map", Component: GISMap },
      { path: "inspectors", Component: Inspectors },
      { path: "settings", Component: Settings },
    ],
  },
]);
