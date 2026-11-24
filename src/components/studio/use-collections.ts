"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Option = { id: string; name: string };
let cache: Promise<Option[]> | null = null;

/** The user's collections for node pickers (fetched once per page load). */
export function useCollections(): Option[] | null {
  const [items, setItems] = useState<Option[] | null>(null);
  useEffect(() => {
    cache ??= apiFetch<Option[]>("/api/collections").then(({ data }) => data.map((c) => ({ id: c.id, name: c.name }))).catch(() => {
      cache = null;
      return [];
    });
    let live = true;
    void cache.then((v) => live && setItems(v));
    return () => {
      live = false;
    };
  }, []);
  return items;
}
