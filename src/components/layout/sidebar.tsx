"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Gem,
  Sparkles,
  FileText,
  Settings,
  Camera,
  type LucideIcon,
} from "lucide-react";
import { NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Gem,
  Sparkles,
  FileText,
  Settings,
  Camera,
};

/**
 * The brand block + nav links, factored out of the desktop `<aside>` so the
 * mobile nav drawer (see header.tsx) can render the exact same content
 * instead of duplicating it. `onNavigate` lets the drawer close itself on
 * link click — the desktop sidebar has no drawer to close, so it's optional.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <div className="flex h-16 items-center gap-2.5 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Gem className="h-4 w-4" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-sidebar-foreground">SELEN</span>
          <span className="text-[11px] text-muted-foreground">Product Studio</span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.icon];
          const isActive =
            item.href === "/products"
              ? pathname === "/products"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-6 py-4 text-[11px] text-muted-foreground">
        Internal tool · not customer-facing
      </div>
    </>
  );
}

/** Desktop-only: hidden below `md`, where the Header's mobile drawer takes over. */
export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <SidebarNav />
    </aside>
  );
}
