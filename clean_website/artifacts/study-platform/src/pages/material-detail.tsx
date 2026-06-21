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
import { getStoredToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ArrowLeft, BookOpen, BrainCircuit, HelpCircle, FileQuestion, MessageSquare, Loader2, ChevronRight, Sparkles, Zap, CheckCircle2 } from "lucide-react";
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
      const response = await fetch("https://studyai-zhyy.onrender.com/api/materials/" + id + "/generate-all", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      });

      const rawBody = await response.text();
      let payload: any;
      try {
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        throw new Error(response.status >= 500 ? "Generation timed out. The server is working hard, please try again." : "Unexpected response from server.");
      }

      if (!response.ok) throw new Error(payload.error || `Generation failed (${response.status})`);
      
      setKitResult(payload as KitResult);
      setProgressValue(100);
    } catch (err: any) {
      setKitError(err.message || "An unknown error occurred");
    } finally {
      setKitLoading(false);
    }
  };

  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>;
  if (!material) return <p className="text-muted-foreground">Not found</p>;

  const hasContent = (material.extractedText?.length ?? 0) > 20;
  const progressSteps = isRTL ? PROGRESS_STEPS_HE : PROGRESS_STEPS_EN;

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
              <Button size="lg" onClick={handleGenerateAll} disabled={!hasContent}><Zap className="w-5 h-5" />{isRTL ? "צור ערכת לימוד ⚡" : "Generate Study Kit ⚡"}</Button>
            </div>
          )}
          {kitLoading && (
            <div className="space-y-4">
              <p className="font-semibold text-sm">{progressSteps[progressStep]}</p>
              <Progress value={progressValue} className="h-2" />
            </div>
          )}
          {kitResult && !kitLoading && (
            <div className="text-green-700 font-bold">{isRTL ? "ערכת הלימוד מוכנה!" : "Your study kit is ready!"}</div>
          )}
          {kitError && !kitLoading && <p className="text-destructive text-sm">{kitError}</p>}
        </CardContent>
      </Card>
      {/* (שאר הרכיבים שלך נשארים זהים למטה כפי שהיו) */}
    </div>
  );
};
