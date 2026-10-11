import { Link } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const tabs = [
  { value: "resume", label: "Resume", to: (id: string) => `/jobs/${id}` },
  { value: "letter", label: "Cover letter", to: (id: string) => `/jobs/${id}/letter` },
  { value: "timeline", label: "Timeline", to: (id: string) => `/jobs/${id}/timeline` },
  { value: "prep", label: "Interview prep", to: (id: string) => `/jobs/${id}/prep` },
] as const;

/** The pages of one job, always one tap apart. */
export function JobTabs({ id, current }: { id: string; current: (typeof tabs)[number]["value"] }) {
  const slug = encodeURIComponent(id);
  return (
    <Tabs value={current} className="overflow-x-auto">
      <TabsList className="h-11">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} asChild>
            <Link to={tab.to(slug)}>{tab.label}</Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
