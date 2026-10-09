import { defineConfig } from 'vitest/config';

/**
 * Suites that talk to a real database, which must not run beside each other.
 *
 * Each of these truncates shared tables in `beforeEach` -- `TRUNCATE TABLE
 * "tenants" CASCADE` and friends -- so running two of them at once means one
 * deletes the other's fixtures mid-test. That is not hypothetical: with the
 * default file parallelism, security.test.ts fails on
 * `expected [] to include 'admin@test.local'`, because another suite wiped the
 * users it had just seeded. The failure moves around between runs, which is the
 * worst kind: it reads as a flaky security test rather than as a fixture race.
 */
const DATABASE_BACKED = [
  '**/src/__tests__/security.test.ts',
  // Truncates tenants, campaigns, calls and applications to seed a campaign
  // billed per application. Left off this list it ran beside settlement.test.ts
  // and the two deleted each other's fixtures: P2025 on a call it had just
  // created, and `users_tenantId_fkey` / `calls_tenantId_fkey` in settlement.
  '**/src/__tests__/campaign-application-billing.test.ts',
  // Truncates tenants, carriers and calls to seed two agencies' carrier routing.
  '**/src/__tests__/vonage-carrier.test.ts',
  '**/src/__tests__/tenant-isolation.test.ts',
  '**/src/__tests__/platform-admin.test.ts',
  '**/src/__tests__/rating-engine.test.ts',
  '**/src/__tests__/settlement.test.ts',
  // Truncates `tenants`, `roles` and `insurance_carrier_applications` to seed
  // an agency, two agents and a platform operator. Left off this list it ran
  // on the default pool beside settlement.test.ts and the two deleted each
  // other's fixtures: nine failures reported as `users_tenantId_fkey` and
  // `user_roles_roleId_fkey` violations, which name Prisma rather than the
  // race that caused them.
  '**/src/__tests__/agent-entry.test.ts',
  '**/src/__tests__/delivery-gating-paths.test.ts',
  '**/src/__tests__/settlement-cli-flags.test.ts',
  '**/src/__tests__/portal.test.ts',
  '**/src/__tests__/phase5-platform.test.ts',
  '**/src/__tests__/api-response-contract.test.ts',
  '**/src/__tests__/no-acting-tenant-audit.test.ts',
  '**/src/__tests__/platform-capability-closure.test.ts',
  // Truncates `tenants`, `roles`, `calls` and `audit_logs` to seed one agency,
  // its owner and agent, and a platform operator. Beside any other suite on the
  // default pool the two would delete each other's fixtures.
  '**/src/__tests__/role-preview.test.ts',
  '**/src/__tests__/publisher-portal-access.test.ts',
  // Truncates `tenants` and `roles` to seed a white-label agency, its children
  // and another agency, and writes `statements`.
  '**/src/__tests__/statements.test.ts',
  // Seeds two agencies with users, calls, recordings and analyzer uploads, and
  // truncates `tenants`, `roles` and `recordings` to do it. Left off this list
  // it ran beside tenant-isolation.test.ts and the two deleted each other's
  // fixtures -- which surfaced as the recording suite failing to seed at all,
  // not as anything to do with recordings.
  '**/src/__tests__/recording-access.test.ts',
  // Truncates `tenants` CASCADE, which takes the carrier tables with it, to
  // prove the boot-time catalog converges for a tenant that has none. On the
  // default pool that would delete every other suite's fixtures -- the same
  // race the entries above record.
  '**/src/__tests__/carrier-catalog.test.ts',
  // Truncates `tenants`, `roles` and `users` to seed one account per role.
  '**/src/__tests__/me-capabilities.test.ts',
  // Truncates `tenants`, `roles`, `users` and `audit_logs` to seed a branded
  // and an unbranded agency and a platform operator.
  '**/src/__tests__/tenant-brand.test.ts',
  // Truncates `tenants`, `roles`, `users` and `audit_logs`, and suspends its
  // own agent mid-suite.
  '**/src/__tests__/session-expiry.test.ts',
  // Truncates `tenants`, `roles`, `users`, `insurance_leads` and `lead_lists`
  // to seed two agencies with two agents each.
  '**/src/__tests__/crm-agent-scope.test.ts',
  // Truncates `tenants`, `roles`, `calls`, `insurance_leads` and
  // `prospect_intakes` to seed two agencies with an owner and two agents each.
  '**/src/__tests__/prospect-intake-agent-scope.test.ts',
  // Seeds two agencies, their owners and three agents each, and truncates
  // `tenants`, `roles` and the insurance tables to do it.
  '**/src/__tests__/agent-licensed-states.test.ts',
  '**/src/__tests__/audit-log.test.ts',
  // Truncates `calls`, `tenants`, `roles` and `users` to seed two agencies
  // with a principal and two agents each. Left off this list it ran on the
  // default pool beside settlement.test.ts and the two deleted each other's
  // fixtures: twenty failures across both files, reported as
  // `calls_tenantId_fkey` violations and a 401 where a 403 was expected --
  // neither of which names the race that caused them.
  '**/src/__tests__/call-log.test.ts',
  // Truncates `insurance_carrier_applications`, `calls`, `tenants`, `roles`
  // and `users` to seed one agency and its agents.
  '**/src/__tests__/application-disposition.test.ts',
  // Truncates `insurance_carrier_applications`, `tenants`, `roles` and `users`
  // to seed one agency, its owner and two agents' applications.
  '**/src/__tests__/applications-read.test.ts',
  // Truncates `calls`, `did_routes`, `tenants`, `roles` and `users` to seed one
  // agency, its agent and a tracking DID, then drives the CDR and the
  // disposition endpoint against them.
  '**/src/__tests__/softphone-disposition.test.ts',
  '**/src/__tests__/db-push-constraints.test.ts',
  // Creates two tenants and their webhook keys, so another suite's
  // `TRUNCATE "tenants" CASCADE` would delete them mid-test.
  '**/src/__tests__/lead-inject-stream.test.ts',
  // Same: it seeds two agencies and truncates `roles`, and beside
  // settlement.test.ts on the default pool the two delete each other's
  // fixtures -- eleven failures whose text points at Prisma rather than at the
  // race that caused them.
  '**/src/__tests__/quota-summary.test.ts',
  // Truncates `tenants`, `roles`, `calls`, `buyers` and `campaigns` to seed two
  // agencies with their own buyers, traffic and applications.
  '**/src/__tests__/agency-live-board.test.ts',
  // Truncates `tenants`, `roles` and `audit_logs` to seed a white-label and a
  // normal agency with publishers, buyers, calls and ledger rows.
  '**/src/__tests__/white-label.test.ts',
  // Each truncates `tenants`, `roles` and `audit_logs` to seed a white-label
  // agency and a normal one: returns and their decisions, publisher invites,
  // a campaign's answer order, the Today screen, and the calls outcome filter.
  '**/src/__tests__/returns.test.ts',
  '**/src/__tests__/user-invite-publisher.test.ts',
  '**/src/__tests__/campaign-answer-order.test.ts',
  '**/src/__tests__/white-label-today.test.ts',
  // Truncates `tenants`, `roles` and `audit_logs` to seed two agencies, their
  // agents, calls, applications and CRM leads: the agent's own Today.
  '**/src/__tests__/agent-today.test.ts',
  // Truncates `tenants`, `roles`, `platform_admins` and
  // `number_carrier_settings`: which carriers agencies buy numbers from.
  '**/src/__tests__/number-carriers.test.ts',
  // Truncates `tenants`, `roles` and `audit_logs` to seed one agency with a
  // stuck call and a live one, and reads every screen that counts calls up.
  '**/src/__tests__/call-in-progress.test.ts',
  '**/src/__tests__/calls-outcome-filter.test.ts',
  // Truncates `tenants`, `roles` and `audit_logs` to seed an owner, an
  // administrator and an agent, and asks each to manage webhooks.
  '**/src/__tests__/webhook-access.test.ts',
  // Truncates `tenants`, `roles` and `audit_logs` to seed two white-label
  // agencies with publishers, payable calls and clawbacks.
  '**/src/__tests__/payout-clawbacks.test.ts',
  // Truncates `tenants`, `roles` and `audit_logs` to seed a white-label agency,
  // its owner, two prepaid buyers and their portal users.
  '**/src/__tests__/buyer-portal.test.ts',
  // Truncates `tenants`, `roles` and `audit_logs` to seed two agencies, their
  // owners, a publisher user, calls, payments and clawbacks.
  '**/src/__tests__/publisher-portal-money.test.ts',
  // Truncates `tenants`, `roles` and `audit_logs` to seed a white-label and a
  // normal agency, each with an owner and DNC lists.
  '**/src/__tests__/dnc-lists-access.test.ts',
  '**/src/services/__tests__/ai-campaign-service.db.test.ts',
  '**/src/services/__tests__/ai-campaign-service.raw-sql.test.ts',
  '**/src/services/__tests__/flow-store.test.ts',
  '**/src/services/__tests__/pay-per-call-integration.test.ts',
  // Seeds a tenant and its compliance overrides. On the default pool another
  // suite's `TRUNCATE "tenants" CASCADE` deleted them mid-test, which read as
  // an override that names no call failing to apply.
  '**/src/services/__tests__/compliance-override.db.test.ts',
  '**/src/services/provisioning/__tests__/provisioning-service.test.ts',
  // Truncates `tenants`, `roles`, `users`, `calls`, `recordings`, `buyers`,
  // `publishers`, `campaigns` and `insurance_leads`, seeding one agency with
  // an owner, agents, buyers and a publisher once for the whole file.
  '**/src/__tests__/security-leaks.test.ts',
  // Each truncates `tenants`, `roles` and `audit_logs` to seed agencies with
  // owners: password change and reset, an agency buying and releasing
  // numbers (with a white-label parent and a child), and a child agency's
  // campaigns, brand and limits.
  '**/src/__tests__/password.test.ts',
  // Truncates `tenants`, `roles` and `audit_logs`: an agent keeping their
  // own licensed states.
  '**/src/__tests__/me-licensed-states.test.ts',
  '**/src/__tests__/agency-numbers.test.ts',
  '**/src/__tests__/child-agency.test.ts',
  // Truncates `tenants`, `roles`, `audit_logs` and `upgrade_requests`: a
  // parent's page for one child agency, and editing its record.
  '**/src/__tests__/network-agency-detail.test.ts',
  // Truncates `tenants`, `roles`, `audit_logs`, `platform_admins` and both
  // upgrade tables: the upgrades catalog, requests and prices.
  '**/src/__tests__/upgrade-catalog.test.ts',
  // Each truncates `tenants` and `roles`: an agency's buyers with their
  // wallets, calls and top-ups, and branded tenants on their own domains.
  '**/src/__tests__/buyer-balances.test.ts',
  '**/src/__tests__/public-brand.test.ts',
  // Truncates `tenants`, `roles`, `users`, `audit_logs` and the platform admin
  // tables to seed NetEnroll, the Life Leads Plus white-label on its own
  // domain, two of its child agencies and an unrelated agency.
  '**/src/__tests__/white-label-domain.test.ts',
  // Truncates `tenants`, `roles`, `users`, `insurance_leads` and
  // `insurance_carrier_applications`: an application opening its customer.
  '**/src/__tests__/application-customer.test.ts',
  // Each truncates `tenants`, `roles` and `audit_logs`: buyers created and
  // saved without a publisher, and a publisher's stats against its Sales row.
  '**/src/__tests__/buyer-publisher-optional.test.ts',
  '**/src/__tests__/publisher-stats.test.ts',
  // Truncates `tenants`, `phone_numbers`, `number_charges` and `statements`:
  // the API's 1st-of-the-month run of billMonth and closeMonth.
  '**/src/__tests__/monthly-close.test.ts',
  // Truncates `tenants`, `roles`, `users`, `audit_logs`, `platform_admins` and
  // `agreement_envelopes` to seed an agency, a white-label owner and a platform
  // operator, then signs agreements end to end.
  '**/src/__tests__/agreements.test.ts',
  // Truncates `tenants`, `roles`, `users`, `audit_logs`, `platform_admins`,
  // the agreement tables and every sales workspace table to seed NetEnroll,
  // Life Leads Plus, its child, a second white-label and an ordinary agency.
  '**/src/__tests__/sales-workspaces.test.ts',
  // Truncates `tenants`, `roles`, `users`, `audit_logs`, `calls`,
  // `insurance_leads`, `insurance_carrier_applications`, the platform admin
  // tables and both quoter tables to seed two agencies, staff and a preview.
  '**/src/__tests__/fex-quote.test.ts',
  // Truncates `tenants`, `roles`, `users`, `insurance_leads`,
  // `insurance_activities` and both quoter tables to seed two agencies whose
  // agents quote CRM customers.
  '**/src/__tests__/fex-customer-quotes.test.ts',
  // Truncates `tenants`, `roles`, `audit_logs`, `platform_admins` and
  // `product_feedback` to seed Life Leads Plus, an unrelated agency and a
  // platform operator: Feedback & Roadmap's isolation and lifecycle.
  '**/src/__tests__/product-feedback.test.ts',
];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    // The database-backed suites go to the `forks` pool, which is configured
    // below to use a single process, so they run one after another. Everything
    // else stays on the default `threads` pool and keeps running in parallel --
    // serialising all 39 files to fix 5 of them would be a poor trade.
    poolMatchGlobs: DATABASE_BACKED.map(glob => [glob, 'forks'] as [string, 'forks']),

    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
