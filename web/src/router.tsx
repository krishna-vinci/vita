import { createBrowserRouter, Navigate } from "react-router-dom";
import AppShell from "@/layouts/AppShell";
import AuthBoundary from "@/layouts/AuthBoundary";

// Pages load on demand so the first screen stays small; the shell stays eager.
const page = (load: () => Promise<{ default: React.ComponentType<object> }>) => ({
  lazy: async () => ({ Component: (await load()).default }),
});
const scoped = (
  load: () => Promise<{ default: React.ComponentType<{ scope: "application" | "resume" }> }>,
  scope: "application" | "resume",
) => ({
  lazy: async () => {
    const Page = (await load()).default;
    return { Component: () => <Page scope={scope} /> };
  },
});
const workspace = () => import("@/pages/workspace/WorkspacePage");

export const routes = [
  { path: "/setup", ...page(() => import("@/pages/auth/SetupPage")) },
  { path: "/login", ...page(() => import("@/pages/auth/LoginPage")) },
  {
    element: <AuthBoundary />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "/", ...page(() => import("@/pages/HomeRedirect")) },
          { path: "/start", ...page(() => import("@/pages/onboarding/OnboardingPage")) },
          {
            path: "/me",
            ...page(() => import("@/pages/me/MeLayout")),
            children: [
              { index: true, element: <Navigate to="/me/outline" replace /> },
              { path: "outline", ...page(() => import("@/pages/me/OutlineTab")) },
              { path: "projects", ...page(() => import("@/pages/me/ProjectsTab")) },
              { path: "resumes", ...page(() => import("@/pages/me/ResumesTab")) },
              { path: "memory", ...page(() => import("@/pages/me/MemoryTab")) },
            ],
          },
          { path: "/me/resumes/:id", ...scoped(workspace, "resume") },
          { path: "/jobs", ...page(() => import("@/pages/JobsPage")) },
          { path: "/jobs/new", ...page(() => import("@/pages/jobs/NewJobPage")) },
          { path: "/jobs/:id", ...scoped(workspace, "application") },
          { path: "/jobs/:id/timeline", ...page(() => import("@/pages/tracker/TimelinePage")) },
          { path: "/jobs/:id/letter", ...page(() => import("@/pages/letter/LetterPage")) },
          { path: "/jobs/:id/prep", ...page(() => import("@/pages/prep/PrepPage")) },
          { path: "/settings", ...page(() => import("@/pages/SettingsPage")) },
          { path: "*", ...page(() => import("@/pages/NotFoundPage")) },
        ],
      },
    ],
  },
];
export const router = createBrowserRouter(routes);
