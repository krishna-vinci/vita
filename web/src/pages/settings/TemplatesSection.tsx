import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useSaveSettings, useSettings, useUploadTemplate } from "@/api/queries";
import { TemplateGallery } from "@/components/TemplateGallery";
import { Button } from "@/components/ui/button";
import { TemplateAdoption } from "./TemplateAdoption";

/** Installed templates, plus the upload flow for your own LaTeX. */
export function TemplatesSection() {
  const settings = useSettings();
  const save = useSaveSettings();
  const upload = useUploadTemplate();
  const picker = useRef<HTMLInputElement>(null);
  // Remembered for this tab, so a reload does not lose an upload waiting for approval.
  const [uploadId, setUploadIdState] = useState(() => {
    try {
      return sessionStorage.getItem("vita:template-upload") ?? "";
    } catch {
      return "";
    }
  });
  const setUploadId = (id: string) => {
    setUploadIdState(id);
    try {
      sessionStorage.setItem("vita:template-upload", id);
    } catch {
      /* Not remembered. */
    }
  };
  return (
    <section aria-labelledby="templates-heading" className="flex flex-col gap-4">
      <h2 id="templates-heading" className="font-display text-xl font-medium">
        Templates
      </h2>
      <p className="text-sm text-muted-foreground">
        The look of your PDF. Bring your own LaTeX template and Vita adapts it so your content fits in.
      </p>
      <TemplateGallery
        selected={settings.data?.template}
        pending={save.isPending}
        pickLabel="Use for new resumes"
        onPick={(template) =>
          settings.data &&
          save.mutate(
            { models: settings.data.models, template },
            {
              onSuccess: () => toast.success("New resumes will use this template."),
              onError: (error) => toast.error(error.message),
            },
          )
        }
      />
      {uploadId ? (
        <TemplateAdoption id={uploadId} onClose={() => setUploadId("")} />
      ) : (
        <div className="flex flex-col gap-2">
          <input
            ref={picker}
            type="file"
            accept=".tex,.zip"
            className="sr-only"
            aria-label="LaTeX template file"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                const made = await upload.mutateAsync(file);
                setUploadId(made.id);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "That file could not be used.");
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 w-fit"
            disabled={upload.isPending}
            onClick={() => picker.current?.click()}
          >
            <FileUp /> {upload.isPending ? "Checking your file…" : "Upload LaTeX template"}
          </Button>
          <p className="text-sm text-muted-foreground">
            A .tex file, or a .zip with the .tex file and its images or fonts.
          </p>
        </div>
      )}
    </section>
  );
}
