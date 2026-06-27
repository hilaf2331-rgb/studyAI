import React, { useState, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useListCourses, getListMaterialsQueryKey, useGetUploadProgress, getGetUploadProgressQueryKey } from "@workspace/api-client-react";
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
import { ArrowLeft, Upload, FileText, Youtube, Link, Mic, FileVideo, Loader2, CheckCircle2, AlertCircle, Camera, Image as ImageIcon } from "lucide-react";
import { getStoredToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api-base";
import { BetaLimitDialog } from "@/components/beta-limit-dialog";
import { Progress } from "@/components/ui/progress";
import { useSmartProgress } from "@/hooks/use-smart-progress";
import { useToast } from "@/hooks/use-toast";
import { MIN_TEXT_CHARS, noContentMessage, isAudioSilent } from "@/lib/content-check";

type ContentType = "text" | "youtube" | "url" | "pdf" | "docx" | "pptx" | "xlsx" | "image" | "audio" | "video";

// "document" is a UI-only grouping over pdf/docx/pptx/xlsx -- the picker
// shows one "Upload Academic File" tile, and the real contentType is
// resolved from the selected file's extension in handleFileChange.
type PickerCategory = "text" | "youtube" | "url" | "document" | "image" | "audio" | "video";

const DOCUMENT_EXT_TO_CONTENT_TYPE: Record<string, ContentType> = {
  pdf: "pdf",
  docx: "docx",
  doc: "docx",
  pptx: "pptx",
  ppt: "pptx",
  xlsx: "xlsx",
  xls: "xlsx",
};

// Mirrors the backend's per-content-type beta caps in
// artifacts/api-server/src/routes/materials.ts (MAX_FILE_BYTES) -- checked
// here too so an oversized file is rejected instantly client-side instead of
// uploading megabytes just to get a 413 back from the server.
const MAX_FILE_BYTES: Partial<Record<ContentType, number>> = {
  pdf: 15 * 1024 * 1024,
  docx: 15 * 1024 * 1024,
  pptx: 15 * 1024 * 1024,
  xlsx: 15 * 1024 * 1024,
  image: 8 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};

const MAX_AUDIO_SECONDS = 20 * 60;
const MAX_VIDEO_SECONDS = 5 * 60;

// Drives the simulated progress bar's pace -- bigger files realistically
// take longer to extract/transcribe, so the crawl should be slower for them
// instead of using one fixed speed regardless of content type or size.
function estimateExpectedDurationMs(contentType: ContentType, file: File | null): number {
  if (!file) return contentType === "youtube" || contentType === "url" ? 12_000 : 6_000;
  const sizeMB = file.size / (1024 * 1024);
  if (contentType === "audio" || contentType === "video") return Math.min(60_000, Math.max(8_000, sizeMB * 1200));
  if (contentType === "image") return 5_000;
  return Math.min(40_000, Math.max(5_000, sizeMB * 2500));
}

function fileTooLargeMessage(resolvedType: ContentType, isRTL: boolean): string {
  if (resolvedType === "image") {
    return isRTL
      ? "התמונה כבדה מדי! בשלב הבטא ניתן להעלות תמונות עד גודל של 8MB."
      : "This image is too large! During the beta we only support images up to 8MB.";
  }
  if (resolvedType === "pdf" || resolvedType === "docx" || resolvedType === "pptx" || resolvedType === "xlsx") {
    return isRTL
      ? "הקובץ או האתר מכילים יותר מדי טקסט! בשלב הבטא אנו תומכים בסיכום של עד 40 עמודי חומר במכה אחת."
      : "This file or website contains too much text! During the beta we only support summarizing up to roughly 40 pages of material at once.";
  }
  return isRTL
    ? "קובץ המדיה ארוך או כבד מדי! בשלב הבטא אנו תומכים בהקלטות של עד 20 דקות ווידאו ישיר של עד 5 דקות."
    : "This media file is too long or too large! During the beta we only support recordings up to 20 minutes and direct video up to 5 minutes.";
}

// Reads duration from file metadata via a throwaway <audio>/<video> element
// -- no upload needed, just a local object URL -- so oversized recordings
// are caught before the file ever leaves the browser. Best-effort: if
// metadata can't be read (corrupt file, unsupported codec), resolves to
// null rather than blocking the upload on an inconclusive check.
function readMediaDurationSeconds(file: File, kind: "audio" | "video"): Promise<number | null> {
  return new Promise(resolve => {
    const el = document.createElement(kind);
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      cleanup();
      resolve(Number.isFinite(el.duration) ? el.duration : null);
    };
    el.onerror = () => {
      cleanup();
      resolve(null);
    };
    el.src = url;
  });
}

const PICKER_CONFIG: Record<PickerCategory, {
  icon: React.ElementType;
  labelHe: string;
  labelEn: string;
  color: string;
  acceptsFile: boolean;
  acceptAttr?: string;
}> = {
  text:     { icon: FileText,  labelHe: "טקסט",          labelEn: "Text",          color: "bg-blue-500/10 text-blue-600",   acceptsFile: false },
  youtube:  { icon: Youtube,   labelHe: "YouTube",        labelEn: "YouTube",       color: "bg-red-500/10 text-red-600",     acceptsFile: false },
  url:      { icon: Link,      labelHe: "קישור",          labelEn: "Web URL",       color: "bg-green-500/10 text-green-600", acceptsFile: false },
  document: { icon: FileText,  labelHe: "מסמך אקדמי",     labelEn: "Academic File", color: "bg-amber-500/10 text-amber-600", acceptsFile: true,
    acceptAttr: ".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  image:    { icon: ImageIcon, labelHe: "תמונה",          labelEn: "Photo",         color: "bg-pink-500/10 text-pink-600",   acceptsFile: true, acceptAttr: "image/*" },
  audio:    { icon: Mic,       labelHe: "הקלטה קולית",   labelEn: "Voice / Audio", color: "bg-purple-500/10 text-purple-600", acceptsFile: true, acceptAttr: "audio/*,.mp3,.m4a,.wav,.ogg,.webm" },
  video:    { icon: FileVideo, labelHe: "וידאו",          labelEn: "Video File",    color: "bg-indigo-500/10 text-indigo-600", acceptsFile: true, acceptAttr: "video/*,.mp4,.webm,.mov" },
};

export const MaterialNewPage: React.FC = () => {
  const { isRTL } = useLanguage();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const qc = useQueryClient();
  const { data: courses } = useListCourses();

  // Preselect the course when arriving from a specific course page, e.g. /materials/new?courseId=5
  const preselectedCourseId = new URLSearchParams(search).get("courseId") || "";

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<PickerCategory>("text");
  const [contentType, setContentType] = useState<ContentType>("text");
  const [language, setLanguage] = useState("he");
  const [courseId, setCourseId] = useState<string>(preselectedCourseId);
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [betaLimitOpen, setBetaLimitOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const cfg = PICKER_CONFIG[category];

  const { data: uploadProgress } = useGetUploadProgress(uploadId ?? "", {
    query: {
      enabled: !!uploadId && isSubmitting,
      refetchInterval: uploadId && isSubmitting ? 800 : false,
      queryKey: getGetUploadProgressQueryKey(uploadId ?? ""),
    },
  });
  const realPercent = uploadProgress?.stage === "extracting" || uploadProgress?.stage === "error"
    ? uploadProgress.percentage
    : null;
  const expectedDurationMs = estimateExpectedDurationMs(contentType, file);
  const percent = useSmartProgress(isSubmitting, { expectedDurationMs, realPercent });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (!f) { setFile(f); return; }
    if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ""));

    let resolvedType: ContentType | undefined;
    if (category === "document") {
      const ext = f.name.split(".").pop()?.toLowerCase() || "";
      resolvedType = DOCUMENT_EXT_TO_CONTENT_TYPE[ext];
      if (!resolvedType) {
        setError(isRTL
          ? "פורמט קובץ לא נתמך. נא להעלות PDF, Word, PowerPoint או Excel"
          : "Unsupported file format. Please upload a PDF, Word, PowerPoint, or Excel file");
        setFile(null);
        return;
      }
    } else if (category === "image") {
      resolvedType = "image";
    } else if (category === "audio") {
      resolvedType = "audio";
    } else if (category === "video") {
      resolvedType = "video";
    }

    // Size cap, checked instantly client-side -- mirrors the backend's
    // MAX_FILE_BYTES so an oversized file never has to leave the browser.
    if (resolvedType) {
      const maxBytes = MAX_FILE_BYTES[resolvedType];
      if (maxBytes && f.size > maxBytes) {
        setError(fileTooLargeMessage(resolvedType, isRTL));
        setFile(null);
        return;
      }
    }

    // Duration cap for audio/video, read from local file metadata -- if the
    // duration can't be determined, the file is allowed through and the
    // backend's size-based backstop is the final safety net.
    if (resolvedType === "audio" || resolvedType === "video") {
      const durationSeconds = await readMediaDurationSeconds(f, resolvedType);
      const maxSeconds = resolvedType === "audio" ? MAX_AUDIO_SECONDS : MAX_VIDEO_SECONDS;
      if (durationSeconds !== null && durationSeconds > maxSeconds) {
        setError(fileTooLargeMessage(resolvedType, isRTL));
        setFile(null);
        return;
      }
    }

    setError("");
    setFile(f);
    if (resolvedType) setContentType(resolvedType);
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

    // Content-presence gate -- runs before the request ever leaves the
    // browser, so an empty/near-empty upload never burns a beta action or
    // an extraction/AI call that was always going to produce nothing useful.
    if (contentType === "text" && text.trim().length < MIN_TEXT_CHARS) {
      toast({ description: noContentMessage(isRTL), variant: "destructive" });
      return;
    }
    if (cfg.acceptsFile && file && file.size === 0) {
      toast({ description: noContentMessage(isRTL), variant: "destructive" });
      return;
    }
    if (contentType === "audio" && file && (await isAudioSilent(file))) {
      toast({ description: noContentMessage(isRTL), variant: "destructive" });
      return;
    }

    const newUploadId = crypto.randomUUID();
    setUploadId(newUploadId);
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
        fd.append("uploadId", newUploadId);
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
            uploadId: newUploadId,
          }),
        });
      }

      if (!response.ok) {
        const data = await response.json();
        if (data.code === "BETA_LIMIT_REACHED") {
          setBetaLimitOpen(true);
          return;
        }
        throw new Error(data.error || "Failed to create material");
      }

      const material = await response.json();
      qc.invalidateQueries({ queryKey: getListMaterialsQueryKey() });
      // autogen=1 tells MaterialDetailPage to kick off generate-all itself
      // the moment it mounts, so every upload path (not just the voice
      // recorder) lands on an instant study kit instead of a manual click.
      setLocation(`/materials/${material.id}?autogen=1`);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setIsSubmitting(false);
      setUploadId(null);
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
              ? "הוסף חומר לימוד — טקסט, קישור YouTube, מסמך (PDF, Word, PowerPoint, Excel), הקלטה קולית ועוד"
              : "Add study material — text, YouTube link, document (PDF, Word, PowerPoint, Excel), voice recording and more"}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Content Type Picker */}
            <div>
              <Label className="mb-2 block">{isRTL ? "סוג חומר" : "Content Type"}</Label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(PICKER_CONFIG) as PickerCategory[]).map(cat => {
                  const c = PICKER_CONFIG[cat];
                  const Icon = c.icon;
                  const active = category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        setCategory(cat);
                        setFile(null);
                        setSourceUrl("");
                        if (cat === "text") setContentType("text");
                        else if (cat === "youtube") setContentType("youtube");
                        else if (cat === "url") setContentType("url");
                        else if (cat === "image") setContentType("image");
                        else if (cat === "audio") setContentType("audio");
                        else if (cat === "video") setContentType("video");
                        else if (cat === "document") setContentType("pdf");
                      }}
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
                      ? "FocusStudy יחלץ את הטרנסקריפט ויעבד אותו אוטומטית"
                      : "FocusStudy will extract the transcript and process it automatically"}
                  </p>
                )}
              </div>
            )}

            {/* File upload */}
            {cfg.acceptsFile && category === "image" && (
              <div className="space-y-1.5">
                <Label>{isRTL ? "צילום או בחירת תמונה" : "Take a Photo or Choose an Image"}</Label>
                {file ? (
                  <div
                    onClick={() => setFile(null)}
                    className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer border-primary bg-primary/5"
                  >
                    <div className="space-y-1">
                      <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto" />
                      <p className="font-medium text-sm">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                      <p className="text-xs text-muted-foreground">{isRTL ? "לחץ להחליף" : "Click to replace"}</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="flex flex-col items-center gap-2 p-6 rounded-xl border-2 border-dashed border-border hover:border-muted-foreground/40 transition-colors"
                    >
                      <Camera className="w-7 h-7 text-muted-foreground" />
                      <span className="text-sm font-medium">{isRTL ? "צלם תמונה" : "Take Photo"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center gap-2 p-6 rounded-xl border-2 border-dashed border-border hover:border-muted-foreground/40 transition-colors"
                    >
                      <ImageIcon className="w-7 h-7 text-muted-foreground" />
                      <span className="text-sm font-medium">{isRTL ? "בחר מהגלריה" : "Choose from Gallery"}</span>
                    </button>
                  </div>
                )}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <p className="text-xs text-muted-foreground">
                  {isRTL
                    ? "התמונה תתומלל אוטומטית באמצעות Gemini — מצוין לתמונות של דפים כתובים, שקפים או לוח"
                    : "The image will be automatically transcribed using Gemini — great for photos of notes, slides, or a whiteboard"}
                </p>
              </div>
            )}

            {cfg.acceptsFile && category !== "image" && (
              <div className="space-y-1.5">
                <Label>{
                  category === "document"
                    ? (isRTL ? "העלאת מסמך (PDF, Word, PowerPoint, Excel)" : "Upload Document (PDF, Word, PowerPoint, Excel)")
                    : (isRTL ? `העלאת קובץ ${cfg.labelHe}` : `Upload ${cfg.labelEn} file`)
                }
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
                        {category === "document" && (isRTL ? "PDF, Word, PowerPoint, Excel עד 15MB (כ-40 עמודים)" : "PDF, Word, PowerPoint, Excel up to 15MB (~40 pages)")}
                        {category === "audio" && (isRTL ? "MP3, M4A, WAV, OGG עד 25MB ועד 20 דקות" : "MP3, M4A, WAV, OGG up to 25MB and 20 minutes")}
                        {category === "video" && (isRTL ? "MP4, WebM, MOV עד 50MB ועד 5 דקות" : "MP4, WebM, MOV up to 50MB and 5 minutes")}
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

            {isSubmitting && (contentType === "youtube" || contentType === "url" || cfg.acceptsFile) && (
              <div className="space-y-1.5">
                <Progress value={Math.max(percent, 4)} active className="h-2" />
                <p className="text-center text-xs text-muted-foreground">
                  {isRTL ? `מחלץ תוכן... ${Math.round(percent)}%` : `Extracting content... ${Math.round(percent)}%`}
                </p>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <BetaLimitDialog open={betaLimitOpen} onOpenChange={setBetaLimitOpen} isRTL={isRTL} />
    </div>
  );
};
