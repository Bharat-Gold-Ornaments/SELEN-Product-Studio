"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/create-product/tag-input";
import {
  useGenerateAllCopy,
  useRegenerateCopyField,
  type ProductCopy,
} from "@/hooks/use-generation";
import type { ImagePromptVariables } from "@/lib/generation-variables";

type CopyField = "title" | "description" | "tags" | "seo" | "collections";

interface CopySectionProps {
  productId: string;
  variables: ImagePromptVariables;
  copy: ProductCopy | null;
  onCopyChange: (copy: ProductCopy) => void;
  /**
   * `/api/drive-image/{fileId}` proxy URLs of whichever hero/lifestyle image
   * is currently picked on Review — sent along with every generate/
   * regenerate call so title/description reflect the actual hero shot and
   * collection classification can see the lifestyle shot. Either can be
   * undefined if that category hasn't been generated/picked yet.
   */
  heroImageUrl?: string;
  lifestyleImageUrl?: string;
}

/**
 * Title/Description/Tags/SEO for the product being reviewed (Milestone 7).
 * Never generates on its own — the user has to hit "Generate Copy" first,
 * matching how Drive retry and image Regenerate are also user-triggered
 * rather than automatic. Every field is a plain editable input once
 * generated, so the AI output is a starting draft, not the final word; each
 * has its own Regenerate button that reuses whatever title is currently on
 * screen (so editing the title by hand and then regenerating Description
 * picks up the edit, not the original AI title).
 */
export function CopySection({ productId, variables, copy, onCopyChange, heroImageUrl, lifestyleImageUrl }: CopySectionProps) {
  const [regeneratingField, setRegeneratingField] = useState<CopyField | null>(null);
  const generateAll = useGenerateAllCopy();
  const regenerateField = useRegenerateCopyField();

  async function handleGenerateAll() {
    try {
      const result = await generateAll.mutateAsync({ productId, variables, heroImageUrl, lifestyleImageUrl });

      if (result.title.status === "error") {
        toast.error(result.title.message);
        return;
      }

      const next: ProductCopy = {
        title: result.title.value,
        description: result.description.status === "success" ? result.description.value : "",
        tags: result.tags.status === "success" ? result.tags.value : [],
        seoTitle: result.seo.status === "success" ? result.seo.value.seoTitle : "",
        metaDescription: result.seo.status === "success" ? result.seo.value.metaDescription : "",
        collections: result.collections.status === "success" ? result.collections.value : [],
      };
      onCopyChange(next);

      if (result.description.status === "error") toast.error(`Description: ${result.description.message}`);
      if (result.tags.status === "error") toast.error(`Tags: ${result.tags.message}`);
      if (result.seo.status === "error") toast.error(`SEO: ${result.seo.message}`);
      if (result.collections.status === "error") toast.error(`Collections: ${result.collections.message}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Copy generation failed.");
    }
  }

  async function handleRegenerateField(field: CopyField) {
    if (!copy) return;
    setRegeneratingField(field);
    try {
      const result = await regenerateField.mutateAsync({
        productId,
        field,
        variables,
        title: copy.title,
        heroImageUrl,
        lifestyleImageUrl,
      });

      if (result.status === "error") {
        toast.error(result.message);
        return;
      }

      if (field === "title") {
        onCopyChange({ ...copy, title: result.value as string });
      } else if (field === "description") {
        onCopyChange({ ...copy, description: result.value as string });
      } else if (field === "tags") {
        onCopyChange({ ...copy, tags: result.value as string[] });
      } else if (field === "collections") {
        onCopyChange({ ...copy, collections: result.value as string[] });
      } else {
        const seo = result.value as { seoTitle: string; metaDescription: string };
        onCopyChange({ ...copy, seoTitle: seo.seoTitle, metaDescription: seo.metaDescription });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Regeneration failed.");
    } finally {
      setRegeneratingField(null);
    }
  }

  if (!copy) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Product Copy</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            Generate a title, description, tags, and SEO metadata for this product with Claude.
          </p>
          <Button onClick={handleGenerateAll} disabled={generateAll.isPending}>
            {generateAll.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Generate Copy
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product Copy</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-0">
        <FieldRow label="Title" field="title" isRegenerating={regeneratingField === "title"} onRegenerate={handleRegenerateField}>
          <Input value={copy.title} onChange={(e) => onCopyChange({ ...copy, title: e.target.value })} />
        </FieldRow>

        <FieldRow
          label="Description"
          field="description"
          isRegenerating={regeneratingField === "description"}
          onRegenerate={handleRegenerateField}
        >
          <Textarea
            rows={4}
            value={copy.description}
            onChange={(e) => onCopyChange({ ...copy, description: e.target.value })}
          />
        </FieldRow>

        <FieldRow label="Tags" field="tags" isRegenerating={regeneratingField === "tags"} onRegenerate={handleRegenerateField}>
          <Input
            value={copy.tags.join(", ")}
            onChange={(e) =>
              onCopyChange({
                ...copy,
                tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
              })
            }
            placeholder="gold, hoops, everyday"
          />
        </FieldRow>

        <FieldRow label="SEO" field="seo" isRegenerating={regeneratingField === "seo"} onRegenerate={handleRegenerateField}>
          <div className="flex flex-col gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">SEO title</Label>
              <Input
                value={copy.seoTitle}
                onChange={(e) => onCopyChange({ ...copy, seoTitle: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Meta description</Label>
              <Textarea
                rows={2}
                value={copy.metaDescription}
                onChange={(e) => onCopyChange({ ...copy, metaDescription: e.target.value })}
              />
            </div>
          </div>
        </FieldRow>

        <FieldRow
          label="Collections"
          field="collections"
          isRegenerating={regeneratingField === "collections"}
          onRegenerate={handleRegenerateField}
        >
          <TagInput
            value={copy.collections}
            onChange={(next) => onCopyChange({ ...copy, collections: next })}
            placeholder="AI-classified from the lifestyle photo"
          />
        </FieldRow>
      </CardContent>
    </Card>
  );
}

function FieldRow({
  label,
  field,
  isRegenerating,
  onRegenerate,
  children,
}: {
  label: string;
  field: CopyField;
  isRegenerating: boolean;
  onRegenerate: (field: CopyField) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={() => onRegenerate(field)}
          disabled={isRegenerating}
        >
          {isRegenerating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Regenerate
        </Button>
      </div>
      {children}
    </div>
  );
}
