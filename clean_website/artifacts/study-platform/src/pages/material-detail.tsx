import React, { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetMaterial, useListSummaries, useListFlashcardDecks, useListQuestionSets, useListExams,
  useGenerateSummary, useGenerateFlashcards, useGenerateQuestions, useGenerateExam,
  useGetMaterialProgress,
  getGetMaterialQueryKey, getListSummariesQueryKey, getListFlashcardDecksQueryKey,
  getListQuestionSetsQueryKey, getListExamsQueryKey, getGetMaterialProgressQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/lib/i18n";
import { getStoredToken } from "@/lib/auth";
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
import {
  ArrowLeft, BookOpen, BrainCircuit, HelpCircle, FileQuestion, MessageSquare, Loader2,
  Sparkles, Zap, CheckCircle2, AlertCircle, Eye, Plus
} from "lucide-react";
import { Link } from "wouter";

function GenerateDialog({
  open, onClose, title, onGenerate, isGenerating, isRTL, children, progress
}: {
  open: boolean; onClose: () => void; title: string; onGenerate: () => void; isGenerating: boolean; isRTL: boolean; children: React.ReactNode;
  progress?: { currentChunk: number; totalChunks: number; percentage: number; stage: string };
}) {
  // Only the chunked path (large documents, multiple sequential Groq calls)
  // ever reports totalChunks > 0 — short materials finish in one call before
  // a poll can even land, so they just show the plain spinner below.
  const showChunkProgress = isGenerating && !!progress && progress.totalChunks > 0;
  const percent = showChunkProgress ? progress!.percentage : 0;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" />{title}</DialogTitle></DialogHeader>
        <div className="space-y-4">{children}</div>
        {showChunkProgress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>{isRTL ? `מעבד חלק ${progress!.currentChunk} מ-${progress!.totalChunks}` : `Processing chunk ${progress!.currentChunk} of ${progress!.totalChunks}`}</span>
              <span className="text-muted-foreground">{percent}%</span>
            </div>
            <Progress value={percent} className="h-2" />
          </div>
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
  icon, label, items, viewHrefBase, onAddNew, isRTL, emptyHint, disabled, disabledReason,
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

interface KitResult {
  summary: { id: number; keyPointCount: number };
  deck: { id: number; cardCount: number };
  questionSet: { id: number; questionCount: number };
}

export const MaterialDetailPage: React.FC = () => {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const { isRTL, t } = useLanguage();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

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
  const [progressValue, setProgressValue] = useState(0);

  const { data: material, isLoading } = useGetMaterial(id, { query: { enabled: !!id, queryKey: getGetMaterialQueryKey(id) } });
  const { data: summaries } = useListSummaries(id, { query: { enabled: !!id, queryKey: getListSummariesQueryKey(id) } });
  const { data: decks } = useListFlashcardDecks(id, { query: { enabled: !!id, queryKey: getListFlashcardDecksQueryKey(id) } });
  const { data: qSets } = useListQuestionSets(id, { query: { enabled: !!id, queryKey: getListQuestionSetsQueryKey(id) } });
  const { data: exams } = useListExams(id, { query: { enabled: !!id, queryKey: getListExamsQueryKey(id) } });

  const genSummary = useGenerateSummary();
  const genFlash = useGenerateFlashcards();
  const genQA = useGenerateQuestions();
  const genExam = useGenerateExam();

  // While any of the four individual generation requests is in flight, poll
  // the backend's "chunk X of Y" tracker so the dialog can show real
  // progress instead of a bare spinner during the (now strictly sequential,
  // multi-minute) chunked processing of large documents.
  const anyGenerating = genSummary.isPending || genFlash.isPending || genQA.isPending || genExam.isPending;
  const { data: generationProgress } = useGetMaterialProgress(id, {
    query: { enabled: !!id && anyGenerating, refetchInterval: anyGenerating ? 1500 : false, queryKey: getGetMaterialProgressQueryKey(id) },
  });

  useEffect(() => {
    if (!kitLoading) { setProgressStep(0); setProgressValue(0); return; }
    const stepInterval = setInterval(() => setProgressStep(s => Math.min(s + 1, PROGRESS_STEPS_HE.length - 1)), 3500);
    const barInterval = setInterval(() => setProgressValue(v => (v >= 90 ? 90 : v + 2)), 600);
    return () => { clearInterval(stepInterval); clearInterval(barInterval); };
  }, [kitLoading]);

  const handleGenerateAll = async () => {
    setKitLoading(true);
    setKitResult(null);
    setKitError("");
    setProgressStep(0);
    setProgressValue(0);

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

      if (!response.ok) throw new Error(payload.message || payload.error || `Generation failed (${response.status})`);

      if (!payload.summary || !payload.deck || !payload.questionSet) {
        throw new Error("Received an incomplete response. Please try again.");
      }

      setKitResult(payload as KitResult);
      setProgressValue(100);

      // The kit generated brand-new summary/deck/question-set rows directly
      // via a raw fetch (bypassing react-query's mutation cache), so the
      // lists rendered below won't know about them yet. Refetch everything
      // for this material so the new items + View buttons show up right away.
      qc.invalidateQueries({ queryKey: getListSummariesQueryKey(id) });
      qc.invalidateQueries({ queryKey: getListFlashcardDecksQueryKey(id) });
      qc.invalidateQueries({ queryKey: getListQuestionSetsQueryKey(id) });
      qc.invalidateQueries({ queryKey: getGetMaterialQueryKey(id) });
    } catch (err: any) {
      if (err.message && err.message.includes("insufficient_content")) {
        setKitError(isRTL
          ? "היי! חומר הלימוד קצר מדי בשביל ליצור ערכה מלאה ומדויקת. אנא הוסיפי עוד תוכן."
          : "Hey! The provided material is too short to generate a full study kit. Please provide more content to ensure accuracy."
        );
      } else {
        setKitError(err.message || (isRTL ? "אירעה שגיאה בלתי צפויה" : "An unknown error occurred"));
      }
    } finally {
      setKitLoading(false);
    }
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
      }
    );
  };

  const handleGenerateExam = () => {
    genExam.mutate(
      { id, data: { language: examLang, examType: examType as any, questionCount: 15, difficulty: "mixed" as any } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListExamsQueryKey(id) });
          qc.invalidateQueries({ queryKey: getGetMaterialQueryKey(id) });
          setExamOpen(false);
        },
      }
    );
  };

  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>;
  if (!material) return <p className="text-muted-foreground">לא נמצא</p>;

  const extractionFailed = material.status === "error";
  const hasContent = !extractionFailed && (material.extractedText?.length ?? 0) > 20;
  const canGenerateKit = hasContent && !material.tooShortForGeneration;
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
        <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => setLocation(`/materials/${id}/chat`)}>
          <MessageSquare className="w-4 h-4" />{isRTL ? "שוחח עם המורה AI" : "Chat with AI Tutor"}
        </Button>
      </div>

      <Card className={`border-2 transition-all ${kitResult ? "border-green-400/60 bg-green-50/40 dark:bg-green-950/20" : "border-primary/30 bg-primary/5"}`}>
        <CardContent className="p-6">
          {!kitLoading && !kitResult && (
            <div className={`flex flex-col sm:flex-row items-center gap-4 ${isRTL ? "sm:flex-row-reverse" : ""}`}>
              <div className="flex-1">
                <h2 className="font-bold text-lg flex items-center gap-2"><Zap className="w-5 h-5 text-primary" />{isRTL ? "צור ערכת לימוד מלאה" : "Generate Full Study Kit"}</h2>
                <p className="text-sm text-muted-foreground">{isRTL ? "סיכום, כרטיסיות ושאלות בלחיצה אחת" : "Summary, flashcards & quiz in one click"}</p>
              </div>
              {!canGenerateKit && hasContent ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button size="lg" onClick={handleGenerateAll} disabled><Zap className="w-5 h-5" />{isRTL ? "צור ערכת לימוד ⚡" : "Generate Study Kit ⚡"}</Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{isRTL ? "הטקסט קצר מדי בשביל לייצר מבחן" : "The text is too short to generate an exam"}</TooltipContent>
                </Tooltip>
              ) : (
                <Button size="lg" onClick={handleGenerateAll} disabled={!canGenerateKit}><Zap className="w-5 h-5" />{isRTL ? "צור ערכת לימוד ⚡" : "Generate Study Kit ⚡"}</Button>
              )}
            </div>
          )}
          {kitLoading && (
            <div className="space-y-4">
              <p className="font-semibold text-sm">{progressSteps[progressStep]}</p>
              <Progress value={progressValue} className="h-2" />
            </div>
          )}
          {kitResult && !kitLoading && (
            <div className="space-y-3">
              <div className="text-green-700 font-bold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />{isRTL ? "ערכת הלימוד מוכנה!" : "Your study kit is ready!"}
              </div>
              <div className={`flex flex-wrap gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
                <Link href={`/summaries/${kitResult.summary.id}`}>
                  <Button size="sm" variant="secondary" className="gap-1"><Eye className="w-4 h-4" />{isRTL ? "צפה בסיכום" : "View Summary"}</Button>
                </Link>
                <Link href={`/flashcards/${kitResult.deck.id}`}>
                  <Button size="sm" variant="secondary" className="gap-1"><Eye className="w-4 h-4" />{isRTL ? "צפה בכרטיסיות" : "View Flashcards"}</Button>
                </Link>
                <Link href={`/questions/${kitResult.questionSet.id}`}>
                  <Button size="sm" variant="secondary" className="gap-1"><Eye className="w-4 h-4" />{isRTL ? "צפה בחידון" : "View Quiz"}</Button>
                </Link>
              </div>
            </div>
          )}
          {kitError && !kitLoading && (
            <p className="text-destructive text-sm flex items-center gap-2 mt-3"><AlertCircle className="w-4 h-4 shrink-0" />{kitError}</p>
          )}
        </CardContent>
      </Card>

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
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {isRTL ? "חומר הלימוד קצר מדי כדי לייצר ממנו תוכן. הוסיפו עוד טקסט." : "This material is too short to generate content from. Please add more text."}
        </p>
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
        />
        <ContentSection
          icon={<BrainCircuit className="w-5 h-5 text-primary" />}
          label={isRTL ? "כרטיסיות לימוד" : "Flashcards"}
          items={(decks || []).map(d => ({ id: d.id, title: d.title, subtitle: d.language }))}
          viewHrefBase="/flashcards"
          onAddNew={() => setFlashOpen(true)}
          isRTL={isRTL}
          emptyHint={isRTL ? "עדיין לא נוצרה ערכת כרטיסיות לחומר זה" : "No flashcard deck generated for this material yet"}
          disabled={material.tooShortForGeneration}
          disabledReason={isRTL ? "הטקסט קצר מדי בשביל לייצר מבחן" : "The text is too short to generate an exam"}
        />
        <ContentSection
          icon={<HelpCircle className="w-5 h-5 text-primary" />}
          label={isRTL ? "שאלות תרגול" : "Practice Quiz"}
          items={(qSets || []).map(q => ({ id: q.id, title: q.title, subtitle: q.language }))}
          viewHrefBase="/questions"
          onAddNew={() => setQAOpen(true)}
          isRTL={isRTL}
          emptyHint={isRTL ? "עדיין לא נוצר חידון לחומר זה" : "No quiz generated for this material yet"}
          disabled={material.tooShortForGeneration}
          disabledReason={isRTL ? "הטקסט קצר מדי בשביל לייצר מבחן" : "The text is too short to generate an exam"}
        />
        <ContentSection
          icon={<FileQuestion className="w-5 h-5 text-primary" />}
          label={isRTL ? "מבחנים" : "Exams"}
          items={(exams || []).map(e => ({ id: e.id, title: e.title, subtitle: e.language }))}
          viewHrefBase="/exams"
          onAddNew={() => setExamOpen(true)}
          isRTL={isRTL}
          emptyHint={isRTL ? "עדיין לא נוצר מבחן לחומר זה" : "No exam generated for this material yet"}
          disabled={material.tooShortForGeneration}
          disabledReason={isRTL ? "הטקסט קצר מדי בשביל לייצר מבחן" : "The text is too short to generate an exam"}
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
        isGenerating={genExam.isPending}
        progress={generationProgress}
        isRTL={isRTL}
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
        {generationError(genExam) && <p className="text-destructive text-sm">{generationError(genExam)}</p>}
      </GenerateDialog>
    </div>
  );
};
