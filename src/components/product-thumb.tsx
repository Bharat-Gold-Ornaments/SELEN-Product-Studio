"use client";

import { useState } from "react";
import Image from "next/image";
import { Gem, Circle, Sparkle, Link2, CircleDot } from "lucide-react";
import type { ProductType } from "@/types/product";
import { cn } from "@/lib/utils";

const CATEGORY_ICON: Record<ProductType, typeof Gem> = {
  earrings: Sparkle,
  ring: CircleDot,
  pendant: Gem,
  necklace: Link2,
  bracelet: Circle,
};

export function ProductThumb({
  category,
  imageUrl,
  className,
}: {
  category: ProductType;
  /**
   * The product's closeup photo (ProductRecord.closeupImageLink) — falls
   * back to the category glyph when absent (nothing generated/saved yet)
   * or if the image fails to load (e.g. a stale Drive link).
   */
  imageUrl?: string;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const Icon = CATEGORY_ICON[category];
  const showImage = Boolean(imageUrl) && !imageFailed;

  return (
    <div
      className={cn(
        "relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent text-accent-foreground",
        className
      )}
    >
      {showImage ? (
        <Image
          src={imageUrl!}
          alt=""
          fill
          unoptimized
          // Slight extra zoom beyond a plain cover fit so the jewelry itself
          // fills this small icon-sized crop instead of including the
          // marble surface/background margin the full closeup photo has.
          className="scale-125 object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <Icon className="h-5 w-5" />
      )}
    </div>
  );
}
