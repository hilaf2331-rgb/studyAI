import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListMaterials, useDeleteMaterial, useBulkDeleteMaterials,
  getListMaterialsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/lib/i18n";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, Plus, Trash2, Search, Loader2, AlertCircle, CheckCircle2, Clock, MessageSquare, BookOpen, BrainCircuit, HelpCircle, FileQuestion, X, CheckSquare } from "lucide-react";

const CONTENT_TYPE_ICONS: Record<string, React.ReactNode> = {
  text: <FileText className="w-4 h-4" />,
  url: <FileText className="w-4 h-4" />,
  youtube: <FileText className="w-4 h-4" />,
  pdf: <FileText className="w-4 h-4" />,
  audio: <FileText className="w-4 h-4" />,
  video: <FileText className="w-4 h-4" />,
};

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

export const MaterialsPage: React.FC = () => {
  const { t, isRTL } = useLanguage();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const { data: materials, isLoading } = useListMaterials();
  const deleteMaterial = useDeleteMaterial();
  const bulkDeleteMaterials = useBulkDeleteMaterials();

  // Selection mode is a separate UI state from the list itself, toggled via
  // the "Select" button -- selectedIds only matters while it's on, and gets
  // cleared whenever it's turned off so re-entering selection mode always
  // starts from a clean slate.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const filtered = materials?.filter(m =>
    m.title.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const toggleSelectionMode = () => {
    setSelectionMode(prev => !prev);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every(m => selectedIds.has(m.id));
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(filtered.map(m => m.id)));
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.preventDefault(); e.stopPropagation();
    if (!window.confirm("האם אתה בטוח שברצונך למחוק את החומר הזה?")) return;
    deleteMaterial.mutate({ id }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListMaterialsQueryKey() }),
    });
  };

  const handleBulkDelete = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!window.confirm(`האם אתה בטוח שברצונך למחוק ${count} חומרים?`)) return;
    bulkDeleteMaterials.mutate({ data: { ids: Array.from(selectedIds) } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListMaterialsQueryKey() });
        setSelectedIds(new Set());
        setSelectionMode(false);
      },
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("materials")}</h1>
          <p className="text-muted-foreground mt-1">{isRTL ? "כל חומרי הלימוד שלך" : "All your study materials"}</p>
        </div>
        <div className="flex items-center gap-2">
          {filtered.length > 0 && (
            <Button variant="outline" className="gap-2" onClick={toggleSelectionMode}>
              {selectionMode ? <X className="w-4 h-4" /> : <CheckSquare className="w-4 h-4" />}
              {selectionMode ? (isRTL ? "ביטול" : "Cancel") : (isRTL ? "בחר" : "Select")}
            </Button>
          )}
          <Button className="gap-2" onClick={() => setLocation("/materials/new")}>
            <Plus className="w-4 h-4" />{t("newMaterial")}
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground ${isRTL ? "right-3" : "left-3"}`} />
        <Input
          placeholder={isRTL ? "חפש חומרים..." : "Search materials..."}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={isRTL ? "pr-9" : "pl-9"}
        />
      </div>

      {selectionMode && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
            {isRTL ? "בחר הכל" : "Select All"}
          </label>
          <span className="text-sm text-muted-foreground">
            {isRTL ? `${selectedIds.size} נבחרו` : `${selectedIds.size} selected`}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : !filtered.length ? (
        <div className="text-center py-24 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">{isRTL ? "אין חומרים עדיין" : "No materials yet"}</p>
          <p className="text-sm mt-1">{isRTL ? "העלה את החומר הראשון שלך" : "Upload your first study material"}</p>
          <Button className="mt-4 gap-2" onClick={() => setLocation("/materials/new")}>
            <Plus className="w-4 h-4" />{t("newMaterial")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 pb-20">
          {filtered.map(m => {
            const selected = selectedIds.has(m.id);
            return (
              <Link
                key={m.id}
                href={`/materials/${m.id}`}
                onClick={(e) => { if (selectionMode) { e.preventDefault(); toggleSelected(m.id); } }}
              >
                <Card className={`cursor-pointer hover:shadow-md transition-all group ${selected ? "ring-2 ring-primary" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start sm:items-center gap-3 sm:gap-4">
                      {selectionMode ? (
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggleSelected(m.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                          <FileText className="w-5 h-5" />
                        </div>
                      )}
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
                      {!selectionMode && (
                        <button onClick={(e) => handleDelete(e, m.id)}
                          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-2 rounded-md hover:bg-destructive/10 hover:text-destructive transition-all shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <Button
            variant="destructive"
            size="lg"
            className="gap-2 shadow-lg"
            onClick={handleBulkDelete}
            disabled={bulkDeleteMaterials.isPending}
          >
            {bulkDeleteMaterials.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {isRTL ? `מחק ${selectedIds.size} חומרים נבחרים` : `Delete ${selectedIds.size} Selected`}
          </Button>
        </div>
      )}
    </div>
  );
};
