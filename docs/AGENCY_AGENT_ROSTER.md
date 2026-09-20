# The agency's agent roster

This is the change that lets an agency add its own agents and have them
actually receive calls, without NetEnroll in the loop for each one.

---

## 1. What was wrong

Setting up one agent meant four separate things, in four places, and **two of
them had no agency-facing surface at all**:

| Step | Where it lived | Who could do it |
| ---- | -------------- | --------------- |
| Invite the agent | `POST /api/v1/auth/activation-grants` | The agency — but the token came back in the response with a comment saying "send it to the invitee", and **nothing sent it**. The owner copied it into a text message. |
| Record licensed states | `PATCH /api/v1/users/:userId` | The agency, on the Users page. |
| Give them a SIP identity | nowhere | Allocated silently on the agent's first softphone fetch. No screen showed it. |
| **Put them in a call pool** | **nowhere** | **NetEnroll staff only** — somebody had to hand-build a `BuyerEndpoint` and attach it to the campaign, on `/buyers` and `/campaigns`, which `lib/staff-only-routes.ts` keeps out of the agency portal. |

The last row is the one that broke the product model. `CampaignAgent` has been
in the schema since it was written, carrying a doc comment calling it "the
dialer's hot read" — and it was **referenced by nothing**. No API, no UI, and
`services/routing.ts` never read it. An agency could add users all day and none
of them would ever ring, with nothing on any screen saying why.

---

## 2. What this adds

### `CampaignAgent` is now real

`services/routing.ts` reads `campaign_agents` alongside the campaign's buyer
endpoints and turns each assignment into a destination at that agent's SIP
extension.

**It is a source of destinations, not a second routing system.** Those rows
join the endpoint list *before* every existing gate, so an agent reached this
way is held to exactly the same rules as one reached through a buyer endpoint:

- the accepted-state filter,
- the **licensed-state gate** — assignment is not a licence,
- the per-agent **concurrency limit**,
- and `status = ACTIVE` on the account.

An agent with no usable softphone is not a destination at all. That means no
credential, a `REVOKED` one, or a **reservation** — a claimed extension with a
`NULL` password, which cannot authenticate and so cannot register. Ringing one
is a call into silence; the roster screen shows that agent as "Has not opened
the softphone yet", which is the same fact in a form somebody can act on.

### The invitation is sent

`services/agent-invite-email.ts` emails the sign-in link. The link is
`{APP_URL}/login?activation=<token>&email=<address>` — the two parameters
`app/login/page.tsx` already reads.

It is **best-effort and never fails the invitation**. The grant is written
first and is valid whether or not SMTP is; a send failure is caught, logged and
reported. The response still carries the token, and now also `emailed` and
`emailFailureReason`, because when the send fails that token is the only copy
of a grant that cannot be retrieved again — hand-delivery is the fallback, and
an owner who was told nothing would assume the agent had been contacted and
wait.

### One screen that answers "why is this agent not getting calls"

`/settings/agents`. Invite, licensed states, SIP extension, concurrency and
campaign assignment in one table.

That question had **five** possible answers and four of them were invisible.
The server computes the blocking one, in this order:

1. Has not accepted their invitation yet
2. Account is not active
3. No licensed states recorded
4. Not assigned to a campaign
5. Has not opened the softphone yet

**Earliest wins, deliberately.** Granting a campaign to an agent with no
licence changes nothing, so naming the campaign first sends somebody to do work
that has no effect. An agent with nothing blocking them shows their live
softphone status instead, which is the only thing left that decides whether the
next call rings.

A blocking reason **outranks** a live status on the screen: an agent who is
"available" on a softphone but assigned to no campaign is not available for
anything, and showing the green word would be the screen lying.

---

## 3. Deploying it

**No migration.** `CampaignAgent` and its table already exist — that is the
point; nothing was reading them. This is API and UI only.

Set `APP_URL` so invitation links point at the right portal. It defaults to
`https://agents.netenroll.com`, and it is the same variable
`cli/platform-admins.ts` already reads, so the two agree on the address.

SMTP is the existing `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD`
/ `SMTP_FROM` set that billing notifications and publisher welcome mail already
use. With none of it configured, invitations still work — the dialog says
plainly that the agent was not emailed and shows the link to copy.

---

## 4. Adding an agent, end to end

1. **Agents → Add agent**, enter their email. They are emailed a link.
2. They open it and set a password. The row leaves `PENDING`.
3. **Set their licensed states** on the roster. Until this, they are routed no
   state-identified call and served no lead — default-deny, by design.
4. **Turn them on for a campaign.** With one campaign, this is a single switch.
5. They open the app once. The softphone fetches its credential, which
   allocates their extension and password.

After 5, "Taking calls" shows their live status and the next matching call can
ring them.

---

## 5. What this does NOT do

- **It does not let an agency create campaigns.** Campaigns stay NetEnroll's;
  the agency chooses which of its own agents work the ones it has. An agency
  with no active campaign sees a notice saying so.
- **There is still no per-agent schedule.** `AgencyProfile` carries delivery
  days and hours for the whole agency; routing knows only licence and
  concurrency, so an agency running two shifts cannot express it.
- **Routing still does not check softphone registration.** It gates on
  concurrency and deliberately ignores the stale presence flag, so a call can
  still be sent to an agent whose browser never registered. The roster screen
  now makes the "never opened the softphone" case visible, which is the
  reporting half of that problem, not the routing half.
- **Team KPIs are still single-day.** `getAgentBreakdown` takes one calendar
  day; there is no week, month or trend.
