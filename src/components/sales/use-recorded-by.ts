"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "selen.sales.recordedBy";

/**
 * The name staff type in "Recorded by", remembered per browser — everyone
 * shares one login, so the app can't tell who is entering sales otherwise.
 */
export function useRecordedBy(): [string, (name: string) => void] {
  const [name, setName] = useState("");

  useEffect(() => {
    try {
      setName(window.localStorage.getItem(STORAGE_KEY) ?? "");
    } catch {
      // Storage blocked — the field just starts empty.
    }
  }, []);

  function update(next: string) {
    setName(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered this time; nothing else depends on it.
    }
  }

  return [name, update];
}
