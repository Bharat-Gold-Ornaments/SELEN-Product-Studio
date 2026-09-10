"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, TriangleAlert } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useCollectionsList,
  useTagsList,
  useDiscountPreview,
  useApplyDiscount,
  useRemoveDiscount,
  type DiscountScope,
} from "@/hooks/use-discounts";

const SCOPE_OPTIONS: { value: "global" | "collection" | "tag"; label: string }[] = [
  { value: "global", label: "Everything" },
  { value: "collection", label: "A Collection" },
  { value: "tag", label: "A Tag" },
];

function scopeLabel(scope: DiscountScope, collections: { id: string; title: string }[]): string {
  if (scope.type === "global") return "your whole catalog";
  if (scope.type === "collection") {
    return `the "${collections.find((c) => c.id === scope.collectionId)?.title ?? scope.collectionId}" collection`;
  }
  return `everything tagged "${scope.tag}"`;
}

export function DiscountsClient() {
  return (
    <PageShell
      title="Discounts"
      description="Apply or remove a percentage discount across your whole catalog, a collection, or a tag. This updates Shopify directly and takes effect immediately."
    >
      <DiscountCard />
    </PageShell>
  );
}

function DiscountCard() {
  const collectionsQuery = useCollectionsList();
  const tagsQuery = useTagsList();
  const applyDiscount = useApplyDiscount();
  const removeDiscount = useRemoveDiscount();

  const [scopeType, setScopeType] = useState<"global" | "collection" | "tag">("global");
  const [collectionId, setCollectionId] = useState("");
  const [tag, setTag] = useState("");
  const [percentInput, setPercentInput] = useState("");
  const [confirmMode, setConfirmMode] = useState<"apply" | "remove" | null>(null);

  const scope: DiscountScope | null =
    scopeType === "global"
      ? { type: "global" }
      : scopeType === "collection"
        ? collectionId
          ? { type: "collection", collectionId }
          : null
        : tag
          ? { type: "tag", tag }
          : null;

  const previewQuery = useDiscountPreview(scope);
  const percent = Number(percentInput) || 0;
  const percentValid = percent >= 1 && percent <= 90;

  async function handleConfirmApply() {
    if (!scope) return;
    try {
      const result = await applyDiscount.mutateAsync({ scope, percent });
      setConfirmMode(null);
      toast.success(
        `Discounted ${result.productsUpdated} product${result.productsUpdated === 1 ? "" : "s"}` +
          ` (${result.variantsUpdated} variant${result.variantsUpdated === 1 ? "" : "s"})` +
          (result.failed.length ? `, ${result.failed.length} failed` : "") +
          "."
      );
      result.failed.forEach((f) => toast.error(`${f.productId}: ${f.message}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't apply the discount.");
    }
  }

  async function handleConfirmRemove() {
    if (!scope) return;
    try {
      const result = await removeDiscount.mutateAsync(scope);
      setConfirmMode(null);
      toast.success(
        result.productsUpdated === 0
          ? "Nothing in this scope currently has a discount."
          : `Restored ${result.productsUpdated} product${result.productsUpdated === 1 ? "" : "s"}` +
              ` (${result.variantsUpdated} variant${result.variantsUpdated === 1 ? "" : "s"})` +
              (result.failed.length ? `, ${result.failed.length} failed` : "") +
              "."
      );
      result.failed.forEach((f) => toast.error(`${f.productId}: ${f.message}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove the discount.");
    }
  }

  const collections = collectionsQuery.data ?? [];
  const isMutating = applyDiscount.isPending || removeDiscount.isPending;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Apply a Discount</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 pt-0">
          <div className="space-y-1.5">
            <Label>Scope</Label>
            <div className="grid grid-cols-1 gap-2 sm:max-w-md sm:grid-cols-3">
              {SCOPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setScopeType(option.value)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors",
                    scopeType === option.value
                      ? "border-primary bg-accent text-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {scopeType === "collection" ? (
            <div className="max-w-xs space-y-1.5">
              <Label>Collection</Label>
              <Select value={collectionId} onValueChange={setCollectionId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={collectionsQuery.isLoading ? "Loading..." : "Choose a collection"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {scopeType === "tag" ? (
            <div className="max-w-xs space-y-1.5">
              <Label>Tag</Label>
              <Select value={tag} onValueChange={setTag}>
                <SelectTrigger>
                  <SelectValue placeholder={tagsQuery.isLoading ? "Loading..." : "Choose a tag"} />
                </SelectTrigger>
                <SelectContent>
                  {(tagsQuery.data ?? []).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="max-w-xs space-y-1.5">
            <Label>Discount (%)</Label>
            <Input
              type="number"
              min="1"
              max="90"
              step="1"
              value={percentInput}
              onChange={(e) => setPercentInput(e.target.value)}
              placeholder="e.g. 20"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {!scope
              ? "Pick a scope to see how many products it matches."
              : previewQuery.isLoading
                ? "Checking how many products match..."
                : previewQuery.isError
                  ? (previewQuery.error instanceof Error
                      ? previewQuery.error.message
                      : "Couldn't check this scope.")
                  : `Matches ${previewQuery.data?.productCount ?? 0} product` +
                    `${previewQuery.data?.productCount === 1 ? "" : "s"}` +
                    ` (${previewQuery.data?.variantCount ?? 0} variant` +
                    `${previewQuery.data?.variantCount === 1 ? "" : "s"}).`}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!scope || !percentValid || isMutating}
              onClick={() => setConfirmMode("apply")}
            >
              Apply Discount
            </Button>
            <Button
              variant="outline"
              disabled={!scope || isMutating}
              onClick={() => setConfirmMode("remove")}
            >
              Remove Discount
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmMode === "apply"} onOpenChange={(open) => !open && setConfirmMode(null)}>
        <DialogContent className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
          <DialogTitle>Apply a {percent}% discount?</DialogTitle>
          <div className="mt-3 flex flex-col gap-3 text-sm text-muted-foreground">
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              This will update {scope ? scopeLabel(scope, collections) : "this scope"} on Shopify
              directly: each matching variant&apos;s current price is stored as its compare-at
              (strikethrough) price, and its price is reduced by {percent}%. This takes effect
              immediately for customers.
            </p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmMode(null)} disabled={applyDiscount.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirmApply} disabled={applyDiscount.isPending}>
              {applyDiscount.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Confirm Discount
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmMode === "remove"} onOpenChange={(open) => !open && setConfirmMode(null)}>
        <DialogContent className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
          <DialogTitle>Remove discount?</DialogTitle>
          <div className="mt-3 flex flex-col gap-3 text-sm text-muted-foreground">
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              This restores the original price for every variant in{" "}
              {scope ? scopeLabel(scope, collections) : "this scope"} that&apos;s currently on sale,
              and clears its compare-at price. Anything not currently discounted is left untouched.
            </p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmMode(null)} disabled={removeDiscount.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirmRemove} disabled={removeDiscount.isPending}>
              {removeDiscount.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Confirm Removal
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
