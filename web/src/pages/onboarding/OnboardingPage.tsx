import { FileUp, MessageCircleQuestion, PencilLine } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useSaveSettings, useSettings } from "@/api/queries";
import { TemplateGallery } from "@/components/TemplateGallery";
import { Button } from "@/components/ui/button";
import { useUrlParam } from "@/lib/use-url-state";
import { ImportFlow } from "./ImportFlow";
import { InterviewFlow } from "./InterviewFlow";

type Mode = "choose" | "import" | "interview";

export default function OnboardingPage() {
  // A real view: Back returns to the choices.
  const [mode, setMode] = useUrlParam<Mode>("mode", "choose", ["choose", "import", "interview"], { replace: false });
  const navigate = useNavigate();
  const settings = useSettings();
  const save = useSaveSettings();
  const choices = [
    {
      mode: "import" as const,
      icon: FileUp,
      title: "Import an old resume",
      text: "Upload what you have. I'll turn it into your outline and projects.",
    },
    {
      mode: "interview" as const,
      icon: MessageCircleQuestion,
      title: "Answer a few questions",
      text: "A friendly chat. I'll write down what you tell me.",
    },
  ];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold">Let's get you started</h1>
        <p className="text-muted-foreground">
          Vita keeps one honest record of your work and builds every resume from it. Pick the way that suits you.
        </p>
      </div>
      {mode === "choose" ? (
        <>
          <ul className="grid gap-4 sm:grid-cols-3">
            {choices.map((choice) => (
              <li key={choice.mode}>
                <button
                  type="button"
                  onClick={() => setMode(choice.mode)}
                  className="flex h-full w-full flex-col items-start gap-2 rounded-xl border bg-card p-5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <choice.icon className="size-6 text-primary" aria-hidden="true" />
                  <span className="font-display text-lg font-medium">{choice.title}</span>
                  <span className="text-sm text-muted-foreground">{choice.text}</span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => navigate("/me/outline")}
                className="flex h-full w-full flex-col items-start gap-2 rounded-xl border bg-card p-5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <PencilLine className="size-6 text-primary" aria-hidden="true" />
                <span className="font-display text-lg font-medium">Start writing</span>
                <span className="text-sm text-muted-foreground">
                  Go straight to your outline and write in your own words.
                </span>
              </button>
            </li>
          </ul>
          <section aria-labelledby="pick-template" className="flex flex-col gap-3">
            <h2 id="pick-template" className="font-display text-xl font-medium">
              Pick a look for your resume
            </h2>
            <p className="text-sm text-muted-foreground">You can change it any time in Settings.</p>
            <TemplateGallery
              selected={settings.data?.template}
              pending={save.isPending}
              pickLabel="Use this look"
              onPick={(template) =>
                settings.data &&
                save.mutate(
                  { models: settings.data.models, template },
                  {
                    onSuccess: () => toast.success("Template chosen."),
                    onError: (error) => toast.error(error.message),
                  },
                )
              }
            />
          </section>
          <p className="text-sm text-muted-foreground">
            Already set up?{" "}
            <Link to="/jobs" className="text-primary underline underline-offset-2">
              Skip this
            </Link>
          </p>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <Button variant="link" className="h-11 w-fit px-0" onClick={() => setMode("choose")}>
            Back to the choices
          </Button>
          <h2 className="font-display text-xl font-medium">
            {mode === "import" ? "Import an old resume" : "A few questions"}
          </h2>
          {mode === "import" ? <ImportFlow onInterview={() => setMode("interview")} /> : <InterviewFlow />}
        </div>
      )}
    </div>
  );
}
