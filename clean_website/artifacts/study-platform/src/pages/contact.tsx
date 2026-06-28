import React, { useState } from "react";
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
