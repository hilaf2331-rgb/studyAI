import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { LanguageProvider } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/lib/auth";
import { PurchaseModalProvider } from "@/lib/purchase-modal";
import { PurchaseCelebrationProvider } from "@/lib/purchase-celebration";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { PageTransition } from "@/components/page-transition";
import { AppErrorBoundary } from "@/components/error-boundary";
import { Spinner } from "@/components/ui/spinner";
import NotFound from "@/pages/not-found";
import { setAuthTokenGetter, saveSharedMaterial } from "@workspace/api-client-react";
import { PENDING_SAVE_SHARE_ID_KEY } from "@/pages/shared-view";
import { useToast } from "@/hooks/use-toast";

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
import { ContactPage } from "@/pages/contact";
import { TermsPage } from "@/pages/terms";
import { PrivacyPage } from "@/pages/privacy";
import { SharedViewPage } from "@/pages/shared-view";

import { getStoredToken } from "@/lib/auth";

setAuthTokenGetter(() => getStoredToken());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function AppRoutes() {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();

  // The authenticated <Switch> below has no "/login" route. Right after a
  // successful login/register, `user` flips truthy on the same render where
  // `location` is still "/login" -- this effect bounces wouter's own
  // location state to "/" so it catches up with the auth state.
  useEffect(() => {
    if (user && location === "/login") {
      setLocation("/");
    }
  }, [user, location, setLocation]);

  // Completes the "Save to My Courses" flow for a visitor who wasn't logged
  // in when they clicked it on the shared-view page -- that click stashed
  // the shareId here instead of saving immediately, then sent them to
  // "/login" to sign up. Once `user` flips truthy (signup/login resolved),
  // fire the save automatically so they never have to find their way back
  // to the original shared link and click the button again.
  useEffect(() => {
    if (!user) return;
    const pendingShareId = localStorage.getItem(PENDING_SAVE_SHARE_ID_KEY);
    if (!pendingShareId) return;
    localStorage.removeItem(PENDING_SAVE_SHARE_ID_KEY);
    saveSharedMaterial(pendingShareId)
      .then(() => toast({ description: "הערכה נשמרה לחומרי הלימוד שלך" }))
      .catch(() => toast({ variant: "destructive", description: "השמירה נכשלה, נסו שנית" }));
  }, [user, toast]);

  // Legal pages must stay reachable with no login required -- the payment
  // gateway's approval process and logged-out visitors both need to read
  // them, so they're checked before the auth/loading gates below.
  if (location === "/terms") return <PageTransition locationKey={location}><TermsPage /></PageTransition>;
  if (location === "/privacy") return <PageTransition locationKey={location}><PrivacyPage /></PageTransition>;

  // Lets the logo in the authenticated sidebar jump straight to the
  // marketing page even though "/" itself renders <Dashboard> once logged
  // in -- without this, there'd be no way to reach <LandingPage> again
  // without logging out first.
  if (location === "/landing") return <PageTransition locationKey={location}><LandingPage /></PageTransition>;

  // Shared study-kit links are the whole point of the feature: a classmate
  // who clicks one has no FocusStudy session at all, so this has to be
  // reachable before the logged-out/loading gates below ever run. Rendered
  // via a standalone <Route> (no enclosing <Switch>) purely so SharedViewPage
  // can read :shareId through wouter's normal useParams, instead of this
  // component having to parse the path itself.
  if (location.startsWith("/shared/")) {
    return (
      <PageTransition locationKey={location}>
        <Route path="/shared/:shareId" component={SharedViewPage} />
      </PageTransition>
    );
  }

  // Auth state hasn't resolved yet (a login/register request is in flight).
  // `user` can flip from null -> truthy on the very next render, so routes
  // must not be evaluated against a half-resolved auth state -- that's what
  // let the unauthenticated branch below commit to <AuthPage/>, or the
  // authenticated <Switch> commit to its <NotFound/> catch-all, for a single
  // frame before flipping again. Render an empty, same-background frame and
  // wait instead.
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Spinner className="size-8 text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    // Logged-out visitors land on the marketing page at "/"; the login
    // gate itself lives at "/login" (linked from the landing page's nav
    // button and bottom CTA) -- any other path also falls back to it.
    if (location === "/") return <PageTransition locationKey={location}><LandingPage /></PageTransition>;
    return <PageTransition locationKey={location}><AuthPage /></PageTransition>;
  }

  // `user` is already truthy but the redirect effect above hasn't committed
  // the "/" URL change yet (it only fires after this render commits).
  // Returning null for that one frame would unmount <SidebarLayout> and, a
  // frame later, remount <Dashboard>/<BackgroundGlow> from scratch -- which
  // is exactly the "glow flashes in then vanishes" symptom. Instead, tell
  // the <Switch> below to match "/" immediately via wouter's `location`
  // override prop, so <SidebarLayout> and <Dashboard> never unmount at all.
  const matchLocation = location === "/login" ? "/" : location;

  return (
    <SidebarLayout>
      <Switch location={matchLocation}>
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
        <Route path="/contact" component={ContactPage} />
        <Route component={NotFound} />
      </Switch>
    </SidebarLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <LanguageProvider>
          <AuthProvider>
            <PurchaseCelebrationProvider>
              <PurchaseModalProvider>
                <TooltipProvider>
                  <AppErrorBoundary>
                    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                      <AppRoutes />
                    </WouterRouter>
                  </AppErrorBoundary>
                  <Toaster />
                </TooltipProvider>
              </PurchaseModalProvider>
            </PurchaseCelebrationProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
