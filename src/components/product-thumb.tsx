import { Gem, Circle, Sparkle, Link2, CircleDot } from "lucide-react";
import type { ProductType } from "@/types/product";
import { cn } from "@/lib/utils";

// Real photography (from Google Drive, once Milestone 4+ is wired up) will
// replace this — until then every product gets a category-tinted glyph
// instead of a broken or misleading placeholder image.
const CATEGORY_ICON: Record<ProductType, typeof Gem> = {
  earrings: Sparkle,
  ring: CircleDot,
  pendant: Gem,
  necklace: Link2,
  bracelet: Circle,
};

export function ProductThumb({
  category,
  className,
}: {
  category: ProductType;
  className?: string;
}) {
  const Icon = CATEGORY_ICON[category];
  return (
    <div
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground",
        className
      )}
    >
      <Icon className="h-5 w-5" />
    </div>
  );
}
