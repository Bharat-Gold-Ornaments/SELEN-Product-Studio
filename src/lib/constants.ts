import type { ProductStatus, ProductType } from "@/types/product";

export const PRODUCT_TYPES: { value: ProductType; label: string }[] = [
  { value: "earrings", label: "Earrings" },
  { value: "ring", label: "Ring" },
  { value: "pendant", label: "Pendant" },
  { value: "necklace", label: "Necklace" },
  { value: "bracelet", label: "Bracelet" },
];

export const PRODUCT_STATUSES: { value: ProductStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "processing", label: "Processing" },
  { value: "published", label: "Published" },
  { value: "failed", label: "Failed" },
];

export const IMAGE_CATEGORIES = [
  "hero",
  "lifestyle",
  "closeup",
] as const;

export const DEFAULT_GENERATION_COUNTS: Record<
  (typeof IMAGE_CATEGORIES)[number],
  number
> = {
  hero: 1,
  lifestyle: 1,
  closeup: 1,
};

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/products", label: "Products", icon: "Gem" },
  { href: "/products/create", label: "Create Product", icon: "Sparkles" },
  { href: "/uploads", label: "Upload Photos", icon: "Camera" },
  { href: "/templates", label: "Template Manager", icon: "FileText" },
  { href: "/settings", label: "Settings", icon: "Settings" },
] as const;

export const POOL_PHOTO_ANGLES: { value: "front" | "side" | "worn" | "other"; label: string }[] = [
  { value: "front", label: "Front" },
  { value: "side", label: "Side" },
  { value: "worn", label: "Worn" },
  { value: "other", label: "Other / unlabeled" },
];

export const IMAGE_CATEGORY_LABELS: Record<(typeof IMAGE_CATEGORIES)[number], string> = {
  hero: "Hero Images",
  lifestyle: "Lifestyle Images",
  closeup: "Closeup Images",
};
