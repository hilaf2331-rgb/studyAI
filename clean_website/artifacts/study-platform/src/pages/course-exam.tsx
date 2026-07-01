import React, { useState, useRef, useEffect } from "react";
import { useParams } from "wouter";
import { useGetCourse, useGetCourseExamQuestions, type Question } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, CheckCircle2, XCircle, Trophy } from "lucide-react";

type Phase = "intro" | "taking" | "results";

interface Answer {
  questionId: number;
  userAnswer: string;
  correct: boolean;
}

function scoreMCQ(q: Question, userAnswer: string): boolean {
  return userAnswer.trim().toLowerCase() === q.answer.trim().toLowerCase();
}


function QuestionCard({
  q,
  index,
  total,
  isHebrew,
  isRTL,
  onSubmit,
}: {
  q: Question;
  index: number;
  total: number;
  isHebrew: boolean;
  isRTL: boolean;
  onSubmit: (answer: string) => void;
}) {
  const isMCQ = q.questionType === "multiple_choice" && q.options && q.options.length > 0;
  const [selected, setSelected] = useState<string>("");
  const [openText, setOpenText] = useState("");

  const canSubmit = isMCQ ? !!selected : openText.trim().length > 0;

  const handleSubmit = () => {
    onSubmit(isMCQ ? selected : openText.trim());
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Badge variant="secondary" className="capitalize text-xs">{q.questionType?.replace("_", " ")}</Badge>
          <Badge variant="outline" className="text-xs capitalize">{q.difficulty}</Badge>
        </div>
        <p className="text-lg font-semibold leading-relaxed" dir={isHebrew ? "rtl" : "ltr"}>{q.question}</p>
      </div>

      {isMCQ ? (
        <div className="space-y-2">
          {q.options!.map((opt, i) => (
            <button
              key={i}
              onClick={() => setSelected(opt)}
              className={`w-full text-start px-4 py-3 rounded-xl border-2 transition-all text-sm ${
                selected === opt
                  ? "border-primary bg-primary/10 font-medium"
                  : "border-border hover:border-primary/40 hover:bg-muted/50"
              }`}
              dir={isHebrew ? "rtl" : "ltr"}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <Textarea
          value={openText}
          onChange={e => setOpenText(e.target.value)}
          rows={4}
          dir={isHebrew ? "rtl" : "ltr"}
          placeholder={isRTL ? "כתוב את תשובתך כאן..." : "Write your answer here..."}
          className="resize-none"
        />
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{index + 1} / {total}</span>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {isRTL ? "הבא" : "Next"}
        </Button>
      </div>
    </div>
  );
}

function OpenSelfScore({
  q,
  userAnswer,
  isHebrew,
  isRTL,
  onScore,
}: {
  q: Question;
  userAnswer: string;
  isHebrew: boolean;
  isRTL: boolean;
  onScore: (correct: boolean) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground mb-1">{isRTL ? "השאלה:" : "Question:"}</p>
        <p className="text-lg font-semibold leading-relaxed" dir={isHebrew ? "rtl" : "ltr"}>{q.question}</p>
      </div>
      <div className="rounded-xl border bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground mb-1">{isRTL ? "תשובתך:" : "Your answer:"}</p>
        <p className="text-sm leading-relaxed" dir={isHebrew ? "rtl" : "ltr"}>{userAnswer}</p>
      </div>
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <p className="text-xs text-muted-foreground mb-1">{isRTL ? "תשובה נכונה:" : "Correct answer:"}</p>
        <p className="text-sm font-medium leading-relaxed" dir={isHebrew ? "rtl" : "ltr"}>{q.answer}</p>
        {q.explanation && (
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed" dir={isHebrew ? "rtl" : "ltr"}>{q.explanation}</p>
        )}
      </div>
      <div className="flex gap-3 justify-center">
        <Button variant="outline" className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => onScore(false)}>
          <XCircle className="w-4 h-4" />
          {isRTL ? "טעיתי" : "Incorrect"}
        </Button>
        <Button className="gap-2 bg-green-600 hover:bg-green-700 text-white" onClick={() => onScore(true)}>
          <CheckCircle2 className="w-4 h-4" />
          {isRTL ? "צדקתי" : "Correct"}
        </Button>
      </div>
    </div>
  );
}

export const CourseExamPage: React.FC = () => {
  const { id: idStr } = useParams<{ id: string }>();
  const courseId = Number(idStr);
  const { isRTL } = useLanguage();

  const [phase, setPhase] = useState<Phase>("intro");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [pendingOpen, setPendingOpen] = useState<{ answer: string } | null>(null);

  const { data: course, isLoading: loadingCourse } = useGetCourse(courseId);
  const { data: questions, isLoading: loadingQ } = useGetCourseExamQuestions(courseId);

  const frozenQ = useRef<Question[] | null>(null);
  useEffect(() => {
    if (questions && questions.length && !frozenQ.current) {
      frozenQ.current = questions;
    }
  }, [questions]);

  if (loadingCourse || loadingQ) {
    return <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-32" />)}</div>;
  }

  const qs = frozenQ.current ?? questions ?? [];
  const isHebrew = isRTL;

  if (!qs.length) {
    return (
      <div className="max-w-2xl mx-auto text-center py-24 space-y-4">
        <p className="text-muted-foreground">
          {isRTL ? "אין שאלות זמינות לקורס זה. צור שאלות בחומרים תחילה." : "No questions available for this course yet. Generate questions in materials first."}
        </p>
        <Button variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft className={`w-4 h-4 me-2 ${isRTL ? "rotate-180" : ""}`} />
          {isRTL ? "חזרה" : "Back"}
        </Button>
      </div>
    );
  }

  if (phase === "intro") {
    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <button onClick={() => window.history.back()} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm">
          <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
          {isRTL ? "חזרה" : "Back"}
        </button>

        <div className="rounded-2xl border-2 bg-card p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Trophy className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">{isRTL ? "מבחן קורס" : "Course Exam"}</h1>
          {course?.name && <p className="text-muted-foreground">{course.name}</p>}
          <p className="text-sm text-muted-foreground">
            {isRTL
              ? `${qs.length} שאלות מכל חומרי הקורס, בסדר אקראי`
              : `${qs.length} questions from all course materials, in random order`}
          </p>
          <Button size="lg" onClick={() => setPhase("taking")}>
            {isRTL ? "התחל מבחן" : "Start Exam"}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "results") {
    const correct = answers.filter(a => a.correct).length;
    const pct = Math.round((correct / qs.length) * 100);
    const grade = pct >= 90 ? "A" : pct >= 80 ? "B" : pct >= 70 ? "C" : pct >= 60 ? "D" : "F";

    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="rounded-2xl border-2 bg-card p-8 text-center space-y-4">
          <Trophy className={`w-12 h-12 mx-auto ${pct >= 60 ? "text-yellow-500" : "text-muted-foreground"}`} />
          <h1 className="text-3xl font-bold">{grade}</h1>
          <p className="text-5xl font-bold text-primary">{pct}%</p>
          <p className="text-muted-foreground">{correct} / {qs.length} {isRTL ? "נכון" : "correct"}</p>
          <Progress value={pct} className="h-3" />
        </div>

        <div className="space-y-3">
          {qs.map((q: Question, i: number) => {
            const ans = answers[i];
            const isCorrect = ans?.correct;
            return (
              <div key={q.id} className={`rounded-xl border-2 p-4 ${isCorrect ? "border-green-500/30 bg-green-50 dark:bg-green-950/20" : "border-destructive/30 bg-red-50 dark:bg-red-950/20"}`}>
                <div className="flex items-start gap-3">
                  {isCorrect
                    ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    : <XCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium leading-relaxed" dir={isHebrew ? "rtl" : "ltr"}>{q.question}</p>
                    {!isCorrect && (
                      <p className="text-xs text-green-700 dark:text-green-400" dir={isHebrew ? "rtl" : "ltr"}>
                        {isRTL ? "תשובה נכונה: " : "Correct: "}{q.answer}
                      </p>
                    )}
                    {ans?.userAnswer && (
                      <p className="text-xs text-muted-foreground" dir={isHebrew ? "rtl" : "ltr"}>
                        {isRTL ? "תשובתך: " : "Your answer: "}{ans.userAnswer}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 justify-center pb-8">
          <Button variant="outline" onClick={() => window.history.back()}>
            {isRTL ? "חזרה לקורס" : "Back to Course"}
          </Button>
          <Button onClick={() => {
            frozenQ.current = null;
            setCurrentIndex(0);
            setAnswers([]);
            setPendingOpen(null);
            setPhase("intro");
          }}>
            {isRTL ? "נסה שוב" : "Try Again"}
          </Button>
        </div>
      </div>
    );
  }

  // Taking phase
  const q = qs[currentIndex];
  const isMCQ = q.questionType === "multiple_choice" && q.options && q.options.length > 0;
  const progress = (currentIndex / qs.length) * 100;

  const handleAnswer = (userAnswer: string) => {
    if (!isMCQ) {
      // Open question: show self-scoring screen
      setPendingOpen({ answer: userAnswer });
      return;
    }
    const correct = scoreMCQ(q, userAnswer);
    const newAnswers = [...answers, { questionId: q.id, userAnswer, correct }];
    setAnswers(newAnswers);
    if (currentIndex + 1 >= qs.length) {
      setPhase("results");
    } else {
      setCurrentIndex(i => i + 1);
    }
  };

  const handleOpenScore = (correct: boolean) => {
    const userAnswer = pendingOpen?.answer ?? "";
    const newAnswers = [...answers, { questionId: q.id, userAnswer, correct }];
    setAnswers(newAnswers);
    setPendingOpen(null);
    if (currentIndex + 1 >= qs.length) {
      setPhase("results");
    } else {
      setCurrentIndex(i => i + 1);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-semibold">{course?.name ?? (isRTL ? "מבחן קורס" : "Course Exam")}</h1>
          <span className="text-sm text-muted-foreground">{currentIndex + 1} / {qs.length}</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      <div className="rounded-2xl border-2 bg-card p-6 shadow-sm">
        {pendingOpen ? (
          <OpenSelfScore
            q={q}
            userAnswer={pendingOpen.answer}
            isHebrew={isHebrew}
            isRTL={isRTL}
            onScore={handleOpenScore}
          />
        ) : (
          <QuestionCard
            q={q}
            index={currentIndex}
            total={qs.length}
            isHebrew={isHebrew}
            isRTL={isRTL}
            onSubmit={handleAnswer}
          />
        )}
      </div>
    </div>
  );
};
