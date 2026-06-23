import React, { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useGetExam, useSubmitExam } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Clock, CheckCircle2 } from "lucide-react";

export const ExamTakePage: React.FC = () => {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const { isRTL } = useLanguage();
  const [, setLocation] = useLocation();

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [startTime] = useState(Date.now());

  const { data: exam, isLoading } = useGetExam(id, { query: { enabled: !!id } });
  const submitExam = useSubmitExam();

  useEffect(() => {
    if (exam?.timeLimitMinutes) {
      setTimeLeft(exam.timeLimitMinutes * 60);
    }
  }, [exam]);

  useEffect(() => {
    if (!timeLeft) return;
    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (!t || t <= 1) { clearInterval(interval); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timeLeft !== null]);

  if (isLoading) return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-32" />)}</div>;
  if (!exam || !exam.questions?.length) return <p>לא נמצא</p>;

  const isHebrew = exam.language === "he";
  const questions = exam.questions;
  const answered = Object.keys(answers).length;
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const handleSubmit = () => {
    const timeSpent = Math.round((Date.now() - startTime) / 1000);
    submitExam.mutate({
      id,
      data: {
        answers: Object.entries(answers).map(([qId, answer]) => ({ questionId: Number(qId), answer })),
        timeSpentSeconds: timeSpent,
      }
    }, {
      onSuccess: (result) => setLocation(`/exams/${id}/result/${result.id}`),
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between sticky top-0 bg-background py-3 z-10 border-b">
        <div className="flex items-center gap-3">
          <button onClick={() => window.history.back()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className={`w-5 h-5 ${isRTL ? "rotate-180" : ""}`} />
          </button>
          <div>
            <p className="font-semibold text-sm">{exam.title}</p>
            <p className="text-xs text-muted-foreground">{answered}/{questions.length} {isRTL ? "נענו" : "answered"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {timeLeft !== null && (
            <Badge variant={timeLeft < 300 ? "destructive" : "secondary"} className="gap-1">
              <Clock className="w-3 h-3" />{formatTime(timeLeft)}
            </Badge>
          )}
          <Button size="sm" onClick={handleSubmit} disabled={submitExam.isPending || answered === 0}>
            {submitExam.isPending ? (isRTL ? "שולח..." : "Submitting...") : (isRTL ? "הגש מבחן" : "Submit Exam")}
          </Button>
        </div>
      </div>

      <Progress value={(answered / questions.length) * 100} className="h-1.5" />

      <div className="space-y-6">
        {questions.map((q, idx) => (
          <div key={q.id} className="p-5 rounded-xl border bg-card">
            <div className="flex items-start gap-3 mb-4">
              <span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                {idx + 1}
              </span>
              <div className="flex-1">
                <div className="flex gap-2 mb-2 flex-wrap">
                  <Badge variant="outline" className="text-xs capitalize">{q.questionType.replace("_", " ")}</Badge>
                  <Badge variant="secondary" className="text-xs">{q.difficulty}</Badge>
                  {answers[q.id] && <Badge className="text-xs bg-green-500 text-white gap-1"><CheckCircle2 className="w-3 h-3" />{isRTL ? "נענה" : "Answered"}</Badge>}
                </div>
                <p className="font-medium leading-relaxed" dir={isHebrew ? "rtl" : "ltr"}>{q.question}</p>
              </div>
            </div>

            {q.questionType === "multiple_choice" && q.options?.length > 0 ? (
              <div className="space-y-2 ps-10">
                {q.options.map((opt, i) => (
                  <button key={i} onClick={() => setAnswers(a => ({ ...a, [q.id]: opt }))}
                    className={`w-full text-start px-4 py-2.5 rounded-lg border text-sm transition-all ${answers[q.id] === opt ? "border-primary bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`}
                    dir={isHebrew ? "rtl" : "ltr"}>
                    {opt}
                  </button>
                ))}
              </div>
            ) : q.questionType === "true_false" ? (
              <div className="flex gap-3 ps-10">
                {[isRTL ? "נכון" : "True", isRTL ? "לא נכון" : "False"].map(opt => (
                  <button key={opt} onClick={() => setAnswers(a => ({ ...a, [q.id]: opt }))}
                    className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${answers[q.id] === opt ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}>
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <Textarea
                className="ps-10 mt-2 min-h-24 text-sm"
                placeholder={isRTL ? "הכנס את תשובתך כאן..." : "Type your answer here..."}
                value={answers[q.id] || ""}
                onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                dir={isHebrew ? "rtl" : "ltr"}
              />
            )}
          </div>
        ))}
      </div>

      <div className="sticky bottom-4 flex justify-center">
        <Button size="lg" onClick={handleSubmit} disabled={submitExam.isPending || answered === 0} className="shadow-lg px-8">
          {submitExam.isPending ? (isRTL ? "מעבד..." : "Grading...") : (isRTL ? "הגש מבחן" : "Submit Exam")}
        </Button>
      </div>
    </div>
  );
};
