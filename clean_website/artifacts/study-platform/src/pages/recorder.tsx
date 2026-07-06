import React, { useState, useRef, useEffect, useCallback } from "react";
import { Link, useSearch } from "wouter";
import { useListCourses, useGetTokenBalance } from "@workspace/api-client-react";
import { usePurchaseModal } from "@/lib/purchase-modal";
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
import { BetaLimitDialog } from "@/components/beta-limit-dialog";
import { AudioTokenLimitDialog } from "@/components/audio-token-limit-dialog";
import { useSmartProgress } from "@/hooks/use-smart-progress";
import { useToast } from "@/hooks/use-toast";
import { NO_CONTENT_MESSAGE_HE, SILENT_AUDIO_MESSAGE_HE, validateRecording, friendlyRecordingErrorMessage } from "@/lib/content-check";
import { saveCachedRecording, getCachedRecording, clearCachedRecording } from "@/lib/recording-cache";
import { TokenLimitErrorBanner, isTokenUpsellError } from "@/components/token-limit-error-banner";
import {
  Mic, MicOff, Square, Play, Pause, Loader2, CheckCircle2,
  BookOpen, BrainCircuit, HelpCircle, Trash2, ChevronRight,
  AlertCircle, Clock, Calendar, Zap, Bookmark,
} from "lucide-react";

// Hard ceiling matching the backend's MAX_RECORDING_SECONDS in
// lib/validation.ts -- a live recording auto-stops here. Transcription now
// runs backgrounded and chunked (lib/audio-chunker.ts), so this is no longer
// tied to Render's free-tier HTTP timeout -- it's just a sane technical
// bound on a single recording. The real per-user gate is token balance,
// negotiated via the 402 INSUFFICIENT_TOKENS_FOR_AUDIO flow below.
const MAX_RECORDING_SECONDS = 3 * 60 * 60;

// Matches the backend's MIN_AUDIO_TRANSCRIPT_LENGTH check in recordings.ts:
// anything shorter than this reliably transcribes to too little text and
// gets rejected as insufficient_content, burning a beta action for nothing
// -- so the stop action is gated client-side before that round-trip happens.
const MIN_RECORDING_SECONDS = 40;

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
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  // Recordings can now run up to 3 hours (MAX_RECORDING_SECONDS) -- switch to
  // H:MM:SS past the first hour instead of letting the minutes column climb
  // past 59 (e.g. "179:58" for a near-3-hour recording).
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
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
  const { toast } = useToast();
  const search = useSearch();
  const { data: courses } = useListCourses();
  const { data: tokenBalance } = useGetTokenBalance();
  const { open: openPurchaseModal } = usePurchaseModal();

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
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [autoStopped, setAutoStopped] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [betaLimitOpen, setBetaLimitOpen] = useState(false);
  // Set when the backend's 402 INSUFFICIENT_TOKENS_FOR_AUDIO response tells
  // us the user's token balance can't cover the whole recording -- holds
  // everything AudioTokenLimitDialog needs to negotiate a way forward (buy
  // tokens / continue with an affordable prefix / download instead of
  // uploading at all, since the Blob is already sitting in memory here).
  const [audioLimitOpen, setAudioLimitOpen] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{
    blob: Blob;
    recTitle: string;
    requestedSeconds: number;
    affordableSeconds: number;
    tokensNeeded: number;
    tokensAvailable: number;
  } | null>(null);

  // Real-Time Bookmarking: timestamps (elapsed seconds) the student marked
  // as important during the live recording, surfaced to the backend so the
  // AI summary can pay closer attention to those moments.
  const [bookmarks, setBookmarks] = useState<number[]>([]);

  // Mic check: lets the user verify (and pick) their input device before
  // they ever hit "Record".
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [micLevel, setMicLevel] = useState(0);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  // Save progress
  const [saveStep, setSaveStep] = useState(0);
  const [kitResult, setKitResult] = useState<KitResult | null>(null);
  // Set only while the upload is waiting its turn behind the backend's
  // processing-concurrency limit (see api-server's lib/processing-queue.ts)
  // -- during exam-period spikes, several students can stop recording within
  // the same few seconds, so this tells the student they're in line instead
  // of the bar looking stalled at 0%.
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  // Transcription + 3 parallel Gemini calls scale with recording length --
  // a 20-second voice memo and a 20-minute lecture shouldn't crawl at the
  // same pace, so the simulated bar's speed is derived from elapsed.
  const saveProgress = useSmartProgress(recState === "saving", {
    expectedDurationMs: Math.min(90_000, Math.max(15_000, elapsed * 700)),
  });

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
  // Standalone preview stream/analyser used only to drive the mic-level
  // meter before recording starts -- entirely separate from the
  // recording's own stream/analyser above, and always released before that
  // one is opened so the two never fight over the same device.
  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewAnalyserRef = useRef<AnalyserNode | null>(null);
  const previewAnimRef = useRef<number | null>(null);
  // Long-lived callbacks like mr.onstop close over state from when
  // recording started, not what's on screen now -- mirror title/courseId
  // into refs kept fresh every render so the cache write below reflects
  // whatever the user actually has typed when they hit "stop".
  const titleRef = useRef(title);
  const courseIdRef = useRef(courseId);
  const elapsedRef = useRef(elapsed);
  const bookmarksRef = useRef(bookmarks);
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { courseIdRef.current = courseId; }, [courseId]);
  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);
  useEffect(() => { bookmarksRef.current = bookmarks; }, [bookmarks]);

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

  // Recover an orphaned cached recording left behind by a tab crash/reload
  // that happened mid-upload-failure, before the user could hit retry --
  // restores it into the error state so "נסה שנית" can still send it.
  useEffect(() => {
    (async () => {
      const cached = await getCachedRecording();
      if (!cached) return;
      recordedAtRef.current = new Date(cached.recordedAt);
      setTitle(cached.title);
      setCourseId(cached.courseId);
      setElapsed(cached.elapsed);
      setAudioBlobRef(cached.blob);
      setAudioUrl(URL.createObjectURL(cached.blob));
      setBookmarks(cached.bookmarks || []);
      setError("נמצאה הקלטה קודמת שלא הועלתה בהצלחה. ניתן לנסות לשלוח אותה שוב.");
      setRecState("error");
    })();
  }, []);

  // Waveform animation while recording -- also drives micLevel so the same
  // level meter that ran during the pre-recording mic check keeps reading
  // live off the actual recording stream once it starts.
  const animateWaveform = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(data);
    const step = Math.floor(data.length / 32);
    const bars = Array.from({ length: 32 }, (_, i) => Math.max(2, (data[i * step] / 255) * 100));
    setWaveform(bars);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    setMicLevel(Math.min(100, (avg / 255) * 140));
    animFrameRef.current = requestAnimationFrame(animateWaveform);
  }, []);

  const refreshAudioInputDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const mics = all.filter(d => d.kind === "audioinput" && d.deviceId);
    setAudioInputDevices(mics);
    return mics;
  }, []);

  const stopMicPreview = useCallback(() => {
    if (previewAnimRef.current) { cancelAnimationFrame(previewAnimRef.current); previewAnimRef.current = null; }
    previewStreamRef.current?.getTracks().forEach(t => t.stop());
    previewStreamRef.current = null;
    previewCtxRef.current?.close();
    previewCtxRef.current = null;
    previewAnalyserRef.current = null;
    setMicLevel(0);
  }, []);

  // Opens a standalone (non-recording) stream just to monitor input level,
  // so the user can visually confirm their mic is picking up sound before
  // ever hitting "Record". Re-run whenever the selected device changes.
  const startMicPreview = useCallback(async (deviceId?: string) => {
    stopMicPreview();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      previewStreamRef.current = stream;
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      previewCtxRef.current = ctx;
      previewAnalyserRef.current = analyser;
      setMicPermissionDenied(false);

      const mics = await refreshAudioInputDevices();
      if (!deviceId && mics[0]) setSelectedDeviceId(mics[0].deviceId);

      const tick = () => {
        if (!previewAnalyserRef.current) return;
        const data = new Uint8Array(previewAnalyserRef.current.frequencyBinCount);
        previewAnalyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicLevel(Math.min(100, (avg / 255) * 140));
        previewAnimRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setMicPermissionDenied(true);
    }
  }, [stopMicPreview, refreshAudioInputDevices]);

  // Mic check runs as soon as the page loads, before the user does
  // anything -- and the preview stream is torn down on unmount so the mic
  // indicator light doesn't stay on after navigating away.
  useEffect(() => {
    startMicPreview();
    navigator.mediaDevices.addEventListener?.("devicechange", refreshAudioInputDevices);
    return () => {
      stopMicPreview();
      navigator.mediaDevices.removeEventListener?.("devicechange", refreshAudioInputDevices);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSelectDevice = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (recState !== "recording") startMicPreview(deviceId);
  };

  const startRecording = async () => {
    setError("");
    setAudioUrl(null);
    setAudioBlobRef(null);
    setElapsed(0);
    setKitResult(null);
    setAutoStopped(false);
    setIsPaused(false);
    setBookmarks([]);
    setRecState("idle");
    chunksRef.current = [];

    // Release the mic-check preview stream first -- the recording stream
    // below needs exclusive access to the same device.
    stopMicPreview();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      });

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

      // Explicit low bitrate (32kbps mono is plenty for Whisper-quality speech)
      // so a 3-hour lecture stays a predictable ~43MB regardless of a given
      // browser's undocumented opus default -- without this, MAX_RECORDING_SECONDS
      // being raised to 3 hours (see recordings.ts) would still hit the upload's
      // own byte-size ceiling on some browsers whose default bitrate is much
      // higher than what speech transcription actually needs.
      const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
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

        // Fail-Safe Recording Save: persist the audio locally *before* the
        // upload pipeline even starts, so a network/server failure during
        // upload never permanently loses the take.
        saveCachedRecording({
          blob,
          title: titleRef.current,
          courseId: courseIdRef.current,
          elapsed: elapsedRef.current,
          recordedAt: recordedAtRef.current.toISOString(),
          bookmarks: bookmarksRef.current,
        });

        // The recording stream is fully released now -- safe to bring the
        // mic-check preview back so the level meter keeps working for the
        // user's next take.
        startMicPreview(selectedDeviceId);
      };

      mr.start(250);
      setRecState("recording");
      animateWaveform();
      startTimer();
    } catch (err: any) {
      setError("לא ניתן לגשת למיקרופון. אנא אפשר גישה בהגדרות הדפדפן.");
      setRecState("error");
      startMicPreview(selectedDeviceId);
    }
  };

  // Reads/clears timerRef.current directly rather than through a captured
  // variable, since refs stay live across renders -- avoids the
  // stale-closure trap of reading state set up at the start of this
  // long-lived interval callback. Shared by startRecording and the
  // pause/resume toggle below, since resuming needs the exact same
  // auto-stop-aware ticking the initial start uses.
  const startTimer = () => {
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
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mediaRecorderRef.current?.stop();
    setRecState("stopped");
  };

  // Pause/resume during a recording (e.g. a lecture break) without losing
  // progress -- MediaRecorder.pause()/resume() keep accumulating into the
  // same chunk stream, so no new Blob/cache write is needed here.
  const togglePause = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (isPaused) {
      mr.resume();
      startTimer();
      animateWaveform();
      setIsPaused(false);
    } else {
      mr.pause();
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
      setIsPaused(true);
    }
  };

  // Real-Time Bookmarking: lets the student flag a moment as important
  // while the lecture is still being recorded, so the AI summary can later
  // pay closer attention to whatever was being discussed around it.
  const addBookmark = () => {
    const ts = elapsedRef.current;
    setBookmarks(prev => [...prev, ts]);
    toast({ description: `סומן בדקה ${formatDuration(ts)}` });
  };

  // Tracks the in-flight progress poll interval so it can be torn down both
  // on a terminal stage (done/error) and on unmount -- a long recording can
  // now take much longer than before to finish processing (up to the new
  // 3-hour ceiling), so this poll can no longer be assumed to wrap up
  // quickly the way it did back when everything ran synchronously.
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, []);

  // confirmedProcessSeconds is only set on the retry after the user has
  // already seen AudioTokenLimitDialog's negotiation and chosen "continue
  // with the affordable prefix" -- its presence tells the backend this
  // truncated duration was explicitly agreed to.
  const performSave = useCallback(async (blob: Blob, recTitle: string, confirmedProcessSeconds?: number) => {
    setError("");
    setErrorCode(undefined);
    setRecState("saving");
    setSaveStep(0);
    setQueuePosition(null);

    const stepInterval = setInterval(() => setSaveStep(s => Math.min(s + 1, SAVE_STEPS_HE.length - 1)), 6000);

    // POST /api/recordings now responds 202 immediately (transcription +
    // Gemini generation run backgrounded, see api-server's
    // routes/recordings.ts) -- this same poll loop that used to only show
    // "X uploads ahead of you" while queued now also watches for the
    // background job's terminal stage ("done"/"error") before ever leaving
    // the "saving" screen.
    const uploadId = crypto.randomUUID();
    let settled = false;
    const pollInterval = setInterval(async () => {
      if (settled) return;
      try {
        const res = await fetch(apiUrl(`/api/recordings/upload-progress/${uploadId}`), {
          headers: { Authorization: `Bearer ${getStoredToken()}` },
        });
        const progress = await res.json();
        setQueuePosition(progress.stage === "queued" ? progress.queuePosition ?? null : null);

        if (progress.stage === "done") {
          settled = true;
          clearInterval(stepInterval);
          clearInterval(pollInterval);
          setQueuePosition(null);
          if (progress.result?.kit) setKitResult(progress.result.kit);
          clearCachedRecording();
          setRecState("done");
          loadHistory();
        } else if (progress.stage === "error") {
          settled = true;
          clearInterval(stepInterval);
          clearInterval(pollInterval);
          setQueuePosition(null);
          setError(progress.error || "אירעה שגיאה בעיבוד ההקלטה. נסה שנית.");
          setRecState("error");
        }
      } catch {}
    }, 1500);
    pollIntervalRef.current = pollInterval;

    try {
      const fd = new FormData();
      fd.append("audio", blob, `recording.${blob.type.includes("mp4") ? "mp4" : "webm"}`);
      fd.append("title", recTitle);
      fd.append("recordedAt", recordedAtRef.current.toISOString());
      fd.append("durationSeconds", String(elapsed));
      fd.append("uploadId", uploadId);
      if (courseId) fd.append("courseId", courseId);
      if (bookmarks.length > 0) fd.append("bookmarks", JSON.stringify(bookmarks));
      if (confirmedProcessSeconds != null) fd.append("confirmedProcessSeconds", String(confirmedProcessSeconds));

      const res = await fetch(apiUrl("/api/recordings"), {
        method: "POST",
        headers: { Authorization: `Bearer ${getStoredToken()}` },
        body: fd,
      });
      const data = await res.json();

      if (!res.ok) {
        settled = true;
        clearInterval(stepInterval);
        clearInterval(pollInterval);
        setQueuePosition(null);

        if (data.code === "BETA_LIMIT_REACHED") {
          setBetaLimitOpen(true);
          setRecState("stopped");
          return;
        }
        if (data.code === "INSUFFICIENT_TOKENS_FOR_AUDIO") {
          setPendingUpload({
            blob,
            recTitle,
            requestedSeconds: data.requestedSeconds,
            affordableSeconds: data.affordableSeconds,
            tokensNeeded: data.tokensNeeded,
            tokensAvailable: data.tokensAvailable,
          });
          setAudioLimitOpen(true);
          setRecState("stopped");
          return;
        }
        setError(friendlyRecordingErrorMessage(data));
        setErrorCode(data.code);
        setRecState("error");
        return;
      }

      // 202 accepted -- the recording/material rows already exist and the
      // background pipeline is running. The poll loop above (already
      // ticking) takes it from here and flips recState once it sees "done"
      // or "error"; nothing left to do on this branch.
    } catch (err: any) {
      settled = true;
      clearInterval(stepInterval);
      clearInterval(pollInterval);
      setQueuePosition(null);
      setError("שמירת ההקלטה נכשלה. נסה שנית.");
      setRecState("error");
    }
  }, [mimeType, elapsed, courseId, bookmarks, loadHistory]);

  const handleSave = async () => {
    if (!audioBlobRef) return;
    if (!title.trim()) { setError("יש להזין כותרת להקלטה"); return; }
    // Hard block: no fallback to the title or any other metadata. If the
    // recording itself has no real content, performSave (and the API call
    // it triggers) never runs.
    const check = await validateRecording(audioBlobRef, elapsed);
    if (!check.ok) {
      toast({ description: check.reason === "silent" ? SILENT_AUDIO_MESSAGE_HE : NO_CONTENT_MESSAGE_HE, variant: "destructive" });
      return;
    }
    performSave(audioBlobRef, title.trim());
  };

  // Auto-save once the 20-minute hard limit stops the recorder: this effect
  // (not the mr.onstop callback itself, which closes over stale state from
  // when recording started) re-runs with fresh state whenever audioBlobRef
  // is populated after an auto-stop, so the saved title/courseId reflect
  // whatever the user actually has set at that moment.
  useEffect(() => {
    if (!autoStopped || recState !== "stopped" || !audioBlobRef) return;
    // Same hard-block gate as handleSave -- an empty/silent recording never
    // reaches performSave here either, auto-stop or not.
    (async () => {
      const check = await validateRecording(audioBlobRef, elapsed);
      if (!check.ok) {
        toast({ description: check.reason === "silent" ? SILENT_AUDIO_MESSAGE_HE : NO_CONTENT_MESSAGE_HE, variant: "destructive" });
        return;
      }
      const recTitle = title.trim() || `הקלטה ${new Date().toLocaleDateString("he-IL")} ${new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
      if (!title.trim()) setTitle(recTitle);
      performSave(audioBlobRef, recTitle);
    })();
  }, [autoStopped, recState, audioBlobRef, elapsed, title, toast, performSave]);

  // Re-uploads the exact audio Blob already saved to IndexedDB by mr.onstop
  // (falling back to whatever's still in memory if the cache write somehow
  // failed) -- the user never has to re-record after a failed upload.
  const retryUpload = useCallback(async () => {
    const cached = await getCachedRecording();
    const blob = cached?.blob ?? audioBlobRef;
    if (!blob) {
      // Nothing to re-upload (e.g. the error was a mic-permission failure,
      // not an upload failure) -- fall back to a normal reset instead of
      // leaving the user stuck on a dead-end "retry" button.
      resetRecorder();
      return;
    }
    const recTitle = cached?.title || title.trim() || "הקלטה";
    performSave(blob, recTitle);
  }, [audioBlobRef, title, performSave]);

  const resetRecorder = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    clearCachedRecording();
    setRecState("idle");
    setElapsed(0);
    setAudioUrl(null);
    setAudioBlobRef(null);
    setTitle("");
    setError("");
    setKitResult(null);
    setSaveStep(0);
    setAutoStopped(false);
    setBookmarks([]);
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
          הקלט ישירות מהדפדפן — FocusStudy יתמלל ויצור סיכום, כרטיסיות וחידון אוטומטית
        </p>
      </div>

      {/* ── Recorder Card ─────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardContent className="p-6 space-y-6">

          {/* Mic check: device picker + live level meter, visible before and
              during recording so the user can confirm the mic is actually
              picking up sound. */}
          {(recState === "idle" || recState === "recording") && (
            <div className="space-y-2 bg-muted/30 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <Mic className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <Select value={selectedDeviceId} onValueChange={onSelectDevice} disabled={recState === "recording"}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="מיקרופון ברירת מחדל" />
                  </SelectTrigger>
                  <SelectContent>
                    {audioInputDevices.map((d, i) => (
                      <SelectItem key={d.deviceId || i} value={d.deviceId}>
                        {d.label || `מיקרופון ${i + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {micPermissionDenied ? (
                <p className="text-xs text-destructive">לא ניתן לגשת למיקרופון לבדיקה — אנא אפשרו גישה בהגדרות הדפדפן</p>
              ) : (
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 transition-transform ${micLevel > 6 ? "bg-green-500 scale-125" : "bg-muted-foreground/40"}`} />
                  <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-green-500 transition-all duration-75" style={{ width: `${micLevel}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

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
                  <span className={`w-3 h-3 rounded-full ${isPaused ? "bg-amber-500" : "bg-red-500 animate-pulse"}`} />
                  <span className={`font-bold text-sm ${isPaused ? "text-amber-600" : "text-red-600"}`}>
                    {isPaused ? "בהשהיה" : "מקליט..."}
                  </span>
                </div>
                <span className={`font-mono text-2xl font-bold tabular-nums ${elapsed >= MAX_RECORDING_SECONDS - 60 ? "text-destructive" : "text-foreground"}`}>
                  {formatDuration(elapsed)} <span className="text-muted-foreground text-base font-normal">/ {formatDuration(MAX_RECORDING_SECONDS)}</span>
                </span>
              </div>

              {/* Progress toward the 3-hour auto-stop limit */}
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${elapsed >= MAX_RECORDING_SECONDS - 60 ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${Math.min(100, (elapsed / MAX_RECORDING_SECONDS) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center -mt-1">
                מקסימום 3 שעות להקלטה — ההקלטה תישמר ותעובד אוטומטית כשמגיעים למגבלה
              </p>
              <p className="text-xs text-center -mt-1">
                {elapsed < MIN_RECORDING_SECONDS ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    מינימום {MIN_RECORDING_SECONDS} שניות להקלטה — עוד {MIN_RECORDING_SECONDS - elapsed} שניות לפני שניתן לעצור
                  </span>
                ) : (
                  <span className="text-muted-foreground">מינימום {MIN_RECORDING_SECONDS} שניות להקלטה</span>
                )}
              </p>

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

              {!isPaused && (
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full gap-2 border border-amber-300 dark:border-amber-700 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 text-amber-700 dark:text-amber-300"
                  onClick={addBookmark}
                >
                  <Bookmark className="w-5 h-5" /> סמן רגע חשוב
                </Button>
              )}

              {bookmarks.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {bookmarks.map((ts, i) => (
                    <Badge key={i} variant="outline" className="gap-1 text-xs font-mono">
                      <Bookmark className="w-2.5 h-2.5" />{formatDuration(ts)}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Button size="lg" variant="outline" className="gap-2" onClick={togglePause}>
                  {isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                  {isPaused ? "המשך הקלטה" : "השהה הקלטה"}
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  className="gap-2"
                  onClick={stopRecording}
                  disabled={elapsed < MIN_RECORDING_SECONDS}
                  title={elapsed < MIN_RECORDING_SECONDS ? `יש להקליט לפחות ${MIN_RECORDING_SECONDS} שניות` : undefined}
                >
                  <Square className="w-5 h-5" /> עצור הקלטה
                </Button>
              </div>
            </div>
          )}

          {/* Stopped — preview + title + save */}
          {recState === "stopped" && (
            <div className="space-y-4">
              {autoStopped && (
                <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  הקלטה נעצרה אוטומטית - הגעת למגבלת ה-3 שעות, מעבד את החומר...
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
                isTokenUpsellError({ code: errorCode }) ? (
                  <TokenLimitErrorBanner message={error} />
                ) : (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                    <AlertCircle className="w-4 h-4 shrink-0" />{error}
                  </div>
                )
              )}

              {!autoStopped && (
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" onClick={resetRecorder} className="gap-2">
                    <Mic className="w-4 h-4" /> הקלט מחדש
                  </Button>
                  <Button onClick={handleSave} disabled={!title.trim()} className="gap-2 bg-primary">
                    <Zap className="w-4 h-4" /> שמור וצור ערכה
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
                  הקלטה נעצרה אוטומטית - הגעת למגבלת ה-3 שעות, מעבד את החומר...
                </div>
              )}
              {queuePosition != null && (
                <div className="flex items-center gap-2 text-sm text-primary bg-primary/10 px-3 py-2 rounded-lg">
                  <Clock className="w-4 h-4 shrink-0" />
                  {tokenBalance?.isPayingCustomer ? (
                    <span>עומס בשרת — יש {queuePosition} הקלטות לפניך בתור, נתחיל לעבד את שלך בעוד רגע</span>
                  ) : (
                    <span>
                      השרת שלנו עמוס כרגע, יש {queuePosition} הקלטות לפניך בתור... רוצה להיות בראש התור?{" "}
                      <button
                        type="button"
                        onClick={openPurchaseModal}
                        className="font-semibold underline underline-offset-2 hover:text-primary/80"
                      >
                        קנה עכשיו טוקנים!
                      </button>
                    </span>
                  )}
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
              <Progress value={saveProgress} active className="h-2.5" />
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
                  <p className="font-bold text-green-700 dark:text-green-400">הקלטה נשמרה וערכת הלימוד מוכנה!</p>
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
              <Button variant="outline" className="w-full" onClick={retryUpload}>נסה שנית</Button>
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

      <BetaLimitDialog open={betaLimitOpen} onOpenChange={setBetaLimitOpen} isRTL={isRTL} />

      {pendingUpload && (
        <AudioTokenLimitDialog
          open={audioLimitOpen}
          onOpenChange={setAudioLimitOpen}
          requestedSeconds={pendingUpload.requestedSeconds}
          affordableSeconds={pendingUpload.affordableSeconds}
          tokensNeeded={pendingUpload.tokensNeeded}
          tokensAvailable={pendingUpload.tokensAvailable}
          onBuyTokens={() => {
            setAudioLimitOpen(false);
            openPurchaseModal();
          }}
          onContinuePartial={() => {
            setAudioLimitOpen(false);
            performSave(pendingUpload.blob, pendingUpload.recTitle, pendingUpload.affordableSeconds);
          }}
          onDownloadInstead={() => {
            // The Blob is already sitting in memory (and in IndexedDB via
            // recording-cache) -- the user chose not to spend tokens
            // uploading it, so hand them a local copy instead of just
            // discarding the take. Keeps the cached copy intact (does NOT
            // call clearCachedRecording) since nothing was actually saved
            // server-side.
            const blob = pendingUpload.blob;
            const ext = blob.type.includes("mp4") ? "mp4" : "webm";
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${pendingUpload.recTitle || "הקלטה"}.${ext}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setAudioLimitOpen(false);
            setRecState("stopped");
          }}
        />
      )}
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
