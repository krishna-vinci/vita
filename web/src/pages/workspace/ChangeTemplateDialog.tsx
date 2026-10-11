import { toast } from "sonner";
import { useSaveSettings, useSettings } from "@/api/queries";
import { TemplateGallery } from "@/components/TemplateGallery";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** The server sets a template per account, not per resume, so this changes the look of resumes made from now on. */
export function ChangeTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const settings = useSettings();
  const save = useSaveSettings();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Change template</DialogTitle>
          <DialogDescription>
            This sets the look for new resumes. Resumes you've already made keep theirs.
          </DialogDescription>
        </DialogHeader>
        <TemplateGallery
          selected={settings.data?.template}
          pending={save.isPending}
          pickLabel="Use this look"
          onPick={(template) =>
            settings.data &&
            save.mutate(
              { models: settings.data.models, template },
              {
                onSuccess: () => {
                  toast.success("New resumes will use this template.");
                  onOpenChange(false);
                },
                onError: (error) => toast.error(error.message),
              },
            )
          }
        />
      </DialogContent>
    </Dialog>
  );
}
