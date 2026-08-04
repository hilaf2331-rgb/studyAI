import React, { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetMarathon, useUpdateMarathonMaterial, getGetMarathonQueryKey,
  useListSummaries, useGenerateSummary, getListSummariesQueryKey,
  useListFlashcardDecks, useGetFlashcardDeck, useReviewFlashcard, getGetFlashcardDeckQueryKey,
  useListQuestionSets, useGetQuestionSet, getGetQuestionSetQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryMarkdown } from "@/components/summary-markdown";
import { Flame, Loader2, CheckCircle2, BookOpen, BrainCircuit, HelpCircle, ArrowLeft, Timer } from "lucide-react";

type Phase = "summary" | "flashcards" | "quiz";

const STATUS_TO_PHASE: Record<string, Phase> = {
  pending: "summary",
  summary_done: "flashcards",
  flashcards_done: "quiz",
};

const REVIEW_BUTTON_COLORS: Record<"again" | "hard" | "good" | "easy", string> = {
  again: "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-400",
  hard: "bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-950 dark:text-orange-400",
  good: "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-400",
  easy: "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-950 dark:text-green-400",
};

// The exam-focused summary step -- generates it on the fly the first time a
// material reaches this step in a marathon (reusing the same /summaries
// endpoint the material-detail page's "Generate" dropdown calls), then shows
// it exactly like summary-view.tsx does.
const MarathonSummaryPhase: React.FC<{ materialId: number; onDone: () => void }> = ({ materialId, onDone }) => {
  const { isRTL } = useLanguage();
  const qc = useQueryClient();
  const { data: summaries, isLoading } = useListSummaries(materialId);
  const generateSummary = useGenerateSummary();

  const examFocused = summaries?.find(s => s.summaryType === "exam_focused");

  useEffect(() => {
    if (!isLoading && !examFocused && !generateSummary.isPending && !generateSummary.isSuccess) {
      generateSummary.mutate(
        { id: materialId, data: { summaryType: "exam_focused", language: "he" } },
        { onSuccess: () => qc.invalidateQueries({ queryKey: getListSummariesQueryKey(materialId) }) },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId, isLoading, examFocused]);

  if (isLoading || (!examFocused && (generateSummary.isPending || !generateSummary.isError))) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          {isRTL ? "מזקק סיכום ממוקד מבחן..." : "Distilling an exam-focused summary..."}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!examFocused) {
    return <p className="text-sm text-destructive">{isRTL ? "לא הצלחנו ליצור סיכום עבור החומר הזה." : "Couldn't generate a summary for this material."}</p>;
  }

  return (
    <div className="space-y-4">
      {examFocused.keyPoints && examFocused.keyPoints.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-5">
            <h2 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">
              {isRTL ? "✦ נקודות מפתח לבחינה" : "✦ Key Points for the Exam"}
            </h2>
            <ul className="space-y-2">
              {examFocused.keyPoints.map((point, i) => (
                <li key={i} className="flex items-start gap-2 flex-row-reverse text-right">
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  <span className="text-sm leading-relaxed">{point}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card><CardContent className="p-6"><SummaryMarkdown content={examFocused.content} isHebrew /></CardContent></Card>
      <Button size="lg" className="w-full gap-2" onClick={onDone}>
        {isRTL ? "המשך לכרטיסיות" : "Continue to Flashcards"}
      </Button>
    </div>
  );
};

// Flashcard review step -- same flip-card SRS interaction as flashcard-
// study.tsx, trimmed of the editing UI (out of scope for a cram run) and
// scoped to the material's first deck.
const MarathonFlashcardsPhase: React.FC<{ materialId: number; onDone: () => void }> = ({ materialId, onDone }) => {
  const { isRTL } = useLanguage();
  const { data: decks, isLoading: decksLoading } = useListFlashcardDecks(materialId);
  const deckId = decks?.[0]?.id;
  const { data: deck, isLoading: deckLoading } = useGetFlashcardDeck(deckId!, { query: { enabled: !!deckId, queryKey: getGetFlashcardDeckQueryKey(deckId!) } });
  const reviewCard = useReviewFlashcard();

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [cards, setCards] = useState<NonNullable<typeof deck>["cards"] | null>(null);
  const initializedDeckId = useRef<number | null>(null);

  useEffect(() => {
    if (deck?.cards?.length && initializedDeckId.current !== deck.id) {
      setCards(deck.cards);
      initializedDeckId.current = deck.id;
      setIndex(0);
      setFlipped(false);
    }
  }, [deck]);

  if (decksLoading || deckLoading || !cards) {
    return <div className="space-y-4">{[1, 2].map(i => <Skeleton key={i} className="h-48 rounded-2xl" />)}</div>;
  }
  if (!cards.length) return <p className="text-muted-foreground text-sm">{isRTL ? "אין כרטיסיות" : "No flashcards"}</p>;

  const current = cards[index];
  const progress = (index / cards.length) * 100;

  const handleReview = (result: "again" | "hard" | "good" | "easy") => {
    reviewCard.mutate({ id: current.id, data: { result } }, {
      onSuccess: () => {
        if (index >= cards.length - 1) onDone();
        else { setIndex(i => i + 1); setFlipped(false); }
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Progress value={progress} className="flex-1 h-2" />
        <span className="text-sm text-muted-foreground whitespace-nowrap">{index + 1} / {cards.length}</span>
      </div>

      <div key={index} className="perspective-1000 cursor-pointer" onClick={() => setFlipped(f => !f)} style={{ height: 260 }}>
        <div className={`relative w-full h-full transform-style-3d transition-transform duration-500 ${flipped ? "rotate-y-180" : ""}`}>
          <div className="absolute inset-0 backface-hidden rounded-2xl border-2 bg-card flex flex-col items-center p-6 shadow-lg overflow-hidden">
            <Badge variant="secondary" className="mb-4 capitalize shrink-0">{current.cardType}</Badge>
            <div className="flex-1 w-full overflow-y-auto flex items-center justify-center">
              <p className="text-xl font-semibold text-center leading-relaxed" dir="rtl">{current.front}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-4 shrink-0">{isRTL ? "לחץ להפוך" : "Click to flip"}</p>
          </div>
          <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-2xl border-2 border-primary/30 bg-primary/5 flex flex-col items-center p-6 shadow-lg overflow-hidden">
            <div className="flex-1 w-full overflow-y-auto flex items-center justify-center">
              <p className="text-lg text-center leading-relaxed" dir="rtl">{current.back}</p>
            </div>
          </div>
        </div>
      </div>

      {flipped ? (
        <div className="grid grid-cols-4 gap-3">
          {(["again", "hard", "good", "easy"] as const).map(result => (
            <button
              key={result}
              onClick={() => handleReview(result)}
              className={`py-3 rounded-xl font-semibold text-sm transition-all ${REVIEW_BUTTON_COLORS[result]}`}
            >
              {isRTL
                ? { again: "שוב", hard: "קשה", good: "טוב", easy: "קל" }[result]
                : { again: "Again", hard: "Hard", good: "Good", easy: "Easy" }[result]}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          {isRTL ? "לחץ על הכרטיסייה כדי לראות את התשובה" : "Click the card to reveal the answer"}
        </p>
      )}
    </div>
  );
};

// Quick self-check quiz step -- a trimmed-down questions-practice.tsx (no
// question editing/rescue questions; those belong to slow, focused study,
// not a cram run) scoped to the material's first question set.
const MarathonQuizPhase: React.FC<{ materialId: number; onDone: () => void }> = ({ materialId, onDone }) => {
  const { isRTL } = useLanguage();
  const { data: qsets, isLoading: qsetsLoading } = useListQuestionSets(materialId);
  const qsetId = qsets?.[0]?.id;
  const { data: qSet, isLoading: qSetLoading } = useGetQuestionSet(qsetId!, { query: { enabled: !!qsetId, queryKey: getGetQuestionSetQueryKey(qsetId!) } });
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  if (qsetsLoading || qSetLoading || !qSet) {
    return <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>;
  }
  if (!qSet.questions?.length) return <p className="text-muted-foreground text-sm">{isRTL ? "אין שאלות" : "No questions"}</p>;

  const selectOption = (qId: number, opt: string) => {
    if (selected[qId]) return;
    setSelected(prev => ({ ...prev, [qId]: opt }));
  };
  const toggleReveal = (qId: number) => {
    setRevealed(prev => { const s = new Set(prev); s.has(qId) ? s.delete(qId) : s.add(qId); return s; });
  };

  return (
    <div className="space-y-4">
      {qSet.questions.map((q, idx) => {
        const selectedOpt = selected[q.id];
        const isAnswered = !!selectedOpt;
        const isCorrect = isAnswered && selectedOpt === q.answer;
        return (
          <Card key={q.id}>
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-sm font-bold shrink-0 mt-0.5">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium leading-relaxed" dir="rtl">{q.question}</p>

                  {q.questionType === "multiple_choice" && q.options && q.options.length > 0 ? (
                    <div className="mt-3 space-y-1.5">
                      {q.options.map((opt, i) => {
                        const isThisSelected = selectedOpt === opt;
                        const isThisCorrect = opt === q.answer;
                        let cls = "bg-background hover:bg-muted/50";
                        if (isAnswered) {
                          if (isThisCorrect) cls = "bg-green-100 border-green-300 dark:bg-green-950 dark:border-green-700 font-semibold";
                          else if (isThisSelected) cls = "bg-red-100 border-red-300 dark:bg-red-950 dark:border-red-700";
                        }
                        return (
                          <button
                            key={i}
                            type="button"
                            disabled={isAnswered}
                            onClick={() => selectOption(q.id, opt)}
                            className={`w-full text-start px-3 py-2 rounded-lg text-sm border transition-all ${cls} ${!isAnswered ? "cursor-pointer" : "cursor-default"}`}
                            dir="rtl"
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" className="mt-3 gap-1 text-xs" onClick={() => toggleReveal(q.id)}>
                        {revealed.has(q.id) ? (isRTL ? "הסתר תשובה" : "Hide Answer") : (isRTL ? "הצג תשובה" : "Show Answer")}
                      </Button>
                      {revealed.has(q.id) && <p className="mt-2 text-sm text-green-700 dark:text-green-400">{q.answer}</p>}
                    </>
                  )}

                  {q.questionType === "multiple_choice" && isAnswered && q.explanation && (
                    <p className={`mt-2 text-xs ${isCorrect ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>{q.explanation}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
      <Button size="lg" className="w-full gap-2" onClick={onDone}>
        {isRTL ? "סיימתי, לחומר הבא" : "Done, next material"}
      </Button>
    </div>
  );
};

export const MarathonSessionPage: React.FC = () => {
  const { id: idStr } = useParams<{ id: string }>();
  const marathonId = Number(idStr);
  const { isRTL } = useLanguage();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: marathon, isLoading } = useGetMarathon(marathonId, { query: { enabled: !!marathonId, queryKey: getGetMarathonQueryKey(marathonId) } });
  const updateMaterialStatus = useUpdateMarathonMaterial();

  const materials = marathon?.materials ?? [];
  const current = materials.find(m => m.status !== "completed");

  const [phase, setPhase] = useState<Phase>("summary");
  useEffect(() => {
    if (current) setPhase(STATUS_TO_PHASE[current.status] ?? "summary");
  }, [current?.materialId, current?.status]);

  if (isLoading || !marathon) {
    return <div className="space-y-4 max-w-3xl mx-auto">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div>;
  }

  const advance = (nextStatus: "summary_done" | "flashcards_done" | "completed") => {
    if (!current) return;
    updateMaterialStatus.mutate(
      { id: marathonId, materialId: current.materialId, data: { status: nextStatus } },
      { onSuccess: (updated) => qc.setQueryData(getGetMarathonQueryKey(marathonId), updated) },
    );
  };

  if (!current) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-4">
        <div className="w-16 h-16 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 flex items-center justify-center mx-auto">
          <Flame className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold">{isRTL ? "סיימת את המרתון!" : "Marathon complete!"}</h2>
        <p className="text-muted-foreground">
          {isRTL ? `עברת על ${materials.length} קורסים לפני המבחן` : `You covered ${materials.length} courses before the exam`}
        </p>
        <Button onClick={() => setLocation("/marathon/new")}>{isRTL ? "מרתון חדש" : "New Marathon"}</Button>
      </div>
    );
  }

  const currentIndex = materials.findIndex(m => m.materialId === current.materialId);
  const daysLeft = Math.max(0, Math.ceil((new Date(marathon.examDate).getTime() - Date.now()) / 86400000));

  const steps: { key: Phase; label: string; icon: typeof BookOpen }[] = [
    { key: "summary", label: isRTL ? "סיכום" : "Summary", icon: BookOpen },
    { key: "flashcards", label: isRTL ? "כרטיסיות" : "Flashcards", icon: BrainCircuit },
    { key: "quiz", label: isRTL ? "חידון" : "Quiz", icon: HelpCircle },
  ];
  const phaseIndex = steps.findIndex(s => s.key === phase);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => setLocation("/marathon/new")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm">
        <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
        {isRTL ? "יציאה מהמרתון" : "Exit marathon"}
      </button>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-500" />
            <h1 className="text-xl font-bold">{current.title}</h1>
          </div>
          <Badge variant="outline" className="gap-1.5 text-amber-700 dark:text-amber-400 border-amber-400/50">
            <Timer className="w-3.5 h-3.5" />
            {isRTL ? `המבחן בעוד ${daysLeft} ימים` : `Exam in ${daysLeft} days`}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <Progress value={(currentIndex / materials.length) * 100} className="flex-1 h-2" />
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {isRTL ? `קורס ${currentIndex + 1} מתוך ${materials.length}` : `Course ${currentIndex + 1} of ${materials.length}`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {steps.map((step, i) => {
            const Icon = step.icon;
            const isDone = i < phaseIndex;
            const isActive = i === phaseIndex;
            return (
              <div
                key={step.key}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                  isActive ? "bg-primary text-primary-foreground" : isDone ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                }`}
              >
                {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                {step.label}
              </div>
            );
          })}
        </div>
      </div>

      <div key={`${current.materialId}-${phase}`}>
        {phase === "summary" && <MarathonSummaryPhase materialId={current.materialId} onDone={() => advance("summary_done")} />}
        {phase === "flashcards" && <MarathonFlashcardsPhase materialId={current.materialId} onDone={() => advance("flashcards_done")} />}
        {phase === "quiz" && <MarathonQuizPhase materialId={current.materialId} onDone={() => advance("completed")} />}
      </div>
    </div>
  );
};
