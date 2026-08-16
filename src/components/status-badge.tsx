import { CheckCircle2, FileEdit, Loader2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ProductStatus } from "@/types/product";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  ProductStatus,
  { label: string; variant: "success" | "secondary" | "warning" | "destructive"; icon: typeof CheckCircle2 }
> = {
  published: { label: "Published", variant: "success", icon: CheckCircle2 },
  draft: { label: "Draft", variant: "secondary", icon: FileEdit },
  processing: { label: "Processing", variant: "warning", icon: Loader2 },
  publishing: { label: "Publishing", variant: "warning", icon: Loader2 },
  failed: { label: "Failed", variant: "destructive", icon: AlertCircle },
};

export function StatusBadge({ status, className }: { status: ProductStatus; className?: string }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className={cn("capitalize", className)}>
      <Icon className={cn("h-3 w-3", (status === "processing" || status === "publishing") && "animate-spin")} />
      {config.label}
    </Badge>
  );
}
