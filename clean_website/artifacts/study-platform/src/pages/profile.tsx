import React from "react";
import { useGetTokenBalance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/lib/i18n";
import { useAuth, type Gender } from "@/lib/auth";
import { usePurchaseModal } from "@/lib/purchase-modal";
import { Coins, FileText, Mic, Sparkles, User } from "lucide-react";

// Mirrors api-server's lib/tokens.ts FREE_TIER_MONTHLY_REFILL (already
// converted to whole Tokens by the API) -- used only to tell which free-tier
// regime balance.monthlyTokenQuota currently reflects, so the label below
// doesn't keep claiming the one-time signup grant is "this month" forever.
const FREE_TIER_MONTHLY_REFILL = 1;

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "זכר" },
  { value: "female", label: "נקבה" },
  { value: "other", label: "אחר / לא לציין" },
];

export const ProfilePage: React.FC = () => {
  const { isRTL } = useLanguage();
  const { user, updateUser } = useAuth();
  const { data: balance, isLoading } = useGetTokenBalance();
  const { open: openPurchaseModal } = usePurchaseModal();

  // The free-tier quota bar only ever describes balance.tokensRemaining --
  // it's meaningless once the user has purchased tokens (that pool is
  // uncapped), so it's only rendered below when tokenBalance is 0.
  const usedPercent = balance && balance.monthlyTokenQuota > 0
    ? Math.min(100, Math.round(((balance.monthlyTokenQuota - balance.tokensRemaining) / balance.monthlyTokenQuota) * 100))
    : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">{isRTL ? "פרופיל" : "Profile"}</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          {isRTL ? "פרטי החשבון ומכסת השימוש שלך" : "Your account details and usage quota"}
        </p>
      </div>

      <Card>
        <CardContent className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <User className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold truncate">{user?.name || (isRTL ? "ללא שם" : "No name")}</p>
            <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isRTL ? "פנייה אישית" : "Personal Greeting"}</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={user?.gender ?? "male"}
            onValueChange={(value) => updateUser({ gender: value as Gender })}
            className="flex flex-wrap gap-4"
          >
            {GENDER_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-center gap-2">
                <RadioGroupItem value={option.value} id={`gender-${option.value}`} />
                <Label htmlFor={`gender-${option.value}`}>{option.label}</Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="w-5 h-5 text-amber-500" />
            {isRTL ? "טוקנים שנותרו" : "Tokens Remaining"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading || !balance ? (
            <>
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-2 w-full" />
            </>
          ) : (
            <>
              <div className="flex items-end justify-between">
                <span className="text-3xl font-black">{balance.totalTokens.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground">
                  {isRTL ? "סה״כ טוקנים זמינים" : "total tokens available"}
                </span>
              </div>

              {/* Under the granular ~0.3-Token-per-generation model, "2 Tokens"
                  alone reads as scarce -- this reframes the same balance as
                  "enough for ~6 generations" so it feels like real runway,
                  not a number ticking down to zero. */}
              <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>
                  {isRTL
                    ? `מספיק לכ-${balance.estimatedSummariesRemaining.toLocaleString()} סיכומים, חידונים או ערכות כרטיסיות`
                    : `Enough for ~${balance.estimatedSummariesRemaining.toLocaleString()} summaries, quizzes, or flashcard decks`}
                </span>
              </div>

              {balance.tokenBalance > 0 ? (
                // Once any tokens have been purchased, the free quota no
                // longer represents a real ceiling on the total -- so it's
                // shown as a breakdown line instead of an "out of X" bar
                // that would otherwise imply the user is capped at 200,000.
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    {isRTL
                      ? `${balance.tokensRemaining.toLocaleString()} מהמכסה החינמית${balance.monthlyTokenQuota > FREE_TIER_MONTHLY_REFILL ? " שקיבלת בהרשמה" : " החודשית"}`
                      : `${balance.tokensRemaining.toLocaleString()} from your ${balance.monthlyTokenQuota > FREE_TIER_MONTHLY_REFILL ? "signup bonus" : "monthly free tier"}`}
                  </p>
                  <p>
                    {isRTL
                      ? `+ ${balance.tokenBalance.toLocaleString()} טוקנים שנרכשו, שאינם פגים`
                      : `+ ${balance.tokenBalance.toLocaleString()} purchased tokens, which never expire`}
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {balance.monthlyTokenQuota > FREE_TIER_MONTHLY_REFILL
                      ? (isRTL
                          ? `מתוך ${balance.monthlyTokenQuota.toLocaleString()} שקיבלת בהרשמה`
                          : `of ${balance.monthlyTokenQuota.toLocaleString()} from your signup bonus`)
                      : (isRTL
                          ? `מתוך ${balance.monthlyTokenQuota.toLocaleString()} במכסה החינמית החודשית`
                          : `of ${balance.monthlyTokenQuota.toLocaleString()} in this month's free tier`)}
                  </p>
                  <Progress value={100 - usedPercent} className="h-2" />
                </>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
                  <Mic className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-lg font-bold leading-none">{balance.estimatedTranscriptionMinutesRemaining.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{isRTL ? "דקות תמלול נוספות" : "more transcription minutes"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
                  <FileText className="w-5 h-5 text-blue-500 shrink-0" />
                  <div>
                    <p className="text-lg font-bold leading-none">{balance.estimatedSummaryPagesRemaining.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{isRTL ? "עמודי סיכום נוספים" : "more summary pages"}</p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {isRTL
                  ? "1 טוקן = 10 דקות תמלול, או 5 עמודי סיכום של חומר מקור."
                  : "1 Token = 10 minutes of transcription, or 5 pages of source material summarized."}
              </p>

              <button
                onClick={openPurchaseModal}
                className="w-full text-center text-sm font-medium text-primary hover:underline pt-1"
              >
                {isRTL ? "רוצים עוד טוקנים? לחצו כאן לטעינה" : "Want more tokens? Click here to top up"}
              </button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
