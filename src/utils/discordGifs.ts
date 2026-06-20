export const DISCORD_APP_URL = "https://discord.com/app";

/** Console script users paste into Discord (browser or desktop app DevTools). */
export const DISCORD_EXTRACT_SCRIPT = `window.FrecencyUserSettings ??= webpackChunkdiscord_app.push([
  [Symbol()],
  {},
  (e) =>
    e.b &&
    Object.values(e.c)
      .values()
      .map((m) => m.exports)
      .filter(
        (x) =>
          typeof x === "object" && x !== window && x !== DOMTokenList.prototype,
      )
      .flatMap((x) => [x, ...Object.values(x)])
      .find((x) => x?.ProtoClass?.typeName?.endsWith(".FrecencyUserSettings")),
]);

function downloadJSON(content, filename) {
  const json = JSON.stringify(content, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), {
    href: url,
    download: filename,
  }).click();
  URL.revokeObjectURL(url);
}

FrecencyUserSettings.loadIfNecessary();
const gifs = FrecencyUserSettings.getCurrentValue().favoriteGifs.gifs;
const count = Object.keys(gifs).length;
downloadJSON(gifs, "discord-favorite-gifs.json");
console.log(\`Exported \${count} favorite GIFs to discord-favorite-gifs.json\`);`;

const URL_FIELDS = ["url", "src", "proxy_src", "gif", "thumbnail", "media"] as const;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function addUrl(urls: Set<string>, value: unknown) {
  if (typeof value !== "string" || !isHttpUrl(value)) return;
  urls.add(value.trim());
}

function walkDiscordExport(value: unknown, urls: Set<string>) {
  if (value === null || value === undefined) return;

  if (typeof value === "string") {
    addUrl(urls, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      walkDiscordExport(entry, urls);
    }
    return;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const [key, entry] of Object.entries(record)) {
      addUrl(urls, key);
      if (entry && typeof entry === "object") {
        const nested = entry as Record<string, unknown>;
        for (const field of URL_FIELDS) {
          addUrl(urls, nested[field]);
        }
      }
      walkDiscordExport(entry, urls);
    }
  }
}

/** Pulls GIF/media URLs from Discord export JSON (array, object map, or mixed). */
export function extractGifUrlsFromDiscordExport(data: unknown): string[] {
  const urls = new Set<string>();
  walkDiscordExport(data, urls);
  return Array.from(urls);
}

export function parseDiscordExportJson(raw: string): string[] {
  const parsed = JSON.parse(raw) as unknown;
  return extractGifUrlsFromDiscordExport(parsed);
}