import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Shared markdown renderer for AI-generated summary content -- used by both
// summary-view.tsx (a single material's summary) and the Marathon session
// page (an exam-focused summary shown as one step of the cram run), so the
// glossary-highlight/code/heading styling only has to be maintained once.
export const SummaryMarkdown: React.FC<{ content: string; isHebrew: boolean }> = ({ content, isHebrew }) => {
  const dir = isHebrew ? "rtl" : "ltr";
  return (
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
          // AI-generated glossary highlights ride on the "glossary:"
          // markdown-link scheme (see ai.ts's buildGlossaryContext) -- a
          // custom URL scheme rather than raw HTML/a new syntax, so it
          // renders correctly through the existing remark-gfm-only pipeline
          // with no extra dependency. Real links still pass through untouched.
          a: ({ href, title, children }) => {
            if (href?.startsWith("glossary:")) {
              return (
                <mark
                  title={title}
                  className="bg-primary/15 text-primary font-medium rounded px-1 not-italic cursor-help"
                >
                  {children}
                </mark>
              );
            }
            return (
              <a href={href} title={title} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
