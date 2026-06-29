import React, { useState, useEffect } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import {
  useGetMaterial, useListSummaries, useListFlashcardDecks, useListQuestionSets, useListExams,
  useGenerateSummary, useGenerateFlashcards, useGenerateQuestions,
  useGetMaterialProgress, useUpdateMaterial, useShareMaterial,
  getGetMaterialQueryKey, getListSummariesQueryKey, getListFlashcardDecksQueryKey,
  getListQuestionSetsQueryKey, getListExamsQueryKey, getGetMaterialProgressQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/lib/i18n";
import { getStoredToken, useAuth } from "@/lib/auth";
import { apiUrl } from "@/lib/api-base";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ArrowLeft, BookOpen, BrainCircuit, HelpCircle, FileQuestion, MessageSquare, Loader2,
  Sparkles, CheckCircle2, AlertCircle, Eye, Plus, CalendarClock, Timer, Share2, Copy, Check
} from "lucide-react";
import { Link } from "wouter";
import { StudyTipsCarousel } from "@/components/study-tips-carousel";
import { useSmartProgress } from "@/hooks/use-smart-progress";
import { useToast } from "@/hooks/use-toast";
import { shortContentMessage, isInsufficientContentError } from "@/lib/content-check";

function GenerateDialog({
  open, onClose, title, onGenerate, isGenerating, isRTL, children, progress, costEstimate
}: {
  open: boolean; onClose: () => void; title: string; onGenerate: () => void; isGenerating: boolean; isRTL: boolean; children: React.ReactNode;
  progress?: { currentChunk: number; totalChunks: number; percentage: number; stage: string };
  costEstimate?: number;
}) {
  // Only the chunked path (large documents, multiple sequential Groq calls)
  // ever reports totalChunks > 0 — short materials finish in one call before
  // a poll can even land, so those instead drive a simulated bar that keeps
  // creeping forward for however long the single call actually takes.
  const showChunkProgress = isGenerating && !!progress && progress.totalChunks > 0;
  const realPercent = showChunkProgress ? progress!.percentage : null;
  const percent = useSmartProgress(isGenerating, { expectedDurationMs: 20_000, realPercent });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" />{title}</DialogTitle></DialogHeader>
        <div className="space-y-4">{children}</div>
        {isGenerating && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>
                {showChunkProgress
                  ? (isRTL ? `מעבד חלק ${progress!.currentChunk} מ-${progress!.totalChunks}` : `Processing chunk ${progress!.currentChunk} of ${progress!.totalChunks}`)
                  : (isRTL ? "מייצר תוכן..." : "Generating content...")}
              </span>
              <span className="text-muted-foreground">{Math.round(percent)}%</span>
            </div>
            <Progress value={percent} active className="h-2" />
          </div>
        )}
        {!isGenerating && !!costEstimate && (
          <p className="text-xs text-muted-foreground text-center">
            {isRTL
              ? `הפעולה תעלה כ-${costEstimate.toLocaleString()} טוקנים (משוערך, בהתאם לאורך החומר)`
              : `This will cost about ${costEstimate.toLocaleString()} tokens (estimated, based on material length)`}
          </p>
        )}
        <Button onClick={onGenerate} disabled={isGenerating} className="w-full gap-2">
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {isGenerating ? (isRTL ? "מייצר..." : "Generating...") : (isRTL ? "צור עכשיו" : "Generate Now")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// Renders a row of already-generated items for one content type (summaries,
// flashcard decks, question sets, exams), each with a working "View" button
// that links straight to that item's dedicated page, plus a "+ Generate"
// button to create another one of the same type.
function ContentSection({
  icon, label, items, viewHrefBase, onAddNew, isRTL, emptyHint, disabled, disabledReason, costEstimate,
}: {
  icon: React.ReactNode;
  label: string;
  items: Array<{ id: number; title?: string | null; subtitle?: string }>;
  viewHrefBase: string;
  onAddNew: () => void;
  isRTL: boolean;
  emptyHint: string;
  disabled?: boolean;
  disabledReason?: string;
  costEstimate?: number;
}) {
  const addButton = (
    <Button size="sm" variant="outline" className="gap-1" onClick={onAddNew} disabled={disabled}>
      <Plus className="w-4 h-4" />
      {isRTL ? "צור חדש" : "Generate New"}
    </Button>
  );

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className={`flex items-center justify-between ${isRTL ? "flex-row-reverse" : ""}`}>
          <div className={`flex items-center gap-2 font-semibold ${isRTL ? "flex-row-reverse" : ""}`}>
            {icon}
            <span>{label}</span>
            {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
          </div>
          {disabled && disabledReason ? (
            <Tooltip>
              <TooltipTrigger asChild><span>{addButton}</span></TooltipTrigger>
              <TooltipContent>{disabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            addButton
          )}
        </div>

        {!disabled && !!costEstimate && (
          <p className={`text-xs text-muted-foreground ${isRTL ? "text-right" : ""}`}>
            {isRTL
              ? `יצירה נוספת תעלה כ-${costEstimate.toLocaleString()} טוקנים (משוערך)`
              : `Another generation costs about ${costEstimate.toLocaleString()} tokens (estimated)`}
          </p>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          <div className="space-y-2">
            {items.map(item => (
              <div
                key={item.id}
                className={`flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 ${isRTL ? "flex-row-reverse" : ""}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{item.title || label}</p>
                  {item.subtitle && <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>}
                </div>
                <Link href={`${viewHrefBase}/${item.id}`}>
                  <Button size="sm" variant="default" className="gap-1 shrink-0" data-testid={`button-view-${item.id}`}>
                    <Eye className="w-4 h-4" />
                    {isRTL ? "צפייה" : "View"}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const PROGRESS_STEPS_HE = ["מנתח את חומר הלימוד...", "מייצר סיכום מפורט...", "בונה כרטיסיות לימוד...", "מכין שאלות חידון...", "מסיים את ערכת הלימוד..."];
const PROGRESS_STEPS_EN = ["Analyzing study material...", "Generating detailed summary...", "Building flashcard deck...", "Preparing quiz questions...", "Finishing your study kit..."];

// Inline cost hints only, mirroring the estimates dashboard.ts already uses
// to turn a raw token balance into "X summaries/exams remaining" -- actual
// cost is dynamic (deductTokensForGeneration in tokens.ts, billed off real
// input/output size), so these are deliberately framed as estimates, not a
// flat fee. Expressed directly in whole/fractional Tokens (the same unit the
// balance widget shows), not raw cost-estimation units -- under the granular
// pricing model a single summary/flashcards/quiz generation costs roughly
// 0.3 Tokens, with exams (longer output) costing about double.
const ESTIMATED_TOKEN_COST = {
  summary: 0.3,
  flashcards: 0.3,
  quiz: 0.3,
  exam: 0.6,
} as const;

interface KitResult {
  summary?: { id: number; keyPointCount: number };
  deck?: { id: number; cardCount: number };
  questionSet?: { id: number; questionCount: number };
  partialFailure?: boolean;
}

export const MaterialDetailPage: React.FC = () => {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const { isRTL, t } = useLanguage();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  // App.tsx already swaps in <AuthPage /> for any logged-out visitor, but
  // that's a render-level gate, not a real navigation -- a deep link opened
  // while logged out would otherwise still mount this page's data hooks
  // against a private materialId. Bail out before any of that fires.
  useEffect(() => {
    if (!user) setLocation("/");
  }, [user, setLocation]);

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [flashOpen, setFlashOpen] = useState(false);
  const [qaOpen, setQAOpen] = useState(false);
  const [examOpen, setExamOpen] = useState(false);

  const [summaryType, setSummaryType] = useState("detailed");
  const [summaryLang, setSummaryLang] = useState<"he" | "en">("he");
  const [flashLang, setFlashLang] = useState<"he" | "en">("he");
  const [qaLang, setQALang] = useState<"he" | "en">("he");
  const [examLang, setExamLang] = useState<"he" | "en">("he");
  const [examType, setExamType] = useState("practice");

  const [kitLoading, setKitLoading] = useState(false);
  const [kitResult, setKitResult] = useState<KitResult | null>(null);
  const [kitError, setKitError] = useState("");
  const [progressStep, setProgressStep] = useState(0);

  // The exam route used to be a generated synchronous mutation hook
  // (useGenerateExam, expecting an immediate 201), but a chunked exam
  // routinely outlived Render's proxy timeout before that response ever
  // arrived. It's now fire-and-forget like generate-all, so it needs the
  // same manual-fetch + progress-poll handling instead of a mutation hook.
  const [examLoading, setExamLoading] = useState(false);
  const [examError, setExamError] = useState("");

  const { data: material, isLoading } = useGetMaterial(id, { query: { enabled: !!id, queryKey: getGetMaterialQueryKey(id) } });
  const { data: summaries } = useListSummaries(id, { query: { enabled: !!id, queryKey: getListSummariesQueryKey(id) } });
  const { data: decks } = useListFlashcardDecks(id, { query: { enabled: !!id, queryKey: getListFlashcardDecksQueryKey(id) } });
  const { data: qSets } = useListQuestionSets(id, { query: { enabled: !!id, queryKey: getListQuestionSetsQueryKey(id) } });
  const { data: exams } = useListExams(id, { query: { enabled: !!id, queryKey: getListExamsQueryKey(id) } });

  const genSummary = useGenerateSummary();
  const genFlash = useGenerateFlashcards();
  const genQA = useGenerateQuestions();

  const [examDatePickerOpen, setExamDatePickerOpen] = useState(false);
  const updateMaterial = useUpdateMaterial({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetMaterialQueryKey(id) }) },
  });

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const shareMaterial = useShareMaterial({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetMaterialQueryKey(id) }) },
  });

  // While any of the four individual generation requests is in flight, poll
  // the backend's "chunk X of Y" tracker so the dialog can show real
  // progress instead of a bare spinner during the (now strictly sequential,
  // multi-minute) chunked processing of large documents.
  const anyGenerating = genSummary.isPending || genFlash.isPending || genQA.isPending || examLoading || kitLoading;
  // Stays enabled even when nothing is generating locally, so a fresh mount
  // (e.g. navigating back to this page) can find out whether the backend's
  // in-memory job tracker still has an active generate-all run for this
  // material -- otherwise kitLoading (which never survives a remount) is the
  // only thing gating the poll, and a still-running job becomes invisible to
  // the UI the moment the user navigates away and back.
  const { data: generationProgress } = useGetMaterialProgress(id, {
    query: {
      enabled: !!id,
      refetchInterval: (query) => {
        const stage = query.state.data?.stage;
        const stageActive = stage === "running" || stage === "chunking" || stage === "extracting";
        return anyGenerating || stageActive ? 1500 : false;
      },
      queryKey: getGetMaterialProgressQueryKey(id),
    },
  });

  // Resumes tracking of a job that's still running on the server but whose
  // local kitLoading flag was lost (page remount). Deliberately ignores a
  // "done"/"error" stage here -- those persist in the server's in-memory
  // tracker indefinitely, and resurrecting them on every later visit would
  // wrongly re-show the "your kit is ready" card for materials whose kit
  // finished generating in some earlier session.
  useEffect(() => {
    if (kitLoading || !generationProgress) return;
    const stage = generationProgress.stage;
    if (stage === "running" || stage === "chunking" || stage === "extracting") {
      setKitLoading(true);
      setKitError("");
      if (generationProgress.result) setKitResult(prev => ({ ...prev, ...generationProgress.result }));
    }
  }, [generationProgress, kitLoading]);

  useEffect(() => {
    if (!kitLoading) { setProgressStep(0); return; }
    const stepInterval = setInterval(() => setProgressStep(s => Math.min(s + 1, PROGRESS_STEPS_HE.length - 1)), 3500);
    return () => clearInterval(stepInterval);
  }, [kitLoading]);

  // Real chunk progress (large documents only) always wins over the
  // simulation below -- but the simulation keeps the bar visibly creeping
  // forward the rest of the time, instead of freezing at a fixed number while
  // the sequential summary -> flashcards -> questions pipeline runs for
  // however many minutes it actually takes.
  const realKitPercent = generationProgress && generationProgress.totalChunks > 0 ? generationProgress.percentage : null;
  const progressValue = useSmartProgress(kitLoading, { expectedDurationMs: 45_000, realPercent: realKitPercent });

  // generate-all itself returns as soon as the background job is kicked off
  // (see handleGenerateAll) -- the actual outcome lands here, via the same
  // GET /materials/:id/progress poll used for chunk progress above, once the
  // background pipeline writes a terminal "done"/"error" entry.
  useEffect(() => {
    if (!kitLoading || !generationProgress) return;
    // Each stage (summary, then flashcards, then questions) lands in `result`
    // as soon as its own DB rows are committed -- merge it in the moment it
    // shows up so e.g. "View Summary" goes live while flashcards/quiz are
    // still generating, instead of waiting for the whole job to finish.
    if (generationProgress.result) {
      setKitResult(prev => ({ ...prev, ...generationProgress.result }));
      qc.invalidateQueries({ queryKey: getListSummariesQueryKey(id) });
      qc.invalidateQueries({ queryKey: getListFlashcardDecksQueryKey(id) });
      qc.invalidateQueries({ queryKey: getListQuestionSetsQueryKey(id) });
      qc.invalidateQueries({ queryKey: getGetMaterialQueryKey(id) });
    }
    if (generationProgress.stage === "done") {
      setKitLoading(false);
    } else if (generationProgress.stage === "error") {
      setKitError(generationProgress.error || (isRTL ? "אירעה שגיאה בלתי צפויה" : "An unknown error occurred"));
      setKitLoading(false);
    }
  }, [generationProgress, kitLoading, id, qc, isRTL]);

  // Same poll, same "done"/"error" terminal-stage handling as the kit's
  // effect above, but for the standalone exam job -- it shares the same
  // backend progress slot (keyed by materialId), so this is gated on
  // examLoading specifically to avoid stepping on a concurrent kit run's
  // result handling above.
  useEffect(() => {
    if (!examLoading || !generationProgress) return;
    if (generationProgress.stage === "done" && generationProgress.result?.exam) {
      qc.invalidateQueries({ queryKey: getListExamsQueryKey(id) });
      qc.invalidateQueries({ queryKey: getGetMaterialQueryKey(id) });
      setExamOpen(false);
      setExamLoading(false);
    } else if (generationProgress.stage === "error") {
      setExamError(generationProgress.error || (isRTL ? "אירעה שגיאה בלתי צפויה" : "An unknown error occurred"));
      setExamLoading(false);
    }
  }, [generationProgress, examLoading, id, qc, isRTL]);

  const handleGenerateAll = async () => {
    setKitLoading(true);
    setKitResult(null);
    setKitError("");
    setProgressStep(0);

    try {
      const token = getStoredToken();
      const targetUrl = apiUrl(`/api/materials/${id}/generate-all`);

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
      });

      const rawBody = await response.text();
      let payload: any;
      try {
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        throw new Error(response.status >= 500 ? "Generation timed out. The server is working hard, please try again." : "Unexpected response from server.");
      }

      if (!response.ok) {
        if (isInsufficientContentError(payload)) {
          toast({ description: shortContentMessage(isRTL), variant: "destructive" });
          setKitLoading(false);
          return;
        }
        throw new Error(payload.message || payload.error || `Generation failed (${response.status})`);
      }

      // 202 just confirms the background job started -- it carries no
      // summary/deck/questionSet yet. The actual result (or failure) shows
      // up via the generationProgress poll effect above once the pipeline
      // finishes, since Render's proxy would 502 long before this request
      // could ever wait for that itself. kitLoading stays true until then.
    } catch (err: any) {
      setKitError(err.message || (isRTL ? "אירעה שגיאה בלתי צפויה" : "An unknown error occurred"));
      setKitLoading(false);
    }
  };

  // Every upload path (text, PDF, YouTube, URL, image, audio, video) lands
  // here with ?autogen=1 right after material-new.tsx creates the material
  // -- this fires the exact same generate-all pipeline the manual "Generate
  // Study Kit" button below triggers, so a fresh upload gets an instant kit
  // with zero extra clicks, matching the voice recorder's behavior. Stripped
  // from the URL immediately so a refresh or back-nav never re-fires it, and
  // gated on `material` being loaded since the counts/tooShortForGeneration
  // checks below need real data, not the undefined first render.
  useEffect(() => {
    if (!search.includes("autogen=1") || !material) return;
    setLocation(`/materials/${id}`, { replace: true });

    const hasContent = material.status !== "error" && (material.extractedText?.length ?? 0) > 20;
    const alreadyHasKit = (material.summaryCount ?? 0) > 0 || (material.deckCount ?? 0) > 0 || (material.qSetCount ?? 0) > 0;
    if (hasContent && !material.tooShortForGeneration && !alreadyHasKit && !kitLoading) {
      handleGenerateAll();
    }
  }, [search, material]);

  // A genuinely-too-short document (no vocabulary-list structure to bypass
  // the backend's floor -- see api-server's looksLikeVocabularyList) surfaces
  // here as a 400 "insufficient_content" error. Shown as a friendly toast
  // bubble instead of the raw backend error/message, which other failures
  // still fall back to via each dialog's inline generationError() text.
  const notifyIfInsufficientContent = (err: any): boolean => {
    if (!isInsufficientContentError(err?.response?.data)) return false;
    toast({ description: shortContentMessage(isRTL), variant: "destructive" });
    return true;
  };

  const handleGenerateSummary = () => {
    genSummary.mutate(
      { id, data: { summaryType: summaryType as any, language: summaryLang } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListSummariesQueryKey(id) });
          qc.invalidateQueries({ queryKey: getGetMaterialQueryKey(id) });
          setSummaryOpen(false);
        },
        onError: notifyIfInsufficientContent,
      }
    );
  };

  const handleGenerateFlashcards = () => {
    genFlash.mutate(
      { id, data: { language: flashLang, cardCount: 12, cardTypes: ["definition", "qa", "formula", "concept"] as any } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListFlashcardDecksQueryKey(id) });
          qc.invalidateQueries({ queryKey: getGetMaterialQueryKey(id) });
          setFlashOpen(false);
        },
        onError: notifyIfInsufficientContent,
      }
    );
  };

  // This is the quiz-generation trigger that was previously missing from
  // the UI entirely: useGenerateQuestions() was wired up but never called
  // from anywhere, so requesting a quiz silently did nothing. The dialog
  // below + this handler is the fix.
  const handleGenerateQuestions = () => {
    genQA.mutate(
      { id, data: { language: qaLang, questionCount: 8, questionTypes: ["multiple_choice", "true_false", "open"] as any, difficulty: "mixed" as any } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListQuestionSetsQueryKey(id) });
          qc.invalidateQueries({ queryKey: getGetMaterialQueryKey(id) });
          setQAOpen(false);
        },
        onError: notifyIfInsufficientContent,
      }
    );
  };

  const handleGenerateExam = async () => {
    setExamLoading(true);
    setExamError("");

    try {
      const token = getStoredToken();
      const response = await fetch(apiUrl(`/api/materials/${id}/exams`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ language: examLang, examType, questionCount: 15, difficulty: "mixed" }),
      });

      const rawBody = await response.text();
      let payload: any;
      try {
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        throw new Error(response.status >= 500 ? "Generation timed out. The server is working hard, please try again." : "Unexpected response from server.");
      }

      if (!response.ok) {
        if (isInsufficientContentError(payload)) {
          toast({ description: shortContentMessage(isRTL), variant: "destructive" });
          setExamLoading(false);
          return;
        }
        throw new Error(payload.message || payload.error || `Generation failed (${response.status})`);
      }

      // 202 just confirms the background job started -- the actual exam (or
      // failure) shows up via the generationProgress poll effect above once
      // the background job writes a terminal "done"/"error" entry.
    } catch (err: any) {
      setExamError(err.message || (isRTL ? "אירעה שגיאה בלתי צפויה" : "An unknown error occurred"));
      setExamLoading(false);
    }
  };

  if (!user) return null;
  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>;
  // The API scopes every material lookup to the requesting user's own rows
  // (WHERE id = ? AND userId = ?), so a 404/null response here is returned
  // identically whether the material never existed or simply belongs to
  // someone else -- there's no separate signal to distinguish the two, and
  // there shouldn't be, since confirming "it exists but isn't yours" would
  // leak more to a non-owner than a generic not-found ever should.
  if (!material) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <AlertCircle className="w-10 h-10 text-muted-foreground" />
        <p className="text-muted-foreground">
          {isRTL ? "החומר לא נמצא או שאין לך הרשאה לצפות בו" : "This material doesn't exist or you don't have permission to view it"}
        </p>
        <Button variant="outline" onClick={() => setLocation("/")}>
          {isRTL ? "חזרה לדף הבית" : "Back to home"}
        </Button>
      </div>
    );
  }

  const extractionFailed = material.status === "error";
  const hasContent = !extractionFailed && (material.extractedText?.length ?? 0) > 20;
  // On failure the extractor stores a "[Extraction failed: ...]" placeholder
  // as extractedText (there's no separate persisted error-message column) —
  // strip the brackets/prefix back off so the banner reads like a message
  // instead of raw internal formatting.
  const extractionErrorDetail = extractionFailed
    ? (material.extractedText || "").replace(/^\[Extraction failed:\s*/, "").replace(/\]$/, "")
    : "";
  const progressSteps = isRTL ? PROGRESS_STEPS_HE : PROGRESS_STEPS_EN;

  const generationError = (mutation: { error: unknown }) => {
    const err: any = mutation.error;
    if (!err) return null;
    const msg = err?.response?.data?.message || err?.response?.data?.error || err?.message;
    return msg ? String(msg) : (isRTL ? "אירעה שגיאה. נסו שוב." : "Something went wrong. Please try again.");
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <button onClick={() => setLocation("/materials")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm">
        <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} /> {isRTL ? "חזרה לחומרים" : "Back to Materials"}
      </button>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">{material.title}</h1>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setLocation(`/materials/${id}/chat`)}>
            <MessageSquare className="w-4 h-4" />{isRTL ? "שוחח עם המורה AI" : "Chat with AI Tutor"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={shareMaterial.isPending}
            onClick={() => {
              if (material.shareId) {
                setShareDialogOpen(true);
              } else {
                shareMaterial.mutate({ id }, { onSuccess: () => setShareDialogOpen(true) });
              }
            }}
          >
            {shareMaterial.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
            {isRTL ? "שיתוף ערכת לימוד" : "Share with Class"}
          </Button>
        </div>
      </div>

      <Card className={`border transition-all ${material.cramMode && material.examDate ? "border-amber-400/60 bg-amber-50/40 dark:bg-amber-950/20" : "border-white/30 dark:border-white/10 bg-white/50 dark:bg-slate-900/40"}`}>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Timer className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-sm">{isRTL ? "מצב מרתון" : "Cram Mode"}</p>
                <p className="text-xs text-muted-foreground">
                  {isRTL
                    ? "לקראת מבחן קרוב? סקירה אינטנסיבית של הכרטיסיות עד תאריך המבחן"
                    : "Studying for an exam soon? Intensive flashcard review until your exam date"}
                </p>
              </div>
            </div>
            <Switch
              checked={!!material.cramMode}
              onCheckedChange={(checked) => updateMaterial.mutate({ id, data: { cramMode: checked } })}
            />
          </div>

          {material.cramMode && (
            <div className={`flex flex-wrap items-center gap-3 pt-1 ${isRTL ? "flex-row-reverse" : ""}`}>
              <Popover open={examDatePickerOpen} onOpenChange={setExamDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <CalendarClock className="w-4 h-4" />
                    {material.examDate
                      ? new Date(material.examDate).toLocaleDateString(isRTL ? "he-IL" : "en-US")
                      : (isRTL ? "בחר תאריך מבחן" : "Set exam date")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align={isRTL ? "end" : "start"} className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={material.examDate ? new Date(material.examDate) : undefined}
                    onSelect={(date) => {
                      if (!date) return;
                      updateMaterial.mutate({ id, data: { examDate: date.toISOString() } });
                      setExamDatePickerOpen(false);
                    }}
                    disabled={{ before: new Date() }}
                  />
                </PopoverContent>
              </Popover>

              {material.examDate && (() => {
                const examTime = new Date(material.examDate).getTime();
                const isFuture = examTime > Date.now();
                const daysLeft = Math.max(0, Math.ceil((examTime - Date.now()) / 86400000));
                return (
                  <Badge variant="outline" className="gap-1.5 text-amber-700 dark:text-amber-400 border-amber-400/50">
                    {isFuture
                      ? (isRTL ? `המבחן בעוד ${daysLeft} ימים — מצב מרתון פעיל` : `Exam in ${daysLeft} days — Cram Mode active`)
                      : (isRTL ? "תאריך המבחן עבר" : "Exam date has passed")}
                  </Badge>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* The one-click "Generate Study Kit" trigger is gone -- generation now
          fires automatically right after upload (see the ?autogen=1 effect
          above), and once a kit exists, per-section "Generate More" buttons
          inside the summary/flashcards/quiz views are how students add to it.
          This card now only ever shows the auto-triggered run's progress/
          result/error -- never a redundant manual prompt -- so it disappears
          entirely once there's nothing in flight to report. */}
      {(kitLoading || kitResult || kitError) && (
      <Card className={`border-2 transition-all ${kitResult ? "border-green-400/60 bg-green-50/40 dark:bg-green-950/20" : "border-primary/30 bg-primary/5"}`}>
        <CardContent className="p-6">
          {kitLoading && (
            <div className="space-y-4">
              {/* Summary lands first and stays visible the instant its stage
                  finishes persisting, while flashcards/quiz show a pending
                  chip until their own stage completes -- the user can start
                  reading instead of staring at a frozen page. */}
              {(kitResult?.summary || kitResult?.deck || kitResult?.questionSet) && (
                <div className={`flex flex-wrap gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
                  {kitResult?.summary && (
                    <Link href={`/summaries/${kitResult.summary.id}`}>
                      <Button size="sm" variant="secondary" className="gap-1"><Eye className="w-4 h-4" />{isRTL ? "צפה בסיכום" : "View Summary"}</Button>
                    </Link>
                  )}
                  {kitResult?.deck ? (
                    <Link href={`/flashcards/${kitResult.deck.id}`}>
                      <Button size="sm" variant="secondary" className="gap-1"><Eye className="w-4 h-4" />{isRTL ? "צפה בכרטיסיות" : "View Flashcards"}</Button>
                    </Link>
                  ) : (
                    <Badge variant="outline" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" />{isRTL ? "כרטיסיות בהכנה..." : "Flashcards generating..."}</Badge>
                  )}
                  {kitResult?.questionSet ? (
                    <Link href={`/questions/${kitResult.questionSet.id}`}>
                      <Button size="sm" variant="secondary" className="gap-1"><Eye className="w-4 h-4" />{isRTL ? "צפה בחידון" : "View Quiz"}</Button>
                    </Link>
                  ) : (
                    <Badge variant="outline" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" />{isRTL ? "חידון בהכנה..." : "Quiz generating..."}</Badge>
                  )}
                </div>
              )}
              <div className={`flex items-center justify-between text-sm ${isRTL ? "flex-row-reverse" : ""}`}>
                <span className="font-semibold">
                  {realKitPercent != null
                    ? (isRTL
                        ? `עיבוד: חלק ${generationProgress!.currentChunk} מתוך ${generationProgress!.totalChunks}...`
                        : `Processing: chunk ${generationProgress!.currentChunk} of ${generationProgress!.totalChunks}...`)
                    : progressSteps[progressStep]}
                </span>
                <span className="text-muted-foreground">{Math.round(progressValue)}%</span>
              </div>
              <Progress value={progressValue} active className="h-2" />
              <StudyTipsCarousel isRTL={isRTL} />
            </div>
          )}
          {kitResult && !kitLoading && (
            <div className="space-y-3">
              <div className="text-green-700 font-bold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />{isRTL ? "ערכת הלימוד מוכנה!" : "Your study kit is ready!"}
              </div>
              {(kitResult.partialFailure || (kitResult.deck?.cardCount === 0 && kitResult.questionSet?.questionCount === 0)) && (
                <p className="text-amber-700 text-sm flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {isRTL
                    ? "חלק מהחומר לא עובד בהצלחה (לדוגמה עומס זמני על השירות) — חלק מהסיכום, הכרטיסיות או החידון עשויים להיות חסרים. נסו להריץ יצירה מחדש בעוד כמה דקות."
                    : "Part of the material couldn't be processed (e.g. a temporary service overload) — some of the summary, flashcards, or quiz may be missing. Try generating again in a few minutes."}
                </p>
              )}
              <div className={`flex flex-wrap gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
                {kitResult.summary && (
                  <Link href={`/summaries/${kitResult.summary.id}`}>
                    <Button size="sm" variant="secondary" className="gap-1"><Eye className="w-4 h-4" />{isRTL ? "צפה בסיכום" : "View Summary"}</Button>
                  </Link>
                )}
                {kitResult.deck && (
                  <Link href={`/flashcards/${kitResult.deck.id}`}>
                    <Button size="sm" variant="secondary" className="gap-1"><Eye className="w-4 h-4" />{isRTL ? "צפה בכרטיסיות" : "View Flashcards"}</Button>
                  </Link>
                )}
                {kitResult.questionSet && (
                  <Link href={`/questions/${kitResult.questionSet.id}`}>
                    <Button size="sm" variant="secondary" className="gap-1"><Eye className="w-4 h-4" />{isRTL ? "צפה בחידון" : "View Quiz"}</Button>
                  </Link>
                )}
              </div>
            </div>
          )}
          {kitError && !kitLoading && (
            <p className="text-destructive text-sm flex items-center gap-2 mt-3"><AlertCircle className="w-4 h-4 shrink-0" />{kitError}</p>
          )}
        </CardContent>
      </Card>
      )}

      {extractionFailed ? (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">{isRTL ? "חילוץ התוכן נכשל" : "Content extraction failed"}</p>
            <p className="text-muted-foreground">
              {extractionErrorDetail || (isRTL ? "אירעה שגיאה בלתי צפויה. נסו להעלות את החומר מחדש." : "An unexpected error occurred. Try re-uploading this material.")}
            </p>
          </div>
        </div>
      ) : !hasContent && (
        <div className="flex items-center gap-2.5 text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-4 py-3 rounded-lg animate-in fade-in slide-in-from-top-1 duration-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p>{isRTL ? "חומר הלימוד קצר מדי כדי לייצר ממנו תוכן. הוסיפו עוד טקסט." : "This material is too short to generate content from. Please add more text."}</p>
        </div>
      )}

      <div className="grid gap-4">
        <ContentSection
          icon={<BookOpen className="w-5 h-5 text-primary" />}
          label={isRTL ? "סיכומים" : "Summaries"}
          items={(summaries || []).map(s => ({ id: s.id, title: s.summaryType, subtitle: s.language }))}
          viewHrefBase="/summaries"
          onAddNew={() => setSummaryOpen(true)}
          isRTL={isRTL}
          emptyHint={isRTL ? "עדיין לא נוצר סיכום לחומר זה" : "No summary generated for this material yet"}
          costEstimate={ESTIMATED_TOKEN_COST.summary}
        />
        <ContentSection
          icon={<BrainCircuit className="w-5 h-5 text-primary" />}
          label={isRTL ? "כרטיסיות לימוד" : "Flashcards"}
          items={(decks || []).map(d => ({ id: d.id, title: d.title, subtitle: d.language }))}
          viewHrefBase="/flashcards"
          onAddNew={() => setFlashOpen(true)}
          isRTL={isRTL}
          emptyHint={isRTL ? "עדיין לא נוצרה ערכת כרטיסיות לחומר זה" : "No flashcard deck generated for this material yet"}
          costEstimate={ESTIMATED_TOKEN_COST.flashcards}
        />
        <ContentSection
          icon={<HelpCircle className="w-5 h-5 text-primary" />}
          label={isRTL ? "שאלות תרגול" : "Practice Quiz"}
          items={(qSets || []).map(q => ({ id: q.id, title: q.title, subtitle: q.language }))}
          viewHrefBase="/questions"
          onAddNew={() => setQAOpen(true)}
          isRTL={isRTL}
          emptyHint={isRTL ? "עדיין לא נוצר חידון לחומר זה" : "No quiz generated for this material yet"}
          costEstimate={ESTIMATED_TOKEN_COST.quiz}
        />
        <ContentSection
          icon={<FileQuestion className="w-5 h-5 text-primary" />}
          label={isRTL ? "מבחנים" : "Exams"}
          items={(exams || []).map(e => ({ id: e.id, title: e.title, subtitle: e.language }))}
          viewHrefBase="/exams"
          onAddNew={() => setExamOpen(true)}
          isRTL={isRTL}
          emptyHint={isRTL ? "עדיין לא נוצר מבחן לחומר זה" : "No exam generated for this material yet"}
          costEstimate={ESTIMATED_TOKEN_COST.exam}
        />
      </div>

      <GenerateDialog
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        title={isRTL ? "צור סיכום" : "Generate Summary"}
        onGenerate={handleGenerateSummary}
        isGenerating={genSummary.isPending}
        progress={generationProgress}
        isRTL={isRTL}
        costEstimate={ESTIMATED_TOKEN_COST.summary}
      >
        <div className="space-y-2">
          <Label>{isRTL ? "סוג סיכום" : "Summary Type"}</Label>
          <Select value={summaryType} onValueChange={setSummaryType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="quick">{isRTL ? "סיכום קצר" : "Quick"}</SelectItem>
              <SelectItem value="detailed">{isRTL ? "סיכום מפורט" : "Detailed"}</SelectItem>
              <SelectItem value="chapter">{isRTL ? "לפי פרקים" : "Chapter-by-chapter"}</SelectItem>
              <SelectItem value="key_takeaways">{isRTL ? "עיקרי הדברים" : "Key Takeaways"}</SelectItem>
              <SelectItem value="exam_focused">{isRTL ? "ממוקד מבחן" : "Exam-Focused"}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{isRTL ? "שפה" : "Language"}</Label>
          <Select value={summaryLang} onValueChange={v => setSummaryLang(v as "he" | "en")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="he">עברית</SelectItem>
              <SelectItem value="en">אנגלית</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {generationError(genSummary) && <p className="text-destructive text-sm">{generationError(genSummary)}</p>}
      </GenerateDialog>

      <GenerateDialog
        open={flashOpen}
        onClose={() => setFlashOpen(false)}
        title={isRTL ? "צור כרטיסיות לימוד" : "Generate Flashcards"}
        onGenerate={handleGenerateFlashcards}
        isGenerating={genFlash.isPending}
        progress={generationProgress}
        isRTL={isRTL}
        costEstimate={ESTIMATED_TOKEN_COST.flashcards}
      >
        <div className="space-y-2">
          <Label>{isRTL ? "שפה" : "Language"}</Label>
          <Select value={flashLang} onValueChange={v => setFlashLang(v as "he" | "en")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="he">עברית</SelectItem>
              <SelectItem value="en">אנגלית</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {generationError(genFlash) && <p className="text-destructive text-sm">{generationError(genFlash)}</p>}
      </GenerateDialog>

      <GenerateDialog
        open={qaOpen}
        onClose={() => setQAOpen(false)}
        title={isRTL ? "צור שאלות תרגול" : "Generate Quiz"}
        onGenerate={handleGenerateQuestions}
        isGenerating={genQA.isPending}
        progress={generationProgress}
        isRTL={isRTL}
        costEstimate={ESTIMATED_TOKEN_COST.quiz}
      >
        <div className="space-y-2">
          <Label>{isRTL ? "שפה" : "Language"}</Label>
          <Select value={qaLang} onValueChange={v => setQALang(v as "he" | "en")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="he">עברית</SelectItem>
              <SelectItem value="en">אנגלית</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {generationError(genQA) && <p className="text-destructive text-sm">{generationError(genQA)}</p>}
      </GenerateDialog>

      <GenerateDialog
        open={examOpen}
        onClose={() => setExamOpen(false)}
        title={isRTL ? "צור מבחן" : "Generate Exam"}
        onGenerate={handleGenerateExam}
        isGenerating={examLoading}
        progress={generationProgress}
        isRTL={isRTL}
        costEstimate={ESTIMATED_TOKEN_COST.exam}
      >
        <div className="space-y-2">
          <Label>{isRTL ? "סוג מבחן" : "Exam Type"}</Label>
          <Select value={examType} onValueChange={setExamType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="practice">{isRTL ? "תרגול" : "Practice"}</SelectItem>
              <SelectItem value="topic_quiz">{isRTL ? "חידון נושאי" : "Topic Quiz"}</SelectItem>
              <SelectItem value="midterm">{isRTL ? "מבחן אמצע" : "Midterm"}</SelectItem>
              <SelectItem value="final">{isRTL ? "מבחן גמר" : "Final"}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{isRTL ? "שפה" : "Language"}</Label>
          <Select value={examLang} onValueChange={v => setExamLang(v as "he" | "en")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="he">עברית</SelectItem>
              <SelectItem value="en">אנגלית</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {examError && <p className="text-destructive text-sm">{examError}</p>}
      </GenerateDialog>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="w-5 h-5 text-primary" />
              {isRTL ? "שיתוף ערכת לימוד" : "Share Study Kit"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground" dir={isRTL ? "rtl" : "ltr"}>
            {isRTL
              ? "כל מי שיש לו את הקישור יכול לצפות בסיכום ולתרגל את הכרטיסיות, בלי צורך בהתחברות."
              : "Anyone with this link can view the summary and practice the flashcards, no login required."}
          </p>
          {material.shareId && (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={`${window.location.origin}/shared/${material.shareId}`}
                onFocus={e => e.currentTarget.select()}
                className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono"
                dir="ltr"
              />
              <Button
                size="sm"
                variant="secondary"
                className="gap-2 shrink-0"
                onClick={async () => {
                  await navigator.clipboard.writeText(`${window.location.origin}/shared/${material.shareId}`);
                  setLinkCopied(true);
                  toast({ description: isRTL ? "הקישור הועתק" : "Link copied" });
                  setTimeout(() => setLinkCopied(false), 2000);
                }}
              >
                {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {isRTL ? "העתק" : "Copy"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
