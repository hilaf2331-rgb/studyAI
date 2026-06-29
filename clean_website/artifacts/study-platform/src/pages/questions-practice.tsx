import React, { useState } from "react";
import { useParams } from "wouter";
import { useGetQuestionSet, useGenerateTargetedQuestion, TargetedQuestion } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { BetaUpsellDialog } from "@/components/beta-upsell-dialog";
import { ArrowLeft, ChevronDown, ChevronUp, CheckCircle2, XCircle, Wand2 } from "lucide-react";

// Mirrors FEATURE_TOKEN_COSTS.targetedQuestion in api-server/src/lib/tokens.ts
// (exactly 1 whole Token, RAW_UNITS_PER_TOKEN) -- a real flat fee (not an
// estimate), so it's safe to show as an exact number.
const RESCUE_QUESTION_TOKEN_COST = 1;

export const QuestionsPracticePage: React.FC = () => {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const { isRTL } = useLanguage();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [rescue, setRescue] = useState<Record<number, TargetedQuestion>>({});
  const [rescueSelected, setRescueSelected] = useState<Record<number, string>>({});
  const [showUpsell, setShowUpsell] = useState(false);

  const { data: qSet, isLoading } = useGetQuestionSet(id, { query: { enabled: !!id } });
  const rescueMutation = useGenerateTargetedQuestion();

  if (isLoading) return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-32" />)}</div>;
  if (!qSet || !qSet.questions?.length) return <p className="text-muted-foreground">אין שאלות</p>;

  const questions = qSet.questions;
  const isHebrew = qSet.language === "he";

  const toggle = (qId: number) => {
    setRevealed(prev => {
      const s = new Set(prev);
      s.has(qId) ? s.delete(qId) : s.add(qId);
      return s;
    });
  };

  const selectOption = (qId: number, opt: string) => {
    if (selected[qId]) return;
    setSelected(prev => ({ ...prev, [qId]: opt }));
  };

  const requestRescue = (q: typeof questions[number]) => {
    rescueMutation.mutate(
      { id: qSet.materialId, data: { language: qSet.language, concept: q.concept || q.question } },
      {
        onSuccess: (data) => setRescue(prev => ({ ...prev, [q.id]: data })),
        onError: (err: any) => { if (err?.status === 403 || err?.status === 402) setShowUpsell(true); },
      }
    );
  };

  const DIFF_COLORS: Record<string, string> = {
    easy: "border-green-200 bg-green-50/50 dark:bg-green-950/30",
    medium: "border-amber-200 bg-amber-50/50 dark:bg-amber-950/30",
    hard: "border-red-200 bg-red-50/50 dark:bg-red-950/30",
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => window.history.back()} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm">
        <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
        {isRTL ? "חזרה" : "Back"}
      </button>

      <div>
        <h1 className="text-2xl font-bold">{qSet.title}</h1>
        <p className="text-muted-foreground mt-1">{questions.length} {isRTL ? "שאלות" : "questions"}</p>
      </div>

      <div className="space-y-4">
        {questions.map((q, idx) => {
          const selectedOpt = selected[q.id];
          const isAnswered = !!selectedOpt;
          const isCorrect = isAnswered && selectedOpt === q.answer;
          const isWrong = isAnswered && !isCorrect;
          const selectedIdx = q.options ? q.options.indexOf(selectedOpt) : -1;
          const misconception = isWrong && selectedIdx >= 0 ? q.optionExplanations?.[selectedIdx] : undefined;
          const rescueQ = rescue[q.id];
          const rescueSelectedOpt = rescueSelected[q.id];

          return (
            <Card key={q.id} className={`border ${DIFF_COLORS[q.difficulty] || ""} transition-all`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-sm font-bold shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge variant="outline" className="text-xs capitalize">{q.questionType.replace("_", " ")}</Badge>
                      <Badge variant="secondary" className="text-xs">{q.difficulty}</Badge>
                    </div>
                    <p className="font-medium leading-relaxed" dir={isHebrew ? "rtl" : "ltr"}>{q.question}</p>

                    {q.questionType === "multiple_choice" && q.options?.length > 0 && (
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
                              dir={isHebrew ? "rtl" : "ltr"}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {q.questionType !== "multiple_choice" && (
                      <Button variant="ghost" size="sm" className="mt-3 gap-1 text-xs" onClick={() => toggle(q.id)}>
                        {revealed.has(q.id) ? <><ChevronUp className="w-3 h-3" />{isRTL ? "הסתר תשובה" : "Hide Answer"}</> : <><ChevronDown className="w-3 h-3" />{isRTL ? "הצג תשובה" : "Show Answer"}</>}
                      </Button>
                    )}

                    {q.questionType === "multiple_choice" && isCorrect && (
                      <div className="mt-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800" dir={isHebrew ? "rtl" : "ltr"}>
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-semibold text-sm text-green-800 dark:text-green-300">{isRTL ? "נכון!" : "Correct!"}</p>
                            {q.explanation && <p className="text-xs text-green-700 dark:text-green-400 mt-1">{q.explanation}</p>}
                          </div>
                        </div>
                      </div>
                    )}

                    {q.questionType === "multiple_choice" && isWrong && (
                      <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800" dir={isHebrew ? "rtl" : "ltr"}>
                        <div className="flex items-start gap-2">
                          <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <p className="font-semibold text-sm text-red-800 dark:text-red-300">
                              {isRTL ? `התשובה הנכונה: ${q.answer}` : `Correct answer: ${q.answer}`}
                            </p>
                            <p className="text-xs text-red-700 dark:text-red-400 mt-1">{misconception || q.explanation}</p>
                          </div>
                        </div>
                        {!rescueQ && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-3 gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10"
                            onClick={() => requestRescue(q)}
                            disabled={rescueMutation.isPending}
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            {rescueMutation.isPending
                              ? (isRTL ? "מכין שאלה..." : "Preparing question...")
                              : (isRTL ? `תקן את הפער הזה (יעלה ${RESCUE_QUESTION_TOKEN_COST} טוקנים)` : `Fix this Weak Spot (costs ${RESCUE_QUESTION_TOKEN_COST} tokens)`)}
                          </Button>
                        )}
                      </div>
                    )}

                    {revealed.has(q.id) && q.questionType !== "multiple_choice" && (
                      <div className="mt-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800" dir={isHebrew ? "rtl" : "ltr"}>
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-semibold text-sm text-green-800 dark:text-green-300">{q.answer}</p>
                            {q.explanation && <p className="text-xs text-green-700 dark:text-green-400 mt-1">{q.explanation}</p>}
                            {q.questionType === "open" && q.modelAnswer && (
                              <p className="text-xs text-green-700 dark:text-green-400 mt-2 pt-2 border-t border-green-200 dark:border-green-800 italic">
                                {isRTL ? "תשובת מודל: " : "Model answer: "}{q.modelAnswer}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {rescueQ && (
                      <div className="mt-3 p-4 rounded-lg border-2 border-primary/30 bg-primary/5" dir={isHebrew ? "rtl" : "ltr"}>
                        <div className="flex items-center gap-2 mb-2">
                          <Wand2 className="w-4 h-4 text-primary" />
                          <p className="text-xs font-semibold text-primary uppercase tracking-wide">
                            {isRTL ? "שאלת תיקון" : "Rescue Question"}
                          </p>
                        </div>
                        <p className="font-medium text-sm leading-relaxed mb-3">{rescueQ.question}</p>
                        {rescueQ.options?.length ? (
                          <div className="space-y-1.5">
                            {rescueQ.options.map((opt, i) => {
                              const isThisSelected = rescueSelectedOpt === opt;
                              const isThisCorrect = opt === rescueQ.answer;
                              let cls = "bg-background hover:bg-muted/50";
                              if (rescueSelectedOpt) {
                                if (isThisCorrect) cls = "bg-green-100 border-green-300 dark:bg-green-950 dark:border-green-700 font-semibold";
                                else if (isThisSelected) cls = "bg-red-100 border-red-300 dark:bg-red-950 dark:border-red-700";
                              }
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  disabled={!!rescueSelectedOpt}
                                  onClick={() => setRescueSelected(prev => ({ ...prev, [q.id]: opt }))}
                                  className={`w-full text-start px-3 py-2 rounded-lg text-sm border transition-all ${cls} ${!rescueSelectedOpt ? "cursor-pointer" : "cursor-default"}`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                        {rescueSelectedOpt && (
                          <p className="text-xs text-muted-foreground mt-2">
                            {rescueSelectedOpt === rescueQ.answer
                              ? (rescueQ.explanation || (isRTL ? "כל הכבוד!" : "Nice work!"))
                              : (rescueQ.optionExplanations?.[rescueQ.options?.indexOf(rescueSelectedOpt) ?? -1] || rescueQ.explanation)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <BetaUpsellDialog open={showUpsell} onOpenChange={setShowUpsell} />
    </div>
  );
};
