import { createBrowserRouter } from "react-router";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";

export const routes = [
  { path: "/", element: <ProjectsPage /> },
  { path: "/settings", element: <SettingsPage /> },
  {
    path: "/project/:id",
    // The workspace (file tree, later editor and PDF viewer) loads only when a project is opened.
    lazy: async () => ({
      Component: (await import("./pages/ProjectPage.tsx")).ProjectPage,
    }),
  },
  { path: "*", element: <NotFoundPage /> },
];

export const createRouter = () => createBrowserRouter(routes);
