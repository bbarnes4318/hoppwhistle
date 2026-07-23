import 'dotenv-flow/config';

// Minimal REAL provider smoke test. Confirms the supplied keys + endpoints work
// and that citations/usage come back. Uses tiny prompts to keep cost low. This
// is not the full pipeline (DB is unreachable from here) — it validates the
// real HTTP integrations only. No secrets are printed.

const TIMEOUT = 30_000;

async function call(label: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    console.log(`${label}: ERROR ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  } finally {
    console.log(`  (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
}

function ac() {
  const c = new AbortController();
  setTimeout(() => c.abort(), TIMEOUT);
  return c.signal;
}

async function main() {
  // Anthropic (synthesis / verifier)
  await call('anthropic', async () => {
    const key = process.env.ANTHROPIC_API_KEY!;
    const model = process.env.ANTHROPIC_SYNTHESIS_MODEL || 'claude-opus-4-8';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      }),
      signal: ac(),
    });
    const j: any = await r.json();
    console.log(
      `anthropic(${model}): HTTP ${r.status}` +
        (r.ok
          ? ` text="${(j.content?.[0]?.text || '').trim().slice(0, 20)}" usage=${JSON.stringify(j.usage)}`
          : ` err=${JSON.stringify(j.error).slice(0, 120)}`)
    );
  });

  // Perplexity — auth/citation smoke on cheap `sonar`; the pipeline uses sonar-deep-research.
  await call('perplexity', async () => {
    const key = process.env.PERPLEXITY_API_KEY!;
    const r = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'user',
            content:
              'In one sentence, what is a commercial HVAC maintenance contract? Cite a source.',
          },
        ],
      }),
      signal: ac(),
    });
    const j: any = await r.json();
    console.log(
      `perplexity(sonar): HTTP ${r.status}` +
        (r.ok
          ? ` citations=${(j.citations || j.search_results || []).length} usage=${JSON.stringify(j.usage)}`
          : ` err=${JSON.stringify(j.error || j).slice(0, 140)}`)
    );
  });

  // xAI — Agent Tools Responses API with web_search
  await call('xai', async () => {
    const key = process.env.XAI_API_KEY!;
    const model = process.env.XAI_RESEARCH_MODEL || 'grok-4.5';
    const r = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'user',
            content: 'One sentence on a common HVAC operator complaint. Cite a source.',
          },
        ],
        tools: [{ type: 'web_search' }],
      }),
      signal: ac(),
    });
    const j: any = await r.json();
    const cites = (j.output || [])
      .flatMap((o: any) => o.content || [])
      .flatMap((c: any) => c.annotations || [])
      .filter((a: any) => a.type === 'url_citation');
    console.log(
      `xai(${model}): HTTP ${r.status}` +
        (r.ok
          ? ` citations=${cites.length} usage=${JSON.stringify(j.usage)}`
          : ` err=${JSON.stringify(j.error || j).slice(0, 140)}`)
    );
  });

  // Gemini — configured (likely-preview) model, then a known-good model to prove the key.
  await call('gemini', async () => {
    const key = process.env.GEMINI_API_KEY!;
    for (const model of [
      process.env.GOOGLE_DEEP_RESEARCH_MODEL || 'deep-research-max-preview-04-2026',
      'gemini-2.0-flash',
    ]) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
            tools: [{ google_search: {} }],
          }),
          signal: ac(),
        }
      );
      const j: any = await r.json();
      console.log(
        `gemini(${model}): HTTP ${r.status}` +
          (r.ok ? ` ok` : ` err=${JSON.stringify(j.error?.message || j).slice(0, 120)}`)
      );
    }
  });

  console.log('\nOpenAI: skipped (no OPENAI_API_KEY supplied; verifier resolves to Anthropic).');
}

main().then(() => process.exit(0));
