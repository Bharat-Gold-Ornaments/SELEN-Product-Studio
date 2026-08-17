"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, MoreVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDeleteProduct } from "@/hooks/use-product";
import type { ProductRecord } from "@/types/product";

/**
 * Per-row "..." menu with a Delete action, shared by the /products table and
 * the /dashboard summary lists (the only two places a product row appears).
 * Deleting a published product is refused server-side (see the DELETE
 * route's doc comment) — that's surfaced here as a toast rather than hidden
 * from the menu, so the user finds out why rather than the option just not
 * being there.
 *
 * Stops click propagation everywhere, since every row this renders inside is
 * itself a click target (a Link in products-client.tsx) — without that,
 * opening the menu or confirming delete would also navigate the row away.
 */
export function ProductDeleteMenu({ product }: { product: ProductRecord }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteProduct = useDeleteProduct();

  function handleDelete() {
    deleteProduct.mutate(product.productId, {
      onSuccess: () => {
        toast.success(`Deleted "${product.title || product.productId}".`);
        setConfirmOpen(false);
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : "Deleting failed.");
      },
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">Product actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setConfirmOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={(open) => !deleteProduct.isPending && setConfirmOpen(open)}>
        <DialogContent
          className="w-full max-w-sm rounded-2xl border border-border bg-card p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogTitle>Delete this product?</DialogTitle>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {`This permanently deletes "${product.title || product.productId}" — its Sheet row and every generated image in Drive. This can't be undone.`}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={deleteProduct.isPending} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={deleteProduct.isPending} onClick={handleDelete}>
              {deleteProduct.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
