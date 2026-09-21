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

## 5. Calls are no longer sent to phones that are not there

Routing gated an agent on their live call count and nothing else. The comment
in `routing.ts` explains why, and it was right:

> We deliberately do NOT exclude an agent merely for being offline or DND — the
> availability flag is often stale and over-blocks transfers.

That flag is written by the browser and goes stale when a tab closes or a
laptop sleeps, so excluding agents on it silenced people who were sitting there
ready. But the cost of ignoring it is recorded in `routes/agent-phone.ts`: an
agent on a network that blocked 7443 fetched credentials fine, never opened the
WebSocket, never sent a REGISTER, *"and every call to them died with
USER_NOT_REGISTERED while the dashboard still showed them available."* Those
calls reached nobody **and** were not offered to an agent who could have taken
them.

Both failures come from asking the wrong thing. FreeSWITCH's registration table
is the right one — it is the same fact the dialplan consults with
`sofia_contact` before it bridges, and it cannot go stale in the direction that
matters, because an expired registration is removed.

`services/telephony/sip-registrations.ts` reads it **once per routing decision**
and caches the parsed set in Redis for a few seconds, so a burst of calls shares
one ESL lookup rather than one per agent per call.

**"Cannot tell" is never "nobody is registered."** Every failure path — ESL
unreachable, a parse that finds nothing, a wrong profile name — returns `null`,
and `null` means *do not filter*. Excluding every agent on the strength of an
ESL blip would be an outage dressed up as a safety feature. The gate only ever
excludes an extension FreeSWITCH positively says it does not have.

Tunable with `FREESWITCH_INTERNAL_PROFILE` (default `internal`) and
`SIP_REGISTRATION_CACHE_TTL_SECONDS` (default `5`).

---

## 6. The team view takes a date range

`GET /api/v1/delivery/agents/range?from=YYYY-MM-DD&to=YYYY-MM-DD`, and
`&format=csv` to take it away.

`getAgentBreakdown` takes one calendar day, so "how did my team do this week"
had no answer. (`/api/v1/applications/summary` does take a range and breaks
down by agent, but carries no call counts — so it cannot produce a closing
percentage, which is the figure the business is measured on.)

This is a **separate function**, not a parameter on the day view. The day view
sits on the screen an agency's price is explained from and carries live
presence and seconds-available, neither of which means anything across a week;
widening it in place would put every figure on that screen at risk to answer a
different question.

It uses the Phase 2 predicates verbatim, so a week's figures sum the days that
compose it. It sorts by applications **descending** — the opposite of the day
view, which is a work list leading with who needs coaching; this is a period
report and the question is what the team produced. Nulls stay null: a closing
percentage with no delivered calls behind it is an absent measurement, and the
CSV writes an empty cell rather than a fabricated `0` that a spreadsheet would
average.

A reversed range is refused rather than silently swapped — on a report somebody
may be paying people from, quietly returning days they did not ask for hides
the bug.

---

## 7. Each agent has their own working hours

`agent_schedules`: days (`MON`..`SUN`), a start time and an end time, in the
agency's `deliveryTimeZone`. Set from the roster screen.

`AgencyProfile` carries delivery days and hours for the **whole agency**, and
routing knew nothing about hours at all — it gated on licence, registration and
concurrency and nothing else. An agency running two shifts could not express it,
so an agent who finished at 2pm kept being rung at 7pm: the call reached a phone
nobody was sitting at, and was not offered to the agent who was.

**Absence is not a constraint.** An agent with no row is not restricted, and
there is deliberately **no backfill** — not even the agency's own delivery
window. The agency window is a billing concept, not a staffing one; applying it
as a routing gate would silence every agent who works outside it the moment this
deployed, with nothing on any screen explaining why the phones went quiet. Same
posture as the licence gate: enforce what you have been told, never invent a
constraint from the absence of data. An unresolvable timezone and a malformed
time also enforce nothing.

**Three states, not two:**

| | Means | Routing |
| --- | --- | --- |
| No schedule (`DELETE`) | Hours are not enforced | Routable whenever else allows |
| `days: []` | On leave | Routed nothing |
| `days: [...]` + times | Works those hours | Gated on them |

Clearing is its own verb rather than a `PUT` with a `null` body, because a JSON
`null` body is not reliably distinguishable from *no* body — `apiClient.put(url,
null)` in the web app sends nothing, since `null` is falsy. An endpoint whose
"clear" case rested on that distinction would clear on a malformed request and
refuse a well-formed clear.

**Overnight shifts work.** `startTime` after `endTime` is a night shift (21:00
to 05:00), not a mistake, and `days` names the day the shift **starts** on. The
early-hours half is the one a naive implementation drops, which would silence
every night-shift agent between midnight and their end time — the busiest part
of their shift. `startTime === endTime` is a 24-hour day.

There is **no per-agent timezone**: the agency's `deliveryTimeZone` is the clock
its billing day is measured on, and a second one per agent would be a second
answer to "what time is it here" that could disagree with it. The roster screen
states which zone the times are in rather than letting anyone assume their own.

---

## 8. Every application is tied to the call that produced it

`insurance_carrier_applications.callAttribution`, resolved server-side.

The closing percentage prices every agency, and its two sides were **correlated
by agent and day** rather than joined: delivered calls through
`Call.answeredByUserId`, submitted applications through `createdById`. That
answers "this agent took 40 calls and wrote 4 applications" and cannot answer
"which call became this application" — so an agency disputing the figure that
sets its price had nothing to drill into.

`callId` existed and was barely used: optional, so the form almost never sent
it, and verified only against the **tenant**. That check was correct and is why
another agency's call never reached the column — but it did not check that the
call belonged to the submitting **agent**, so an agent could attribute their
application to a colleague's call, and the per-agent closing percentages a
principal decides coaching and pay from would describe the wrong people.

| | Meaning |
| --- | --- |
| `CLIENT` | The agent's form named the call, and it is this agency's **and** was answered by this agent |
| `INFERRED` | Matched to the agent's own most recent answered call, within a window (default 30 min, `APPLICATION_CALL_INFERENCE_WINDOW_MS`) |
| `NONE` | Nothing could be tied to it — a callback, paper, or hours later |

`INFERRED` is stored apart from `CLIENT` because it can be wrong in a knowable
way: an agent who hangs up, takes a second call and then writes the *first*
caller's business is matched to the second. A dispute over a price has to tell a
claim the agent made from one the server inferred.

A named call that is **not this agent's is refused**, not quietly downgraded —
substituting a different call would write a plausible-looking row for something
nobody asked for, and the caller would never learn their link was wrong. An
inference that cannot run returns `NONE` rather than failing the application:
the row is what the agency is measured on; the link is a convenience for reading
it afterwards.

**Existing rows all read `NONE`, including ones that carry a `callId`.** Running
the inference over history would be guesswork producing rows indistinguishable
from evidence, on the one measurement an agency can dispute. A column of honest
`NONE`s is worth more than one of plausible fabrications.

---

## 9. The team range report has a screen

`/delivery/team` — presets for the last 7 days, last 30 days and this month, a
date pair, and CSV.

Separate from `/delivery`, which is a **live panel** beside today's block and
tonight's rate and whose per-agent table sorts **ascending** (worst closer
first) because it is a work list: who to coach today. This is a period report;
it sorts descending, carries no rate and no money owed, and nothing on it moves
during the day. One screen doing both would have a table whose sort order
silently meant two different things depending on the dates above it.

Em dashes, never zeroes — this is a screen somebody may decide pay or headcount
from, and a fabricated 0% reads as a measurement.

---

## 10. An agent can turn their own phone off

`users.availableForCalls` (default `true`) and `users.availabilityChangedAt`.
Read and written by the agent at `GET`/`PUT /api/v1/agent/availability`, and
obeyed by `services/routing.ts` as the first of the per-agent gates.

An agent had **no working way to stop calls reaching them**, while two controls
looked like they did it:

1. The Available/Away/On-call dropdown in the call-centre header was bound to a
   React `useState` in `CallCenterPortal` and was never sent anywhere. It did
   drive the large banner at the top of the console, so an agent who picked
   "Away" read AWAY in capitals across their screen while calls carried on
   ringing their phone. It is removed.
2. `AgentStatusSelector` does reach `PUT /api/v1/agent/status`, which writes
   `agent:status:<id>` in Redis — but routing deliberately ignores that key, and
   says why: it is browser-inferred state that goes stale when a tab closes.
   Worse for an agent trying to step away, the softphone writes `'available'`
   unconditionally on SIP registration and on every reconnect, so a transport
   blip silently undid their choice. The key also carries a 24-hour TTL.

So an agent at lunch, on a break or finishing paperwork kept being rung, and the
call went to somebody who could not take it instead of to somebody who could.

**Why a new column rather than making routing read the presence key.** The two
answer different questions, and the presence key is still the right answer to
its own: what is this agent's softphone doing right now, for the live view and
the availability-seconds figure on the delivery page. That one is inferred and
overwritten automatically. This one is a deliberate, durable act by the agent —
nothing automatic writes it — which is exactly what makes it safe to route on.
Both are shown, side by side, because both are worth knowing.

**Absence is not a constraint**, again. The column defaults to `true`, so every
existing agent stays on the queue when this deploys; a default of `false` would
take the whole platform off the queue at once. An unreadable value is not "off"
— the screens render the switch as on, because routing rings an agent it has
not been told to stop ringing. The routing gate and the roster both test
`=== false`, never `!value`.

**It stays usable during a call.** The control it replaced disabled itself while
a call was up, which is exactly when an agent reaches for it ("this is my last
one"). Turning off never touches the call in progress; it stops the next one.

**Only a boolean toggles it.** A string body is refused rather than coerced:
`'false'` is truthy, and coercing it would turn an agent's phone *on* while they
were looking at the word "false".

Toggling writes an `on-queue` / `off-queue` agent state event — its own status
strings, so a supervisor can tell a deliberate step-away from a tab closing —
and the console banner reads the real value: **Not taking calls**, in the
blocked colour, only when the server says so.

On the roster screen it answers the question that screen exists for. The API
now returns `blockedBy` beside `blockedReason` — the same fact, machine-readable,
so a client never has to branch on a sentence written to be read — and the
readiness cell renders `UNAVAILABLE` as a muted **Phone off · Sep 21, 12:30**
rather than the amber warning used for setup faults. An agent who stepped away
is correctly configured, and a warning triangle would send an owner looking for
a problem that is not there. The order matters too: `UNAVAILABLE` is the LAST
blocker checked, so an agent who is off *and* has no campaign still shows the
campaign, in amber — that one is the owner's to fix and will still be there when
the agent comes back.

---

## 11. Every call, with the agent who took it

`GET /api/v1/calls` and `GET /api/v1/calls/export.csv`, on the ledger at
`/calls`.

The ledger could show every call and could not show **who took any of them**.
It returned `createdBy` — whoever caused the ROW to exist, which for an inbound
call routed to the floor is the inbound handler, so null — and never
`answeredByUserId`, which is who picked the phone up and is what the per-agent
table and the closing percentage are built on. There was no agent column, no
agent filter, and no disposition column: the table showed the free-text call
notes and not the canonical outcome beside them.

The agent's own list was worse than incomplete. The sidebar calls it *"My
calls — narrowed server-side to the ones you took"*, and it was narrowed to the
calls they **created** plus the phone numbers assigned to them. An agent taking
inbound calls on a softphone satisfies neither: the row is created by the
inbound handler, and the DID belongs to the agency, so `userNumbers` is empty
for the entire floor. The one list an agent opens every day showed everything
except the calls they answered — and the call detail refused them for the same
reason, so a call could appear in their own figures and then 403 when they
clicked it to re-read their notes.

**Attribution had one writer.** `POST /api/v1/agent/calls/:callId/answer`, the
softphone answer handler. Every other route to a disposition left
`answeredByUserId` null — including the disposition save that CREATES a call
row, so an agent who wrote up a call nothing had tracked produced a row that
counted for nobody. The disposition endpoints now fill it **only when it is
null**: a supervisor correcting a write-up can never take a call off the agent
who answered it, because the answer handler's record is a fact and this is a
guess.

**It moves no money.** A delivered call is INBOUND, not blocked, with
`answeredAt` in the window — see `rating/measurement.ts` — and none of those
three are touched. `answeredAt` in particular is deliberately NOT stamped on a
disposition save: that endpoint is reachable by any agent on the floor, and
stamping it would let writing calls up mint billable delivered calls out of
nothing. What changes is which agent a call *already in the agency's total* is
credited to, so the per-agent rows still reconcile with the agency total.

**The name is resolved tenant-scoped**, in one indexed read per page, rather
than through a foreign key. The column was backfilled from a JSON key written
by an older softphone and can name a deleted user, so the constraint is a
migration that can fail on live data — and the lookup buys a property the
relation would not: a stale id from another agency resolves to nothing instead
of printing that agency's employee on this agency's ledger.

Unattributed is **its own reading** everywhere — the table, the detail drawer
and the CSV, which writes `Unattributed` rather than an empty cell. A blank
says "nobody took this call", which is a claim about the call; the truth is a
claim about what was recorded, and a floor lead acts differently on each.

`blockedBy`-style machine readability applies here too: `?agentId=` and
`?disposition=` filter the list and the export, `disposition=NONE` answers
"which calls has nobody written up yet" (which leaving the parameter off cannot
express, since that means *all* calls), and an `agentId` from a non-principal
is **dropped, not honoured and not refused** — their list is already their own
calls, refusing would break a link shared from a principal's screen, and
honouring it would be one agent reading another's calls on a floor where the
closing percentage decides pay.

Each agent's name on the team report now links to that agent's calls **over the
same window**, which is the drill-down that screen never had: it showed a
closing percentage with no way to read the calls behind it.

One thing fixed in passing: the ledger's column-visibility map was read out of
`localStorage` **wholesale**, so any column added after a user's last visit read
as `undefined` and rendered hidden — permanently, for everyone who had ever
opened the page, with nothing on screen to say it existed. It is merged under
the defaults now (`lib/call-column-visibility.ts`), so a choice is kept and a
new column arrives at its default.

---

## 12. "Application submitted" has to carry the application

`POST /api/v1/calls/disposition` now takes the application in the same request,
and refuses the disposition without it.

`APPLICATION_SUBMITTED` is not a note an agent leaves on a call. It is the
**numerator of the closing percentage that prices the agency**, and it spends a
credit off the balance the agency bought. It was saved in **two requests**: the
disposition first — because the browser holds a session id, not a `Call` row,
and that endpoint is what resolves one — then the application with the id that
came back.

Anything failing between them left a call **labelled as a sale with no sale
behind it**. The agent saw "saved". The numerator never moved, no credit was
spent, and the agency's measured closing percentage sat below its real one —
which on the rate curve is a **higher price per application**. The failure
quietly charged the agency more for business it had actually written.

Both screens guarded against it. **Only the screens**: the API accepted
`APPLICATION_SUBMITTED` from anything — a script, an integration, the next
screen somebody builds — with nothing attached.

**One request now, and the order inside it is the point.** The server resolves
the call, records the application against it, and writes the disposition
*last*. A refused application refuses the disposition with it, so the label
cannot exist without the sale. On a call that was never tracked the row is
created bare, the application goes on, and only then is it marked — a single
create carrying the disposition would write the label before the sale existed.

**An application on any other disposition is refused, not ignored.** Dropping
it silently loses business the agent believed they recorded; recording it puts
a sale in the numerator against a call the agent marked "not interested".

**The after-the-fact edit cannot invent one either.** `PATCH
/api/v1/calls/:callId/disposition` is the correction path — it has no
application on it and cannot record one — so it refuses
`APPLICATION_SUBMITTED` unless a submitted, non-voided application is already
linked to that call. Non-voided, because a voided application is not one: the
measurement drops it from the numerator and this has to agree with the
measurement.

**There are two ways in, and both still work.** A sale reaches the numerator
either from a call disposition (`APPLICATION_SUBMITTED`, which now carries the
application) or **standalone**, with no call attached — a callback taken on the
agent's own phone, a follow-up that closed, an application submitted the
morning after the call that produced it. The standalone path is
`POST /api/v1/applications` and the guard above never touched it: the refusal
is about sending an application *alongside a disposition that is not a sale*,
on the disposition endpoint, and it has nothing to say about one sent on its
own.

That second door existed but had exactly one handle — the header of the
call-centre console. An agent sitting on the Applications page, looking at the
list of business they wrote, could not add the one they had just written; the
page carried an Export button and nothing else. `/applications` now carries a
**Log an application** button opening the same form, and the list reloads on
save so the agent sees the row rather than trusting that it landed. Business
written and never recorded understates the closing percentage, and a lower
closing percentage is a higher price per application: a missing button is a
bill.

**Required is required, in one place.** The field list moved out of
`routes/applications.ts` into `services/applications/input-schema.ts`, so the
two endpoints that accept an application validate identically. Two copies would
drift, and the drift is not symmetric — an endpoint accepting a thinner
application lets in rows an agency cannot reconcile, and one refusing rows that
should have counted quietly raises what the agency pays.

Required: `carrier`, `faceAmount`, `modalPremium`, `firstName`, `lastName`.
`paymentMode` is the one field that defaults (to `MONTHLY`), because
`annualizePremium` needs a mode. Strings are **trimmed before they are
measured**: `z.string().min(1)` accepts a single space, which writes a blank
onto the row and prints as an empty cell on the screen an agency reconciles
against carrier statements.

`firstName` in particular was **not** required before. The form substituted the
last name for a blank first name, so applications landed reading "Quintero
Quintero" — unmatchable against a carrier statement, on a row the agency was
charged a credit for. Both names are required now, and the five fields the save
is gated on are marked on the form, which previously said nothing about which
ones they were.

Saving twice is still one application and one credit: `clientRequestId` is
generated when the form mounts and reused on every retry, so the second write
is a `P2002` and `recordAgentApplication` answers with the row that already
exists.

---

## 13. What this does NOT do

- **It does not let an agency create campaigns.** Campaigns stay NetEnroll's;
  the agency chooses which of its own agents work the ones it has. An agency
  with no active campaign sees a notice saying so.
- **No holidays or one-off exceptions.** A schedule is a weekly pattern; an
  agent off next Thursday has to be handled by clearing their days and putting
  them back, which is blunt. The availability switch covers the short version
  of this — a break, an afternoon — but it is manual and does not come back on
  by itself.
- **The availability switch has no timer and no auto-reset.** An agent who
  turns off at lunch and forgets is off until they turn back on. There is no
  "back in 30 minutes", and nothing turns them on at the start of their next
  shift.
- **An agency owner cannot flip it for an agent.** The endpoint is the agent's
  own. The roster screen *shows* who is off and since when; it has no control
  to put somebody back on the queue, deliberately — an owner overriding an
  agent's own "I am not at my desk" delivers a call to an empty chair.
- **Attribution is not backfilled.** Calls answered before this shipped, on any
  path other than the softphone answer handler, stay unattributed. They read as
  `Unattributed` on the ledger rather than being guessed at after the fact.
- **The ledger does not group or total.** It is a list: one row per call, with
  filters and an export. The per-agent totals live on the team report, and the
  link between them runs one way — a name there opens that agent's calls here.
- **`disposition` is still a string, not an enum.** `VALID_DISPOSITIONS` in
  `routes/index.ts` is enforced on the write path and mirrored by
  `DISPOSITION_LABELS` on the screen, but nothing in the database stops a
  direct insert writing something else. An unrecognised value renders verbatim
  rather than being hidden, so the screen cannot quietly disagree with the
  row.
- **Nothing backfills the calls already marked as sales.** A call carrying
  `APPLICATION_SUBMITTED` from before this change, with no application behind
  it, stays as it is. Writing the missing applications would be inventing
  business, and voiding the dispositions would be erasing an agent's record of
  a call they did work.
- **The credit is still spent outside the write.** `consumeCreditForApplication`
  runs after the application row lands, not in its transaction, and swallows
  its own failure — deliberately, because the business is already written at
  the carrier and a ledger hiccup must not refuse a submission that happened.
  `reconcileDeliveryDay` writes the missing row that evening. So the
  application is guaranteed; the ledger row is guaranteed by nightfall.
- **`LIVE_TRANSFER` carries nothing.** It is in the disposition list and reads
  like business, but it is not a submitted application and nothing here asks it
  for one.
- **Nothing reads `callAttribution` on a screen yet.** It is on the API and in
  the database, and the applications page shows the call id, but there is no
  drill-down from a closing percentage to the calls behind it.
- **The measurement still counts by agent and day.** `getAgentBreakdown` and the
  range report group by `answeredByUserId` and `createdById` as before; the new
  column makes the join *possible* without changing what prices an agency.
