"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Globe, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useOnlineSyncState, useSyncOnlineOrders } from "@/hooks/use-online-orders";
import { formatDay } from "@/lib/sales-stats";

const COLLAPSED_ROWS = 5;

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

/**
 * Online sales come from Shopify orders: synced when the Sales page opens
 * and on "Sync now". Lines that can't be matched to an Inventory SKU wait
 * here until their SKU is added on Shopify.
 */
export function OnlineOrdersPanel() {
  const state = useOnlineSyncState();
  const sync = useSyncOnlineOrders();
  const [expanded, setExpanded] = useState(false);
  const started = useRef(false);

  // One automatic sync per page visit, so stock is current before anyone records sales.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    sync.mutate();
  }, [sync]);

  const current = state.data;
  const waiting = current?.waiting ?? [];
  const visible = expanded ? waiting : waiting.slice(0, COLLAPSED_ROWS);
  const result = sync.data;

  return (
    <Card className="p-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-muted-foreground" />
            Online orders
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {current
              ? `Taken off Inventory automatically. Tracking orders since ${formatDay(current.trackingSince.slice(0, 10))} · last synced ${formatTime(current.lastSyncedAt)}.`
              : "Shopify orders are taken off Inventory automatically once the first sync runs."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync now
        </Button>
      </CardHeader>

      {sync.isError ? (
        <div className="flex gap-2 border-t border-border bg-destructive/5 px-4 py-3 text-sm text-foreground">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>{sync.error.message}</span>
        </div>
      ) : result && !sync.isPending ? (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          {result.firstRun
            ? "Tracking started. Orders placed from now on will be taken off Inventory; earlier ones are already in your counts."
            : `Last sync: ${result.imported} new online sale${result.imported === 1 ? "" : "s"}, ${result.returned} return${
                result.returned === 1 ? "" : "s"
              }${result.shopifySent ? `, ${result.shopifySent} shop sale${result.shopifySent === 1 ? "" : "s"} sent to Shopify` : ""}.`}
        </p>
      ) : null}

      {waiting.length > 0 ? (
        <div className="border-t border-border">
          <div className="flex gap-2 bg-warning/10 px-4 py-2.5 text-sm text-foreground">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              {waiting.length} online sale{waiting.length === 1 ? " is" : "s are"} waiting for a SKU, so Inventory still counts
              {waiting.length === 1 ? " it" : " them"} as in stock. Add the Inventory SKU to the product on Shopify, then sync.
            </span>
          </div>
          <ul className="divide-y divide-border">
            {visible.map((line) => (
              <li key={line.lineId} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-foreground">
                    {line.quantity} × {line.lineName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {line.orderName} · {formatDay(line.orderDate)} · {line.reason}
                  </span>
                </div>
                {line.shopifyAdminUrl ? (
                  <Button asChild variant="ghost" size="sm">
                    <a href={line.shopifyAdminUrl} target="_blank" rel="noreferrer">
                      Open in Shopify
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {waiting.length > COLLAPSED_ROWS ? (
            <div className="border-t border-border px-4 py-2">
              <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "Show fewer" : `Show all ${waiting.length}`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
