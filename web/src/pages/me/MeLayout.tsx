import { Link, Outlet, useLocation } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const tabs = [
  { value: "info", label: "My information" },
  { value: "resumes", label: "Versions" },
  { value: "memory", label: "Memory" },
  { value: "outline", label: "Outline (text)" },
  { value: "projects", label: "Projects (text)" },
] as const;

export default function MeLayout() {
  const { pathname } = useLocation();
  const current = tabs.find((tab) => pathname.startsWith(`/me/${tab.value}`))?.value ?? "info";
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold">Me</h1>
        <p className="text-muted-foreground">Your facts, ready for every next step.</p>
      </div>
      <Tabs value={current}>
        {/* On a phone the tabs scroll inside their own row, so the page itself stays the width of the screen. */}
        <TabsList className="h-11 max-w-full justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} asChild>
              <Link to={`/me/${tab.value}`}>{tab.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Outlet />
    </div>
  );
}
