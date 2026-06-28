import React, { useState, useEffect } from "react";
import {
  useGetDailyReviewCards, useReviewFlashcard,
  getGetDailyReviewCardsQueryKey, getGetDailyReviewCountQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { usePurchaseModal } from "@/lib/purchase-modal";
import { ArrowLeft, RotateCcw, Coins } from "lucide-react";

// Cross-material review session fed by the Today's Review queue on the
// dashboard. Unlike flashcard-study.tsx (which studies one deck), the card
// list here can span every material the student owns, so each card carries
// its own materialTitle for context.
export const DailyReviewPage: React.FC = () => {
  const { isRTL } = useLanguage();
  const { open: openPurchaseModal } = usePurchaseModal();
  const qc = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(false);

  const { data, isLoading, error } = useGetDailyReviewCards({ query: { queryKey: getGetDailyReviewCardsQueryKey() } });
  const reviewCard = useReviewFlashcard();

  // Snapshot the queue once on load, same rationale as flashcard-study.tsx:
  // reviewing a card invalidates/refetches the due list, which would
  // otherwise reorder the array out from under the active currentIndex.
  const [cards, setCards] = useState<NonNullable<typeof data>["cards"] | null>(null);
  useEffect(() => {
    if (data?.cards && cards === null) setCards(data.cards);
  }, [data, cards]);

  if ((error as any)?.status === 402) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground">
          {isRTL
            ? "נגמרו לך הטוקנים לסקירה היומית."
            : "You're out of tokens for Today's Review."}
        </p>
        <Button onClick={openPurchaseModal} className="gap-2">
          <Coins className="w-4 h-4" />
          {isRTL ? "טעינת טוקנים" : "Buy Tokens"}
        </Button>
      </div>
    );
  }
  if (isLoading || cards === null) return <div className="space-y-4">{[1, 2].map(i => <Skeleton key={i} className="h-48" />)}</div>;
  if (!cards.length) return <p className="text-muted-foreground">{isRTL ? "אין כרטיסיות לסקירה היום" : "No cards due for review today"}</p>;

  const current = cards[currentIndex];
  const progress = (currentIndex / cards.length) * 100;

  const handleReview = (result: "again" | "hard" | "good" | "easy") => {
    reviewCard.mutate({ id: current.id, data: { result } }, {
      onSuccess: () => {
        const isLastCard = currentIndex >= cards.length - 1;
        if (isLastCard) {
          qc.invalidateQueries({ queryKey: getGetDailyReviewCardsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDailyReviewCountQueryKey() });
          setDone(true);
        } else {
          setCurrentIndex(i => i + 1);
          setFlipped(false);
        }
      }
    });
  };

  if (done) return (
    <div className="max-w-lg mx-auto text-center py-16 space-y-4">
      <div className="text-6xl">🎉</div>
      <h2 className="text-2xl font-bold">{isRTL ? "סיימת את הסקירה היומית!" : "Daily review complete!"}</h2>
      <p className="text-muted-foreground">{isRTL ? `עברת על ${cards.length} כרטיסיות` : `You reviewed ${cards.length} cards`}</p>
      <Button onClick={() => window.history.back()}>
        <RotateCcw className="w-4 h-4 me-2" />{isRTL ? "חזרה לדשבורד" : "Back to dashboard"}
      </Button>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <button onClick={() => window.history.back()} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm">
        <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
        {isRTL ? "חזרה" : "Back"}
      </button>

      <div>
        <h1 className="text-2xl font-bold">{isRTL ? "סקירה יומית" : "Today's Review"}</h1>
        <div className="flex items-center gap-3 mt-2">
          <Progress value={progress} className="flex-1 h-2" />
          <span className="text-sm text-muted-foreground whitespace-nowrap">{currentIndex + 1} / {cards.length}</span>
        </div>
      </div>

      <div className="perspective-1000 cursor-pointer" onClick={() => setFlipped(f => !f)} style={{ height: 300 }}>
        <div className={`relative w-full h-full transform-style-3d transition-transform duration-500 ${flipped ? "rotate-y-180" : ""}`}>
          <div className="absolute inset-0 backface-hidden rounded-2xl border-2 bg-card flex flex-col items-center p-6 shadow-lg overflow-hidden">
            <Badge variant="secondary" className="mb-2 capitalize shrink-0">{current.materialTitle}</Badge>
            <div className="flex-1 w-full overflow-y-auto flex items-center justify-center">
              <p className="text-xl font-semibold text-center leading-relaxed">{current.front}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-4 shrink-0">{isRTL ? "לחץ להפוך" : "Click to flip"}</p>
          </div>
          <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-2xl border-2 border-primary/30 bg-primary/5 flex flex-col items-center p-6 shadow-lg overflow-hidden">
            <div className="flex-1 w-full overflow-y-auto flex items-center justify-center">
              <p className="text-lg text-center leading-relaxed">{current.back}</p>
            </div>
          </div>
        </div>
      </div>

      {flipped && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { result: "again" as const, label: isRTL ? "שוב" : "Again", color: "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-400" },
            { result: "hard" as const, label: isRTL ? "קשה" : "Hard", color: "bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-950 dark:text-orange-400" },
            { result: "good" as const, label: isRTL ? "טוב" : "Good", color: "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-400" },
            { result: "easy" as const, label: isRTL ? "קל" : "Easy", color: "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-950 dark:text-green-400" },
          ].map(btn => (
            <button key={btn.result} onClick={() => handleReview(btn.result)}
              className={`py-3 rounded-xl font-semibold text-sm transition-all ${btn.color}`}>
              {btn.label}
            </button>
          ))}
        </div>
      )}

      {!flipped && (
        <p className="text-center text-sm text-muted-foreground">
          {isRTL ? "לחץ על הכרטיסייה כדי לראות את התשובה" : "Click the card to reveal the answer"}
        </p>
      )}
    </div>
  );
};
