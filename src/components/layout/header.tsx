"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, User } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarNav } from "@/components/layout/sidebar";

/**
 * The Sidebar (see sidebar.tsx) is `hidden` below the `md` breakpoint with
 * nothing replacing it, so nav was previously unreachable on mobile — this
 * is that replacement: a hamburger button that opens the same nav links in
 * a left-edge drawer, built on the existing Dialog primitive (already a
 * dependency via @radix-ui/react-dialog) rather than pulling in a separate
 * sheet/drawer library.
 */
function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="left-0 top-0 flex h-full w-64 max-w-[85vw] translate-x-0 translate-y-0 flex-col rounded-none border-r border-sidebar-border bg-sidebar p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100"
      >
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function Header() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur">
      <MobileNav />
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar className="h-8 w-8">
            <AvatarFallback>
              <User className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Admin</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={loggingOut}
            onSelect={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            {loggingOut ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
