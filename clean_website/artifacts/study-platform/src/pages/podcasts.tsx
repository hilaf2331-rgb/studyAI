import React, { useState } from "react";
import { Link } from "wouter";
import { useListAllCourseMedia } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { AudioPlayer } from "@/components/audio-player";
import { Headphones, Search, BookOpen, Calendar } from "lucide-react";

export const PodcastsPage: React.FC = () => {
  const { isRTL } = useLanguage();
  const [search, setSearch] = useState("");
  const { data: assets, isLoading } = useListAllCourseMedia();

  const filtered = (assets ?? []).filter((a) =>
    a.title.toLowerCase().includes(search.toLowerCase()) ||
    a.courseName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Headphones className="w-7 h-7 text-primary" />
          {isRTL ? "כל הפודקאסטים" : "All Podcasts"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {isRTL ? "כל קבצי השמע מכל הקורסים שלך, במקום אחד" : "All audio from every course, in one place"}
        </p>
      </div>

      <div className="relative">
        <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground ${isRTL ? "right-3" : "left-3"}`} />
        <Input
          placeholder={isRTL ? "חפש פודקאסטים או קורסים..." : "Search podcasts or courses..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={isRTL ? "pr-9" : "pl-9"}
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : !filtered.length ? (
        <div className="text-center py-24 text-muted-foreground">
          <Headphones className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">{isRTL ? "אין עדיין פודקאסטים" : "No podcasts yet"}</p>
          <p className="text-sm mt-1">
            {isRTL ? "המר חומר לימוד או העלה הרצאה מתוך עמוד הקורס" : "Convert a material or upload a lecture from a course page"}
          </p>
        </div>
      ) : (
        <div className="space-y-3 pb-20">
          {filtered.map((asset) => (
            <Card key={asset.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start sm:items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                      <Headphones className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <span className="font-semibold break-words block">{asset.title}</span>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                        <Link href={`/courses/${asset.courseId}`} className="flex items-center gap-1 hover:text-primary hover:underline">
                          <BookOpen className="w-3 h-3" />{asset.courseName}
                        </Link>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(asset.createdAt).toLocaleDateString(isRTL ? "he-IL" : "en-US")}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {asset.kind === "lecture_upload" ? (isRTL ? "הרצאה שהועלתה" : "Uploaded") : (isRTL ? "הומר" : "Converted")}
                  </Badge>
                </div>
                {asset.status === "ready" ? (
                  <AudioPlayer src={asset.storageUrl} title={asset.title} artist={asset.courseName} />
                ) : (
                  <p className="text-xs text-muted-foreground">{isRTL ? "מעבד..." : "Processing..."}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
