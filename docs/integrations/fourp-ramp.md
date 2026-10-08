# 4P Finance ramp integration · Slippay

- **status:** shipped · margin math hardened in #109
- **commit:** see `supabase/functions/api/routes/fourp.ts` and `apps/web/src/lib/ramp4p.ts`
- **bounty:** [Bounty: $75] Fix 4P quote margin rounding exposing a rate mismatch (#109)
- **adjacent:** `x402.md` (same `docs/integrations/` directory)

## what the 4P ramp is

[4P Finance](https://4p.finance) is a Brazilian PSP for `Pix <-> crypto`:
on-ramp sends stablecoin directly to a wallet you pass (non-custodial for
the buyer), off-ramp converts crypto to Pix. Auth is a single `x-api-key`
header that lives only server-side. The Slippay integration lives in
`supabase/functions/api/routes/fourp.ts`; the browser-facing client is
`apps/web/src/lib/ramp4p.ts`.

## how the margin is applied

Slippay takes a spread on every 4P quote, configured by
`FOURP_MARGIN_BPS` (basis points; default `280` = 2.8 %, capped at
`1000` = 10 %). The spread is applied to the **crypto side** of the quote
for on-ramp, and to the **BRL side** for off-ramp.

### on-ramp (BRL → crypto)

```text
net_usdc  = floor( gross_usdc * (10_000 - marginBps) / 10_000 , at USDC's 6-decimal precision )
dollarRate = brl / net_usdc                  # so rate * received == brl exactly
```

Concrete, for `brl = 100`, `gross = 16 USDC`, `marginBps = 280`:

```text
scaledGross  = round(16 * 1e6)              = 16_000_000   # integer USDC units
netScaled    = floor(16_000_000 * 9_720 / 10_000) = floor(15_552_000) = 15_552_000
net          = 15_552_000 / 1e6             = 15.552 USDC
dollarRate   = 100 / 15.552                 = 6.4304… BRL per 1 USDC (net)
rate * net   = 6.4304… * 15.552             = 100.0 (exactly, by construction)
```

### off-ramp (USDC → BRL)

```text
brlOut = floor( brl_gross * (10_000 - marginBps) / 10_000 , at 1-cent precision )
```

BRL has 2 decimal places (1 cent = `0.01`), so the result is rounded DOWN
to the nearest cent.

## rounding direction

**Round DOWN, in the platform's disfavour.**

- The user never receives **less** crypto (on-ramp) or **less** BRL (off-ramp)
  than the UI shows. The platform eats any sub-stroop / sub-cent dust.
- Equivalently: the displayed `dollarRate * cryptoOut` always reconciles back
  to the original BRL amount within one stroop (`1e-6` USDC) or one cent
  (`1e-2` BRL) — by construction, never by luck.

## why not `toFixed(8)`?

`Number((gross * (1 - marginBps / 10_000)).toFixed(8))` was the original
implementation. Two problems:

1. **Truncation, not rounding.** `toFixed` truncates to 8 decimals — fine
   for display, but the result is then re-parsed into a `Number` and shipped
   as the actual quote. A user receiving 15.55199999 USDC sees the same
   `15.552` rate as a user receiving 15.55200001 USDC; the displayed rate no
   longer matches the received amount.
2. **Float drift.** `1 - 280 / 10_000` is not exactly representable in IEEE
   754. Multiplying through and truncating compounds the error.

Integer basis points avoid both:

```text
scaledGross  = round(gross * 1e6)              # integer
netScaled    = floor(scaledGross * (10_000 - marginBps) / 10_000)
net          = netScaled / 1e6                 # back to a Number, integer-valued in USDC units
```

Every intermediate value is an integer; the final divide is exact.

## verification

`supabase/functions/api/test/fourp-margin.test.ts` asserts:

- `net = floor(gross * (1 - marginBps / SCALE))` at USDC precision,
- `net` never exceeds the float-derived value (round DOWN, platform disfavour),
- `dollarRate * cryptoOut == brl` within one stroop (`1e-6` USDC) for a table
  of amounts,
- `net`'s USDC-unit representation is always an integer (no float drift).

Run locally:

```bash
cd supabase/functions/api
deno test --allow-all --no-check test/fourp-margin.test.ts
```

The same assertions run in CI under the `test` job in
`.github/workflows/test.yml` (the API edge function tests step).
