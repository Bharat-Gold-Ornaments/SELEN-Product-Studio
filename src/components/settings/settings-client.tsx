"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCw, TriangleAlert, XCircle } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { IMAGE_CATEGORIES, IMAGE_CATEGORY_LABELS } from "@/lib/constants";
import {
  useIntegrationStatus,
  useAppSettings,
  useUpdateGenerationCounts,
  useUpdateImageProvider,
  useUpdateDefaultMakingChargeMode,
  type ImageProvider,
  type MakingChargeMode,
} from "@/hooks/use-settings";
import { useUpdateAllPrices, useRateLog } from "@/hooks/use-pricing";
import type { ImageCategory } from "@/types/product";

export function SettingsClient() {
  return (
    <PageShell title="Settings" description="Integration status, pricing, and default generation counts.">
      <IntegrationStatusCard />
      <ImageProviderCard />
      <PricingCard />
      <GenerationCountsCard />
    </PageShell>
  );
}

function IntegrationStatusCard() {
  const statusQuery = useIntegrationStatus();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Integration Status</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => statusQuery.refetch()}
          disabled={statusQuery.isFetching}
        >
          {statusQuery.isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Recheck
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {statusQuery.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking every integration...
          </div>
        ) : statusQuery.error ? (
          <p className="text-sm text-destructive">
            {statusQuery.error instanceof Error ? statusQuery.error.message : "Couldn't check integration status."}
          </p>
        ) : (
          statusQuery.data?.map((service) => (
            <div
              key={service.id}
              className="flex flex-col gap-1 rounded-xl border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-medium text-foreground">{service.label}</span>
              {service.ok ? (
                <span className="flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  Connected
                </span>
              ) : (
                <span className="flex items-start gap-1.5 text-sm text-destructive sm:max-w-md sm:text-right">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{service.message ?? "Not connected."}</span>
                </span>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

const PROVIDER_OPTIONS: { value: ImageProvider; label: string; description: string }[] = [
  { value: "kie", label: "Kie", description: "Default. Same GPT Image 2 model as Leonardo, via a different aggregator." },
  { value: "leonardo", label: "Leonardo", description: "Kept available as a fallback — see Integration Status above." },
];

function ImageProviderCard() {
  const settingsQuery = useAppSettings();
  const updateProvider = useUpdateImageProvider();

  function handleSelect(provider: ImageProvider) {
    if (provider === settingsQuery.data?.imageProvider) return;
    updateProvider.mutate(provider, {
      onSuccess: () => toast.success(`Switched to ${provider === "kie" ? "Kie" : "Leonardo"}.`),
      onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't switch provider."),
    });
  }

  const active = settingsQuery.data?.imageProvider ?? "kie";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Image Generation Provider</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <p className="text-sm text-muted-foreground">
          Which service generates Hero/Lifestyle/Closeup images — every product uses whichever is active here.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PROVIDER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              disabled={settingsQuery.isLoading || updateProvider.isPending}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-50",
                active === option.value
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-secondary"
              )}
            >
              <span className="text-sm font-medium text-foreground">
                {option.label}
                {active === option.value ? " · Active" : ""}
              </span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const MAKING_CHARGE_MODE_OPTIONS: { value: MakingChargeMode; label: string }[] = [
  { value: "flat", label: "Flat (₹)" },
  { value: "per_gram", label: "Per Gram (₹/g)" },
];

/**
 * The global Rate/gram, its "Update All Prices" bulk action (with the
 * exact scope-of-change confirmation copy from the spec), the default
 * Making Charge Mode new products pre-fill with, and the rate change audit
 * log — see src/lib/pricing.ts and services/pricing.ts for the formulas
 * and orchestration this drives.
 */
function PricingCard() {
  const settingsQuery = useAppSettings();
  const updateAllPrices = useUpdateAllPrices();
  const updateDefaultMode = useUpdateDefaultMakingChargeMode();
  const rateLogQuery = useRateLog();

  const [rateInput, setRateInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && settingsQuery.data) {
      initialized.current = true;
      setRateInput(settingsQuery.data.ratePerGram > 0 ? String(settingsQuery.data.ratePerGram) : "");
    }
  }, [settingsQuery.data]);

  const currentRate = settingsQuery.data?.ratePerGram ?? 0;
  const newRateNumber = Number(rateInput) || 0;
  const rateChanged = newRateNumber > 0 && newRateNumber !== currentRate;

  async function handleConfirmUpdateAll() {
    try {
      const result = await updateAllPrices.mutateAsync(newRateNumber);
      setConfirmOpen(false);
      toast.success(
        `Updated ${result.updated} product${result.updated === 1 ? "" : "s"}` +
          (result.skipped ? `, skipped ${result.skipped}` : "") +
          (result.failed.length ? `, ${result.failed.length} failed` : "") +
          "."
      );
      result.failed.forEach((f) => toast.error(`${f.productId}: ${f.message}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update prices.");
    }
  }

  function handleSelectDefaultMode(mode: MakingChargeMode) {
    if (mode === settingsQuery.data?.defaultMakingChargeMode) return;
    updateDefaultMode.mutate(mode, {
      onSuccess: () => toast.success("Default making charge mode saved."),
      onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't save."),
    });
  }

  const activeDefaultMode = settingsQuery.data?.defaultMakingChargeMode ?? "per_gram";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 pt-0">
          <div className="max-w-xs space-y-1.5">
            <Label>Rate/gram (₹)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              disabled={settingsQuery.isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Current: ₹{currentRate.toLocaleString("en-IN")}/g
            </p>
          </div>

          <Button
            variant="outline"
            className="self-start"
            disabled={!rateChanged || updateAllPrices.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {updateAllPrices.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Update All Prices
          </Button>

          <div className="space-y-1.5">
            <Label>Default Making Charge Mode</Label>
            <p className="text-xs text-muted-foreground">
              Pre-fills new products&apos; Making Charge Mode — never inferred, always changeable per product.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:max-w-sm sm:grid-cols-2">
              {MAKING_CHARGE_MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelectDefaultMode(option.value)}
                  disabled={settingsQuery.isLoading || updateDefaultMode.isPending}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
                    activeDefaultMode === option.value
                      ? "border-primary bg-accent text-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Rate Change Log</Label>
            {rateLogQuery.isLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : !rateLogQuery.data || rateLogQuery.data.length === 0 ? (
              <p className="text-xs text-muted-foreground">No rate changes logged yet.</p>
            ) : (
              <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-xl border border-border p-2">
                {rateLogQuery.data.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-foreground">
                      ₹{entry.oldRate.toLocaleString("en-IN")} → ₹{entry.newRate.toLocaleString("en-IN")}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleString()} · {entry.changedBy}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
          <DialogTitle>Update all prices?</DialogTitle>
          <div className="mt-3 flex flex-col gap-3 text-sm text-muted-foreground">
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              This will update metal cost only, based on the new Rate/gram (₹{currentRate.toLocaleString("en-IN")} →
              ₹{newRateNumber.toLocaleString("en-IN")}). Making charges and stone/pearl charges are unaffected.
              Products with a manual price override are skipped. This updates your product catalog — the change will
              sync to Shopify and apply to new orders going forward.
            </p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)} disabled={updateAllPrices.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirmUpdateAll} disabled={updateAllPrices.isPending}>
              {updateAllPrices.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Confirm Update
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GenerationCountsCard() {
  const settingsQuery = useAppSettings();
  const updateCounts = useUpdateGenerationCounts();

  const [counts, setCounts] = useState<Record<ImageCategory, string>>({ hero: "", lifestyle: "", closeup: "" });
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && settingsQuery.data) {
      initialized.current = true;
      setCounts({
        hero: String(settingsQuery.data.generationCounts.hero),
        lifestyle: String(settingsQuery.data.generationCounts.lifestyle),
        closeup: String(settingsQuery.data.generationCounts.closeup),
      });
    }
  }, [settingsQuery.data]);

  async function handleSave() {
    const parsed: Partial<Record<ImageCategory, number>> = {};
    for (const category of IMAGE_CATEGORIES) {
      const value = Number(counts[category]);
      if (!Number.isInteger(value) || value < 1 || value > 6) {
        toast.error(`${IMAGE_CATEGORY_LABELS[category]}: enter a whole number between 1 and 6.`);
        return;
      }
      parsed[category] = value;
    }

    try {
      await updateCounts.mutateAsync(parsed);
      toast.success("Generation counts saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save settings.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default Generation Counts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <p className="text-sm text-muted-foreground">
          How many images the active provider (above) generates per category, every time Generate runs. Higher
          counts give more to choose from on Review but cost more per product.
        </p>
        {settingsQuery.isLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {IMAGE_CATEGORIES.map((category) => (
              <div key={category} className="space-y-1.5">
                <Label>{IMAGE_CATEGORY_LABELS[category]}</Label>
                <Input
                  type="number"
                  min="1"
                  max="6"
                  step="1"
                  value={counts[category]}
                  onChange={(e) => setCounts((prev) => ({ ...prev, [category]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}
        <Button onClick={handleSave} disabled={settingsQuery.isLoading || updateCounts.isPending} className="self-start">
          {updateCounts.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
