import React, { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { useGetFlashcardDeck, useReviewFlashcard, getGetFlashcardDeckQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, RotateCcw } from "lucide-react";

export const FlashcardStudyPage: React.FC = () => {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const { isRTL } = useLanguage();
  const qc = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(false);

  const { data: deck, isLoading } = useGetFlashcardDeck(id, { query: { enabled: !!id, queryKey: getGetFlashcardDeckQueryKey(id) } });
  const reviewCard = useReviewFlashcard();

  // Freeze the card order for this study session. The deck query gets
  // invalidated/refetched after every review (since reviewing changes that
  // card's nextReviewAt/interval), which can reorder deck.cards if the
  // backend sorts by review priority. Deriving `cards` directly from the
  // live query on every render meant currentIndex pointed into a shifting
  // array - you'd advance to the next card, then the refetch would resolve
  // and currentIndex would land on a different (often the previous) card.
  // Snapshotting cards once per deck load fixes that.
  const [cards, setCards] = useState<NonNullable<typeof deck>["cards"] | null>(null);
  const initializedDeckId = useRef<number | null>(null);

  useEffect(() => {
    if (deck?.cards?.length && initializedDeckId.current !== id) {
      setCards(deck.cards);
      initializedDeckId.current = id;
      setCurrentIndex(0);
      setFlipped(false);
      setDone(false);
    }
  }, [deck, id]);

  if (isLoading || !cards) return <div className="space-y-4">{[1,2].map(i => <Skeleton key={i} className="h-48" />)}</div>;
  if (!deck || !cards.length) return <p className="text-muted-foreground">{isRTL ? "אין כרטיסיות" : "No flashcards"}</p>;

  const current = cards[currentIndex];
  const isHebrew = deck.language === "he";
  const progress = ((currentIndex) / cards.length) * 100;

  const handleReview = (result: "again" | "hard" | "good" | "easy") => {
    reviewCard.mutate({ id: current.id, data: { result } }, {
      onSuccess: () => {
        const isLastCard = currentIndex >= cards.length - 1;
        if (isLastCard) {
          // Safe to invalidate now - no active index pointing into the
          // array anymore, so a reordered refetch can't pull the rug out.
          qc.invalidateQueries({ queryKey: getGetFlashcardDeckQueryKey(id) });
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
      <h2 className="text-2xl font-bold">{isRTL ? "סיימת את החפיסה!" : "Deck Complete!"}</h2>
      <p className="text-muted-foreground">{isRTL ? `עברת על ${cards.length} כרטיסיות` : `You reviewed ${cards.length} cards`}</p>
      <Button onClick={() => { if (deck?.cards) setCards(deck.cards); setCurrentIndex(0); setFlipped(false); setDone(false); }}>
        <RotateCcw className="w-4 h-4 me-2" />{isRTL ? "התחל מחדש" : "Start Over"}
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
        <h1 className="text-2xl font-bold">{deck.title}</h1>
        <div className="flex items-center gap-3 mt-2">
          <Progress value={progress} className="flex-1 h-2" />
          <span className="text-sm text-muted-foreground whitespace-nowrap">{currentIndex + 1} / {cards.length}</span>
        </div>
      </div>

      {/* Flip Card — key={currentIndex} ensures the DOM element is recreated
          when advancing to the next card, so no flip animation runs with the
          next card's content momentarily visible during the transition. */}
      <div key={currentIndex} className="perspective-1000 cursor-pointer" onClick={() => setFlipped(f => !f)} style={{ height: 300 }}>
        <div className={`relative w-full h-full transform-style-3d transition-transform duration-500 ${flipped ? "rotate-y-180" : ""}`}>
          {/* Front */}
          <div className="absolute inset-0 backface-hidden rounded-2xl border-2 bg-card flex flex-col items-center p-6 shadow-lg overflow-hidden">
            <Badge variant="secondary" className="mb-4 capitalize shrink-0">{current.cardType}</Badge>
            <div className="flex-1 w-full overflow-y-auto flex items-center justify-center">
              <p className="text-xl font-semibold text-center leading-relaxed" dir={isHebrew ? "rtl" : "ltr"}>{current.front}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-4 shrink-0">{isRTL ? "לחץ להפוך" : "Click to flip"}</p>
          </div>
          {/* Back */}
          <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-2xl border-2 border-primary/30 bg-primary/5 flex flex-col items-center p-6 shadow-lg overflow-hidden">
            <div className="flex-1 w-full overflow-y-auto flex items-center justify-center">
              <p className="text-lg text-center leading-relaxed" dir={isHebrew ? "rtl" : "ltr"}>{current.back}</p>
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
