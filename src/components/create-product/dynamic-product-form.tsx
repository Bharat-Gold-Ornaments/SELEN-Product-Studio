"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, type FieldPath, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";

import {
  PRODUCT_SCHEMAS,
  EXTRA_FIELDS,
  defaultValuesFor,
  type ProductFormValues,
} from "@/lib/product-schemas";
import { generateProductId } from "@/lib/utils";
import { useStartGeneration } from "@/hooks/use-generation";
import { IMAGE_CATEGORIES, IMAGE_CATEGORY_LABELS } from "@/lib/constants";
import type { ProductType, ImageCategory } from "@/types/product";

import { FormField } from "@/components/form-field";
import { PhotoUploadField, type PoolPhotoRef } from "./photo-upload-field";
import { PoolPhotoPicker } from "./pool-photo-picker";
import { TagInput } from "./tag-input";
import type { PoolPhoto, PoolPhotoAngle } from "@/hooks/use-pool-photos";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DynamicProductFormProps {
  productType: ProductType;
}

/**
 * One config-driven form for all five product types instead of five
 * near-duplicate components. Because each mounted instance is scoped to a
 * single, fixed `productType` (the page remounts this component via a
 * `key={productType}`), it's safe to treat the field values as the loose
 * `ProductFormValues` union here and lean on the runtime Zod schema — the
 * per-type field configuration in `EXTRA_FIELDS` is the real source of
 * truth for what's on screen, and it's strongly typed on its own.
 */
export function DynamicProductForm({ productType }: DynamicProductFormProps) {
  const schema = PRODUCT_SCHEMAS[productType];

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<ProductFormValues>,
    defaultValues: defaultValuesFor(productType) as Partial<ProductFormValues>,
  });

  const extraFields = EXTRA_FIELDS[productType];
  const fieldErrors = errors as Record<string, { message?: string } | undefined>;

  const router = useRouter();
  const startGeneration = useStartGeneration();

  // Which image types to generate — defaults to all three. Kept as local
  // component state rather than part of the Zod-validated ProductFormValues
  // since it's a generation directive, not a field of the product record
  // itself (it never gets written to the Sheet).
  const [imageCategories, setImageCategories] = useState<Set<ImageCategory>>(
    () => new Set(IMAGE_CATEGORIES)
  );

  function toggleCategory(category: ImageCategory, checked: boolean) {
    setImageCategories((prev) => {
      const next = new Set(prev);
      if (checked) next.add(category);
      else next.delete(category);
      return next;
    });
  }

  // Each photo slot is either a local File (tracked by react-hook-form, in
  // `values.frontPhoto` etc.) or a photo picked from the Uploads pool
  // (tracked here, outside the form) — never both. Picking one clears the
  // other; see PhotoUploadField's onClearPool/onChange wiring below.
  const [poolPhotos, setPoolPhotos] = useState<{ front?: PoolPhotoRef; side?: PoolPhotoRef; worn?: PoolPhotoRef }>(
    {}
  );
  const [pickerSlot, setPickerSlot] = useState<"front" | "side" | "worn" | null>(null);

  function handlePoolPick(slot: "front" | "side" | "worn", photo: PoolPhoto) {
    setPoolPhotos((prev) => ({ ...prev, [slot]: { fileId: photo.fileId, publicUrl: photo.publicUrl } }));
    // Clear any local file in this slot — a pool pick always wins.
    setValue(`${slot}Photo` as FieldPath<ProductFormValues>, null as never);
    setPickerSlot(null);
  }

  function clearPoolPhoto(slot: "front" | "side" | "worn") {
    setPoolPhotos((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }

  async function onSubmit(values: ProductFormValues) {
    if (imageCategories.size === 0) {
      toast.error("Select at least one photo type to generate.");
      return;
    }

    const productId = generateProductId();

    try {
      await startGeneration.mutateAsync({
        productId,
        productType,
        values,
        imageCategories: Array.from(imageCategories),
        poolPhotoIds: {
          front: poolPhotos.front?.fileId,
          side: poolPhotos.side?.fileId,
          worn: poolPhotos.worn?.fileId,
        },
      });
      toast.success(`${productId} is generating`, {
        description: "Drive upload and Leonardo generation are both running — opening the review screen.",
      });
      router.push(`/products/${productId}/review`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't start generation.", {
        description: "Your details are still filled in below — fix the issue and try again.",
      });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Photos</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 pt-0 sm:grid-cols-3">
          <Controller
            name={"frontPhoto" as FieldPath<ProductFormValues>}
            control={control}
            render={({ field }) => (
              <PhotoUploadField
                id="frontPhoto"
                label="Front Photo (optional)"
                value={(field.value as File | null) ?? null}
                onChange={field.onChange}
                error={fieldErrors.frontPhoto?.message}
                poolPhoto={poolPhotos.front ?? null}
                onClearPool={() => clearPoolPhoto("front")}
                onOpenPicker={() => setPickerSlot("front")}
              />
            )}
          />
          <Controller
            name={"sidePhoto" as FieldPath<ProductFormValues>}
            control={control}
            render={({ field }) => (
              <PhotoUploadField
                id="sidePhoto"
                label="Side Photo (optional)"
                value={(field.value as File | null) ?? null}
                onChange={field.onChange}
                error={fieldErrors.sidePhoto?.message}
                poolPhoto={poolPhotos.side ?? null}
                onClearPool={() => clearPoolPhoto("side")}
                onOpenPicker={() => setPickerSlot("side")}
              />
            )}
          />
          <Controller
            name={"wornPhoto" as FieldPath<ProductFormValues>}
            control={control}
            render={({ field }) => (
              <PhotoUploadField
                id="wornPhoto"
                label="Worn Photo (optional)"
                value={(field.value as File | null) ?? null}
                onChange={field.onChange}
                error={fieldErrors.wornPhoto?.message}
                poolPhoto={poolPhotos.worn ?? null}
                onClearPool={() => clearPoolPhoto("worn")}
                onOpenPicker={() => setPickerSlot("worn")}
              />
            )}
          />
        </CardContent>
      </Card>

      {pickerSlot ? (
        <PoolPhotoPicker
          open
          onOpenChange={(open) => !open && setPickerSlot(null)}
          angle={pickerSlot as PoolPhotoAngle}
          productType={productType}
          onPick={(photo) => handlePoolPick(pickerSlot, photo)}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Photos to Generate</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 pt-0 sm:grid-cols-3">
          {IMAGE_CATEGORIES.map((category) => (
            <div
              key={category}
              className="flex items-center justify-between rounded-lg border border-input bg-card px-3.5 py-2.5 shadow-sm"
            >
              <Label htmlFor={`category-${category}`} className="text-sm font-normal">
                {IMAGE_CATEGORY_LABELS[category]}
              </Label>
              <Switch
                id={`category-${category}`}
                checked={imageCategories.has(category)}
                onCheckedChange={(checked) => toggleCategory(category, checked)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 pt-0 sm:grid-cols-2">
          <FormField label="Weight (grams)" htmlFor="weightGrams" error={fieldErrors.weightGrams?.message}>
            <Input
              id="weightGrams"
              type="number"
              step="any"
              inputMode="decimal"
              placeholder="0.0"
              {...register("weightGrams" as FieldPath<ProductFormValues>)}
            />
          </FormField>

          {extraFields.map((extraField) => {
            if (extraField.type === "number") {
              return (
                <FormField
                  key={extraField.name}
                  label={extraField.label}
                  htmlFor={extraField.name}
                  error={fieldErrors[extraField.name]?.message}
                >
                  <Input
                    id={extraField.name}
                    type="number"
                    step={extraField.step}
                    inputMode="decimal"
                    placeholder="0.0"
                    {...register(extraField.name as FieldPath<ProductFormValues>)}
                  />
                </FormField>
              );
            }

            if (extraField.type === "select") {
              return (
                <FormField
                  key={extraField.name}
                  label={extraField.label}
                  htmlFor={extraField.name}
                  error={fieldErrors[extraField.name]?.message}
                >
                  <Controller
                    name={extraField.name as FieldPath<ProductFormValues>}
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={(field.value as string) ?? ""}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger id={extraField.name}>
                          <SelectValue placeholder={`Select ${extraField.label.toLowerCase()}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {extraField.options.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
              );
            }

            return (
              <div
                key={extraField.name}
                className="flex items-center justify-between rounded-lg border border-input bg-card px-3.5 py-2.5 shadow-sm"
              >
                <Label htmlFor={extraField.name} className="text-sm font-normal">
                  {extraField.label}
                </Label>
                <Controller
                  name={extraField.name as FieldPath<ProductFormValues>}
                  control={control}
                  render={({ field }) => (
                    <Switch
                      id={extraField.name}
                      checked={Boolean(field.value)}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>
            );
          })}

          <FormField
            label="Finish"
            htmlFor="finish"
            error={fieldErrors.finish?.message}
            hint="e.g. Polished Gold, Matte Gold, Brushed Silver"
          >
            <Input id="finish" placeholder="Polished Gold" {...register("finish" as FieldPath<ProductFormValues>)} />
          </FormField>

          <FormField label="Stone" htmlFor="stone" error={fieldErrors.stone?.message}>
            <Input id="stone" placeholder='Pearl, or "None"' {...register("stone" as FieldPath<ProductFormValues>)} />
          </FormField>

          <FormField label="Inventory" htmlFor="inventory" error={fieldErrors.inventory?.message}>
            <Input
              id="inventory"
              type="number"
              step="1"
              inputMode="numeric"
              placeholder="0"
              {...register("inventory" as FieldPath<ProductFormValues>)}
            />
          </FormField>

          <FormField label="Collections" htmlFor="collections" className="sm:col-span-2">
            <Controller
              name={"collections" as FieldPath<ProductFormValues>}
              control={control}
              render={({ field }) => (
                <TagInput
                  id="collections"
                  value={(field.value as string[]) ?? []}
                  onChange={field.onChange}
                  placeholder="Type a collection, press Enter"
                />
              )}
            />
          </FormField>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={isSubmitting || startGeneration.isPending}>
          {isSubmitting || startGeneration.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Generate
        </Button>
      </div>
    </form>
  );
}
