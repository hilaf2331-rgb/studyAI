import React, { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useListCourses, getListMaterialsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Upload, FileText, Youtube, Link, Mic, FileVideo, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { getStoredToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api-base";

type ContentType = "text" | "youtube" | "url" | "pdf" | "audio" | "video";

const TYPE_CONFIG: Record<ContentType, {
  icon: React.ElementType;
  labelHe: string;
  labelEn: string;
  color: string;
  acceptsFile: boolean;
  acceptAttr?: string;
}> = {
  text:    { icon: FileText,  labelHe: "טקסט",        labelEn: "Text",          color: "bg-blue-500/10 text-blue-600",   acceptsFile: false },
  youtube: { icon: Youtube,   labelHe: "YouTube",      labelEn: "YouTube",       color: "bg-red-500/10 text-red-600",     acceptsFile: false },
  url:     { icon: Link,      labelHe: "קישור",        labelEn: "Web URL",       color: "bg-green-500/10 text-green-600", acceptsFile: false },
  pdf:     { icon: FileText,  labelHe: "PDF",          labelEn: "PDF",           color: "bg-amber-500/10 text-amber-600", acceptsFile: true,  acceptAttr: ".pdf,application/pdf" },
  audio:   { icon: Mic,       labelHe: "הקלטה קולית", labelEn: "Voice / Audio", color: "bg-purple-500/10 text-purple-600", acceptsFile: true, acceptAttr: "audio/*,.mp3,.m4a,.wav,.ogg,.webm" },
  video:   { icon: FileVideo, labelHe: "וידאו",        labelEn: "Video File",    color: "bg-indigo-500/10 text-indigo-600", acceptsFile: true, acceptAttr: "video/*,.mp4,.webm,.mov" },
};

export const MaterialNewPage: React.FC = () => {
  const { isRTL } = useLanguage();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { data: courses } = useListCourses();

  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<ContentType>("text");
  const [language, setLanguage] = useState("he");
  const [courseId, setCourseId] = useState<string>("");
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cfg = TYPE_CONFIG[contentType];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.[^/.]+$/, ""));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!title.trim()) { setError(isRTL ? "יש להזין כותרת" : "Title is required"); return; }
    if ((contentType === "youtube" || contentType === "url") && !sourceUrl.trim()) {
      setError(isRTL ? "יש להזין קישור" : "URL is required"); return;
    }
    if (cfg.acceptsFile && !file) {
      setError(isRTL ? "יש לבחור קובץ" : "Please select a file"); return;
    }

    setIsSubmitting(true);
    try {
      const token = getStoredToken();
      let response: Response;

      if (cfg.acceptsFile && file) {
        const fd = new FormData();
        fd.append("title", title.trim());
        fd.append("contentType", contentType);
        fd.append("language", language);
        if (courseId) fd.append("courseId", courseId);
        fd.append("file", file);

        response = await fetch(apiUrl("/api/materials"), {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      } else {
        response = await fetch(apiUrl("/api/materials"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: title.trim(),
            contentType,
            language,
            courseId: courseId ? Number(courseId) : undefined,
            text: contentType === "text" ? text : undefined,
            sourceUrl: (contentType === "youtube" || contentType === "url") ? sourceUrl : undefined,
          }),
        });
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create material");
      }

      const material = await response.json();
      qc.invalidateQueries({ queryKey: getListMaterialsQueryKey() });
      setLocation(`/materials/${material.id}`);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <button onClick={() => setLocation("/materials")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm">
        <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
        {isRTL ? "חזרה לחומרים" : "Back to Materials"}
      </button>

      <Card>
        <CardHeader>
          <CardTitle>{isRTL ? "הוסף חומר לימוד חדש" : "Add New Study Material"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {isRTL
              ? "הוסף חומר לימוד — טקסט, קישור YouTube, PDF, הקלטה קולית ועוד"
              : "Add study material — text, YouTube link, PDF, voice recording and more"}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Content Type Picker */}
            <div>
              <Label className="mb-2 block">{isRTL ? "סוג חומר" : "Content Type"}</Label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(TYPE_CONFIG) as ContentType[]).map(ct => {
                  const c = TYPE_CONFIG[ct];
                  const Icon = c.icon;
                  const active = contentType === ct;
                  return (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => { setContentType(ct); setFile(null); setSourceUrl(""); }}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-sm font-medium
                        ${active ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-xs">{isRTL ? c.labelHe : c.labelEn}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="title">{isRTL ? "כותרת" : "Title"}</Label>
              <Input
                id="title"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={isRTL ? "לדוגמה: פרק 3 — מכניקת קוונטים" : "e.g. Chapter 3 — Quantum Mechanics"}
                required
              />
            </div>

            {/* Language + Course row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{isRTL ? "שפת החומר" : "Content Language"}</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="he">עברית</SelectItem>
                    <SelectItem value="en">אנגלית</SelectItem>
                    <SelectItem value="mixed">מעורב</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {courses && courses.length > 0 && (
                <div className="space-y-1.5">
                  <Label>{isRTL ? "קורס (אופציונלי)" : "Course (optional)"}</Label>
                  <Select value={courseId} onValueChange={setCourseId}>
                    <SelectTrigger><SelectValue placeholder={isRTL ? "ללא קורס" : "No course"} /></SelectTrigger>
                    <SelectContent>
                      {courses.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Text input */}
            {contentType === "text" && (
              <div className="space-y-1.5">
                <Label htmlFor="text">{isRTL ? "תוכן הטקסט" : "Text Content"}</Label>
                <Textarea
                  id="text"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={isRTL ? "הדבק את תוכן הטקסט כאן — הרצאה, ספר לימוד, מאמר..." : "Paste your text here — lecture notes, textbook, article..."}
                  className="min-h-48 font-mono text-sm"
                  dir={language === "he" ? "rtl" : "ltr"}
                />
              </div>
            )}

            {/* URL inputs */}
            {(contentType === "youtube" || contentType === "url") && (
              <div className="space-y-1.5">
                <Label htmlFor="sourceUrl">
                  {contentType === "youtube" ? "YouTube URL" : (isRTL ? "כתובת URL" : "Web URL")}
                </Label>
                <Input
                  id="sourceUrl"
                  type="url"
                  value={sourceUrl}
                  onChange={e => setSourceUrl(e.target.value)}
                  placeholder={contentType === "youtube"
                    ? "https://www.youtube.com/watch?v=..."
                    : "https://..."}
                  dir="ltr"
                />
                {contentType === "youtube" && (
                  <p className="text-xs text-muted-foreground">
                    {isRTL
                      ? "StudyAI יחלץ את הטרנסקריפט ויעבד אותו אוטומטית"
                      : "StudyAI will extract the transcript and process it automatically"}
                  </p>
                )}
              </div>
            )}

            {/* File upload */}
            {cfg.acceptsFile && (
              <div className="space-y-1.5">
                <Label>{isRTL
                  ? `העלאת קובץ ${cfg.labelHe}`
                  : `Upload ${cfg.labelEn} file`}
                </Label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
                    ${file ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={cfg.acceptAttr}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  {file ? (
                    <div className="space-y-1">
                      <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto" />
                      <p className="font-medium text-sm">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
                      <p className="text-sm font-medium">
                        {isRTL ? "לחץ להעלאת קובץ" : "Click to upload file"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {contentType === "pdf" && (isRTL ? "PDF עד 25MB" : "PDF up to 25MB")}
                        {contentType === "audio" && (isRTL ? "MP3, M4A, WAV, OGG עד 25MB" : "MP3, M4A, WAV, OGG up to 25MB")}
                        {contentType === "video" && (isRTL ? "MP4, WebM, MOV עד 25MB" : "MP4, WebM, MOV up to 25MB")}
                      </p>
                    </div>
                  )}
                </div>
                {contentType === "audio" && (
                  <p className="text-xs text-muted-foreground">
                    {isRTL
                      ? "ההקלטה תתומלל אוטומטית בעברית באמצעות Groq Whisper"
                      : "Recording will be auto-transcribed using Groq Whisper"}
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting
                ? <><Loader2 className="w-4 h-4 me-2 animate-spin" />{isRTL ? "מעבד..." : "Processing..."}</>
                : <><Upload className="w-4 h-4 me-2" />{isRTL ? "הוסף חומר" : "Add Material"}</>}
            </Button>

            {isSubmitting && (contentType === "youtube" || cfg.acceptsFile) && (
              <p className="text-center text-xs text-muted-foreground animate-pulse">
                {isRTL
                  ? "מחלץ תוכן וממיר... זה עשוי לקחת מספר שניות"
                  : "Extracting and processing content... this may take a few seconds"}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
