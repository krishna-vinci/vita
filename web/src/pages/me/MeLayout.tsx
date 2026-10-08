import { Link, Outlet, useLocation } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const tabs = [
  { value: "outline", label: "Outline" },
  { value: "projects", label: "Projects" },
  { value: "resumes", label: "Base resumes" },
] as const;

export default function MeLayout() {
  const { pathname } = useLocation();
  const current = tabs.find((tab) => pathname.startsWith(`/me/${tab.value}`))?.value ?? "outline";
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold">Me</h1>
        <p className="text-muted-foreground">Your facts, ready for every next step.</p>
      </div>
      <Tabs value={current}>
        <TabsList className="h-11">
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
