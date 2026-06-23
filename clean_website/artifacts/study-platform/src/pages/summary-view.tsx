import React from "react";
import { useParams } from "wouter";
import { useGetSummary } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const SummaryViewPage: React.FC = () => {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const { isRTL } = useLanguage();
  const { data: summary, isLoading } = useGetSummary(id, { query: { enabled: !!id } });

  if (isLoading) return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16" />)}
    </div>
  );
  if (!summary) return <p className="text-muted-foreground">לא נמצא</p>;

  const isHebrew = summary.language === "he";
  const dir = isHebrew ? "rtl" : "ltr";

  const summaryTypeLabel: Record<string, string> = {
    quick: isHebrew ? "סיכום קצר" : "Quick Summary",
    detailed: isHebrew ? "סיכום מפורט" : "Detailed Summary",
    chapter: isHebrew ? "סיכום לפי פרקים" : "Chapter Summary",
    topic: isHebrew ? "סיכום נושאי" : "Topic Summary",
    key_takeaways: isHebrew ? "עיקרי הדברים" : "Key Takeaways",
    exam_focused: isHebrew ? "סיכום ממוקד מבחן" : "Exam-Focused Summary",
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => window.history.back()}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
      >
        <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
        {isRTL ? "חזרה" : "Back"}
      </button>

      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight flex-1" dir={dir}>
          {summaryTypeLabel[summary.summaryType] ?? summary.summaryType}
        </h1>
        <Badge variant="outline">{isHebrew ? "עברית" : "English"}</Badge>
      </div>

      {summary.keyPoints && summary.keyPoints.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-5">
            <h2
              className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground"
              dir={dir}
            >
              {isHebrew ? "✦ נקודות מפתח לבחינה" : "✦ Key Points for the Exam"}
            </h2>
            <ul className="space-y-2">
              {summary.keyPoints.map((point, i) => (
                <li key={i} className={`flex items-start gap-2 ${isHebrew ? "flex-row-reverse text-right" : ""}`}>
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  <span className="text-sm leading-relaxed" dir={dir}>{point}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6">
          <div
            dir={dir}
            className="prose prose-sm dark:prose-invert max-w-none leading-relaxed"
            style={{ textAlign: isHebrew ? "right" : "left" }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-xl font-bold mt-6 mb-3 pb-2 border-b border-border">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-semibold mt-5 mb-2 text-primary">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-semibold mt-4 mb-1.5">{children}</h3>
                ),
                p: ({ children }) => (
                  <p className="mb-3 leading-relaxed">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className={`mb-3 space-y-1 ${isHebrew ? "pr-5 list-disc" : "pl-5 list-disc"}`}>{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className={`mb-3 space-y-1 ${isHebrew ? "pr-5 list-decimal" : "pl-5 list-decimal"}`}>{children}</ol>
                ),
                li: ({ children }) => (
                  <li className="text-sm leading-relaxed">{children}</li>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-foreground">{children}</strong>
                ),
                blockquote: ({ children }) => (
                  <blockquote className={`border-primary bg-primary/5 py-2 px-4 rounded-md my-3 italic ${isHebrew ? "border-r-4" : "border-l-4"}`}>
                    {children}
                  </blockquote>
                ),
                code: ({ children, className }) => {
                  const isBlock = className?.includes("language-");
                  if (isBlock) {
                    return (
                      <pre className="bg-muted rounded-lg p-4 overflow-x-auto my-3">
                        <code className="text-xs font-mono">{children}</code>
                      </pre>
                    );
                  }
                  return <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>;
                },
              }}
            >
              {summary.content}
            </ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
