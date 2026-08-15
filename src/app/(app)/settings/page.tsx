import { PageShell } from "@/components/layout/page-shell";

export default function SettingsPage() {
  return (
    <PageShell
      title="Settings"
      description="Integration status and default generation counts."
    >
      <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
        Settings land in Milestone 10, once every integration exists to report on.
      </div>
    </PageShell>
  );
}
