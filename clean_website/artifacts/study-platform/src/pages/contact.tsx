import React, { useState } from "react";
import { Link } from "wouter";
import { useSubmitContactMessage } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLanguage } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Mail, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { PublicPageHeader } from "@/components/public-page-header";

export const ContactPage: React.FC = () => {
  const { isRTL } = useLanguage();
  const { user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const submitContact = useSubmitContactMessage();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitContact.mutate({ data: { name, email, message } }, {
      onSuccess: () => {
        setSent(true);
        setMessage("");
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: isRTL ? "שליחת ההודעה נכשלה" : "Failed to send message",
          description: isRTL ? "נסו שוב בעוד מספר דקות" : "Please try again in a few minutes",
        });
      },
    });
  };

  return (
    <div className="max-w-xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Mail className="w-7 h-7 text-primary" />
          {isRTL ? "צור קשר" : "Contact Us"}
        </h1>
        <p className="text-muted-foreground mt-2 text-lg">
          {isRTL
            ? "נתקלתם בבעיות? יש לכם רעיונות לשיפור או לשימוש? שלחו הודעה!"
            : "Ran into a problem? Have an idea for a new feature? Send us a message!"}
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          {sent ? (
            <div className="flex flex-col items-center text-center gap-3 py-6">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
              <p className="font-semibold">{isRTL ? "ההודעה נשלחה בהצלחה!" : "Message sent successfully!"}</p>
              <p className="text-sm text-muted-foreground">
                {isRTL ? "נחזור אליכם בהקדם." : "We'll get back to you soon."}
              </p>
              <Button variant="outline" onClick={() => setSent(false)}>
                {isRTL ? "שליחת הודעה נוספת" : "Send another message"}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="contact-name">{isRTL ? "שם" : "Name"}</Label>
                <Input
                  id="contact-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder={isRTL ? "השם שלך" : "Your name"}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-email">{isRTL ? "אימייל" : "Email"}</Label>
                <Input
                  id="contact-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder={isRTL ? "האימייל שלך" : "your@email.com"}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-message">{isRTL ? "תוכן ההודעה" : "Message"}</Label>
                <Textarea
                  id="contact-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  rows={6}
                  placeholder={isRTL ? "כתבו לנו כל מה שעל הלב..." : "Tell us what's on your mind..."}
                />
              </div>

              {submitContact.isError && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{isRTL ? "שליחת ההודעה נכשלה. נסו שוב." : "Failed to send. Please try again."}</span>
                </div>
              )}

              <Button type="submit" className="w-full gap-2" disabled={submitContact.isPending}>
                {submitContact.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {isRTL ? "שליחה" : "Send"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// Logged-out rendering of the same form (see App.tsx's "/contact" branch,
// checked only while !user -- a logged-in visit still goes through the
// authenticated <Switch> and keeps the normal SidebarLayout chrome
// unchanged). ContactPage itself needs no auth to submit (POST /api/contact
// is mounted as a public route, see api-server's app.ts) -- this wrapper
// only adds the nav header that SidebarLayout would otherwise provide, so a
// visitor arriving with no account isn't dropped on a bare form with no way
// back to the rest of the site.
export const PublicContactPage: React.FC = () => (
  <div className="relative min-h-screen flex flex-col bg-background" dir="rtl">
    <PublicPageHeader
      links={
        <Link href="/pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-2">
          מחירים
        </Link>
      }
    />
    <main className="relative flex-1 flex items-start justify-center px-6 sm:px-10 py-8 sm:py-12">
      <ContactPage />
    </main>
  </div>
);
