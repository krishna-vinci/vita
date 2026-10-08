import { FileText, FolderOpen, Layers, MessageSquareText } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const sections = {
  outline: {
    title: "Your outline",
    description:
      "A place for your work, education and experience, in your own words. Start with your outline or import an old resume.",
    icon: FileText,
  },
  projects: {
    title: "Your work and evidence",
    description: "Keep the work, links and documents that support your resume here.",
    icon: FolderOpen,
  },
  resumes: {
    title: "Your base resumes",
    description:
      "Your master resume and resumes for each career direction will appear here, built from your outline and evidence.",
    icon: Layers,
  },
};
export function MePage({ section }: { section: keyof typeof sections }) {
  const { title, description, icon: Icon } = sections[section];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold">Me</h1>
        <p className="text-muted-foreground">Your facts, ready for every next step.</p>
      </div>
      <Tabs value={section}>
        <TabsList className="h-11">
          <TabsTrigger value="outline" asChild>
            <Link to="/me/outline">Outline</Link>
          </TabsTrigger>
          <TabsTrigger value="projects" asChild>
            <Link to="/me/projects">Projects</Link>
          </TabsTrigger>
          <TabsTrigger value="resumes" asChild>
            <Link to="/me/resumes">Base resumes</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Empty className="min-h-72 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
export function JobPlaceholder({ isNew = false }: { isNew?: boolean }) {
  return (
    <div className="flex flex-col gap-8">
      <Button variant="link" className="w-fit px-0" asChild>
        <Link to="/jobs">Back to jobs</Link>
      </Button>
      <h1 className="font-display text-3xl font-bold">{isNew ? "A resume for your next job" : "Your job resume"}</h1>
      <Empty className="min-h-72 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquareText />
          </EmptyMedia>
          <EmptyTitle>{isNew ? "Start with the job description" : "Review, edit and make it yours"}</EmptyTitle>
          <EmptyDescription>
            {isNew
              ? "This space will let you paste a job, answer a few questions and make a checked resume."
              : "Your checked resume, questions, editing tools and conversation will appear here."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
export function NotFoundPage() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>This page could not be found</EmptyTitle>
        <EmptyDescription>Choose Me, Jobs or Settings to continue.</EmptyDescription>
      </EmptyHeader>
      <Button asChild>
        <Link to="/me/outline">Go to Me</Link>
      </Button>
    </Empty>
  );
}
