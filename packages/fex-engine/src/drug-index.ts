import type { DrugIngredient, FexBundle } from './types.js';

/**
 * Condition codes that imply a broader code. A fact for the narrower code is
 * also a fact for the broader one ("insulin-dependent diabetes" is diabetes),
 * so a carrier rule written against DIABETES fires for DIABETES_INSULIN too.
 */
export const IMPLIES: Readonly<Record<string, readonly string[]>> = {
  DIABETES_INSULIN: ['DIABETES'],
  DIABETES_UNCONTROLLED: ['DIABETES'],
  DIABETIC_NEUROPATHY: ['DIABETES'],
  DIABETIC_RETINOPATHY: ['DIABETES'],
  DIABETIC_NEPHROPATHY: ['DIABETES'],
  DIABETIC_COMA: ['DIABETES'],
  DIABETIC_ULCERS: ['DIABETES'],
  CANCER_METASTATIC: ['CANCER'],
  CANCER_RECURRENT: ['CANCER'],
  LEUKEMIA: ['CANCER'],
  LYMPHOMA: ['CANCER'],
  MELANOMA: ['CANCER'],
  EMPHYSEMA: ['COPD'],
  CHRONIC_BRONCHITIS: ['COPD'],
  KIDNEY_DIALYSIS: ['KIDNEY_FAILURE'],
  ALZHEIMERS_DEMENTIA: ['MEMORY_LOSS'],
  HEART_ATTACK: ['CAD'],
  ANGIOPLASTY_STENT: ['CAD'],
  HYPERTENSION_UNCONTROLLED: ['HYPERTENSION'],
};

/** The broadest code a condition code rolls up to. */
export function rootCondition(code: string): string {
  let current = code;
  const seen = new Set<string>();
  while (IMPLIES[current]?.length && !seen.has(current)) {
    seen.add(current);
    current = IMPLIES[current][0];
  }
  return current;
}

/**
 * The drug dictionary: name resolution, search, and the ingredient
 * relationships (combination products, drug classes) the Rx rules match on.
 * Build one per bundle and reuse it -- construction indexes ~1,000 ingredients.
 */
export class DrugIndex {
  readonly byId = new Map<string, DrugIngredient>();
  /** member id → the class/group ids that list it. */
  readonly parents = new Map<string, string[]>();

  constructor(private readonly bundle: FexBundle) {
    for (const ingredient of bundle.drugs.ingredients) this.byId.set(ingredient.id, ingredient);
    for (const ingredient of bundle.drugs.ingredients) {
      for (const member of ingredient.members ?? []) {
        const list = this.parents.get(member) ?? [];
        list.push(ingredient.id);
        this.parents.set(member, list);
      }
    }
  }

  /** Exact name → ingredient id (brand, generic, alias or known misspelling). */
  resolve(name: string): string | undefined {
    const normalized = name.toLowerCase().trim().replace(/\s+/g, ' ');
    return (
      this.bundle.drugs.nameIndex[normalized] ??
      this.bundle.drugs.nameIndex[normalized.replace(/[^a-z0-9 /+-]/g, '')]
    );
  }

  isInsulin(id: string): boolean {
    return (
      id === 'class:insulin' ||
      id.startsWith('insulin') ||
      (this.byId.get(id)?.member_of ?? []).includes('class:insulin')
    );
  }

  /**
   * Every id an Rx entry for this drug may be keyed under: itself, its class
   * members (when it is a class), its components (when it is a combination),
   * the classes it belongs to, explicitly related ids, and the combinations /
   * classes that contain any of its components.
   */
  related(id: string): string[] {
    const ids = new Set<string>([id]);
    const ingredient = this.byId.get(id);
    if (ingredient?.kind === 'class' || ingredient?.kind === 'group') {
      for (const member of ingredient.members ?? []) ids.add(member);
    }
    for (const component of ingredient?.components ?? []) ids.add(component);
    for (const parent of ingredient?.member_of ?? []) ids.add(parent);
    for (const relatedId of ingredient?.related ?? []) ids.add(relatedId);
    for (const parent of this.parents.get(id) ?? []) ids.add(parent);
    for (const component of ingredient?.components ?? []) {
      for (const parent of this.parents.get(component) ?? []) ids.add(parent);
    }
    return Array.from(ids);
  }

  /**
   * True when carriers decide this drug differently depending on what it is
   * taken for (e.g. gabapentin for neuropathy vs. seizures), so the agent must
   * confirm the use before the result is final.
   */
  multiUse(id: string): boolean {
    if (this.byId.get(id)?.multi_use) return true;
    const uses = new Set<string>();
    for (const product of this.bundle.products) {
      for (const relatedId of this.related(id)) {
        for (const entry of product.uw.rx[relatedId] ?? []) {
          if (entry.dep && entry.ind.length) {
            uses.add(
              Array.from(new Set(entry.ind.map(rootCondition)))
                .sort()
                .join()
            );
          }
        }
      }
    }
    return uses.size > 1;
  }

  /**
   * Typeahead over every brand, generic, alias and misspelling. Ranked: exact
   * name, then prefix, then word-start, then substring; shorter names first
   * within a rank. One row per ingredient. A single letter matches name
   * prefixes only, alphabetically, so typing "a" lists the A medications.
   */
  search(query: string, limit = 12): DrugIngredient[] {
    return this.searchNames(query, limit).map(hit => hit.ingredient);
  }

  /** `search`, plus the name each ingredient matched on (lowercase, as indexed). */
  searchNames(query: string, limit = 12): Array<{ ingredient: DrugIngredient; matched: string }> {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const prefixOnly = q.length === 1;
    const hits: Array<{ ingredient: DrugIngredient; score: number; via: string }> = [];
    const seen = new Set<string>();
    for (const [name, id] of Object.entries(this.bundle.drugs.nameIndex)) {
      let score = -1;
      if (name === q) score = 0;
      else if (name.startsWith(q)) score = 1;
      else if (prefixOnly) continue;
      else if (name.includes(' ' + q) || name.includes('/' + q)) score = 2;
      else if (name.includes(q)) score = 3;
      if (score < 0 || seen.has(id + '|' + score)) continue;
      const ingredient = this.byId.get(id);
      if (ingredient) {
        seen.add(id + '|' + score);
        hits.push({ ingredient, score, via: name });
      }
    }
    hits.sort(
      prefixOnly
        ? (a, b) => a.score - b.score || a.via.localeCompare(b.via)
        : (a, b) => a.score - b.score || a.via.length - b.via.length
    );
    const out: Array<{ ingredient: DrugIngredient; matched: string }> = [];
    const ids = new Set<string>();
    for (const hit of hits) {
      if (!ids.has(hit.ingredient.id)) {
        ids.add(hit.ingredient.id);
        out.push({ ingredient: hit.ingredient, matched: hit.via });
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * The condition codes to offer when asking "what is it prescribed for?":
   * the drug's common indications plus every use any carrier's Rx list names
   * for it, limited to codes that exist in the bundle's condition list.
   */
  indicationOptions(id: string): string[] {
    const options = new Set(this.byId.get(id)?.common_indications ?? []);
    const relatedIds = this.related(id);
    for (const product of this.bundle.products) {
      for (const relatedId of relatedIds) {
        for (const entry of product.uw.rx[relatedId] ?? []) {
          if (entry.dep) entry.ind.forEach(code => options.add(code));
        }
      }
    }
    const known = new Set(this.bundle.conditions.map(c => c.code));
    return Array.from(options).filter(code => known.has(code));
  }
}
