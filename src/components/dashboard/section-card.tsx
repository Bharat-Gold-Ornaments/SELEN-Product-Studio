import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SectionCardProps {
  title: string;
  viewAllHref?: string;
  isEmpty?: boolean;
  emptyLabel?: string;
  children: ReactNode;
}

export function SectionCard({
  title,
  viewAllHref,
  isEmpty,
  emptyLabel = "Nothing here yet.",
  children,
}: SectionCardProps) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{title}</CardTitle>
        {viewAllHref ? (
          <Link
            href={viewAllHref}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col pt-0">
        {isEmpty ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border py-10 text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}
