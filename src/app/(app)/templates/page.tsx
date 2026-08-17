"use client";

import { useEffect, useState } from "react";
import { Clock, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTemplates, useUpdateTemplate } from "@/hooks/use-templates";
import { TEMPLATE_CATEGORIES, imageTemplateId, type TemplateCategoryId } from "@/lib/template-categories";
import { PRODUCT_TYPES } from "@/lib/constants";
import { cn, formatDate } from "@/lib/utils";

// Image prompts are grouped one level deeper than Copy prompts — one
// sub-section per product type — since there are now 15 of them (5 product
// types x Hero/Lifestyle/Closeup) instead of 3 shared ones, too many to
// scan as a single flat list.
const copyCategories = TEMPLATE_CATEGORIES.filter((c) => c.group === "Copy prompts");
const imageCategoriesByProductType = PRODUCT_TYPES.map((productType) => ({
  productType,
  templates: TEMPLATE_CATEGORIES.filter((c) => c.group === "Image prompts" && c.productType === productType.value),
}));

export default function TemplatesPage() {
  const { data: templates, isLoading, isError } = useTemplates();
  const updateTemplate = useUpdateTemplate();
  const [activeId, setActiveId] = useState<TemplateCategoryId>(imageTemplateId("earrings", "hero"));
  const [draft, setDraft] = useState("");

  const active = templates?.find((t) => t.id === activeId);

  useEffect(() => {
    if (active) setDraft(active.content);
    // Only re-sync the draft when the active template's own content
    // changes (e.g. after a successful save) or the user switches tabs —
    // not on every keystroke, which would overwrite what they're typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.content]);

  const isDirty = active ? draft !== active.content : false;

  async function handleSave() {
    if (!active) return;
    try {
      await updateTemplate.mutateAsync({ id: active.id, content: draft });
      toast.success(`${active.label} saved`, {
        description: "The next generation for this category will use the updated prompt.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the template.");
    }
  }

  return (
    <PageShell
      title="Template Manager"
      description="Edit the Leonardo and AI-copy prompt templates used across generation."
    >
      {isError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load templates. Try refreshing the page.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        <nav className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Image prompts
            </span>
            {imageCategoriesByProductType.map(({ productType, templates: productTemplates }) => (
              <div key={productType.value} className="flex flex-col gap-1">
                <span className="px-2.5 text-[11px] font-medium text-muted-foreground/70">
                  {productType.label}
                </span>
                {productTemplates.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setActiveId(category.id)}
                    className={cn(
                      "rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors",
                      activeId === category.id
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground/80 hover:bg-secondary"
                    )}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <span className="px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Copy prompts
            </span>
            {copyCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveId(category.id)}
                className={cn(
                  "rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors",
                  activeId === category.id
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground/80 hover:bg-secondary"
                )}
              >
                {category.label}
              </button>
            ))}
          </div>
        </nav>

        {isLoading || !active ? (
          <Card>
            <CardHeader className="gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
            </CardHeader>
            <CardContent className="pt-0">
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>{active.label}</CardTitle>
                <CardDescription>{active.description}</CardDescription>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Updated {formatDate(active.updatedAt)}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-0">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={12}
                className="font-mono text-xs"
              />

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Available variables:</span>
                {active.variables.map((variable) => (
                  <Badge key={variable} variant="outline" className="font-mono text-[11px]">
                    {`{{${variable}}}`}
                  </Badge>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {isDirty ? "Unsaved changes" : "Saved"}
                </span>
                <Button onClick={handleSave} disabled={!isDirty || updateTemplate.isPending}>
                  {updateTemplate.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save changes
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
