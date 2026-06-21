import React, { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetMaterial, useListSummaries, useListFlashcardDecks, useListQuestionSets, useListExams,
  useGenerateSummary, useGenerateFlashcards, useGenerateQuestions, useGenerateExam,
  getGetMaterialQueryKey, getListSummariesQueryKey, getListFlashcardDecksQueryKey,
  getListQuestionSetsQueryKey, getListExamsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { getStoredToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ArrowLeft, BookOpen, BrainCircuit, HelpCircle, FileQuestion, MessageSquare, Loader2, ChevronRight, Sparkles, Zap, CheckCircle2, BookMarked } from "lucide-react";
import { Link } from "wouter";

function GenerateDialog({
  open, onClose, title, onGenerate, isGenerating, isRTL, children
}: { open: boolean; onClose: () => void; title: string; onGenerate: () => void; isGenerating: boolean; isRTL: boolean; children: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" />{title}</DialogTitle></DialogHeader>
        <div className="space-y-4">{children}</div>
        <Button onClick={onGenerate} disabled={isGenerating} className="w-full gap-2">
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {isGenerating ? (isRTL ? "מייצר..." : "Generating...") : (isRTL ? "צור עכשיו" : "Generate Now")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

const PROGRESS_STEPS_HE = [
  "מנתח את חומר הלימוד...",
  "מייצר סיכום מפורט...",
  "בונה כרטיסיות לימוד...",
  "מכין שאלות חידון...",
  "מסיים את ערכת הלימוד...",
];
const PROGRESS_STEPS_EN = [
  "Analyzing study material...",
  "Generating detailed summary...",
  "Building flashcard deck...",
  "Preparing quiz questions...",
  "Finishing your study kit...",
];

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

  // Generate All state
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

  // Animate progress bar & step messages while loading
  useEffect(() => {
    if (!kitLoading) {
      setProgressStep(0);
      setProgressValue(0);
      return;
    }
    // Advance step message every ~3.5 seconds
    const stepInterval = setInterval(() => {
      setProgressStep(s => Math.min(s + 1, PROGRESS_STEPS_HE.length - 1));
    }, 3500);
    // Smoothly fill bar up to 90% (the last 10% fills on success)
    const barInterval = setInterval(() => {
      setProgressValue(v => (v >= 90 ? 90 : v + 2));
    }, 600);
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
      // משתמשים בכתובת המלאה עם ה-API
      const response = await fetch("https://studyai-zhyy.onrender.com/api/materials/" + id + "/generate-all", {
  method: "POST",
  headers: { 
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}` 
  },
});

      // בדיקת תקינות התגובה
      if (!response.ok) {
        const d = await response.json();
        throw new Error(d.error || "Generation failed");
      }

      const data: KitResult = await response.json();
      
      setProgressValue(100);
      setKitResult(data);
      
      // רענון הנתונים
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListSummariesQueryKey(id) }),
        qc.invalidateQueries({ queryKey: getListFlashcardDecksQueryKey(id) }),
        qc.invalidateQueries({ queryKey: getListQuestionSetsQueryKey(id) }),
      ]);
    } catch (err: any) {
      console.error("Generate All Error:", err);
      setKitError(err.message || "Something went wrong");
    } finally {
      setKitLoading(false);
    }
  };

  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>;
  if (!material) return <p className="text-muted-foreground">Not found</p>;

  const hasContent = (material.extractedText?.length ?? 0) > 20;
  const progressSteps = isRTL ? PROGRESS_STEPS_HE : PROGRESS_STEPS_EN;

  const actions = [
    {
      label: t("generateSummary"), icon: BookOpen, color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
      onClick: () => setSummaryOpen(true), count: summaries?.length || 0, unit: isRTL ? "סיכומים" : "summaries",
    },
    {
      label: t("generateFlashcards"), icon: BrainCircuit, color: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
      onClick: () => setFlashOpen(true), count: decks?.reduce((a, d) => a + (d.cardCount || 0), 0) || 0, unit: isRTL ? "כרטיסיות" : "cards",
    },
    {
      label: t("generateQA"), icon: HelpCircle, color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      onClick: () => setQAOpen(true), count: qSets?.reduce((a, s) => a + (s.questionCount || 0), 0) || 0, unit: isRTL ? "שאלות" : "questions",
    },
    {
      label: t("generateExam"), icon: FileQuestion, color: "bg-green-500/10 text-green-600 dark:text-green-400",
      onClick: () => setExamOpen(true), count: exams?.length || 0, unit: isRTL ? "מבחנים" : "exams",
    },
  ];

  return (
    <div className="space-y-8 max-w-4xl">
      <button onClick={() => setLocation("/materials")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm">
        <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
        {isRTL ? "חזרה לחומרים" : "Back to Materials"}
      </button>

      <div>
        <div className="flex items-start gap-3">
          <h1 className="text-3xl font-bold tracking-tight flex-1">{material.title}</h1>
          <div className="flex gap-2 flex-wrap">
            <Badge variant="outline">{material.language === "he" ? "עברית" : material.language === "mixed" ? "Mixed" : "English"}</Badge>
            <Badge variant="secondary" className="capitalize">{material.contentType}</Badge>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setLocation(`/materials/${id}/chat`)}>
            <MessageSquare className="w-4 h-4" />{isRTL ? "שוחח עם המורה AI" : "Chat with AI Tutor"}
          </Button>
        </div>
      </div>

      {/* ── Generate Exam Kit ─────────────────────────────────────────── */}
      <Card className={`border-2 transition-all ${kitResult ? "border-green-400/60 bg-green-50/40 dark:bg-green-950/20" : "border-primary/30 bg-primary/5"}`}>
        <CardContent className="p-6">
          {!kitLoading && !kitResult && (
            <div className={`flex flex-col sm:flex-row items-start sm:items-center gap-4 ${isRTL ? "sm:flex-row-reverse" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-5 h-5 text-primary shrink-0" />
                  <h2 className="font-bold text-lg">{isRTL ? "צור ערכת לימוד מלאה" : "Generate Full Study Kit"}</h2>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {isRTL
                    ? "בלחיצה אחת — סיכום מפורט, 15 כרטיסיות ו-10 שאלות חידון, הכול בעברית ומוכן לשימוש מיידי"
                    : "One click — detailed summary, 15 flashcards & 10 quiz questions, all in Hebrew, ready instantly"}
                </p>
              </div>
              <Button
                size="lg"
                className="gap-2 shrink-0 shadow-md"
                onClick={handleGenerateAll}
                disabled={!hasContent}
                title={!hasContent ? (isRTL ? "אין תוכן לעיבוד" : "No content to process") : undefined}
              >
                <Zap className="w-5 h-5" />
                {isRTL ? "צור ערכת לימוד ⚡" : "Generate Study Kit ⚡"}
              </Button>
            </div>
          )}

          {kitLoading && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm" dir={isRTL ? "rtl" : "ltr"}>
                    {progressSteps[progressStep]}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isRTL ? "Groq AI עובד בשבילך — זה ייקח כ-30 שניות" : "Groq AI is working for you — takes ~30 seconds"}
                  </p>
                </div>
              </div>
              <Progress value={progressValue} className="h-2" />
              <div className={`flex gap-6 text-xs text-muted-foreground ${isRTL ? "flex-row-reverse" : ""}`}>
                {[
                  { icon: BookOpen, label: isRTL ? "סיכום" : "Summary", done: progressStep >= 2 },
                  { icon: BrainCircuit, label: isRTL ? "כרטיסיות" : "Flashcards", done: progressStep >= 3 },
                  { icon: HelpCircle, label: isRTL ? "חידון" : "Quiz", done: progressStep >= 4 },
                ].map(item => (
                  <div key={item.label} className={`flex items-center gap-1.5 transition-colors ${item.done ? "text-green-600 dark:text-green-400" : ""}`}>
                    <item.icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                    {item.done && <CheckCircle2 className="w-3 h-3" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {kitResult && !kitLoading && (
            <div className={`flex flex-col sm:flex-row items-start sm:items-center gap-5 ${isRTL ? "sm:flex-row-reverse" : ""}`}>
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-green-700 dark:text-green-400">
                  {isRTL ? "ערכת הלימוד שלך מוכנה!" : "Your study kit is ready!"}
                </p>
                <div className={`flex gap-4 mt-1.5 text-sm text-muted-foreground flex-wrap ${isRTL ? "flex-row-reverse" : ""}`}>
                  <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5 text-blue-500" />{isRTL ? `${kitResult.summary.keyPointCount} נקודות מפתח` : `${kitResult.summary.keyPointCount} key points`}</span>
                  <span className="flex items-center gap-1"><BrainCircuit className="w-3.5 h-3.5 text-purple-500" />{isRTL ? `${kitResult.deck.cardCount} כרטיסיות` : `${kitResult.deck.cardCount} flashcards`}</span>
                  <span className="flex items-center gap-1"><HelpCircle className="w-3.5 h-3.5 text-amber-500" />{isRTL ? `${kitResult.questionSet.questionCount} שאלות` : `${kitResult.questionSet.questionCount} questions`}</span>
                </div>
              </div>
              <div className={`flex gap-2 flex-wrap ${isRTL ? "flex-row-reverse" : ""}`}>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/summaries/${kitResult.summary.id}`}>
                    <BookOpen className="w-3.5 h-3.5 me-1.5" />{isRTL ? "פתח סיכום" : "Open Summary"}
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/flashcards/${kitResult.deck.id}`}>
                    <BrainCircuit className="w-3.5 h-3.5 me-1.5" />{isRTL ? "לכרטיסיות" : "Flashcards"}
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/questions/${kitResult.questionSet.id}`}>
                    <HelpCircle className="w-3.5 h-3.5 me-1.5" />{isRTL ? "לחידון" : "Quiz"}
                  </Link>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setKitResult(null); setKitError(""); }}>
                  {isRTL ? "שוב" : "Again"}
                </Button>
              </div>
            </div>
          )}

          {kitError && !kitLoading && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-destructive flex-1">{kitError}</p>
              <Button size="sm" variant="outline" onClick={handleGenerateAll}>
                {isRTL ? "נסה שוב" : "Retry"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Individual Actions ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {actions.map(a => (
          <button key={a.label} onClick={a.onClick}
            className="group p-5 rounded-xl border bg-card hover:shadow-lg transition-all text-left hover:border-primary/30">
            <div className={`w-10 h-10 rounded-lg ${a.color} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
              <a.icon className="w-5 h-5" />
            </div>
            <p className="font-semibold text-sm leading-tight">{a.label}</p>
            <p className="text-xs text-muted-foreground mt-1">{a.count} {a.unit}</p>
          </button>
        ))}
      </div>

      {/* ── Summaries ─────────────────────────────────────────────────── */}
      {(summaries?.length || 0) > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-500" />{isRTL ? "סיכומים" : "Summaries"}
          </h2>
          <div className="space-y-2">
            {summaries!.map(s => (
              <Link key={s.id} href={`/summaries/${s.id}`}>
                <Card className="cursor-pointer hover:shadow-md transition-all">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <span className="font-medium capitalize">{
                        ({ quick: isRTL ? "קצר" : "Quick", detailed: isRTL ? "מפורט" : "Detailed", key_takeaways: isRTL ? "עיקרי הדברים" : "Key Takeaways", exam_focused: isRTL ? "ממוקד מבחן" : "Exam Focused", chapter: isRTL ? "לפי פרקים" : "Chapter" } as Record<string, string>)[s.summaryType] ?? s.summaryType
                      }</span>
                      <Badge variant="outline" className="ms-2 text-xs">{s.language === "he" ? "עברית" : "English"}</Badge>
                      {s.keyPoints?.length > 0 && <Badge variant="secondary" className="ms-1.5 text-xs">{s.keyPoints.length} {isRTL ? "נקודות" : "points"}</Badge>}
                    </div>
                    <ChevronRight className={`w-4 h-4 text-muted-foreground ${isRTL ? "rotate-180" : ""}`} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Flashcard Decks ───────────────────────────────────────────── */}
      {(decks?.length || 0) > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-purple-500" />{isRTL ? "כרטיסיות" : "Flashcard Decks"}
          </h2>
          <div className="space-y-2">
            {decks!.map(d => (
              <Link key={d.id} href={`/flashcards/${d.id}`}>
                <Card className="cursor-pointer hover:shadow-md transition-all">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <span className="font-medium">{d.title}</span>
                      <span className="text-sm text-muted-foreground ms-2">{d.cardCount} {isRTL ? "כרטיסיות" : "cards"} · {d.masteredCount} {isRTL ? "שולטים" : "mastered"}</span>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-muted-foreground ${isRTL ? "rotate-180" : ""}`} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Question Sets ─────────────────────────────────────────────── */}
      {(qSets?.length || 0) > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-amber-500" />{isRTL ? "שאלות ותשובות" : "Questions & Answers"}
          </h2>
          <div className="space-y-2">
            {qSets!.map(s => (
              <Link key={s.id} href={`/questions/${s.id}`}>
                <Card className="cursor-pointer hover:shadow-md transition-all">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <span className="font-medium">{s.title}</span>
                      <span className="text-sm text-muted-foreground ms-2">{s.questionCount} {isRTL ? "שאלות" : "questions"}</span>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-muted-foreground ${isRTL ? "rotate-180" : ""}`} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Exams ────────────────────────────────────────────────────── */}
      {(exams?.length || 0) > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <FileQuestion className="w-5 h-5 text-green-500" />{isRTL ? "מבחנים" : "Exams"}
          </h2>
          <div className="space-y-2">
            {exams!.map(e => (
              <Link key={e.id} href={`/exams/${e.id}`}>
                <Card className="cursor-pointer hover:shadow-md transition-all">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <span className="font-medium">{e.title}</span>
                      <span className="text-sm text-muted-foreground ms-2">{e.questionCount} {isRTL ? "שאלות" : "questions"}</span>
                      {e.timeLimitMinutes && <Badge variant="secondary" className="ms-2 text-xs">{e.timeLimitMinutes} min</Badge>}
                    </div>
                    <ChevronRight className={`w-4 h-4 text-muted-foreground ${isRTL ? "rotate-180" : ""}`} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Generate Dialogs ─────────────────────────────────────────── */}
      <GenerateDialog open={summaryOpen} onClose={() => setSummaryOpen(false)}
        title={t("generateSummary")} isRTL={isRTL}
        isGenerating={genSummary.isPending}
        onGenerate={() => genSummary.mutate({ id, data: { summaryType, language: summaryLang } }, {
          onSuccess: () => { qc.invalidateQueries({ queryKey: getListSummariesQueryKey(id) }); setSummaryOpen(false); }
        })}>
        <div className="space-y-3">
          <div><Label>{isRTL ? "סוג סיכום" : "Summary Type"}</Label>
            <Select value={summaryType} onValueChange={setSummaryType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="quick">{isRTL ? "קצר" : "Quick"}</SelectItem>
                <SelectItem value="detailed">{isRTL ? "מפורט" : "Detailed"}</SelectItem>
                <SelectItem value="key_takeaways">{isRTL ? "עיקרי הדברים" : "Key Takeaways"}</SelectItem>
                <SelectItem value="exam_focused">{isRTL ? "ממוקד מבחן" : "Exam Focused"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>{isRTL ? "שפת הסיכום" : "Output Language"}</Label>
            <Select value={summaryLang} onValueChange={v => setSummaryLang(v as "he" | "en")}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="he">עברית</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </GenerateDialog>

      <GenerateDialog open={flashOpen} onClose={() => setFlashOpen(false)}
        title={t("generateFlashcards")} isRTL={isRTL}
        isGenerating={genFlash.isPending}
        onGenerate={() => genFlash.mutate({ id, data: { language: flashLang, cardCount: 10, cardTypes: ["qa", "definition"] } }, {
          onSuccess: () => { qc.invalidateQueries({ queryKey: getListFlashcardDecksQueryKey(id) }); setFlashOpen(false); }
        })}>
        <div><Label>{isRTL ? "שפת הכרטיסיות" : "Output Language"}</Label>
          <Select value={flashLang} onValueChange={v => setFlashLang(v as "he" | "en")}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="he">עברית</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </GenerateDialog>

      <GenerateDialog open={qaOpen} onClose={() => setQAOpen(false)}
        title={t("generateQA")} isRTL={isRTL}
        isGenerating={genQA.isPending}
        onGenerate={() => genQA.mutate({ id, data: { language: qaLang, questionCount: 5, questionTypes: ["open", "multiple_choice"], difficulty: "mixed" } }, {
          onSuccess: () => { qc.invalidateQueries({ queryKey: getListQuestionSetsQueryKey(id) }); setQAOpen(false); }
        })}>
        <div><Label>{isRTL ? "שפת השאלות" : "Output Language"}</Label>
          <Select value={qaLang} onValueChange={v => setQALang(v as "he" | "en")}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="he">עברית</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </GenerateDialog>

      <GenerateDialog open={examOpen} onClose={() => setExamOpen(false)}
        title={t("generateExam")} isRTL={isRTL}
        isGenerating={genExam.isPending}
        onGenerate={() => genExam.mutate({ id, data: { language: examLang, examType, questionCount: 10, difficulty: "mixed" } }, {
          onSuccess: (exam) => { qc.invalidateQueries({ queryKey: getListExamsQueryKey(id) }); setExamOpen(false); setLocation(`/exams/${exam.id}`); }
        })}>
        <div className="space-y-3">
          <div><Label>{isRTL ? "סוג מבחן" : "Exam Type"}</Label>
            <Select value={examType} onValueChange={setExamType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="practice">{isRTL ? "תרגול" : "Practice"}</SelectItem>
                <SelectItem value="topic_quiz">{isRTL ? "חידון נושאי" : "Topic Quiz"}</SelectItem>
                <SelectItem value="midterm">{isRTL ? "מבחן אמצע" : "Midterm"}</SelectItem>
                <SelectItem value="final">{isRTL ? "מבחן סוף" : "Final Exam"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>{isRTL ? "שפת המבחן" : "Output Language"}</Label>
            <Select value={examLang} onValueChange={v => setExamLang(v as "he" | "en")}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="he">עברית</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </GenerateDialog>
    </div>
  );
};
