/**
 * The two binary assets every agreement inlines: NetEnroll's logo and the
 * signature script font (Dancing Script, SIL Open Font License).
 *
 * Both are embedded as data URIs so a document renders identically in the
 * signer's browser, in headless Chrome with no network, and years from now --
 * nothing an agreement shows depends on a URL that can change.
 *
 * The logo is `apps/api/assets/agreements/netenroll-logo.png` (copied from the
 * web app's public folder); the image copies `apps/api/assets` beside dist/.
 * The font is read from `@fontsource/dancing-script` in node_modules.
 */

import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { BRAND_THEME_KEYS } from '@hopwhistle/shared';

function assetDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    // dist/index.js in the runner image: /app/dist -> /app/assets/agreements
    resolve(here, '../assets/agreements'),
    // src/services/agreements/*.ts under tsx or vitest
    resolve(here, '../../../assets/agreements'),
    join(process.cwd(), 'assets/agreements'),
    join(process.cwd(), 'apps/api/assets/agreements'),
  ];
}

function findAsset(name: string): string {
  for (const dir of assetDirs()) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Agreement asset ${name} not found (looked in ${assetDirs().join(', ')})`);
}

let logoDataUri: string | null = null;
let fontFace: string | null = null;

/** NetEnroll's logo as a `data:image/png;base64,...` URI. */
export function netenrollLogoDataUri(): string {
  if (!logoDataUri) {
    logoDataUri = `data:image/png;base64,${readFileSync(findAsset('netenroll-logo.png')).toString('base64')}`;
  }
  return logoDataUri;
}

/** The font family name the signature fragments use. */
export const SIGNATURE_FONT_FAMILY = 'NetEnroll Signature';

/** An `@font-face` rule for the signature script, with the woff2 inlined. */
export function signatureFontFace(): string {
  if (!fontFace) {
    const require = createRequire(import.meta.url);
    const file = require.resolve(
      '@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff2'
    );
    const data = readFileSync(file).toString('base64');
    fontFace = `@font-face{font-family:'${SIGNATURE_FONT_FAMILY}';font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  }
  return fontFace;
}

/** Read both at startup so a missing asset fails the boot log, not a signing. */
export function preloadAgreementAssets(): void {
  netenrollLogoDataUri();
  signatureFontFace();
  for (const theme of BRAND_THEME_KEYS) brandLogoDataUri(theme);
}

const brandLogos = new Map<string, string>();

/**
 * A white-label issuer's wordmark (`assets/agreements/brands/<theme>.png`,
 * copied from `apps/web/public/brands/<theme>/wordmark.png`) as a data URI.
 * Keyed by brand theme, never by tenant name or host.
 */
export function brandLogoDataUri(theme: string): string {
  if (!/^[a-z0-9-]+$/.test(theme)) throw new Error(`Not a brand theme key: ${theme}`);
  let uri = brandLogos.get(theme);
  if (!uri) {
    uri = `data:image/png;base64,${readFileSync(findAsset(`brands/${theme}.png`)).toString('base64')}`;
    brandLogos.set(theme, uri);
  }
  return uri;
}
