export type ColorScheme = "light" | "dark";

const STORAGE_KEY = "gif-picker-color-scheme";

export function applyColorScheme(scheme: ColorScheme): void {
  document.documentElement.dataset.theme = scheme;
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    // localStorage unavailable
  }
}

export function readCachedColorScheme(): ColorScheme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // localStorage unavailable
  }
  return null;
}