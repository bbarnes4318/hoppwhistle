import { RESEARCH_MODES } from './constants';
import type {
  ProviderAssignments,
  ProviderConfig,
  ProviderId,
  ProviderRole,
  ResearchBriefInput,
  ResearchMode,
} from './types';

type Env = Record<string, string | undefined>;

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === '') return dflt;
  return v === 'true' || v === '1' || v === 'yes';
}

function int(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/**
 * Whether provider execution may substitute an explicitly-configured REAL
 * fallback provider when a role's provider fails. Never enables mock data.
 */
export function realFallbackEnabled(env: Env): boolean {
  return bool(env.INDUSTRY_RESEARCH_REAL_FALLBACK, true);
}

/**
 * Real-only provider registry. Four providers: Google, Perplexity, xAI,
 * Anthropic. There is no mock provider and no OpenAI. Anthropic performs
 * synthesis ONLY — it never verifies its own report.
 */
export function buildProviderRegistry(env: Env): ProviderConfig[] {
  return [
    {
      id: 'google',
      label: 'Google Gemini (Deep Research + adjudication)',
      enabled: bool(env.GOOGLE_DEEP_RESEARCH_ENABLED, true),
      apiKeyEnv: 'GEMINI_API_KEY',
      hasKey: Boolean(env.GEMINI_API_KEY),
      model: env.GOOGLE_DEEP_RESEARCH_MODEL || 'deep-research-preview-04-2026',
      fallbackModel: env.GOOGLE_RAPID_RESEARCH_MODEL || env.GOOGLE_GROUNDED_MODEL || 'gemini-flash-latest',
      timeoutMs: int(env.GOOGLE_DEEP_RESEARCH_TIMEOUT_MS, 25 * 60 * 1000),
      maxRetries: int(env.GOOGLE_DEEP_RESEARCH_MAX_RETRIES, 1),
      roles: ['primary', 'independent', 'adjudicator'],
    },
    {
      id: 'perplexity',
      label: 'Perplexity Sonar Deep Research (+ factual verification)',
      enabled: bool(env.PERPLEXITY_RESEARCH_ENABLED, true),
      apiKeyEnv: 'PERPLEXITY_API_KEY',
      hasKey: Boolean(env.PERPLEXITY_API_KEY),
      model: env.PERPLEXITY_RESEARCH_MODEL || 'sonar-deep-research',
      timeoutMs: int(env.PERPLEXITY_TIMEOUT_MS, 20 * 60 * 1000),
      maxRetries: int(env.PERPLEXITY_MAX_RETRIES, 1),
      roles: ['independent', 'primary', 'social', 'factual_verifier'],
    },
    {
      id: 'xai',
      label: 'xAI Grok (Web + X search, adversarial verification)',
      enabled: bool(env.XAI_WEB_SEARCH_ENABLED, true),
      apiKeyEnv: 'XAI_API_KEY',
      hasKey: Boolean(env.XAI_API_KEY),
      model: env.XAI_RESEARCH_MODEL || 'grok-4.5',
      timeoutMs: int(env.XAI_TIMEOUT_MS, 15 * 60 * 1000),
      maxRetries: int(env.XAI_MAX_RETRIES, 1),
      roles: ['social', 'primary', 'independent', 'adversarial_verifier'],
    },
    {
      id: 'anthropic',
      label: 'Anthropic Claude (synthesis only)',
      enabled: bool(env.ANTHROPIC_WEB_SEARCH_ENABLED, true),
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      hasKey: Boolean(env.ANTHROPIC_API_KEY),
      model: env.ANTHROPIC_SYNTHESIS_MODEL || 'claude-opus-4-8',
      fallbackModel: env.ANTHROPIC_SYNTHESIS_FALLBACK_MODEL || 'claude-sonnet-5',
      timeoutMs: int(env.ANTHROPIC_TIMEOUT_MS, 12 * 60 * 1000),
      maxRetries: int(env.ANTHROPIC_MAX_RETRIES, 1),
      roles: ['synthesis'],
    },
  ];
}

const DEFAULT_ROLE_PROVIDER: Record<ProviderRole, ProviderId> = {
  primary: 'google',
  independent: 'perplexity',
  social: 'xai',
  synthesis: 'anthropic',
  factual_verifier: 'perplexity',
  adversarial_verifier: 'xai',
  adjudicator: 'google',
};

function usableProvider(cfg: ProviderConfig | undefined, role: ProviderRole): boolean {
  return Boolean(cfg && cfg.enabled && cfg.hasKey && cfg.roles.includes(role));
}

export function resolveAssignments(
  env: Env,
  brief: Pick<ResearchBriefInput, 'mode' | 'providerOverrides'>
): ProviderAssignments {
  const registry = buildProviderRegistry(env);
  const byId = new Map<ProviderId, ProviderConfig>(registry.map(c => [c.id, c]));
  const roles: ProviderRole[] = [
    'primary',
    'independent',
    'social',
    'synthesis',
    'factual_verifier',
    'adversarial_verifier',
    'adjudicator',
  ];
  const out = {} as ProviderAssignments;

  for (const role of roles) {
    const override = brief.providerOverrides?.[role];
    if (override && usableProvider(byId.get(override), role)) {
      out[role] = override;
      continue;
    }
    const preferred = DEFAULT_ROLE_PROVIDER[role];
    if (usableProvider(byId.get(preferred), role)) {
      out[role] = preferred;
      continue;
    }
    const alt = registry.find(c => usableProvider(c, role));
    out[role] = alt ? alt.id : preferred;
  }
  return out;
}

/** Ordered list of usable REAL fallback providers for a role, excluding `primary`. */
export function roleFallbacks(env: Env, role: ProviderRole, primary: ProviderId): ProviderId[] {
  if (!realFallbackEnabled(env)) return [];
  return buildProviderRegistry(env)
    .filter(c => c.id !== primary && usableProvider(c, role))
    .map(c => c.id);
}

export interface PreflightError {
  role: ProviderRole;
  provider: ProviderId;
  reason: string;
}

export function preflightRun(
  env: Env,
  brief: Pick<ResearchBriefInput, 'mode' | 'providerOverrides'>
): { ok: boolean; errors: PreflightError[]; assignments: ProviderAssignments } {
  const assignments = resolveAssignments(env, brief);
  const registry = buildProviderRegistry(env);
  const byId = new Map<ProviderId, ProviderConfig>(registry.map(c => [c.id, c]));
  const errors: PreflightError[] = [];

  for (const role of RESEARCH_MODES[brief.mode].roles) {
    const provider = assignments[role];
    const cfg = byId.get(provider);
    if (!cfg) errors.push({ role, provider, reason: 'Provider is not configured' });
    else if (!cfg.enabled) errors.push({ role, provider, reason: `${cfg.label} is disabled` });
    else if (!cfg.hasKey)
      errors.push({
        role,
        provider,
        reason: `${cfg.label} is missing its API key (${cfg.apiKeyEnv})`,
      });
    else if (!cfg.roles.includes(role))
      errors.push({ role, provider, reason: `${cfg.label} cannot serve the ${role} role` });
  }
  return { ok: errors.length === 0, errors, assignments };
}

export function activeRoles(mode: ResearchBriefInput['mode']): ProviderRole[] {
  return RESEARCH_MODES[mode].roles;
}

// ---------------------------------------------------------------------------
// Per-mode capability selection (real Deep Research vs grounded/sync).
// ---------------------------------------------------------------------------

export type GeminiPrimaryMode = 'grounded' | 'deep_research';

/** How the Gemini primary role runs for a mode. Rapid = grounded generateContent;
 *  Full = Deep Research agent; Forensic = Deep Research MAX agent. */
export function geminiPrimaryConfig(
  env: Env,
  mode: ResearchMode
): { mode: GeminiPrimaryMode; model: string } {
  if (mode === 'rapid_scan') {
    return {
      mode: 'grounded',
      model: env.GOOGLE_RAPID_RESEARCH_MODEL || env.GOOGLE_GROUNDED_MODEL || 'gemini-flash-latest',
    };
  }
  if (mode === 'forensic_max') {
    return {
      mode: 'deep_research',
      model: env.GOOGLE_DEEP_RESEARCH_MAX_MODEL || 'deep-research-max-preview-04-2026',
    };
  }
  return {
    mode: 'deep_research',
    model: env.GOOGLE_DEEP_RESEARCH_MODEL || 'deep-research-preview-04-2026',
  };
}

/** Whether Perplexity research uses the async Deep Research workflow for a mode. */
export function perplexityResearchConfig(
  env: Env,
  mode: ResearchMode
): { async: boolean; model: string } {
  const model = env.PERPLEXITY_RESEARCH_MODEL || 'sonar-deep-research';
  return { async: mode !== 'rapid_scan', model };
}

export function perplexityVerifierModel(env: Env, mode: ResearchMode): string {
  if (mode === 'forensic_max') return env.PERPLEXITY_MAX_VERIFIER_MODEL || 'sonar-deep-research';
  return env.PERPLEXITY_VERIFIER_MODEL || 'sonar-pro';
}

export function geminiAdjudicatorModel(env: Env): string {
  return env.GOOGLE_ADJUDICATOR_MODEL || 'gemini-3.1-pro-preview';
}

export function xaiVerifierModel(env: Env): string {
  return env.XAI_VERIFIER_MODEL || env.XAI_RESEARCH_MODEL || 'grok-4.5';
}
