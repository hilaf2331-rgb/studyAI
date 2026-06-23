import React from "react";
import { useParams, useLocation } from "wouter";
import { useGetExamResult, useGetExam, getGetExamQueryKey } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, XCircle, RotateCcw } from "lucide-react";

export const ExamResultPage: React.FC = () => {
  const { id: examId, resultId } = useParams<{ id: string; resultId: string }>();
  const { isRTL } = useLanguage();
  const [, setLocation] = useLocation();

  const { data: result, isLoading: loadingResult } = useGetExamResult(Number(resultId), { query: { enabled: !!resultId } });
  const { data: exam } = useGetExam(Number(examId), { query: { enabled: !!examId, queryKey: getGetExamQueryKey(Number(examId)) } });

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
            {result.feedback.map((f: any, idx: number) => (
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
                      {f.explanation && <p className="text-xs text-muted-foreground mt-1.5 border-t pt-1.5">{f.explanation}</p>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
