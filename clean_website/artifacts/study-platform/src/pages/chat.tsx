import React, { useState, useRef, useEffect } from "react";
import { useParams } from "wouter";
import {
  useGetChatHistory, useSendChatMessage, useGetMaterial,
  getGetChatHistoryQueryKey, getGetMaterialQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Send, BrainCircuit, Loader2 } from "lucide-react";

export const ChatPage: React.FC = () => {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const { isRTL, language } = useLanguage();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: material } = useGetMaterial(id, { query: { enabled: !!id, queryKey: getGetMaterialQueryKey(id) } });
  const { data: messages, isLoading } = useGetChatHistory(id, { query: { enabled: !!id, queryKey: getGetChatHistoryQueryKey(id) } });
  const sendMessage = useSendChatMessage();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || sendMessage.isPending) return;
    const content = input.trim();
    setInput("");
    sendMessage.mutate({
      id,
      data: { content, language: language as "he" | "en" }
    }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetChatHistoryQueryKey(id) }),
    });
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b shrink-0">
        <button onClick={() => window.history.back()} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className={`w-5 h-5 ${isRTL ? "rotate-180" : ""}`} />
        </button>
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <BrainCircuit className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="font-semibold text-sm">{isRTL ? "מורה AI" : "AI Tutor"}</p>
          {material && <p className="text-xs text-muted-foreground truncate max-w-xs">{material.title}</p>}
        </div>
        {material && <Badge variant="outline" className="ms-auto text-xs">{material.language === "he" ? "עברית" : material.language === "mixed" ? "מעורב" : "אנגלית"}</Badge>}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
        {isLoading ? (
          <div className="space-y-3">{[1,2].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : !messages?.length ? (
          <div className="text-center py-16 text-muted-foreground">
            <BrainCircuit className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">{isRTL ? "שאל אותי על החומר" : "Ask me anything about the material"}</p>
            <p className="text-xs mt-1 opacity-60">{isRTL ? "אענה על בסיס תוכן החומר שהעלית" : "I'll answer based on your uploaded content"}</p>
          </div>
        ) : (
          messages.map(msg => {
            const isUser = msg.role === "user";
            const isHebrew = msg.content.match(/[\u0590-\u05FF]/) !== null;
            return (
              <div key={msg.id} className={`flex ${isUser ? (isRTL ? "justify-start" : "justify-end") : (isRTL ? "justify-end" : "justify-start")}`}>
                <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  isUser
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted rounded-bl-sm"
                }`} dir={isHebrew ? "rtl" : "ltr"}>
                  {msg.content}
                </div>
              </div>
            );
          })
        )}
        {sendMessage.isPending && (
          <div className={`flex ${isRTL ? "justify-end" : "justify-start"}`}>
            <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{isRTL ? "מעבד..." : "Thinking..."}</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="pt-4 border-t shrink-0">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={isRTL ? "שאל שאלה על החומר... (Enter לשליחה)" : "Ask a question about the material... (Enter to send)"}
            className="resize-none min-h-[44px] max-h-32"
            dir={isRTL ? "rtl" : "ltr"}
            rows={1}
          />
          <Button size="icon" onClick={handleSend} disabled={!input.trim() || sendMessage.isPending}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
