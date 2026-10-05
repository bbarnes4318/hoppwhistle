/**
 * Which logo a carrier name gets.
 *
 * Carrier names reach the screen in several spellings -- the quoter's family
 * ("American Amicable / Occidental"), the application form's name ("American
 * Amicable"), a product id ("amam_golden_solution"), a legal name ("Mutual of
 * Omaha (United of Omaha Life Insurance Company)") -- so the match is on a
 * normalised name, most specific pattern first. "American Amicable" is checked
 * before "Americo", which is a prefix of it.
 *
 * A carrier with no logo here gets its name set as a wordmark (`CarrierLogo`).
 * Logos live in `public/carriers/`, trimmed to their mark on a transparent
 * background.
 */

export interface CarrierBrand {
  /** `/carriers/<key>.webp`, or null when there is no logo for this carrier. */
  logo: string | null;
  /** Wide wordmark (most) or a square seal (AHL, Royal Neighbors). */
  shape: 'wide' | 'square';
  /** The name as the brand writes it, for alt text. */
  name: string;
}

const BRANDS: ReadonlyArray<{ test: RegExp; brand: CarrierBrand }> = [
  {
    test: /american[\s-]*amicable|^amam_|occidental life|pioneer american|ia american/,
    brand: { logo: '/carriers/american-amicable.webp', shape: 'wide', name: 'American Amicable' },
  },
  {
    test: /accendo/,
    brand: {
      logo: '/carriers/accendo-aetna.webp',
      shape: 'wide',
      name: 'Accendo (Aetna / CVS Health)',
    },
  },
  {
    test: /continental life/,
    brand: {
      logo: '/carriers/continental-life-aetna.webp',
      shape: 'wide',
      name: 'Continental Life by Aetna',
    },
  },
  {
    test: /mutual of omaha|united of omaha|^moo_/,
    brand: { logo: '/carriers/mutual-of-omaha.webp', shape: 'wide', name: 'Mutual of Omaha' },
  },
  {
    test: /\bamerico\b|^americo_/,
    brand: { logo: '/carriers/americo.webp', shape: 'wide', name: 'Americo' },
  },
  {
    test: /\bahl\b|american home life/,
    brand: { logo: '/carriers/ahl.webp', shape: 'square', name: 'American Home Life' },
  },
  {
    test: /royal neighbors/,
    brand: {
      logo: '/carriers/royal-neighbors.webp',
      shape: 'square',
      name: 'Royal Neighbors of America',
    },
  },
  {
    test: /liberty bankers/,
    brand: { logo: '/carriers/liberty-bankers.webp', shape: 'wide', name: 'Liberty Bankers' },
  },
  {
    test: /sons of norway/,
    brand: { logo: '/carriers/sons-of-norway.webp', shape: 'wide', name: 'Sons of Norway' },
  },
  {
    test: /security national/,
    brand: { logo: '/carriers/security-national.webp', shape: 'wide', name: 'Security National' },
  },
  {
    test: /sentinel security/,
    brand: {
      logo: '/carriers/sentinel-security.webp',
      shape: 'wide',
      name: 'Sentinel Security Life',
    },
  },
  {
    test: /transamerica/,
    brand: { logo: '/carriers/transamerica.webp', shape: 'wide', name: 'Transamerica' },
  },
  {
    test: /lifeshield/,
    brand: { logo: '/carriers/lifeshield.webp', shape: 'wide', name: 'LifeShield' },
  },
  {
    test: /trinity life|family benefit/,
    brand: { logo: '/carriers/trinity.webp', shape: 'wide', name: 'Trinity Life' },
  },
  {
    test: /\bgcu\b|greek catholic union/,
    brand: { logo: '/carriers/gcu.webp', shape: 'wide', name: 'GCU' },
  },
  {
    test: /\bcica\b/,
    brand: { logo: '/carriers/cica.webp', shape: 'wide', name: 'CICA Life' },
  },
  {
    test: /corebridge/,
    brand: { logo: '/carriers/corebridge.webp', shape: 'wide', name: 'Corebridge Financial' },
  },
  // Bankers Fidelity is a different company; only "Fidelity Life" matches.
  {
    test: /fidelity life/,
    brand: { logo: '/carriers/fidelity-life.webp', shape: 'wide', name: 'Fidelity Life' },
  },
  {
    test: /catholic (united|financial)/,
    brand: {
      logo: '/carriers/catholic-united.webp',
      shape: 'wide',
      name: 'Catholic United Financial',
    },
  },
  {
    test: /better\s?life/,
    brand: { logo: '/carriers/betterlife.webp', shape: 'wide', name: 'BetterLife' },
  },
  {
    test: /physicians (mutual|life)/,
    brand: { logo: '/carriers/physicians-mutual.webp', shape: 'wide', name: 'Physicians Mutual' },
  },
  {
    test: /gerber/,
    brand: { logo: '/carriers/gerber.webp', shape: 'wide', name: 'Gerber Life' },
  },
  {
    test: /\bgtl\b|guarantee trust/,
    brand: { logo: '/carriers/gtl.webp', shape: 'wide', name: 'Guarantee Trust Life' },
  },
  {
    test: /\bsbli\b/,
    brand: { logo: '/carriers/sbli.webp', shape: 'wide', name: 'SBLI' },
  },
  {
    test: /aflac/,
    brand: { logo: '/carriers/aflac.webp', shape: 'wide', name: 'Aflac' },
  },
];

function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The brand for any of the names a carrier goes by. Pass every name you have
 * (family, product id, application carrier); the first that matches wins.
 */
export function carrierBrand(...names: Array<string | null | undefined>): CarrierBrand | null {
  for (const raw of names) {
    if (!raw) continue;
    const name = normalise(raw);
    const hit = BRANDS.find(b => b.test.test(name));
    if (hit) return hit.brand;
  }
  return null;
}
