import { createBrowserRouter, Navigate } from "react-router-dom";
import AppShell from "@/layouts/AppShell";
import JobsPage from "@/pages/JobsPage";
import { JobPlaceholder, MePage, NotFoundPage } from "@/pages/Placeholders";
import SettingsPage from "@/pages/SettingsPage";

export const routes = [
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Navigate to="/me/outline" replace /> },
      { path: "/me", element: <Navigate to="/me/outline" replace /> },
      { path: "/me/outline", element: <MePage section="outline" /> },
      { path: "/me/projects", element: <MePage section="projects" /> },
      { path: "/me/resumes", element: <MePage section="resumes" /> },
      { path: "/jobs", element: <JobsPage /> },
      { path: "/jobs/new", element: <JobPlaceholder isNew /> },
      { path: "/jobs/:id", element: <JobPlaceholder /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
export const router = createBrowserRouter(routes);
