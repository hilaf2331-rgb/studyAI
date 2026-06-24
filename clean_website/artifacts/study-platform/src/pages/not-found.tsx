import { useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

// Reached both for genuinely unknown routes and as the SPA fallback's
// landing point on a hard refresh before client routing has fully taken
// over -- auto-redirecting to the dashboard after a moment, with a manual
// button as a backstop, means a stale/bad URL never strands the user here.
export default function NotFound() {
  const [, navigate] = useLocation();

  useEffect(() => {
    const timer = setTimeout(() => navigate("/"), 3000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background" dir="rtl">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6 space-y-4">
          <div className="flex mb-2 gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">404 — הדף לא נמצא</h1>
          </div>

          <p className="text-sm text-muted-foreground">
            העמוד שחיפשתם לא קיים או שהוסר. מעבירים אתכם למסך הבית...
          </p>

          <Button className="w-full" onClick={() => navigate("/")}>
            חזרה למסך הבית
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
