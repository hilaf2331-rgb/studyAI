import React, { useState, useRef, useEffect, useCallback } from "react";
import { Link, useSearch } from "wouter";
import { useListCourses } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { getStoredToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api-base";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Mic, MicOff, Square, Play, Pause, Loader2, CheckCircle2,
  BookOpen, BrainCircuit, HelpCircle, Trash2, ChevronRight,
  AlertCircle, Clock, Calendar, Zap,
} from "lucide-react";

// Hard ceiling matching the backend's MAX_RECORDING_SECONDS in
// recordings.ts -- a live recording auto-stops here so a student can't
// accidentally record for hours and blow past Render's free-tier HTTP
// timeout once the file hits transcription + AI generation.
const MAX_RECORDING_SECONDS = 20 * 60;

type RecorderState = "idle" | "recording" | "stopped" | "saving" | "done" | "error";

interface KitResult {
  summary: { id: number; keyPointCount: number };
  deck: { id: number; cardCount: number };
  questionSet: { id: number; questionCount: number };
}

interface RecordingRow {
  id: number;
  title: string;
  recordedAt: string;
  durationSeconds: number | null;
  summaryId: number | null;
  deckId: number | null;
  questionSetId: number | null;
}

const SAVE_STEPS_HE = [
  "שומר את ההקלטה...",
  "ממיר לטקסט עם Groq Whisper...",
  "מייצר סיכום...",
  "בונה כרטיסיות...",
  "מכין שאלות חידון...",
  "מסיים ערכת לימוד...",
];

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export const RecorderPage: React.FC = () => {
  const { isRTL } = useLanguage();
  const search = useSearch();
  const { data: courses } = useListCourses();

  // Preselect the course when arriving from a specific course page, e.g. /recorder?courseId=5
  const preselectedCourseId = new URLSearchParams(search).get("courseId") || "";

  // Recorder state
  const [recState, setRecState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlobRef, setAudioBlobRef] = useState<Blob | null>(null);
  const [mimeType, setMimeType] = useState("audio/webm");
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState<string>(preselectedCourseId);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState("");
  const [autoStopped, setAutoStopped] = useState(false);

  // Save progress
  const [saveStep, setSaveStep] = useState(0);
  const [saveProgress, setSaveProgress] = useState(0);
  const [kitResult, setKitResult] = useState<KitResult | null>(null);

  // History
  const [history, setHistory] = useState<RecordingRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Visualizer
  const [waveform, setWaveform] = useState<number[]>(Array(32).fill(2));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recordedAtRef = useRef<Date>(new Date());

  // Load history
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(apiUrl("/api/recordings"), { headers: { Authorization: `Bearer ${getStoredToken()}` } });
      if (res.ok) setHistory(await res.json());
    } catch {}
    setHistoryLoading(false);
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Waveform animation while recording
  const animateWaveform = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(data);
    const step = Math.floor(data.length / 32);
    const bars = Array.from({ length: 32 }, (_, i) => Math.max(2, (data[i * step] / 255) * 100));
    setWaveform(bars);
    animFrameRef.current = requestAnimationFrame(animateWaveform);
  }, []);

  const startRecording = async () => {
    setError("");
    setAudioUrl(null);
    setAudioBlobRef(null);
    setElapsed(0);
    setKitResult(null);
    setAutoStopped(false);
    setRecState("idle");
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Set up analyser for waveform
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "audio/webm";
      setMimeType(mime.split(";")[0]);

      const mr = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = mr;
      recordedAtRef.current = new Date();

      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime.split(";")[0] });
        setAudioBlobRef(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        setWaveform(Array(32).fill(2));
      };

      mr.start(250);
      setRecState("recording");
      animateWaveform();

      // Reads/clears timerRef.current directly rather than through a
      // captured variable, since refs stay live across renders -- avoids
      // the stale-closure trap of reading state set up at the start of this
      // long-lived interval callback.
      timerRef.current = setInterval(() => {
        setElapsed(s => {
          const next = s + 1;
          if (next >= MAX_RECORDING_SECONDS) {
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            mediaRecorderRef.current?.stop();
            setAutoStopped(true);
            setRecState("stopped");
          }
          return next;
        });
      }, 1000);
    } catch (err: any) {
      setError("לא ניתן לגשת למיקרופון. אנא אפשר גישה בהגדרות הדפדפן.");
      setRecState("error");
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mediaRecorderRef.current?.stop();
    setRecState("stopped");
  };

  const performSave = useCallback(async (blob: Blob, recTitle: string) => {
    setError("");
    setRecState("saving");
    setSaveStep(0);
    setSaveProgress(0);

    const stepInterval = setInterval(() => setSaveStep(s => Math.min(s + 1, SAVE_STEPS_HE.length - 1)), 6000);
    const barInterval = setInterval(() => setSaveProgress(v => v >= 88 ? 88 : v + 1.5), 800);

    try {
      const fd = new FormData();
      fd.append("audio", blob, `recording.${mimeType.includes("mp4") ? "mp4" : "webm"}`);
      fd.append("title", recTitle);
      fd.append("recordedAt", recordedAtRef.current.toISOString());
      fd.append("durationSeconds", String(elapsed));
      if (courseId) fd.append("courseId", courseId);

      const res = await fetch(apiUrl("/api/recordings"), {
        method: "POST",
        headers: { Authorization: `Bearer ${getStoredToken()}` },
        body: fd,
      });
      const data = await res.json();

      clearInterval(stepInterval);
      clearInterval(barInterval);
      setSaveProgress(100);

      if (data.kit) {
        setKitResult(data.kit);
      }
      setRecState("done");
      loadHistory();
    } catch (err: any) {
      clearInterval(stepInterval);
      clearInterval(barInterval);
      setError("שמירת ההקלטה נכשלה. נסה שנית.");
      setRecState("error");
    }
  }, [mimeType, elapsed, courseId, loadHistory]);

  const handleSave = () => {
    if (!audioBlobRef) return;
    if (!title.trim()) { setError("יש להזין כותרת להקלטה"); return; }
    performSave(audioBlobRef, title.trim());
  };

  // Auto-save once the 20-minute hard limit stops the recorder: this effect
  // (not the mr.onstop callback itself, which closes over stale state from
  // when recording started) re-runs with fresh state whenever audioBlobRef
  // is populated after an auto-stop, so the saved title/courseId reflect
  // whatever the user actually has set at that moment.
  useEffect(() => {
    if (!autoStopped || recState !== "stopped" || !audioBlobRef) return;
    const recTitle = title.trim() || `הקלטה ${new Date().toLocaleDateString("he-IL")} ${new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
    if (!title.trim()) setTitle(recTitle);
    performSave(audioBlobRef, recTitle);
  }, [autoStopped, recState, audioBlobRef, performSave]);

  const resetRecorder = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setRecState("idle");
    setElapsed(0);
    setAudioUrl(null);
    setAudioBlobRef(null);
    setTitle("");
    setError("");
    setKitResult(null);
    setSaveStep(0);
    setSaveProgress(0);
    setAutoStopped(false);
  };

  const deleteRecording = async (id: number) => {
    await fetch(`/api/recordings/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${getStoredToken()}` },
    });
    loadHistory();
  };

  // Audio player controls
  const fetchAndPlayHistory = async (id: number) => {
    const res = await fetch(`/api/recordings/${id}/audio`, { headers: { Authorization: `Bearer ${getStoredToken()}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.play();
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8" dir="rtl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Mic className="w-8 h-8 text-primary" />
          הקלט הרצאה חיה
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          הקלט ישירות מהדפדפן — StudyAI יתמלל ויצור סיכום, כרטיסיות וחידון אוטומטית
        </p>
      </div>

      {/* ── Recorder Card ─────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardContent className="p-6 space-y-6">

          {/* Idle: call to action */}
          {recState === "idle" && (
            <div className="text-center space-y-4 py-4">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Mic className="w-10 h-10 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-lg">מוכן להקליט?</p>
                <p className="text-sm text-muted-foreground mt-1">לחץ על הכפתור הירוק כדי להתחיל</p>
              </div>
              <Button size="lg" className="gap-2 bg-green-600 hover:bg-green-700 text-white px-8" onClick={startRecording}>
                <Mic className="w-5 h-5" /> התחל הקלטה
              </Button>
            </div>
          )}

          {/* Recording */}
          {recState === "recording" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                  <span className="font-bold text-red-600 text-sm">מקליט...</span>
                </div>
                <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
                  {formatDuration(elapsed)}
                </span>
              </div>

              {/* Waveform visualizer */}
              <div className="flex items-end justify-center gap-0.5 h-16 bg-muted/40 rounded-xl px-3">
                {waveform.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-primary rounded-sm transition-all duration-75"
                    style={{ height: `${Math.max(3, h * 0.6)}%`, minWidth: 3 }}
                  />
                ))}
              </div>

              <Button size="lg" variant="destructive" className="w-full gap-2" onClick={stopRecording}>
                <Square className="w-5 h-5" /> עצור הקלטה
              </Button>
            </div>
          )}

          {/* Stopped — preview + title + save */}
          {recState === "stopped" && (
            <div className="space-y-4">
              {autoStopped && (
                <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  הקלטה נעצרה אוטומטית - הגעת למגבלת ה-20 דקות, מעבד את החומר...
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">משך הקלטה: <span className="font-mono font-semibold">{formatDuration(elapsed)}</span></span>
                <Badge variant="secondary">מוכן לשמירה</Badge>
              </div>

              {audioUrl && (
                <div className="bg-muted/40 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-2 font-medium">האזנה לתצוגה מקדימה:</p>
                  <audio
                    src={audioUrl}
                    controls
                    className="w-full h-9"
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium">כותרת להקלטה *</label>
                <Input
                  placeholder="לדוגמה: הרצאה 4 — מבנה החלבון"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" />
                  {recordedAtRef.current.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>

              {courses && courses.length > 0 && (
                <div className="space-y-1.5">
                  <Label>קורס (אופציונלי)</Label>
                  <Select value={courseId} onValueChange={setCourseId}>
                    <SelectTrigger><SelectValue placeholder="ללא קורס" /></SelectTrigger>
                    <SelectContent>
                      {courses.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
              )}

              {!autoStopped && (
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" onClick={resetRecorder} className="gap-2">
                    <Mic className="w-4 h-4" /> הקלט מחדש
                  </Button>
                  <Button onClick={handleSave} disabled={!title.trim()} className="gap-2 bg-primary">
                    <Zap className="w-4 h-4" /> שמור וצור ערכה ⚡
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Saving — animated progress */}
          {recState === "saving" && (
            <div className="space-y-5 py-2">
              {autoStopped && (
                <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  הקלטה נעצרה אוטומטית - הגעת למגבלת ה-20 דקות, מעבד את החומר...
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm">{SAVE_STEPS_HE[saveStep]}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">זה ייקח כ-30–60 שניות — Groq מעבד בשבילך</p>
                </div>
              </div>
              <Progress value={saveProgress} className="h-2.5" />
              <div className="flex gap-5 text-xs text-muted-foreground">
                {[
                  { icon: Mic, label: "תמלול", done: saveStep >= 2 },
                  { icon: BookOpen, label: "סיכום", done: saveStep >= 3 },
                  { icon: BrainCircuit, label: "כרטיסיות", done: saveStep >= 4 },
                  { icon: HelpCircle, label: "חידון", done: saveStep >= 5 },
                ].map(item => (
                  <div key={item.label} className={`flex items-center gap-1 transition-colors ${item.done ? "text-green-600 dark:text-green-400" : ""}`}>
                    <item.icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                    {item.done && <CheckCircle2 className="w-3 h-3" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Done */}
          {recState === "done" && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="font-bold text-green-700 dark:text-green-400">הקלטה נשמרה וערכת הלימוד מוכנה! 🎉</p>
                  <p className="text-sm text-muted-foreground">{title}</p>
                </div>
              </div>

              {kitResult && (
                <div className="grid grid-cols-3 gap-3">
                  <Link href={`/summaries/${kitResult.summary.id}`}>
                    <div className="p-3 rounded-xl border bg-blue-50/50 dark:bg-blue-950/20 hover:shadow-md transition-all cursor-pointer text-center">
                      <BookOpen className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                      <p className="text-xs font-semibold">סיכום</p>
                      <p className="text-xs text-muted-foreground">{kitResult.summary.keyPointCount} נקודות</p>
                    </div>
                  </Link>
                  <Link href={`/flashcards/${kitResult.deck.id}`}>
                    <div className="p-3 rounded-xl border bg-purple-50/50 dark:bg-purple-950/20 hover:shadow-md transition-all cursor-pointer text-center">
                      <BrainCircuit className="w-5 h-5 text-purple-500 mx-auto mb-1" />
                      <p className="text-xs font-semibold">כרטיסיות</p>
                      <p className="text-xs text-muted-foreground">{kitResult.deck.cardCount} כרטיסיות</p>
                    </div>
                  </Link>
                  <Link href={`/questions/${kitResult.questionSet.id}`}>
                    <div className="p-3 rounded-xl border bg-amber-50/50 dark:bg-amber-950/20 hover:shadow-md transition-all cursor-pointer text-center">
                      <HelpCircle className="w-5 h-5 text-amber-500 mx-auto mb-1" />
                      <p className="text-xs font-semibold">חידון</p>
                      <p className="text-xs text-muted-foreground">{kitResult.questionSet.questionCount} שאלות</p>
                    </div>
                  </Link>
                </div>
              )}

              {!kitResult && (
                <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
                  התמלול הסתיים אך יצירת הערכה נכשלה. ניתן לנסות שוב מדף החומר.
                </p>
              )}

              <Button variant="outline" className="w-full gap-2" onClick={resetRecorder}>
                <Mic className="w-4 h-4" /> הקלטה חדשה
              </Button>
            </div>
          )}

          {/* Error */}
          {recState === "error" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-destructive bg-destructive/10 px-4 py-3 rounded-lg">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm">{error || "אירעה שגיאה"}</p>
              </div>
              <Button variant="outline" className="w-full" onClick={resetRecorder}>נסה שנית</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Recordings History ────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-muted-foreground" />
          הקלטות קודמות
        </h2>

        {historyLoading && (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
          </div>
        )}

        {!historyLoading && history.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">
            <Mic className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">עדיין אין הקלטות. התחל להקליט!</p>
          </div>
        )}

        {!historyLoading && history.length > 0 && (
          <div className="space-y-3">
            {history.map(rec => (
              <Card key={rec.id} className="hover:shadow-md transition-all">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Mic className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{rec.title}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />{formatDateTime(rec.recordedAt)}
                        </span>
                        {rec.durationSeconds && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />{formatDuration(rec.durationSeconds)}
                          </span>
                        )}
                      </div>

                      {/* Generated content links */}
                      {(rec.summaryId || rec.deckId || rec.questionSetId) && (
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {rec.summaryId && (
                            <Link href={`/summaries/${rec.summaryId}`}>
                              <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-muted text-xs">
                                <BookOpen className="w-2.5 h-2.5" />סיכום
                              </Badge>
                            </Link>
                          )}
                          {rec.deckId && (
                            <Link href={`/flashcards/${rec.deckId}`}>
                              <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-muted text-xs">
                                <BrainCircuit className="w-2.5 h-2.5" />כרטיסיות
                              </Badge>
                            </Link>
                          )}
                          {rec.questionSetId && (
                            <Link href={`/questions/${rec.questionSetId}`}>
                              <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-muted text-xs">
                                <HelpCircle className="w-2.5 h-2.5" />חידון
                              </Badge>
                            </Link>
                          )}
                        </div>
                      )}

                      {/* Audio player for this recording */}
                      <HistoryAudioPlayer recordingId={rec.id} />
                    </div>

                    <button
                      onClick={() => deleteRecording(rec.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors mt-0.5 shrink-0"
                      title="מחק הקלטה"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* hidden audio element for history playback */}
      <audio ref={audioRef} className="hidden" />
    </div>
  );
};

function HistoryAudioPlayer({ recordingId }: { recordingId: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (url) { setOpen(true); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/audio`, {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      const blob = await res.blob();
      setUrl(URL.createObjectURL(blob));
      setOpen(true);
    } catch {}
    setLoading(false);
  };

  return (
    <div className="mt-2">
      {!open && (
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {loading ? "טוען..." : "האזן להקלטה"}
        </button>
      )}
      {open && url && (
        <audio src={url} controls className="w-full h-8 mt-1" />
      )}
    </div>
  );
}
