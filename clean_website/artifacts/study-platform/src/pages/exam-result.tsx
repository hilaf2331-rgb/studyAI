import React, { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useGetExamResult, useGetExam, getGetExamQueryKey, useGenerateTargetedQuestion, TargetedQuestion } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, CheckCircle2, XCircle, RotateCcw, Wand2, Sparkles } from "lucide-react";

export const ExamResultPage: React.FC = () => {
  const { id: examId, resultId } = useParams<{ id: string; resultId: string }>();
  const { isRTL } = useLanguage();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [rescue, setRescue] = useState<Record<number, TargetedQuestion>>({});
  const [rescueSelected, setRescueSelected] = useState<Record<number, string>>({});
  const [showUpsell, setShowUpsell] = useState(false);

  const { data: result, isLoading: loadingResult } = useGetExamResult(Number(resultId), { query: { enabled: !!resultId } });
  const { data: exam } = useGetExam(Number(examId), { query: { enabled: !!examId, queryKey: getGetExamQueryKey(Number(examId)) } });
  const rescueMutation = useGenerateTargetedQuestion();

  const requestRescue = (questionId: number, concept: string, language: "he" | "en") => {
    if (!exam) return;
    if (!user?.isPremium) {
      setShowUpsell(true);
      return;
    }
    rescueMutation.mutate(
      { id: exam.materialId, data: { language, concept } },
      {
        onSuccess: (data) => setRescue(prev => ({ ...prev, [questionId]: data })),
        onError: (err: any) => { if (err?.status === 403) setShowUpsell(true); },
      }
    );
  };

  if (loadingResult) return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>;
  if (!result) return <p>לא נמצא</p>;

  const score = result.score;
  const isPassing = score >= 60;
  const isHebrew = exam?.language === "he";

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <button onClick={() => window.history.back()} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm">
        <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
        {isRTL ? "חזרה" : "Back"}
      </button>

      {/* Score Card */}
      <Card className={`border-2 ${isPassing ? "border-green-300 dark:border-green-700" : "border-red-300 dark:border-red-700"}`}>
        <CardContent className="p-8 text-center">
          <div className={`text-7xl font-black mb-2 ${isPassing ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {score}%
          </div>
          <p className="text-lg font-semibold text-foreground/80">
            {isPassing ? (isRTL ? "עברת את המבחן!" : "You Passed!") : (isRTL ? "לא עברת הפעם" : "Keep Practicing")}
          </p>
          <p className="text-muted-foreground text-sm mt-1">
            {result.correctCount} / {result.totalQuestions} {isRTL ? "תשובות נכונות" : "correct answers"}
          </p>
          <Progress value={score} className={`mt-4 h-3 ${isPassing ? "[&>div]:bg-green-500" : "[&>div]:bg-red-500"}`} />
          {result.timeSpentSeconds && (
            <p className="text-xs text-muted-foreground mt-3">
              {isRTL ? `זמן: ${Math.round(result.timeSpentSeconds / 60)} דקות` : `Time: ${Math.round(result.timeSpentSeconds / 60)} minutes`}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 gap-2" onClick={() => setLocation(`/exams/${examId}`)}>
          <RotateCcw className="w-4 h-4" />{isRTL ? "נסה שוב" : "Try Again"}
        </Button>
        <Button className="flex-1" onClick={() => window.history.back()}>
          {isRTL ? "חזור לחומר" : "Back to Material"}
        </Button>
      </div>

      {/* Per-question Feedback */}
      {result.feedback && result.feedback.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">{isRTL ? "סקירת תשובות" : "Answer Review"}</h2>
          <div className="space-y-3">
            {result.feedback.map((f: any, idx: number) => {
              const q = exam?.questions?.find(qq => qq.id === f.questionId);
              const selectedIdx = q?.options ? q.options.indexOf(f.userAnswer) : -1;
              const misconception = !f.correct && selectedIdx >= 0 ? q?.optionExplanations?.[selectedIdx] : undefined;
              const rescueQ = rescue[f.questionId];
              const rescueSelectedOpt = rescueSelected[f.questionId];

              return (
                <Card key={f.questionId} className={`border ${f.correct ? "border-green-200 dark:border-green-800" : "border-red-200 dark:border-red-800"}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {f.correct
                        ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                        : <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      }
                      <div className="flex-1 min-w-0" dir={isHebrew ? "rtl" : "ltr"}>
                        <p className="text-xs text-muted-foreground mb-1">{isRTL ? "שאלה" : "Question"} {idx + 1}</p>
                        {!f.correct && (
                          <>
                            <p className="text-sm"><span className="font-medium text-red-600 dark:text-red-400">{isRTL ? "תשובתך: " : "Your answer: "}</span>{f.userAnswer}</p>
                            <p className="text-sm mt-1"><span className="font-medium text-green-600 dark:text-green-400">{isRTL ? "תשובה נכונה: " : "Correct: "}</span>{f.correctAnswer}</p>
                          </>
                        )}
                        {f.correct && <p className="text-sm text-green-700 dark:text-green-300">{f.userAnswer}</p>}
                        {f.modelAnswer && (
                          <p className="text-xs text-muted-foreground mt-1.5 border-t pt-1.5 italic">
                            <span className="font-medium">{isRTL ? "תשובת מודל: " : "Model answer: "}</span>{f.modelAnswer}
                          </p>
                        )}
                        {(misconception || f.explanation) && (
                          <p className="text-xs text-muted-foreground mt-1.5 border-t pt-1.5">{misconception || f.explanation}</p>
                        )}

                        {!f.correct && q?.concept && !rescueQ && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10"
                            onClick={() => requestRescue(f.questionId, q.concept || q.question, exam!.language)}
                            disabled={rescueMutation.isPending}
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            {rescueMutation.isPending ? (isRTL ? "מכין שאלה..." : "Preparing question...") : (isRTL ? "תקן את הפער הזה" : "Fix this Weak Spot")}
                          </Button>
                        )}

                        {rescueQ && (
                          <div className="mt-3 p-4 rounded-lg border-2 border-primary/30 bg-primary/5">
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
                                      onClick={() => setRescueSelected(prev => ({ ...prev, [f.questionId]: opt }))}
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
        </div>
      )}

      <Dialog open={showUpsell} onOpenChange={setShowUpsell}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              {isRTL ? "תכונת פרימיום" : "Premium Feature"}
            </DialogTitle>
            <DialogDescription>
              {isRTL
                ? "פתח ניתוח נקודות חולשה ושאלות תיקון עם studyAI Premium!"
                : "Unlock your Weak Spot Analytics and Rescue Questions with studyAI Premium!"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpsell(false)}>
              {isRTL ? "אולי בהמשך" : "Maybe later"}
            </Button>
            <Button onClick={() => setShowUpsell(false)}>
              {isRTL ? "שדרג לפרימיום" : "Upgrade to Premium"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
