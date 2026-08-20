import type { DesignBundle, DesignNode } from "../core/types/designBundle";

/**
 * D38: self-hosting Google Fonts, decided over linking Google's CDN
 * directly at page-view time (Sean's call) — a self-hosted theme has no
 * runtime dependency on a third party staying up, and sidesteps a real
 * legal wrinkle some jurisdictions have flagged: a German court (LG
 * München I, 2022) held that loading fonts from Google's CDN without
 * consent violates GDPR, since it transmits the visitor's IP address to
 * Google. Downloading happens here, in Stage 2 (the CLI) — a normal
 * Node.js process — rather than Stage 1 (the Figma plugin), which runs in
 * Figma's sandboxed environment with restricted network access.
 *
 * Google Fonts' CSS2 API serves a different @font-face `src` format
 * depending on the requesting User-Agent (format negotiation baked into
 * the endpoint itself, not a Vary/Accept-header content-negotiation
 * scheme): a modern browser UA gets `.woff2` (small, Brotli-compressed,
 * universally supported by anything that can actually render a real
 * WordPress site); an unrecognized/absent UA gets `.ttf` (much larger,
 * meant for maximum compatibility with very old browsers this project has
 * no reason to support). Confirmed directly: the same request with no UA
 * returned a `.ttf` src. This is standard, widely-documented practice —
 * it's the whole reason tools like `google-webfonts-helper` exist — not a
 * workaround unique to this project.
 */
const MODERN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Figma's `fontWeight` (`DesignBundleTextSegment.fontWeight`) can be a
 * numeric-looking string ("400") or a named weight ("Bold", "Regular",
 * "SemiBold", etc.) depending on the font's own style-naming convention —
 * normalize to Google Fonts' numeric `wght` axis value, since that's what
 * the CSS2 API's `family=X:wght@N` syntax requires. Unrecognized names
 * fall back to "400" (regular) rather than failing the whole family's
 * fetch over one unparseable weight.
 */
const NAMED_WEIGHTS: Record<string, string> = {
  thin: "100",
  hairline: "100",
  extralight: "200",
  ultralight: "200",
  light: "300",
  regular: "400",
  normal: "400",
  book: "400",
  medium: "500",
  semibold: "600",
  demibold: "600",
  bold: "700",
  extrabold: "800",
  ultrabold: "800",
  black: "900",
  heavy: "900",
};

export const normalizeFontWeight = (fontWeight: string): string => {
  const trimmed = fontWeight.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const named = NAMED_WEIGHTS[trimmed.toLowerCase().replace(/\s+/g, "")];
  return named ?? "400";
};

/**
 * Walks every design's tree collecting every distinct (fontFamily,
 * normalized fontWeight) pair actually used — matches exactly what
 * `mapNode.ts`'s `mapText` reads (`first.fontFamily`/`first.fontWeight`,
 * the first text segment only, same "first run only" limitation as
 * heading detection, D23) so this only ever fetches fonts the mapper will
 * actually reference in the generated CSS. Doesn't distinguish header/
 * footer from regular content — irrelevant here, this runs before that
 * split and a font family used anywhere in the bundle needs to load
 * regardless of which template/part ends up using it.
 */
export const collectFontRequests = (bundle: DesignBundle): Map<string, Set<string>> => {
  const requests = new Map<string, Set<string>>();

  const visit = (node: DesignNode): void => {
    const first = node.text?.segments?.[0];
    if (first?.fontFamily) {
      const weights = requests.get(first.fontFamily) ?? new Set<string>();
      weights.add(normalizeFontWeight(first.fontWeight));
      requests.set(first.fontFamily, weights);
    }
    node.children.forEach(visit);
  };

  bundle.designs.forEach((design) => visit(design.root));
  return requests;
};

export interface ResolvedFontFace {
  family: string;
  weight: string;
  style: string;
  /** e.g. "U+0000-00FF, U+0131, U+0152-0153, ..." — verbatim from Google's response. Present on almost every real multi-subset response; a font with only one universal subset may omit it. */
  unicodeRange?: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface ResolveFontsResult {
  faces: ResolvedFontFace[];
  resolvedFamilies: string[];
  unresolvedFamilies: string[];
}

export const slugifyFontFamily = (family: string): string =>
  family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/**
 * Parses a Google Fonts CSS2 API response into individual `@font-face`
 * rules — exported separately from `resolveGoogleFonts` so it can be unit
 * tested against a captured real response without a live network call
 * (this sandbox's network egress is proxy-restricted and can't reach
 * Google Fonts at all — see D38's verification note in the decisions
 * log). Only ever extracts the `format('woff2')` `src` from a rule, per
 * this module's UA choice above — a response could in principle include
 * multiple `src` fallbacks for different formats, though a modern-UA
 * request in practice returns exactly one woff2 `src` per rule.
 *
 * A real response commonly has *multiple* rules for the same
 * family/weight/style — one per Unicode subset (latin, latin-ext,
 * cyrillic, etc.), distinguished only by `unicode-range`. All of them are
 * returned here, not deduplicated to one — `resolveGoogleFonts` downloads
 * every one as its own file, and `fontFaceCss` emits every one as its own
 * `@font-face` rule (carrying its own `unicode-range`), same as Google's
 * own response structure: the browser only downloads whichever subset
 * file actually matches characters present on the page. An earlier draft
 * of this function ignored `unicode-range` and treated weight+style as
 * the only identity, which silently collapsed every subset onto one
 * filename (each download overwriting the last) and would have broken
 * non-Latin characters — caught before this ever shipped.
 */
export const parseFontFaceRules = (
  css: string,
): Array<{ family: string; weight: string; style: string; unicodeRange?: string; srcUrl: string }> => {
  const rules: Array<{ family: string; weight: string; style: string; unicodeRange?: string; srcUrl: string }> = [];
  for (const match of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const block = match[1];
    const family = /font-family:\s*['"]?([^;'"]+)['"]?/.exec(block)?.[1]?.trim();
    const weight = /font-weight:\s*(\d+)/.exec(block)?.[1] ?? "400";
    const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? "normal";
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
    const srcUrl = /src:\s*url\(([^)]+)\)\s*format\(['"]woff2['"]\)/.exec(block)?.[1]?.trim();
    if (family && srcUrl) rules.push({ family, weight, style, unicodeRange, srcUrl });
  }
  return rules;
};

/**
 * Fetches, downloads, and self-hosts every requested (family, weights[])
 * combination from Google Fonts. A family Google Fonts doesn't recognize
 * (a custom/commercial font, a typo, or just not on Google Fonts at all)
 * fails gracefully — reported in `unresolvedFamilies`, never thrown; the
 * caller (`generateThemeFiles.ts`) already has a fallback for exactly
 * this case (D37's generic-family CSS fallback), so a font that can't be
 * resolved here just renders with that instead of failing the whole
 * generation run. Same posture for a network failure (offline machine,
 * DNS issue, Google Fonts unreachable) — `warn` gets a message, the
 * family is reported unresolved, generation continues.
 */
export const resolveGoogleFonts = async (
  requests: Map<string, Set<string>>,
  warn: (message: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolveFontsResult> => {
  const faces: ResolvedFontFace[] = [];
  const resolvedFamilies: string[] = [];
  const unresolvedFamilies: string[] = [];

  for (const [family, weightsSet] of requests) {
    const weights = Array.from(weightsSet).sort();
    let css: string;
    try {
      const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weights.join(";")}&display=swap`;
      const res = await fetchImpl(url, { headers: { "User-Agent": MODERN_UA } });
      if (!res.ok) {
        unresolvedFamilies.push(family);
        warn(`Font "${family}" not found on Google Fonts (HTTP ${res.status}) — falling back to a generic CSS font-family (D37).`);
        continue;
      }
      css = await res.text();
    } catch (error) {
      unresolvedFamilies.push(family);
      warn(`Could not reach Google Fonts for "${family}" (${(error as Error).message}) — falling back to a generic CSS font-family (D37).`);
      continue;
    }

    const parsed = parseFontFaceRules(css);
    if (parsed.length === 0) {
      unresolvedFamilies.push(family);
      warn(`Google Fonts returned no usable (woff2) @font-face rules for "${family}" — falling back to a generic CSS font-family (D37).`);
      continue;
    }

    let familyResolved = false;
    // Subset index, not the unicode-range value itself, keeps filenames
    // short and filesystem-safe — the actual range still lands in the
    // generated @font-face rule's `unicode-range` declaration either way.
    let subsetIndex = 0;
    for (const rule of parsed) {
      try {
        const fileRes = await fetchImpl(rule.srcUrl);
        if (!fileRes.ok) {
          warn(`Font file download failed for "${family}" weight ${rule.weight} (HTTP ${fileRes.status}).`);
          continue;
        }
        const bytes = new Uint8Array(await fileRes.arrayBuffer());
        const fileName = `${slugifyFontFamily(family)}-${rule.weight}-${rule.style}-${subsetIndex}.woff2`;
        subsetIndex += 1;
        faces.push({ family, weight: rule.weight, style: rule.style, unicodeRange: rule.unicodeRange, fileName, bytes });
        familyResolved = true;
      } catch (error) {
        warn(`Font file download failed for "${family}" weight ${rule.weight} (${(error as Error).message}).`);
      }
    }
    if (familyResolved) resolvedFamilies.push(family);
    else unresolvedFamilies.push(family);
  }

  return { faces, resolvedFamilies, unresolvedFamilies };
};

/**
 * Builds `@font-face` CSS rules referencing the self-hosted files,
 * relative to `style.css`'s own location (the theme root). Unlike D30/
 * D31's image-`src` problem in static `templates/*.html`/`parts/*.html`
 * files (a relative path there resolves against the *current page's* URL,
 * not the theme's, since that markup gets inserted into an arbitrary
 * page), this just works with a plain relative `url()`: `style.css` is
 * served as its own static file at a fixed, known location, and a CSS
 * `url()` inside a stylesheet always resolves relative to that
 * stylesheet's own URL — no PHP/live-resolution trick needed here.
 */
export const fontFaceCss = (faces: ResolvedFontFace[]): string =>
  faces
    .map(
      (f) => `@font-face {
  font-family: "${f.family}";
  font-style: ${f.style};
  font-weight: ${f.weight};
  font-display: swap;
  src: url("assets/fonts/${f.fileName}") format("woff2");${f.unicodeRange ? `\n  unicode-range: ${f.unicodeRange};` : ""}
}`,
    )
    .join("\n\n");
