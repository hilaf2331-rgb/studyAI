import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

// A hard refresh on a deep route (e.g. /materials/123) can land here before
// auth/data has loaded, and a page component reading a missing/invalid
// param can throw during render -- without this boundary that's a blank
// white screen with no way back. Catching it and offering a way back to
// the dashboard turns a crash into a recoverable dead end.
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("AppErrorBoundary caught a render error:", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background" dir="rtl">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 space-y-4">
            <div className="flex mb-2 gap-2">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <h1 className="text-2xl font-bold text-foreground">משהו השתבש</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              אירעה שגיאה בטעינת העמוד הזה. נסו לחזור למסך הבית.
            </p>
            <Button className="w-full" onClick={() => { window.location.href = "/"; }}>
              חזרה למסך הבית
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
}
