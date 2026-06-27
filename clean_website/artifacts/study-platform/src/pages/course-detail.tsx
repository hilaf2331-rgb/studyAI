import React, { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  useGetCourse, useListMaterials, useDeleteMaterial,
  getListMaterialsQueryKey,
  useListGlossaryTerms, useCreateGlossaryTerm, useUpdateGlossaryTerm, useDeleteGlossaryTerm,
  getListGlossaryTermsQueryKey,
  type GlossaryTerm,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft, ArrowRight, BookOpen, FileText, Plus, Trash2,
  BrainCircuit, HelpCircle, FileQuestion, Loader2, AlertCircle, CheckCircle2, Mic,
  BookMarked, Pencil,
} from "lucide-react";

function GlossarySection({ courseId, isRTL }: { courseId: number; isRTL: boolean }) {
  const qc = useQueryClient();
  const { data: terms, isLoading } = useListGlossaryTerms(courseId);
  const createTerm = useCreateGlossaryTerm();
  const updateTerm = useUpdateGlossaryTerm();
  const deleteTerm = useDeleteGlossaryTerm();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GlossaryTerm | null>(null);
  const [term, setTerm] = useState("");
  const [definition, setDefinition] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: getListGlossaryTermsQueryKey(courseId) });

  const openCreate = () => { setEditing(null); setTerm(""); setDefinition(""); setOpen(true); };
  const openEdit = (t: GlossaryTerm) => { setEditing(t); setTerm(t.term); setDefinition(t.definition); setOpen(true); };

  const handleSave = () => {
    if (!term.trim() || !definition.trim()) return;
    if (editing) {
      updateTerm.mutate({ id: courseId, termId: editing.id, data: { term, definition } }, {
        onSuccess: () => { invalidate(); setOpen(false); },
      });
    } else {
      createTerm.mutate({ id: courseId, data: { term, definition } }, {
        onSuccess: () => { invalidate(); setOpen(false); },
      });
    }
  };

  const handleDeleteTerm = (termId: number) => {
    if (!window.confirm(isRTL ? "האם אתה בטוח שברצונך למחוק מונח זה?" : "Delete this term?")) return;
    deleteTerm.mutate({ id: courseId, termId }, { onSuccess: invalidate });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <BookMarked className="w-5 h-5 text-primary" />
          {isRTL ? "מילון מונחי הקורס" : "Course Glossary"}
        </h2>
        <Button variant="outline" size="sm" className="gap-2" onClick={openCreate}>
          <Plus className="w-4 h-4" />
          {isRTL ? "הוסף מונח" : "Add Term"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {isRTL
          ? "מונחים, קיצורים ונוסחאות ספציפיים לקורס שלך יעוגנו בתשובות ה-AI ויודגשו בסיכומים."
          : "Course-specific terms, abbreviations, and formulas that ground the AI's answers and get highlighted in summaries."}
      </p>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
      ) : !terms?.length ? (
        <p className="text-sm text-muted-foreground italic">
          {isRTL ? "לא הוגדרו עדיין מונחים לקורס זה." : "No glossary terms defined for this course yet."}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {terms.map(t => (
            <Card key={t.id}>
              <CardContent className="p-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm break-words">{t.term}</p>
                  <p className="text-xs text-muted-foreground break-words mt-0.5">{t.definition}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(t)} className="p-1.5 rounded-md hover:bg-muted transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDeleteTerm(t.id)} className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? (isRTL ? "ערוך מונח" : "Edit Term") : (isRTL ? "הוסף מונח" : "Add Term")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="glossary-term">{isRTL ? "מונח" : "Term"}</Label>
              <Input id="glossary-term" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={isRTL ? "לדוגמה: אינטגרל לוגריתמי" : "e.g. Logarithmic Integral"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="glossary-definition">{isRTL ? "הגדרה" : "Definition"}</Label>
              <Textarea id="glossary-definition" value={definition} onChange={(e) => setDefinition(e.target.value)} rows={4} placeholder={isRTL ? "ההגדרה המדויקת כפי שנלמדה בקורס" : "The exact definition as taught in the course"} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{isRTL ? "ביטול" : "Cancel"}</Button>
            <Button onClick={handleSave} disabled={createTerm.isPending || updateTerm.isPending}>
              {isRTL ? "שמור" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status, isRTL }: { status: string; isRTL: boolean }) {
  if (status === "processing") return (
    <Badge variant="secondary" className="gap-1 text-xs">
      <Loader2 className="w-3 h-3 animate-spin" />{isRTL ? "מעבד" : "Processing"}
    </Badge>
  );
  if (status === "ready") return (
    <Badge variant="outline" className="gap-1 text-xs text-green-600 border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
      <CheckCircle2 className="w-3 h-3" />{isRTL ? "מוכן" : "Ready"}
    </Badge>
  );
  if (status === "error") return (
    <Badge variant="destructive" className="gap-1 text-xs">
      <AlertCircle className="w-3 h-3" />{isRTL ? "שגיאה" : "Error"}
    </Badge>
  );
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

export const CourseDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const courseId = Number(id);
  const { isRTL } = useLanguage();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: course, isLoading: loadingCourse } = useGetCourse(courseId);
  // Filtered by courseId — only materials belonging to this specific course.
  const { data: materials, isLoading: loadingMaterials } = useListMaterials({ courseId });
  const deleteMaterial = useDeleteMaterial();

  const handleDelete = (e: React.MouseEvent, materialId: number) => {
    e.preventDefault(); e.stopPropagation();
    if (!window.confirm("האם אתה בטוח שברצונך למחוק את החומר הזה?")) return;
    deleteMaterial.mutate({ id: materialId }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListMaterialsQueryKey() }),
    });
  };

  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  if (loadingCourse) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-20 rounded-xl" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="text-center py-24 text-muted-foreground">
        <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
        <p className="text-lg font-medium">{isRTL ? "הקורס לא נמצא" : "Course not found"}</p>
        <Button variant="outline" className="mt-4 gap-2" onClick={() => setLocation("/courses")}>
          <BackIcon className="w-4 h-4" />
          {isRTL ? "חזרה לקורסים" : "Back to Courses"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <button
        onClick={() => setLocation("/courses")}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
      >
        <BackIcon className="w-4 h-4" />
        {isRTL ? "חזרה לקורסים" : "Back to Courses"}
      </button>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: (course.color || "#4F46E5") + "20" }}
          >
            <BookOpen className="w-6 h-6" style={{ color: course.color || "#4F46E5" }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight break-words">{course.name}</h1>
            {course.description && (
              <p className="text-muted-foreground text-sm mt-0.5 break-words">{course.description}</p>
            )}
            <div className="flex gap-2 flex-wrap mt-1.5">
              {course.university && <Badge variant="secondary" className="text-xs">{course.university}</Badge>}
              {course.semester && <Badge variant="outline" className="text-xs">{course.semester}</Badge>}
            </div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" className="gap-2" onClick={() => setLocation(`/recorder?courseId=${courseId}`)}>
            <Mic className="w-4 h-4" />
            {isRTL ? "הקלט הרצאה" : "Record Lecture"}
          </Button>
          <Button className="gap-2" onClick={() => setLocation(`/materials/new?courseId=${courseId}`)}>
            <Plus className="w-4 h-4" />
            {isRTL ? "הוסף חומר" : "Add Material"}
          </Button>
        </div>
      </div>

      <GlossarySection courseId={courseId} isRTL={isRTL} />

      {loadingMaterials ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : !materials?.length ? (
        <div className="text-center py-24 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">{isRTL ? "אין חומרים בקורס הזה עדיין" : "No materials in this course yet"}</p>
          <p className="text-sm mt-1">{isRTL ? "הוסף חומר ראשון לקורס" : "Add the first material to this course"}</p>
          <Button className="mt-4 gap-2" onClick={() => setLocation(`/materials/new?courseId=${courseId}`)}>
            <Plus className="w-4 h-4" />
            {isRTL ? "הוסף חומר" : "Add Material"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {materials.map(m => (
            <Link key={m.id} href={`/materials/${m.id}`}>
              <Card className="cursor-pointer hover:shadow-md transition-all group">
                <CardContent className="p-4">
                  <div className="flex items-start sm:items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold break-words">{m.title}</span>
                        <StatusBadge status={m.status} isRTL={isRTL} />
                        <Badge variant="outline" className="text-xs">{m.language === "he" ? "עברית" : m.language === "mixed" ? "מעורב" : "אנגלית"}</Badge>
                        <Badge variant="secondary" className="text-xs capitalize">{m.contentType}</Badge>
                      </div>
                      <div className="flex gap-3 sm:gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" />{m.summaryCount} {isRTL ? "סיכומים" : "summaries"}</span>
                        <span className="flex items-center gap-1"><BrainCircuit className="w-3 h-3" />{m.flashcardCount} {isRTL ? "כרטיסיות" : "cards"}</span>
                        <span className="flex items-center gap-1"><HelpCircle className="w-3 h-3" />{m.questionCount} {isRTL ? "שאלות" : "questions"}</span>
                        <span className="flex items-center gap-1"><FileQuestion className="w-3 h-3" />{m.examCount} {isRTL ? "מבחנים" : "exams"}</span>
                      </div>
                    </div>
                    <button onClick={(e) => handleDelete(e, m.id)}
                      className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-2 rounded-md hover:bg-destructive/10 hover:text-destructive transition-all shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
