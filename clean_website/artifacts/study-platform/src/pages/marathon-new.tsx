import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListMaterials, useListMarathons, useCreateMarathon } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Timer, CalendarClock, ArrowLeft, Loader2, Flame, Lock } from "lucide-react";

// Marathon Mode: distills several already-ready materials (courses a
// student fell behind on) into one continuous cram run -- see
// marathon-session.tsx for the run itself. Only materials that already have
// a full kit (summary + flashcards + quiz, from the normal upload/generate-
// all pipeline) are selectable; generating one from scratch is a multi-
// minute AI pipeline that doesn't belong inside this "start now" screen.
export const MarathonNewPage: React.FC = () => {
  const { isRTL } = useLanguage();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [examDate, setExamDate] = useState<Date | undefined>(undefined);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const { data: materials, isLoading } = useListMaterials();
  const { data: marathons } = useListMarathons();
  const createMarathon = useCreateMarathon();

  const activeMarathon = marathons?.find(m => m.status === "active");

  const isReady = (m: NonNullable<typeof materials>[number]) => (m.summaryCount ?? 0) > 0 && (m.flashcardCount ?? 0) > 0 && (m.questionCount ?? 0) > 0;
  const ready = (materials || []).filter(isReady);
  const notReady = (materials || []).filter(m => !isReady(m));

  const toggle = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleStart = () => {
    if (!examDate || selectedIds.size === 0) return;
    createMarathon.mutate(
      { data: { examDate: examDate.toISOString(), materialIds: Array.from(selectedIds) } },
      {
        onSuccess: (marathon) => setLocation(`/marathon/${marathon.id}`),
        onError: () => toast({ variant: "destructive", description: isRTL ? "לא הצלחנו להתחיל את המרתון. נסו שוב." : "Couldn't start the marathon. Please try again." }),
      }
    );
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{isRTL ? "מרתון לימוד" : "Study Marathon"}</h1>
        </div>
        <p className="text-muted-foreground mt-2">
          {isRTL
            ? "פספסת כמה שיעורים? בחרו את החומרים שנשארו מאחור ותאריך מבחן, והמרתון יעביר אתכם ברצף אחד על סיכום ממוקד, כרטיסיות וחידון של כל קורס."
            : "Fell behind on a few lessons? Pick the leftover materials and an exam date, and the marathon walks you through a focused summary, flashcards, and a quiz for each one, back to back."}
        </p>
      </div>

      {activeMarathon && (
        <Card className="border-amber-400/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="p-5 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Timer className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <p className="font-semibold text-sm">{isRTL ? "יש לך מרתון פעיל" : "You have a marathon in progress"}</p>
                <p className="text-xs text-muted-foreground">
                  {isRTL ? "אפשר להמשיך מהנקודה שבה עצרת" : "Pick up right where you left off"}
                </p>
              </div>
            </div>
            <Button size="sm" onClick={() => setLocation(`/marathon/${activeMarathon.id}`)}>
              {isRTL ? "המשך מרתון" : "Continue Marathon"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-5 space-y-3">
          <p className="font-semibold text-sm">{isRTL ? "תאריך המבחן" : "Exam date"}</p>
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <CalendarClock className="w-4 h-4" />
                {examDate ? examDate.toLocaleDateString(isRTL ? "he-IL" : "en-US") : (isRTL ? "בחר תאריך מבחן" : "Set exam date")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align={isRTL ? "end" : "start"} className="w-auto p-0">
              <Calendar
                mode="single"
                selected={examDate}
                onSelect={(date) => { if (date) { setExamDate(date); setDatePickerOpen(false); } }}
                disabled={{ before: new Date() }}
              />
            </PopoverContent>
          </Popover>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm">{isRTL ? "בחרו חומרים למרתון" : "Choose materials for the marathon"}</p>
          <span className="text-sm text-muted-foreground">
            {isRTL ? `${selectedIds.size} נבחרו` : `${selectedIds.size} selected`}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : ready.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">
            {isRTL ? "עדיין אין לך חומרים מוכנים (עם סיכום, כרטיסיות וחידון). העלו חומר חדש כדי להתחיל." : "You don't have any ready materials yet (with a summary, flashcards, and a quiz). Upload one to get started."}
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {ready.map(m => {
              const selected = selectedIds.has(m.id);
              return (
                <Card
                  key={m.id}
                  className={`cursor-pointer transition-all ${selected ? "ring-2 ring-primary" : "hover:shadow-sm"}`}
                  onClick={() => toggle(m.id)}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <Checkbox checked={selected} onCheckedChange={() => toggle(m.id)} onClick={(e) => e.stopPropagation()} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium break-words">{m.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {m.flashcardCount} {isRTL ? "כרטיסיות" : "cards"} · {m.questionCount} {isRTL ? "שאלות" : "questions"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {notReady.length > 0 && (
          <div className="pt-2 space-y-2">
            <p className="text-xs text-muted-foreground">{isRTL ? "עוד לא מוכנים למרתון (חסר סיכום/כרטיסיות/חידון):" : "Not ready for a marathon yet (missing summary/flashcards/quiz):"}</p>
            {notReady.map(m => (
              <Link key={m.id} href={`/materials/${m.id}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg border border-dashed px-3 py-2">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{m.title}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <button onClick={() => setLocation("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm">
          <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
          {isRTL ? "ביטול" : "Cancel"}
        </button>
        <Button
          size="lg"
          className="gap-2"
          disabled={!examDate || selectedIds.size === 0 || createMarathon.isPending}
          onClick={handleStart}
        >
          {createMarathon.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
          {isRTL ? "התחל מרתון" : "Start Marathon"}
        </Button>
      </div>
    </div>
  );
};
