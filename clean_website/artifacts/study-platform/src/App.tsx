import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { LanguageProvider } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { AppErrorBoundary } from "@/components/error-boundary";
import NotFound from "@/pages/not-found";
import { setAuthTokenGetter } from "@workspace/api-client-react";

import { Dashboard } from "@/pages/dashboard";
import { CoursesPage } from "@/pages/courses";
import { CourseDetailPage } from "@/pages/course-detail";
import { MaterialsPage } from "@/pages/materials";
import { MaterialNewPage } from "@/pages/material-new";
import { MaterialDetailPage } from "@/pages/material-detail";
import { SummaryViewPage } from "@/pages/summary-view";
import { FlashcardStudyPage } from "@/pages/flashcard-study";
import { DailyReviewPage } from "@/pages/daily-review";
import { QuestionsPracticePage } from "@/pages/questions-practice";
import { ExamTakePage } from "@/pages/exam-take";
import { ExamResultPage } from "@/pages/exam-result";
import { ChatPage } from "@/pages/chat";
import { AuthPage } from "@/pages/auth";
import { LandingPage } from "@/pages/landing";
import { RecorderPage } from "@/pages/recorder";
import { ProfilePage } from "@/pages/profile";
import { TermsPage } from "@/pages/terms";
import { PrivacyPage } from "@/pages/privacy";

import { getStoredToken } from "@/lib/auth";

setAuthTokenGetter(() => getStoredToken());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function AppRoutes() {
  const { user } = useAuth();
  const [location] = useLocation();

  // Legal pages must stay reachable with no login required -- the payment
  // gateway's approval process and logged-out visitors both need to read
  // them, so they're checked before the auth gate below.
  if (location === "/terms") return <TermsPage />;
  if (location === "/privacy") return <PrivacyPage />;

  if (!user) {
    // Logged-out visitors land on the marketing page at "/"; the login
    // gate itself lives at "/login" (linked from the landing page's nav
    // button and bottom CTA) -- any other path also falls back to it.
    if (location === "/") return <LandingPage />;
    return <AuthPage />;
  }

  return (
    <SidebarLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/courses" component={CoursesPage} />
        <Route path="/courses/:id" component={CourseDetailPage} />
        <Route path="/materials" component={MaterialsPage} />
        <Route path="/materials/new" component={MaterialNewPage} />
        <Route path="/materials/:id" component={MaterialDetailPage} />
        <Route path="/materials/:id/chat" component={ChatPage} />
        <Route path="/summaries/:id" component={SummaryViewPage} />
        <Route path="/review" component={DailyReviewPage} />
        <Route path="/flashcards/:id" component={FlashcardStudyPage} />
        <Route path="/questions/:id" component={QuestionsPracticePage} />
        <Route path="/exams/:id/result/:resultId" component={ExamResultPage} />
        <Route path="/exams/:id" component={ExamTakePage} />
        <Route path="/recorder" component={RecorderPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route component={NotFound} />
      </Switch>
    </SidebarLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <LanguageProvider>
          <AuthProvider>
            <TooltipProvider>
              <AppErrorBoundary>
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <AppRoutes />
                </WouterRouter>
              </AppErrorBoundary>
              <Toaster />
            </TooltipProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
