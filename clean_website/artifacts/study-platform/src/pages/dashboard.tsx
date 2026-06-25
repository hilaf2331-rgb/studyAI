import React from "react";
import { Link } from "wouter";
import { useGetDashboardStats, useGetRecentActivity, useGetStudyStreak, useGetDailyReviewCount } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useLanguage } from "@/lib/i18n";
import { BookOpen, BrainCircuit, FileQuestion, GraduationCap, Flame, Clock, Sparkles, HelpCircle, MessageSquare, Upload, BookText } from "lucide-react";
import { CourseGlyph, MaterialsGlyph, FlashcardGlyph, GradeGlyph } from "@/components/icons";

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

// The backend's `description` field is a raw, system-generated sentence
// (e.g. `Generated full exam kit for "study_material_test"`) meant for
// logs, not students. This maps it to a short, human action label so the
// activity feed can show "ערכת לימוד מלאה: <material>" instead of the
// full sentence -- the material's own title carries the specifics.
function getActivityLabel(description: string, isRTL: boolean): string {
  if (/full exam kit/i.test(description)) return isRTL ? "ערכת לימוד מלאה" : "Full study kit";
  if (/^Completed exam/i.test(description)) return isRTL ? "מבחן הושלם" : "Exam completed";
  if (/exam/i.test(description)) return isRTL ? "מבחן" : "Exam";
  if (/flashcards/i.test(description)) return isRTL ? "כרטיסיות לימוד" : "Flashcards";
  if (/questions/i.test(description)) return isRTL ? "שאלות תרגול" : "Practice quiz";
  if (/summary/i.test(description)) return isRTL ? "סיכום" : "Summary";
  if (/^Uploaded/i.test(description)) return isRTL ? "חומר הועלה" : "Material uploaded";
  if (/^Chatted/i.test(description)) return isRTL ? "שיחה עם המורה" : "Chat with tutor";
  if (/הקלטה/.test(description)) return isRTL ? "הקלטה ועיבוד" : "Recording processed";
  return description;
}

export const Dashboard: React.FC = () => {
  const { t, isRTL } = useLanguage();
  const { data: stats, isLoading: loadingStats } = useGetDashboardStats();
  const { data: activity, isLoading: loadingActivity } = useGetRecentActivity();
  const { data: streak } = useGetStudyStreak();
  const { data: dailyReview } = useGetDailyReviewCount();

  const statCards = [
    { label: t("totalCourses"), value: stats?.totalCourses ?? 0, icon: CourseGlyph, glow: "hover:shadow-indigo-500/25 hover:border-indigo-400/50" },
    { label: t("totalMaterials"), value: stats?.totalMaterials ?? 0, icon: MaterialsGlyph, glow: "hover:shadow-sky-500/25 hover:border-sky-400/50" },
    { label: t("totalFlashcards"), value: stats?.totalFlashcards ?? 0, icon: FlashcardGlyph, glow: "hover:shadow-amber-500/25 hover:border-amber-400/50" },
    { label: t("averageScore"), value: `${stats?.averageScore ?? 0}%`, icon: GradeGlyph, glow: "hover:shadow-emerald-500/25 hover:border-emerald-400/50" },
  ];

  return (
    <div className="relative space-y-12 animate-in fade-in duration-500">
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
          <div className="group flex items-center justify-between gap-4 p-5 rounded-xl border border-primary/30 bg-primary/5 backdrop-blur-md hover:bg-primary/10 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/20 transition-all duration-300 cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110">
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
          <Card key={s.label} className={`group border border-white/30 dark:border-white/10 bg-white/50 dark:bg-slate-900/40 backdrop-blur-md shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${s.glow}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{s.label}</CardTitle>
              <s.icon className="w-8 h-8 shrink-0 transition-transform duration-300 group-hover:scale-110" />
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
          <Card className="border border-white/30 dark:border-white/10 bg-white/50 dark:bg-slate-900/40 backdrop-blur-md shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/20 hover:border-emerald-400/40">
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
          <Card className="border border-white/30 dark:border-white/10 bg-white/50 dark:bg-slate-900/40 backdrop-blur-md shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-sky-500/20 hover:border-sky-400/40">
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
        <h2 className="text-lg font-black tracking-tight mb-3">{isRTL ? "פעולות מהירות" : "Quick Actions"}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: "/materials/new", label: isRTL ? "הוסף חומר" : "Add Material", icon: Upload, color: "bg-blue-500/10 text-blue-600 dark:text-blue-400", glow: "hover:shadow-blue-500/25 hover:border-blue-400/50" },
            { href: "/courses", label: isRTL ? "הקורסים שלי" : "My Courses", icon: BookOpen, color: "bg-purple-500/10 text-purple-600 dark:text-purple-400", glow: "hover:shadow-purple-500/25 hover:border-purple-400/50" },
            { href: "/materials", label: isRTL ? "כל החומרים" : "All Materials", icon: GraduationCap, color: "bg-amber-500/10 text-amber-600 dark:text-amber-400", glow: "hover:shadow-amber-500/25 hover:border-amber-400/50" },
            { href: "/materials", label: isRTL ? "תרגל עכשיו" : "Practice Now", icon: Sparkles, color: "bg-green-500/10 text-green-600 dark:text-green-400", glow: "hover:shadow-green-500/25 hover:border-green-400/50" },
          ].map(a => (
            <Link key={a.href + a.label} href={a.href}>
              <div className={`group p-4 rounded-xl border border-white/30 dark:border-white/10 backdrop-blur-md cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${a.color} ${a.glow}`}>
                <a.icon className="w-5 h-5 mb-2 transition-transform duration-300 group-hover:scale-110" />
                <p className="text-sm font-bold tracking-wide">{a.label}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-lg font-black tracking-tight mb-3">{t("recentActivity")}</h2>
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
          <div className="space-y-3">
            {activity.slice(0, 8).map(item => {
              const label = getActivityLabel(item.description, isRTL);
              const title = item.materialTitle ? `${label}: ${item.materialTitle}` : label;
              return (
                <div key={item.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-4 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ACTIVITY_COLORS[item.activityType] || "bg-muted"}`}>
                      {ACTIVITY_ICONS[item.activityType] || <BookOpen className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold break-words sm:truncate">{title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{new Date(item.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  {item.score !== null && item.score !== undefined && (
                    <div className="shrink-0 ps-11 sm:ps-0 sm:ms-auto">
                      <Badge variant={item.score >= 60 ? "outline" : "secondary"} className={`text-xs ${item.score >= 60 ? "text-green-600 border-green-300" : ""}`}>
                        {item.score}%
                      </Badge>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
