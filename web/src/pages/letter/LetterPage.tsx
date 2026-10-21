import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import type { GenerateLetterRequest, Letter, LetterOp } from "@vita/shared";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ApiError, api } from "@/api/client";
import { queryKeys, useApplication, useJobs, useLetter } from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { SplitWithChat } from "@/components/SplitWithChat";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { download } from "@/lib/resume-view";
import { useDetails } from "@/lib/use-details";
import { useDraft } from "@/lib/use-draft";
import { ChatPanel } from "../workspace/ChatPanel";
import { JobTabs } from "../workspace/JobTabs";
import type { Message } from "../workspace/useChatThread";
import { LetterParagraph, type ParagraphActions } from "./LetterParagraph";
import { letterFlags, letterToMarkdown } from "./letter-view";

export default function LetterPage() {
  const { id = "" } = useParams();
  const app = useApplication(id);
  const letter = useLetter(id);
  const jobs = useJobs();
  const title = app.data
    ? [app.data.analysis.title, app.data.analysis.company].filter(Boolean).join(" at ")
    : "this job";
  const running = jobs.data?.find(
    (job) => job.kind === "letter" && job.resourceId === id && (job.status === "queued" || job.status === "running"),
  );
  const failed = jobs.data
    ?.filter((job) => job.kind === "letter" && job.resourceId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const missing = letter.error instanceof ApiError && letter.error.status === 404;
  return (
    <div className="flex flex-col gap-6">
      <Button variant="link" className="h-11 w-fit px-0" asChild>
        <Link to="/jobs">
          <ArrowLeft /> All jobs
        </Link>
      </Button>
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold break-words">{title}</h1>
        <JobTabs id={id} current="letter" />
      </header>
      {running ? (
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Writing your cover letter. This usually takes a minute.
        </p>
      ) : letter.isPending ? (
        <PageLoading />
      ) : missing ? (
        <GenerateForm id={id} failedMessage={failed?.status === "failed" ? failed.error : undefined} />
      ) : letter.isError ? (
        <PageError error={letter.error} retry={() => void letter.refetch()} />
      ) : (
        <LetterView id={id} resource={letter.data} />
      )}
    </div>
  );
}

function GenerateForm({ id, failedMessage }: { id: string; failedMessage?: string }) {
  const client = useQueryClient();
  const [toneText, setTone, clearTone] = useDraft(`letter:${id}:tone`, "plain");
  const [lengthText, setLength, clearLength] = useDraft(`letter:${id}:length`, "standard");
  const [notes, setNotes, clearNotes] = useDraft(`letter:${id}:notes`);
  const tone = toneText as NonNullable<GenerateLetterRequest["tone"]>;
  const length = lengthText as NonNullable<GenerateLetterRequest["length"]>;
  const [busy, setBusy] = useState(false);
  return (
    <section aria-labelledby="gen" className="flex max-w-xl flex-col gap-4 rounded-xl border bg-card p-6">
      <h2 id="gen" className="font-display text-xl font-medium">
        No cover letter yet
      </h2>
      <p className="text-muted-foreground">
        Vita writes it from the same checked facts as your resume, and never adds anything you haven't told it.
      </p>
      {failedMessage && <p className="text-sm text-destructive">The last try didn't work: {failedMessage}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="tone">Tone</Label>
          <Select value={tone} onValueChange={(value) => setTone(value as typeof tone)}>
            <SelectTrigger id="tone" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plain">Plain and direct</SelectItem>
              <SelectItem value="warm">Warm</SelectItem>
              <SelectItem value="formal">Formal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="length">Length</Label>
          <Select value={length} onValueChange={(value) => setLength(value as typeof length)}>
            <SelectTrigger id="length" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="letter-notes">Anything to mention? (optional)</Label>
        <Textarea
          id="letter-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="min-h-20"
        />
      </div>
      <Button
        className="h-11 w-fit"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.letters.generate(id, { tone, length, ...(notes.trim() ? { notes: notes.trim() } : {}) });
            clearTone();
            clearLength();
            clearNotes();
            await client.invalidateQueries({ queryKey: queryKeys.jobs });
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not start.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Write my cover letter
      </Button>
    </section>
  );
}

function LetterView({ id, resource }: { id: string; resource: NonNullable<ReturnType<typeof useLetter>["data"]> }) {
  const client = useQueryClient();
  const [details, setDetails] = useDetails();
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [messages, setMessages] = useState<(Message & { memoryProposals?: never })[]>([]);
  const [pending, setPending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [local, setLocal] = useState<string[] | null>(null);
  const { letter, review } = resource;
  const flags = useMemo(() => letterFlags(letter, review), [letter, review]);
  const ids = local ?? letter.paragraphs.map((paragraph) => paragraph.id);
  const byId = new Map(letter.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.letter(id) });
  const run = async (ops: LetterOp[]): Promise<boolean> => {
    try {
      const result = await api.letters.ops(id, { ops });
      setChanged(new Set(result.changedParagraphs));
      await refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That change didn't work.");
      return false;
    }
  };
  const send = async (message: string) => {
    setMessages((all) => [...all, { role: "user", text: message }]);
    setPending(true);
    try {
      const before = new Map(letter.paragraphs.map((paragraph) => [paragraph.id, paragraph.text]));
      const reply = await api.letters.chat(id, message);
      await refresh();
      setChanged(new Set(reply.changedParagraphs));
      setMessages((all) => [
        ...all,
        {
          role: "assistant",
          text: reply.reply,
          changes: reply.changedParagraphs.map((paragraphId) => ({
            id: paragraphId,
            before: before.get(paragraphId) ?? "",
            after: "Updated in your letter above.",
            hidden: false,
          })),
        },
      ]);
    } catch (error) {
      setMessages((all) => [
        ...all,
        { role: "error", text: error instanceof Error ? error.message : "That didn't work." },
      ]);
    } finally {
      setPending(false);
    }
  };
  const actions: ParagraphActions = {
    edit: (paragraphId, text) => run([{ op: "paragraph.edit", id: paragraphId, text }]),
    hide: (paragraphId, hidden) => void run([{ op: "paragraph.hide", id: paragraphId, hidden }]),
    move: (paragraphId, index) => void run([{ op: "move", id: paragraphId, index }]),
    ask: (message) => void send(message),
  };
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setLocal(arrayMove(ids, from, to));
    await run([{ op: "move", id: String(active.id), index: to }]);
    setLocal(null);
  };
  const exportPdf = async () => {
    setExporting(true);
    try {
      const result = await api.letters.export(id);
      const link = document.createElement("a");
      link.href = result.pdfUrl;
      link.download = "cover-letter.pdf";
      link.click();
      toast.success("Your cover letter PDF is ready.");
      await refresh();
    } catch (error) {
      toast.error(
        flags.size > 0
          ? "A few paragraphs still need your decision. Look for the highlighted ones."
          : error instanceof Error
            ? error.message
            : "The PDF could not be made.",
        { description: details && error instanceof Error ? error.message : undefined },
      );
    } finally {
      setExporting(false);
    }
  };
  return (
    <SplitWithChat
      chat={
        <ChatPanel
          messages={messages}
          pending={pending}
          onSend={(message) => void send(message)}
          intro="Here's your cover letter. Click a paragraph to edit it, or ask me for a change."
          suggestions={["Make it shorter", "Open with something warmer"]}
          className="h-full"
          draftKey={`chat:letter:${id}`}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-h-11 items-center gap-2">
            <Switch id="letter-details" checked={details} onCheckedChange={setDetails} />
            <Label htmlFor="letter-details" className="cursor-pointer text-muted-foreground">
              Show details
            </Label>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-11" disabled={exporting}>
                <Download /> {exporting ? "Getting it ready…" : "Download"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void exportPdf()}>PDF</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => download(`${id}-cover-letter.md`, "text/markdown", letterToMarkdown(letter as Letter))}
              >
                Markdown
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {flags.size > 0 && (
          <p className="text-sm text-muted-foreground">
            {flags.size} {flags.size === 1 ? "paragraph needs" : "paragraphs need"} your decision before you can
            download the PDF.
          </p>
        )}
        <article
          aria-label="Your cover letter"
          className="mx-auto flex w-full max-w-[720px] flex-col gap-3 rounded-sm bg-sheet px-5 py-7 font-resume text-[16px] leading-relaxed text-sheet-ink shadow-[0_1px_3px_rgba(0,0,0,.12),0_6px_20px_rgba(0,0,0,.06)] sm:px-10 sm:py-9"
        >
          <p>{letter.greeting}</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void onDragEnd(event)}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {ids.map((paragraphId, index) => {
                const paragraph = byId.get(paragraphId);
                return paragraph ? (
                  <LetterParagraph
                    key={paragraphId}
                    paragraph={paragraph}
                    flag={flags.get(paragraphId)}
                    index={index}
                    count={ids.length}
                    changed={changed.has(paragraphId)}
                    details={details}
                    actions={actions}
                  />
                ) : null;
              })}
            </SortableContext>
          </DndContext>
          <p>{letter.closing}</p>
          <p>{letter.signature}</p>
        </article>
      </div>
    </SplitWithChat>
  );
}
