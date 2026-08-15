import { ReviewClient } from "@/components/review/review-client";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <ReviewClient productId={productId} />;
}
