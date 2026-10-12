/** An online order line that couldn't be matched to an Inventory SKU, so its stock wasn't taken off yet. */
export interface WaitingOnlineSale {
  /** Shopify line item gid. */
  lineId: string;
  /** "#1001" */
  orderName: string;
  /** YYYY-MM-DD in the shop's time zone. */
  orderDate: string;
  productTitle: string;
  /** "Product - Variant" as on the order. */
  lineName: string;
  quantity: number;
  shopifyAdminUrl: string | null;
  reason: string;
}

/** Saved after every sync of online orders (services/online-orders.ts). */
export interface OnlineSyncState {
  /** Orders from before this moment are never imported — Inventory already reflected them. */
  trackingSince: string;
  lastSyncedAt: string;
  waiting: WaitingOnlineSale[];
}
