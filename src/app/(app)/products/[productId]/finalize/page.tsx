import { FinalizeClient } from "@/components/finalize/finalize-client";

export default async function FinalizePage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <FinalizeClient productId={productId} />;
}
