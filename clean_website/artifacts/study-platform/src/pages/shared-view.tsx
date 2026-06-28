import React, { useState } from "react";
import { useParams, Link } from "wouter";
import { useGetSharedMaterial, type SharedMaterialFlashcardsItem } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Sparkles, ArrowLeft, Share2, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useToast } from "@/hooks/use-toast";

// Public, unauthenticated preview of a shared study kit -- mounted outside
// the authenticated <SidebarLayout>/<Switch> in App.tsx (same early-return
// pattern as /terms and /privacy), since a guest with this link has no
// session at all.
// Both variants link to "/" (the marketing landing page for a logged-out
// visitor -- see App.tsx) rather than straight to "/login", so anyone
// trying to do something that needs an account sees the value pitch first
// and chooses to sign up/log in from there, instead of being dropped on a
// bare auth form with no context.
function ConversionBanner({ isHebrew, variant }: { isHebrew: boolean; variant: "top" | "bottom" }) {
  if (variant === "bottom") {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row items-center gap-3 sm:justify-center text-center sm:text-start">
        <p className="text-sm font-medium" dir={isHebrew ? "rtl" : "ltr"}>
          {isHebrew ? "רוצים ליצור ערכות לימוד משלכם? לחצו כאן לפרטים נוספים" : "Want to create your own study sets? Click here to learn more"}
        </p>
        <Link href="/">
          <Button size="sm" variant="outline" className="shrink-0 gap-2">
            {isHebrew ? "לפרטים נוספים" : "Learn more"}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row items-center gap-3 sm:justify-between">
      <p className="text-sm font-medium" dir={isHebrew ? "rtl" : "ltr"}>
        {isHebrew
          ? "לומדים לקראת המבחן הזה? שמרו את החפיסה ועקבו אחרי ההתקדמות שלכם עם חשבון חינמי ב-FocusStudy."
          : "Studying for this exam? Save this deck and track your progress by creating a free account on FocusStudy."}
      </p>
      <Link href="/">
        <Button size="sm" className="shrink-0 gap-2">
          {isHebrew ? "צרו חשבון חינמי" : "Create a free account"}
        </Button>
      </Link>
    </div>
  );
}

function FlashcardPreview({ cards, isHebrew }: { cards: SharedMaterialFlashcardsItem[]; isHebrew: boolean }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (!cards.length) return null;
  const current = cards[index];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold">{isHebrew ? "כרטיסיות" : "Flashcards"}</h2>
        <span className="text-sm text-muted-foreground">{index + 1} / {cards.length}</span>
      </div>

      <div className="perspective-1000 cursor-pointer" onClick={() => setFlipped(f => !f)} style={{ height: 260 }}>
        <div className={`relative w-full h-full transform-style-3d transition-transform duration-500 ${flipped ? "rotate-y-180" : ""}`}>
          <div className="absolute inset-0 backface-hidden rounded-2xl border-2 bg-card flex flex-col items-center p-6 shadow-lg overflow-hidden">
            <Badge variant="secondary" className="mb-4 capitalize shrink-0">{current.cardType}</Badge>
            <div className="flex-1 w-full overflow-y-auto flex items-center justify-center">
              <p className="text-lg font-semibold text-center leading-relaxed" dir={isHebrew ? "rtl" : "ltr"}>{current.front}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-4 shrink-0">{isHebrew ? "לחץ להפוך" : "Click to flip"}</p>
          </div>
          <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-2xl border-2 border-primary/30 bg-primary/5 flex flex-col items-center p-6 shadow-lg overflow-hidden">
            <div className="flex-1 w-full overflow-y-auto flex items-center justify-center">
              <p className="text-base text-center leading-relaxed" dir={isHebrew ? "rtl" : "ltr"}>{current.back}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={index === 0}
          onClick={() => { setIndex(i => Math.max(0, i - 1)); setFlipped(false); }}
        >
          {isHebrew ? "הקודם" : "Previous"}
        </Button>
        <Button
          size="sm"
          disabled={index === cards.length - 1}
          onClick={() => { setIndex(i => Math.min(cards.length - 1, i + 1)); setFlipped(false); }}
        >
          {isHebrew ? "הבא" : "Next"}
        </Button>
      </div>
    </div>
  );
}

// navigator.share() opens the OS-native share sheet (WhatsApp, Messages,
// etc. on iOS/Android) so a recipient can re-share the kit with a friend in
// one tap -- falls back to a clipboard copy on desktop browsers that don't
// implement the Web Share API.
function NativeShareButton({ title, isHebrew }: { title: string; isHebrew: boolean }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // User dismissed the native share sheet -- not an error.
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast({ description: isHebrew ? "הקישור הועתק" : "Link copied" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={handleShare}>
      {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
      {isHebrew ? "שתפו" : "Share"}
    </Button>
  );
}

export const SharedViewPage: React.FC = () => {
  const { shareId } = useParams<{ shareId: string }>();
  const { isRTL } = useLanguage();
  const { data, isLoading, isError } = useGetSharedMaterial(shareId ?? "");

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="max-w-md mx-auto p-6 text-center space-y-3 mt-16">
        <h1 className="text-xl font-bold">{isRTL ? "הקישור לא נמצא" : "Link not found"}</h1>
        <p className="text-muted-foreground text-sm">
          {isRTL ? "ייתכן שהקישור שגוי או שהשיתוף בוטל." : "This link may be invalid or no longer shared."}
        </p>
        <Link href="/">
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            {isRTL ? "לעמוד הבית" : "Go home"}
          </Button>
        </Link>
      </div>
    );
  }

  const isHebrew = data.language === "he";
  const dir = isHebrew ? "rtl" : "ltr";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4 sm:p-8 space-y-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="w-4 h-4 text-primary" />
            {isHebrew ? "ערכת לימוד משותפת מ-FocusStudy" : "A shared FocusStudy study kit"}
          </div>
          <NativeShareButton title={data.title} isHebrew={isHebrew} />
        </div>

        <ConversionBanner isHebrew={isHebrew} variant="top" />

        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" dir={dir}>{data.title}</h1>

        {data.summary && (
          <div className="space-y-4">
            {!!data.summary.keyPoints?.length && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-5">
                  <h2 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground" dir={dir}>
                    {isHebrew ? "נקודות מפתח" : "Key Points"}
                  </h2>
                  <ul className="space-y-2">
                    {data.summary.keyPoints.map((point, i) => (
                      <li key={i} className={`flex items-start gap-2 ${isHebrew ? "flex-row-reverse text-right" : ""}`}>
                        <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                        <span className="text-sm leading-relaxed" dir={dir}>{point}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="p-6">
                <div dir={dir} className="prose prose-sm dark:prose-invert max-w-none leading-relaxed" style={{ textAlign: isHebrew ? "right" : "left" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.summary.content}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {data.flashcards.length > 0 && <FlashcardPreview cards={data.flashcards} isHebrew={isHebrew} />}

        <ConversionBanner isHebrew={isHebrew} variant="bottom" />
      </div>
    </div>
  );
};
