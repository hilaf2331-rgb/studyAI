import React from "react";
import { useGetTokenBalance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useLanguage } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Coins, FileText, GraduationCap, User } from "lucide-react";

export const ProfilePage: React.FC = () => {
  const { isRTL } = useLanguage();
  const { user } = useAuth();
  const { data: balance, isLoading } = useGetTokenBalance();

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
                  {isRTL
                    ? `מתוך ${balance.monthlyTokenQuota.toLocaleString()} בחודש`
                    : `of ${balance.monthlyTokenQuota.toLocaleString()} this month`}
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
