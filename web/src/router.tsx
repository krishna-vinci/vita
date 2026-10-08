import { createBrowserRouter, Navigate } from "react-router-dom";
import AppShell from "@/layouts/AppShell";
import JobsPage from "@/pages/JobsPage";
import NewJobPage from "@/pages/jobs/NewJobPage";
import MeLayout from "@/pages/me/MeLayout";
import OutlineTab from "@/pages/me/OutlineTab";
import ProjectsTab from "@/pages/me/ProjectsTab";
import ResumesTab from "@/pages/me/ResumesTab";
import NotFoundPage from "@/pages/NotFoundPage";
import SettingsPage from "@/pages/SettingsPage";
import WorkspacePage from "@/pages/workspace/WorkspacePage";

export const routes = [
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Navigate to="/me/outline" replace /> },
      {
        path: "/me",
        element: <MeLayout />,
        children: [
          { index: true, element: <Navigate to="/me/outline" replace /> },
          { path: "outline", element: <OutlineTab /> },
          { path: "projects", element: <ProjectsTab /> },
          { path: "resumes", element: <ResumesTab /> },
        ],
      },
      { path: "/me/resumes/:id", element: <WorkspacePage scope="resume" /> },
      { path: "/jobs", element: <JobsPage /> },
      { path: "/jobs/new", element: <NewJobPage /> },
      { path: "/jobs/:id", element: <WorkspacePage scope="application" /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
export const router = createBrowserRouter(routes);
