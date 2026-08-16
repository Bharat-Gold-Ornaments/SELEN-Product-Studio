"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IMAGE_CATEGORIES, IMAGE_CATEGORY_LABELS } from "@/lib/constants";
import { useIntegrationStatus, useAppSettings, useUpdateGenerationCounts } from "@/hooks/use-settings";
import type { ImageCategory } from "@/types/product";

export function SettingsClient() {
  return (
    <PageShell title="Settings" description="Integration status and default generation counts.">
      <IntegrationStatusCard />
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
          How many images Leonardo generates per category, every time Generate runs. Higher counts give more to
          choose from on Review but cost more per product.
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
