"use client";

import { useState } from "react";
import Link from "next/link";
import { Boxes, Download, ExternalLink, Gem, Loader2, RefreshCw, ShoppingBag, TriangleAlert } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useReconciliation } from "@/hooks/use-reconciliation";
import {
  RECONCILIATION_RULES,
  type ReconciliationIssue,
  type ReconciliationRule,
  type ReconciliationSeverity,
} from "@/types/reconciliation";

const SEVERITY_BADGE: Record<ReconciliationSeverity, "destructive" | "warning" | "secondary"> = {
  error: "destructive",
  warning: "warning",
  info: "secondary",
};

const SEVERITY_LABEL: Record<ReconciliationSeverity, string> = {
  error: "Errors",
  warning: "Warnings",
  info: "Info",
};

/** How many rows a rule's table shows before "Show all". */
const COLLAPSED_ROWS = 8;

function toCsv(issues: ReconciliationIssue[]): string {
  const header = ["Severity", "Check", "Shopify product", "Shopify ID", "SKU", "Studio product", "Details"];
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const rows = issues.map((issue) => {
    const info = RECONCILIATION_RULES[issue.rule];
    return [
      info.severity,
      info.title,
      issue.shopifyTitle ?? "",
      issue.shopifyProductId ?? "",
      issue.sku ?? "",
      issue.productId ? `${issue.productTitle ?? ""} (${issue.productId})` : "",
      issue.message,
    ].map(escape);
  });
  return [header, ...rows].map((row) => row.join(",")).join("\n");
}

function downloadCsv(issues: ReconciliationIssue[]) {
  const blob = new Blob([toCsv(issues)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function SummaryTile({ label, value, sub, icon: Icon }: { label: string; value: number; sub?: string; icon: typeof Gem }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-5">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-2xl font-semibold tracking-tight text-foreground">{value}</span>
          {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function RuleSection({ rule, issues }: { rule: ReconciliationRule; issues: ReconciliationIssue[] }) {
  const [expanded, setExpanded] = useState(false);
  const info = RECONCILIATION_RULES[rule];
  const visible = expanded ? issues : issues.slice(0, COLLAPSED_ROWS);

  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="gap-1 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={SEVERITY_BADGE[info.severity]}>{info.severity}</Badge>
          <CardTitle className="text-base">{info.title}</CardTitle>
          <span className="text-sm text-muted-foreground">({issues.length})</span>
        </div>
        <p className="text-sm text-muted-foreground">{info.description}</p>
      </CardHeader>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Shopify product</th>
              <th className="px-4 py-2 font-medium">SKU</th>
              <th className="px-4 py-2 font-medium">Studio product</th>
              <th className="px-4 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((issue, i) => (
              <tr key={i} className="align-top">
                <td className="px-4 py-2">
                  {issue.shopifyProductId ? (
                    issue.shopifyAdminUrl ? (
                      <a
                        href={issue.shopifyAdminUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                      >
                        {issue.shopifyTitle ?? issue.shopifyProductId}
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">{issue.shopifyProductId}</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{issue.sku ?? "—"}</td>
                <td className="px-4 py-2">
                  {issue.productId ? (
                    <Link href={`/products/${issue.productId}/finalize`} className="hover:underline">
                      {issue.productTitle ?? issue.productId}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{issue.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {issues.length > COLLAPSED_ROWS ? (
        <div className="border-t border-border px-4 py-2">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show fewer" : `Show all ${issues.length}`}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function ReconciliationClient() {
  const { data, isLoading, isFetching, isError, error, refetch } = useReconciliation();
  const [severityFilter, setSeverityFilter] = useState<ReconciliationSeverity | "all">("all");

  const issues = data?.issues ?? [];
  const severityCounts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) severityCounts[RECONCILIATION_RULES[issue.rule].severity] += 1;

  const rules = (Object.keys(RECONCILIATION_RULES) as ReconciliationRule[]).filter(
    (rule) => severityFilter === "all" || RECONCILIATION_RULES[rule].severity === severityFilter
  );
  const byRule = new Map<ReconciliationRule, ReconciliationIssue[]>();
  for (const issue of issues) byRule.set(issue.rule, [...(byRule.get(issue.rule) ?? []), issue]);
  const visibleRules = rules.filter((rule) => byRule.has(rule));

  return (
    <PageShell
      title="Reconciliation"
      description="Cross-checks Shopify against the Products and Inventory tabs. Read-only — nothing is changed. Archived and draft Shopify products are left out."
      actions={
        <>
          <Button variant="outline" onClick={() => downloadCsv(issues)} disabled={issues.length === 0}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run again
          </Button>
        </>
      }
    >
      {isError ? (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {error instanceof Error ? error.message : "Couldn't run the reconciliation."}
        </div>
      ) : null}

      {isLoading ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px] rounded-2xl" />
            ))}
          </div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading every Shopify product and both Sheet tabs…
          </p>
        </>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile
              label="Active on Shopify"
              value={data.totals.shopifyActive}
              sub={`${data.totals.shopifyIgnored} archived/draft ignored`}
              icon={ShoppingBag}
            />
            <SummaryTile label="Products tab" value={data.totals.productsWithShopifyId} sub="rows with a Shopify ID" icon={Gem} />
            <SummaryTile label="Inventory tab" value={data.totals.inventoryRows} sub="SKUs" icon={Boxes} />
            <SummaryTile
              label="Issues found"
              value={issues.length}
              sub={`${severityCounts.error} errors · ${severityCounts.warning} warnings · ${severityCounts.info} info`}
              icon={TriangleAlert}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "error", "warning", "info"] as const).map((severity) => (
              <Button
                key={severity}
                size="sm"
                variant={severityFilter === severity ? "default" : "outline"}
                onClick={() => setSeverityFilter(severity)}
              >
                {severity === "all" ? `All (${issues.length})` : `${SEVERITY_LABEL[severity]} (${severityCounts[severity]})`}
              </Button>
            ))}
            <span className={cn("ml-auto text-xs text-muted-foreground", isFetching && "animate-pulse")}>
              Last run {new Date(data.generatedAt).toLocaleString()}
            </span>
          </div>

          {visibleRules.length === 0 ? (
            <div className="flex items-center justify-center rounded-2xl border border-dashed border-border py-16 text-sm text-muted-foreground">
              {issues.length === 0 ? "Everything matches — no issues found." : "No issues at this level."}
            </div>
          ) : (
            visibleRules.map((rule) => <RuleSection key={rule} rule={rule} issues={byRule.get(rule)!} />)
          )}
        </>
      ) : null}
    </PageShell>
  );
}
