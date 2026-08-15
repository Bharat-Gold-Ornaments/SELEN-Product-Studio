import { PageShell } from "@/components/layout/page-shell";
import { UploadsClient } from "@/components/uploads/uploads-client";

export default function UploadsPage() {
  return (
    <PageShell
      title="Upload Photos"
      description="Stage reference photos in Drive ahead of time, then pick from them in Create Product."
    >
      <UploadsClient />
    </PageShell>
  );
}
