"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { stoneLineItemAmount, type StoneLineItem, type StonePricingMode } from "@/lib/pricing";

interface StoneLineItemsTableProps {
  items: StoneLineItem[];
  onChange: (items: StoneLineItem[]) => void;
}

function newStoneLineItem(): StoneLineItem {
  return {
    id: crypto.randomUUID(),
    stoneType: "",
    pricingMode: "by_weight",
    quantityOrWeight: 0,
    rate: 0,
  };
}

const PRICING_MODE_OPTIONS: { value: StonePricingMode; label: string }[] = [
  { value: "by_weight", label: "By Weight" },
  { value: "flat_per_piece", label: "Flat per Piece" },
];

/**
 * Repeatable Stone/Pearl line-item editor (spec Section 4) — only relevant
 * for Case B products (Gross Weight ≠ Net Weight), where stones/pearls are
 * priced separately from the metal. Each row's Amount is derived, never
 * hand-entered, so it can't drift from Quantity/Weight × Rate.
 */
export function StoneLineItemsTable({ items, onChange }: StoneLineItemsTableProps) {
  function updateItem(id: string, patch: Partial<StoneLineItem>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeItem(id: string) {
    onChange(items.filter((item) => item.id !== id));
  }

  function addItem() {
    onChange([...items, newStoneLineItem()]);
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No stone/pearl line items yet — gross and net weight differ, so at least one is required.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.id} className="grid grid-cols-1 gap-2 rounded-xl border border-border p-3 sm:grid-cols-12 sm:items-end sm:gap-2">
              <div className="sm:col-span-3">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Input
                  value={item.stoneType}
                  onChange={(e) => updateItem(item.id, { stoneType: e.target.value })}
                  placeholder="CZ Stone, Pearl..."
                />
              </div>
              <div className="sm:col-span-3">
                <Label className="text-xs text-muted-foreground">Pricing Mode</Label>
                <div className="flex overflow-hidden rounded-lg border border-input">
                  {PRICING_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateItem(item.id, { pricingMode: option.value })}
                      className={cn(
                        "flex-1 px-2 py-2 text-xs font-medium transition-colors",
                        item.pricingMode === option.value
                          ? "bg-accent text-accent-foreground"
                          : "bg-card text-muted-foreground hover:bg-secondary"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs text-muted-foreground">
                  {item.pricingMode === "by_weight" ? "Weight (ct/g)" : "Quantity"}
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.quantityOrWeight || ""}
                  onChange={(e) => updateItem(item.id, { quantityOrWeight: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs text-muted-foreground">Rate (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.rate || ""}
                  onChange={(e) => updateItem(item.id, { rate: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="flex items-end justify-between gap-2 sm:col-span-2">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Amount</Label>
                  <p className="flex h-9 items-center text-sm font-medium text-foreground">
                    ₹{stoneLineItemAmount(item).toLocaleString("en-IN")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeItem(item.id)}
                  aria-label={`Remove ${item.stoneType || "stone"} line item`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={addItem}>
        <Plus className="h-3.5 w-3.5" />
        Add Stone/Pearl
      </Button>
    </div>
  );
}
