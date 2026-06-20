import React, { useState } from "react";
import { Link } from "wouter";
import {
  useListCourses, useCreateCourse, useDeleteCourse,
  getListCoursesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Plus, Trash2, ChevronRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";

const COLORS = ["#4F46E5", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6"];

const formSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  university: z.string().optional(),
  semester: z.string().optional(),
  color: z.string().default("#4F46E5"),
});

export const CoursesPage: React.FC = () => {
  const { t, isRTL } = useLanguage();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: courses, isLoading } = useListCourses();
  const createCourse = useCreateCourse();
  const deleteCourse = useDeleteCourse();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "", university: "", semester: "", color: "#4F46E5" },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createCourse.mutate({ data: values }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        setOpen(false);
        form.reset();
      },
    });
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    deleteCourse.mutate({ id }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListCoursesQueryKey() }),
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("courses")}</h1>
          <p className="text-muted-foreground mt-1">{isRTL ? "ספריית הקורסים שלך" : "Your course library"}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="w-4 h-4" />{t("newCourse")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("newCourse")}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{isRTL ? "שם הקורס" : "Course Name"}</FormLabel>
                    <FormControl><Input placeholder={isRTL ? "לדוגמה: אלגברה לינארית" : "e.g. Linear Algebra"} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{isRTL ? "תיאור" : "Description"}</FormLabel>
                    <FormControl><Input placeholder={isRTL ? "תיאור קצר" : "Short description"} {...field} /></FormControl>
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="university" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{isRTL ? "אוניברסיטה" : "University"}</FormLabel>
                      <FormControl><Input placeholder={isRTL ? "שם המוסד" : "Institution"} {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="semester" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{isRTL ? "סמסטר" : "Semester"}</FormLabel>
                      <FormControl><Input placeholder={isRTL ? "סמסטר א׳ 2025" : "Fall 2025"} {...field} /></FormControl>
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="color" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{isRTL ? "צבע" : "Color"}</FormLabel>
                    <FormControl>
                      <div className="flex gap-2 flex-wrap">
                        {COLORS.map(c => (
                          <button key={c} type="button"
                            className={`w-8 h-8 rounded-full border-2 transition-all ${field.value === c ? "border-foreground scale-110" : "border-transparent"}`}
                            style={{ backgroundColor: c }}
                            onClick={() => field.onChange(c)}
                          />
                        ))}
                      </div>
                    </FormControl>
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={createCourse.isPending}>
                  {createCourse.isPending ? (isRTL ? "יוצר..." : "Creating...") : (isRTL ? "צור קורס" : "Create Course")}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : !courses?.length ? (
        <div className="text-center py-24 text-muted-foreground">
          <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">{isRTL ? "אין קורסים עדיין" : "No courses yet"}</p>
          <p className="text-sm mt-1">{isRTL ? "צור את הקורס הראשון שלך" : "Create your first course to get started"}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courses.map(course => (
            <Link key={course.id} href={`/courses/${course.id}`}>
              <Card className="cursor-pointer hover:shadow-lg transition-all group border-t-4" style={{ borderTopColor: course.color }}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-2" style={{ backgroundColor: course.color + "20" }}>
                      <BookOpen className="w-5 h-5" style={{ color: course.color }} />
                    </div>
                    <button onClick={(e) => handleDelete(e, course.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-all">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <CardTitle className="text-lg leading-tight">{course.name}</CardTitle>
                  {course.description && <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{course.description}</p>}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2 flex-wrap">
                      {course.university && <Badge variant="secondary" className="text-xs">{course.university}</Badge>}
                      {course.semester && <Badge variant="outline" className="text-xs">{course.semester}</Badge>}
                    </div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <span>{course.materialCount}</span>
                      <span>{isRTL ? "חומרים" : "materials"}</span>
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
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
