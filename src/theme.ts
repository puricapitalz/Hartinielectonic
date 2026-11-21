// Mode gelap: kelas "dark" di <html>, pilihan pengguna disimpan di localStorage.
// Warna gelap didefinisikan terpusat di src/index.css (bagian "MODE GELAP").
import { useSyncExternalStore } from "react";

const KEY = "hartini.theme";
function initial(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved === "dark";
  } catch {
    /* abaikan */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

let dark = initial();
const apply = () => document.documentElement.classList.toggle("dark", dark);
apply();
const listeners = new Set<() => void>();

export function setDark(value: boolean) {
  dark = value;
  apply();
  try {
    localStorage.setItem(KEY, value ? "dark" : "light");
  } catch {
    /* abaikan */
  }
  listeners.forEach((l) => l());
}

export const useDark = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => dark,
  );
