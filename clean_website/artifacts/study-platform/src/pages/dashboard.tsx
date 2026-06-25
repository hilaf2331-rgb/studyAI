import React from "react";
import { Link } from "wouter";
import { useGetDashboardStats, useGetRecentActivity, useGetStudyStreak, useGetDailyReviewCount } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useLanguage } from "@/lib/i18n";
import { BackgroundGlow } from "@/components/background-glow";
import { BookOpen, BrainCircuit, FileQuestion, GraduationCap, Flame, Target, Clock, Sparkles, HelpCircle, MessageSquare, Upload, BookText } from "lucide-react";

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  upload: <Upload className="w-4 h-4" />,
  summary: <BookText className="w-4 h-4" />,
  flashcards: <BrainCircuit className="w-4 h-4" />,
  questions: <HelpCircle className="w-4 h-4" />,
  exam: <FileQuestion className="w-4 h-4" />,
  chat: <MessageSquare className="w-4 h-4" />,
};

const ACTIVITY_COLORS: Record<string, string> = {
  upload: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  summary: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  flashcards: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  questions: "bg-green-500/10 text-green-600 dark:text-green-400",
  exam: "bg-red-500/10 text-red-600 dark:text-red-400",
  chat: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
};

export const Dashboard: React.FC = () => {
  const { t, isRTL } = useLanguage();
  const { data: stats, isLoading: loadingStats } = useGetDashboardStats();
  const { data: activity, isLoading: loadingActivity } = useGetRecentActivity();
  const { data: streak } = useGetStudyStreak();
  const { data: dailyReview } = useGetDailyReviewCount();

  const statCards = [
    { label: t("totalCourses"), value: stats?.totalCourses ?? 0, icon: BookOpen, color: "text-blue-500", border: "border-s-blue-500" },
    { label: t("totalMaterials"), value: stats?.totalMaterials ?? 0, icon: GraduationCap, color: "text-purple-500", border: "border-s-purple-500" },
    { label: t("totalFlashcards"), value: stats?.totalFlashcards ?? 0, icon: BrainCircuit, color: "text-amber-500", border: "border-s-amber-500" },
    { label: t("averageScore"), value: `${stats?.averageScore ?? 0}%`, icon: Target, color: "text-green-500", border: "border-s-green-500" },
  ];

  return (
    <div className="relative space-y-10 animate-in fade-in duration-500">
      <BackgroundGlow className="-top-10 right-1/3 w-[26rem] h-[26rem] opacity-20" />

      {/* Header */}
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-tight">{t("dashboard")}</h1>
          <p className="text-muted-foreground mt-1.5 text-lg">
            {isRTL ? "ברוך הבא בחזרה. הנה ההתקדמות שלך." : "Welcome back. Here's your progress."}
          </p>
        </div>
        {streak && (
          <div className="flex items-center gap-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-4 py-2 rounded-xl">
            <Flame className="w-5 h-5" />
            <span className="font-bold text-lg">{streak.currentStreak}</span>
            <span className="text-sm font-medium">{t("studyStreak")}</span>
          </div>
        )}
      </div>

      {/* Today's Review Queue */}
      {!!dailyReview?.count && (
        <Link href="/review">
          <div className="flex items-center justify-between gap-4 p-5 rounded-xl border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <BrainCircuit className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold">{isRTL ? "סקירה יומית מוכנה" : "Today's Review is ready"}</p>
                <p className="text-sm text-muted-foreground">
                  {isRTL ? `${dailyReview.count} כרטיסיות ממתינות בכל החומרים שלך` : `${dailyReview.count} cards due across all your materials`}
                </p>
              </div>
            </div>
            <span className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold whitespace-nowrap">
              {isRTL ? `סקור ${dailyReview.count} כרטיסיות` : `Review ${dailyReview.count} Cards`}
            </span>
          </div>
        </Link>
      )}

      {/* Stat Cards */}
      <div className="relative z-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(s => (
          <Card key={s.label} className={`border-s-4 ${s.border} shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{s.label}</CardTitle>
              <s.icon className={`w-4 h-4 ${s.color}`} />
            </CardHeader>
            <CardContent className="pb-4 px-5">
              {loadingStats ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-black">{s.value}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Exam Readiness + Study Minutes */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">{isRTL ? "מוכנות למבחן" : "Exam Readiness"}</p>
                <Badge variant="outline" className="text-xs">{stats.examReadinessScore}%</Badge>
              </div>
              <Progress value={stats.examReadinessScore} className="h-2" />
              <p className="text-xs text-muted-foreground mt-2">
                {isRTL ? `${stats.totalExamsTaken} מבחנים הושלמו` : `${stats.totalExamsTaken} exams completed`}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">{t("studyMinutes")}</p>
                <Clock className="w-4 h-4 text-muted-foreground" />
              </div>
              <p className="text-3xl font-black">{stats.studyMinutesThisWeek}</p>
              <p className="text-xs text-muted-foreground mt-1">{isRTL ? "דקות השבוע" : "minutes this week"}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold mb-3">{isRTL ? "פעולות מהירות" : "Quick Actions"}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: "/materials/new", label: isRTL ? "הוסף חומר" : "Add Material", icon: Upload, color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20" },
            { href: "/courses", label: isRTL ? "הקורסים שלי" : "My Courses", icon: BookOpen, color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20" },
            { href: "/materials", label: isRTL ? "כל החומרים" : "All Materials", icon: GraduationCap, color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20" },
            { href: "/materials", label: isRTL ? "תרגל עכשיו" : "Practice Now", icon: Sparkles, color: "bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20" },
          ].map(a => (
            <Link key={a.href + a.label} href={a.href}>
              <div className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 hover:-translate-y-0.5 ${a.color}`}>
                <a.icon className="w-5 h-5 mb-2" />
                <p className="text-sm font-semibold">{a.label}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-lg font-semibold mb-3">{t("recentActivity")}</h2>
        {loadingActivity ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
        ) : !activity?.length ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{isRTL ? "אין פעילות עדיין. התחל ללמוד!" : "No activity yet. Start studying!"}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {activity.slice(0, 8).map(item => (
              <div key={item.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ACTIVITY_COLORS[item.activityType] || "bg-muted"}`}>
                    {ACTIVITY_ICONS[item.activityType] || <BookOpen className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium break-words sm:truncate">{item.description}</p>
                    {item.materialTitle && <p className="text-xs text-muted-foreground break-words sm:truncate">{item.materialTitle}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ps-11 sm:ps-0 sm:ms-auto">
                  {item.score !== null && item.score !== undefined && (
                    <Badge variant={item.score >= 60 ? "outline" : "secondary"} className={`text-xs shrink-0 ${item.score >= 60 ? "text-green-600 border-green-300" : ""}`}>
                      {item.score}%
                    </Badge>
                  )}
                  <p className="text-xs text-muted-foreground shrink-0">{new Date(item.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
