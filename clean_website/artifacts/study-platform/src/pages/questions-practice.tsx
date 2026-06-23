import React, { useState } from "react";
import { useParams } from "wouter";
import { useGetQuestionSet } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";

export const QuestionsPracticePage: React.FC = () => {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const { isRTL } = useLanguage();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState(0);

  const { data: qSet, isLoading } = useGetQuestionSet(id, { query: { enabled: !!id } });

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
        {questions.map((q, idx) => (
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
                    <ul className="mt-3 space-y-1.5">
                      {q.options.map((opt, i) => (
                        <li key={i} className={`px-3 py-2 rounded-lg text-sm border transition-all ${revealed.has(q.id) && opt === q.answer ? "bg-green-100 border-green-300 dark:bg-green-950 dark:border-green-700 font-semibold" : "bg-background"}`} dir={isHebrew ? "rtl" : "ltr"}>
                          {opt}
                        </li>
                      ))}
                    </ul>
                  )}

                  <Button variant="ghost" size="sm" className="mt-3 gap-1 text-xs" onClick={() => toggle(q.id)}>
                    {revealed.has(q.id) ? <><ChevronUp className="w-3 h-3" />{isRTL ? "הסתר תשובה" : "Hide Answer"}</> : <><ChevronDown className="w-3 h-3" />{isRTL ? "הצג תשובה" : "Show Answer"}</>}
                  </Button>

                  {revealed.has(q.id) && (
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
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
