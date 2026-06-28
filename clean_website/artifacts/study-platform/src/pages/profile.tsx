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
import { Coins, FileText, GraduationCap, User } from "lucide-react";

// Mirrors api-server's lib/tokens.ts FREE_TIER_MONTHLY_REFILL -- used only to
// tell which free-tier regime balance.monthlyTokenQuota currently reflects,
// so the label below doesn't keep claiming the one-time signup grant is "this
// month" forever.
const FREE_TIER_MONTHLY_REFILL = 5_000;

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "זכר" },
  { value: "female", label: "נקבה" },
  { value: "other", label: "אחר / לא לציין" },
];

// Dedicated key for the form-of-address preference -- read on mount and
// written on every change, independent of whatever the auth user object
// happens to hold, so the choice survives a refresh even if the user record
// itself gets refetched/overwritten without a gender field.
const PREFERRED_GENDER_KEY = "studyai_preferred_gender";

function readStoredGender(): Gender | null {
  const raw = localStorage.getItem(PREFERRED_GENDER_KEY);
  return raw === "male" || raw === "female" || raw === "other" ? raw : null;
}

export const ProfilePage: React.FC = () => {
  const { isRTL } = useLanguage();
  const { user, updateUser } = useAuth();
  const { data: balance, isLoading } = useGetTokenBalance();
  const { open: openPurchaseModal } = usePurchaseModal();

  const [gender, setGender] = React.useState<Gender>(
    () => readStoredGender() ?? user?.gender ?? "male",
  );

  const handleGenderChange = (value: Gender) => {
    setGender(value);
    localStorage.setItem(PREFERRED_GENDER_KEY, value);
    updateUser({ gender: value });
  };

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
            value={gender}
            onValueChange={(value) => handleGenderChange(value as Gender)}
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
                <span className="text-3xl font-black">{balance.tokensRemaining.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground">
                  {balance.monthlyTokenQuota > FREE_TIER_MONTHLY_REFILL
                    ? (isRTL
                        ? `מתוך ${balance.monthlyTokenQuota.toLocaleString()} שקיבלת בהרשמה`
                        : `of ${balance.monthlyTokenQuota.toLocaleString()} from your signup bonus`)
                    : (isRTL
                        ? `מתוך ${balance.monthlyTokenQuota.toLocaleString()} במכסה החינמית החודשית`
                        : `of ${balance.monthlyTokenQuota.toLocaleString()} in this month's free tier`)}
                </span>
              </div>
              <Progress value={100 - usedPercent} className="h-2" />

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
                  <FileText className="w-5 h-5 text-blue-500 shrink-0" />
                  <div>
                    <p className="text-lg font-bold leading-none">{balance.estimatedSummariesRemaining.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{isRTL ? "סיכומים נוספים" : "more summaries"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
                  <GraduationCap className="w-5 h-5 text-purple-500 shrink-0" />
                  <div>
                    <p className="text-lg font-bold leading-none">{balance.estimatedExamsRemaining.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{isRTL ? "מבחני תרגול נוספים" : "more practice exams"}</p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {isRTL
                  ? "ההערכה היא משוערת בלבד ומשתנה בהתאם לאורך החומר ולסוג היצירה."
                  : "This estimate is approximate and varies with material length and generation type."}
              </p>

              {balance.tokenBalance > 0 && (
                <p className="text-xs text-muted-foreground">
                  {isRTL
                    ? `+ ${balance.tokenBalance.toLocaleString()} טוקנים שנרכשו, שאינם פגים בסוף החודש`
                    : `+ ${balance.tokenBalance.toLocaleString()} purchased tokens, which never expire`}
                </p>
              )}

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
