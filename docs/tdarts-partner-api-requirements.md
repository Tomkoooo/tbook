# tDarts partner API — changes tbook needs

Written against the contract as it exists today in
`tdarts_torunament/packages/api-contracts/src/partner-schemas.ts` and the
route table in `tdarts_torunament/apps/api/src/app.ts`.

## What exists today

| Procedure | HTTP | Auth | Used by tbook |
|---|---|---|---|
| `partner.tournament.capacity` | `GET /partner/tournaments/{code}/capacity` | HMAC | no |
| `partner.enroll` | `POST /partner/tournaments/{code}/enroll` | HMAC | **yes** |
| `partner.enroll.lookup` | `GET /partner/enrollments/{idempotencyKey}` | HMAC | no |

tbook signs every request as `HMAC-SHA256(secret, "{timestamp}.{rawBody}")`
in `X-Signature`, with `X-Client-Id` and `X-Timestamp`, and passes
`Idempotency-Key: <orderId>` on enrol. That part works and needs no change.

## The gap

`partner.enroll` is **create-only and idempotent on `orderId`**. Once a
participant is enrolled there is no way to:

1. **Correct their details.** An org manager fixing a misspelled name, a
   typo'd email, or a wrong birth date in tbook has no way to push that to
   the tournament roster. Re-calling `enroll` with the same `orderId` is a
   no-op by design (`alreadyRegistered: true`), and calling it with a new
   `orderId` would enrol the person a second time. `partnerEnrollPartnerSchema`
   even documents `birthDate` as "only ever set on first account creation,
   never overwritten", confirming updates are out of scope today.

2. **Withdraw them.** When a booking is cancelled or refunded, tbook voids
   the vouchers and releases its own capacity, but the player stays on the
   tDarts roster — occupying a slot and appearing in the draw. This is the
   more damaging of the two: a cancelled entry silently keeps a place that
   a waiting-list player should get.

3. **Reconcile.** There is no way to ask "who does tDarts think is enrolled
   under my client id for tournament X?", so tbook cannot detect or repair
   drift after a partial failure.

Right now tbook surfaces (1) to the org manager as a
`tdartsResyncRequired` warning on the booking, and cannot act on (2) at
all.

## Requested changes

### 1. `partner.enroll.update` — amend an enrolment

```
PATCH /partner/tournaments/{code}/enrollments/{idempotencyKey}
```

Addressed by the `idempotencyKey` (tbook's `orderId`) already used on
enrol, so no new identifier has to be stored on either side. `playerId`
would also work if you prefer.

```ts
export const partnerEnrollUpdateInputSchema = z.object({
  tournamentCode: z.string().trim().min(1).max(16),
  idempotencyKey: z.string().trim().min(1).max(128),
  // All optional — only the present fields are applied.
  email: z.string().trim().email().transform((v) => v.toLowerCase()).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  country: z.string().trim().min(2).max(2).optional(),
  birthDate: z.string().date().optional(),
  teamName: z.string().trim().min(2).max(120).optional(),
  /** Pair-mode only: amend the second member. */
  partner: partnerEnrollPartnerSchema.partial().optional(),
});

export const partnerEnrollUpdateResultSchema = z.object({
  playerId: z.string(),
  tournamentCode: z.string(),
  rosterStatus: z.enum(['applied', 'waiting']),
  /** Field names actually changed, so the caller can log precisely. */
  updated: z.array(z.string()),
});
```

Semantics we need:

- **Idempotent.** Re-sending the same values is a success with
  `updated: []`, not an error.
- **Changing `email` must not create a second user.** If the new address
  already belongs to another tDarts account, please fail with a distinct,
  machine-readable code (e.g. `EMAIL_BELONGS_TO_ANOTHER_USER`) rather than
  merging accounts — tbook will surface that to the org manager for a
  human decision.
- **`birthDate` should become amendable** at least while the tournament has
  not started. Today's "never overwritten" rule means a typo is permanent.
- Rejecting the update once the tournament has started (or the player has
  played a leg) is fine and expected — just return a distinct code
  (`TOURNAMENT_ALREADY_STARTED`) so tbook can tell the manager *why*
  instead of showing a generic failure.

### 2. `partner.withdraw` — remove an enrolment

```
DELETE /partner/tournaments/{code}/enrollments/{idempotencyKey}
```

```ts
export const partnerWithdrawInputSchema = z.object({
  tournamentCode: z.string().trim().min(1).max(16),
  idempotencyKey: z.string().trim().min(1).max(128),
  reason: z.enum(['cancelled', 'refunded', 'no_show', 'other']).default('cancelled'),
  note: z.string().trim().max(500).optional(),
});

export const partnerWithdrawResultSchema = z.object({
  playerId: z.string(),
  tournamentCode: z.string(),
  /** False when it was already withdrawn — still a 200. */
  withdrawn: z.boolean(),
  /** True if a waiting-list player was promoted into the freed slot. */
  promotedFromWaitingList: z.boolean(),
});
```

Semantics we need:

- **Idempotent.** Withdrawing twice is a success with `withdrawn: false`,
  so a retry after a network timeout is safe.
- **Frees the slot**, and ideally promotes the next waiting-list player —
  that promotion is the main reason this endpoint matters.
- A withdrawal after the draw has been made may well be refusable; again,
  a distinct code (`DRAW_ALREADY_MADE`) rather than a generic error, so
  tbook can tell the manager to sort it out with the organizer.
- Whether the player account survives is entirely your call; tbook only
  needs the roster slot released.

### 3. `partner.enrollment.list` — reconciliation (nice to have)

```
GET /partner/tournaments/{code}/enrollments
```

Returns the enrolments created by the calling client id:
`{ idempotencyKey, playerId, name, email, rosterStatus, withdrawnAt }[]`,
cursor-paginated. This lets tbook run a drift check after an outage instead
of guessing. Lower priority than 1 and 2 — we can live without it.

## Auth and errors

- Both new mutations are `partner.*` mutations, so they fall under the
  existing `requirePartnerHmac` rule in `app.ts` with no change.
- Please keep the `apiTier: 'partner-enroll'` / `callerClasses:
  ['partner.enroll']` classification, so our existing partner credential
  keeps working without a re-issue.
- For every refusal, a stable `code` in the error body matters more than
  the message. tbook shows these to a non-technical org manager, and a
  generic 400 becomes "tDarts rejected this" with no actionable detail.

## What tbook will do once these land

- `partner.enroll.update`: called automatically when an org manager edits
  an attendee's name/email/birth date on a booking that is already synced,
  replacing today's `tdartsResyncRequired` warning banner.
- `partner.withdraw`: called automatically from the admin cancellation
  path, next to the existing voucher-voiding and capacity release, so a
  cancelled entry stops holding a tournament slot.

Both will be registered the same way the current enrol is — best-effort,
per-participant status recorded on `booking.tdartsSync`, never allowed to
fail the booking operation that triggered them.
