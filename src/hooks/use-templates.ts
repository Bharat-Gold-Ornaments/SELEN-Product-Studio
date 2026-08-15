"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TemplateCategoryId } from "@/lib/template-categories";

export interface TemplateRecord {
  id: TemplateCategoryId;
  label: string;
  description: string;
  variables: string[];
  content: string;
  updatedAt: string;
}

async function fetchTemplates(): Promise<TemplateRecord[]> {
  const res = await fetch("/api/templates");
  if (!res.ok) throw new Error("Couldn't load templates.");
  const data = (await res.json()) as { templates: TemplateRecord[] };
  return data.templates;
}

export function useTemplates() {
  return useQuery({ queryKey: ["templates"], queryFn: fetchTemplates });
}

async function saveTemplate(id: TemplateCategoryId, content: string): Promise<TemplateRecord> {
  const res = await fetch(`/api/templates/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "Couldn't save the template.");
  }

  const data = (await res.json()) as { template: TemplateRecord };
  return data.template;
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: TemplateCategoryId; content: string }) =>
      saveTemplate(id, content),
    onSuccess: (template) => {
      queryClient.setQueryData<TemplateRecord[]>(["templates"], (old) =>
        old?.map((t) => (t.id === template.id ? template : t))
      );
    },
  });
}
