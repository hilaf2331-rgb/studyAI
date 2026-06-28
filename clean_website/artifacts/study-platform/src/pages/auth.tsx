import React, { useState, useMemo } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLanguage } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { BackgroundGlow } from "@/components/background-glow";
import { Loader2, AlertCircle, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";

interface PasswordRule {
  labelHe: string;
  labelEn: string;
  test: (pw: string) => boolean;
}

const PASSWORD_RULES: PasswordRule[] = [
  { labelHe: "לפחות 8 תווים",            labelEn: "At least 8 characters",           test: pw => pw.length >= 8 },
  { labelHe: "לפחות אות גדולה אחת (A-Z)", labelEn: "At least one uppercase letter",   test: pw => /[A-Z]/.test(pw) },
  { labelHe: "לפחות ספרה אחת (0-9)",     labelEn: "At least one number",             test: pw => /[0-9]/.test(pw) },
];

function validatePassword(pw: string): string | null {
  if (pw.length < 8)      return "הסיסמה חייבת להכיל לפחות 8 תווים";
  if (!/[A-Z]/.test(pw))  return "הסיסמה חייבת להכיל לפחות אות גדולה אחת";
  if (!/[0-9]/.test(pw))  return "הסיסמה חייבת להכיל לפחות ספרה אחת";
  return null;
}

export const AuthPage: React.FC = () => {
  const { login, register, isLoading } = useAuth();
  const { isRTL } = useLanguage();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [name, setName]         = useState("");
  const [error, setError]       = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [pwTouched, setPwTouched] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const ruleResults = useMemo(() =>
    PASSWORD_RULES.map(r => ({ ...r, passed: r.test(password) })),
    [password]
  );
  const allRulesPassed = ruleResults.every(r => r.passed);

  const switchMode = (next: "login" | "register") => {
    setMode(next); setError(""); setPwTouched(false);
    setPassword(""); setEmail(""); setName(""); setAgreedToTerms(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "register") {
      const pwError = validatePassword(password);
      if (pwError) { setError(pwError); setPwTouched(true); return; }
      if (!agreedToTerms) { setError("יש לאשר את התקנון ומדיניות הפרטיות כדי להמשיך"); return; }
    }

    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, name || undefined);
      }
    } catch (err: any) {
      const msg: string = err.message || "";
      // Surface friendly Hebrew messages for known server errors
      if (msg.includes("already exists"))    setError("כתובת האימייל הזו כבר רשומה במערכת");
      else if (msg.includes("Invalid email") || msg.includes("Invalid or")) setError("כתובת האימייל או הסיסמה שגויות");
      else if (msg.includes("8 characters")) setError("הסיסמה חייבת להכיל לפחות 8 תווים");
      else setError(msg || "אירעה שגיאה, נסה שנית");
    }
  };

  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center p-4 overflow-hidden" dir="rtl">
      <BackgroundGlow className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem]" />
      <BackgroundGlow className="-bottom-24 -left-24 w-[22rem] h-[22rem] opacity-60" />

      <div className="relative z-10 w-full max-w-md space-y-7">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center">
            <img src="/logo.png" alt="FocusStudy" className="w-14 h-14 object-contain" />
          </div>
          <h1
            className="text-3xl font-black tracking-tight"
            style={{
              backgroundImage: "linear-gradient(to left, hsl(170 75% 45%), hsl(195 85% 50%), hsl(217 85% 55%))",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              color: "#0891b2",
            }}
          >
            FocusStudy
          </h1>
          <p className="text-muted-foreground text-sm">פלטפורמת הלמידה החכמה שלך</p>
        </div>

        <Card className="border border-white/30 dark:border-white/10 bg-white/50 dark:bg-slate-900/45 backdrop-blur-md shadow-2xl shadow-primary/10">
          <CardHeader className="pb-4">
            <CardTitle>
              {mode === "login" ? "התחבר לחשבונך" : "צור חשבון חדש"}
            </CardTitle>
            <CardDescription>
              {mode === "login" ? "ברוך הבא בחזרה! הכנס את פרטיך" : "הצטרף אלינו — בחינם לחלוטין"}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">

              {mode === "register" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">שם (אופציונלי)</Label>
                  <Input id="name" type="text" placeholder="השם שלך" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">כתובת אימייל</Label>
                <Input id="email" type="email" placeholder="you@example.com" value={email}
                  onChange={e => setEmail(e.target.value)} required autoComplete="email" dir="ltr" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">סיסמה</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPw ? "text" : "password"}
                    placeholder={mode === "register" ? "בחר סיסמה חזקה" : "••••••••"}
                    value={password}
                    onChange={e => { setPassword(e.target.value); if (!pwTouched && e.target.value.length > 0) setPwTouched(true); }}
                    required
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    dir="ltr"
                    className="pe-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Password rules — only on register, once user starts typing */}
                {mode === "register" && pwTouched && (
                  <div className="mt-2 p-3 rounded-lg bg-muted/60 space-y-1.5 text-sm">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">דרישות הסיסמה:</p>
                    {ruleResults.map((r, i) => (
                      <div key={i} className={`flex items-center gap-2 transition-colors ${r.passed ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                        {r.passed
                          ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          : <XCircle className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />}
                        <span>{isRTL ? r.labelHe : r.labelEn}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Strength bar — register only */}
                {mode === "register" && password.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {[0, 1, 2].map(i => (
                      <div key={i} className={`h-1 flex-1 rounded-full transition-all ${
                        ruleResults.filter(r => r.passed).length > i
                          ? ruleResults.every(r => r.passed) ? "bg-green-500" : "bg-amber-400"
                          : "bg-muted"
                      }`} />
                    ))}
                  </div>
                )}
              </div>

              {mode === "register" && (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="agreeTerms"
                    checked={agreedToTerms}
                    onCheckedChange={(v) => setAgreedToTerms(v === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor="agreeTerms" className="text-sm font-normal leading-relaxed cursor-pointer">
                    בהרשמה לשירות, אני מסכים/ה ל
                    <Link href="/terms" className="text-primary font-medium hover:underline">תקנון השימוש</Link>
                    {" "}ול
                    <Link href="/privacy" className="text-primary font-medium hover:underline">מדיניות הפרטיות</Link>.
                  </Label>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 px-3 py-2.5 rounded-lg">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                className="w-full font-bold tracking-wide shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 transition-all duration-300"
                disabled={isLoading || (mode === "register" && pwTouched && !allRulesPassed) || (mode === "register" && !agreedToTerms)}
              >
                {isLoading
                  ? <><Loader2 className="w-4 h-4 me-2 animate-spin" />טוען...</>
                  : mode === "login" ? "התחבר" : "צור חשבון"}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              {mode === "login" ? (
                <>אין לך חשבון?{" "}
                  <button onClick={() => switchMode("register")} className="text-primary font-medium hover:underline">הירשם</button>
                </>
              ) : (
                <>כבר יש לך חשבון?{" "}
                  <button onClick={() => switchMode("login")} className="text-primary font-medium hover:underline">התחבר</button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <footer className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground hover:underline">תקנון ותנאי שימוש</Link>
          <span>•</span>
          <Link href="/privacy" className="hover:text-foreground hover:underline">מדיניות פרטיות</Link>
        </footer>
      </div>
    </div>
  );
};
