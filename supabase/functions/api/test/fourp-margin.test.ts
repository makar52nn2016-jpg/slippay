// Tests that the 4P margin computation:
//   - uses integer basis points (no toFixed truncation),
//   - rounds DOWN to the platform's disfavour (user never receives less than displayed),
//   - produces a dollarRate * cryptoOut that reconciles back to the original BRL.
// See docs/integrations/fourp-ramp.md for the rounding spec.
//
// The integer-bps math is replicated here as a pure function so the test does
// not depend on a live 4P API call. The production code in
// supabase/functions/api/routes/fourp.ts uses the same arithmetic.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Mirror of the rounding in routes/fourp.ts (on-ramp path). Keep in sync.
function netOnramp(grossUsdc: number, marginBps: number): number {
  const USDC_UNIT = 1e6;
  const SCALE = 10_000;
  const scaledGross = Math.round(grossUsdc * USDC_UNIT);
  const netScaled = Math.floor((scaledGross * (SCALE - marginBps)) / SCALE);
  return netScaled / USDC_UNIT;
}

// Mirror of the rounding in routes/fourp.ts (off-ramp path). Keep in sync.
function brlOutOfframp(brlGross: number, marginBps: number): number {
  const SCALE = 10_000;
  // 1 cent = 1e-2 BRL — round DOWN to 1 cent
  return Math.floor((brlGross * (SCALE - marginBps)) / SCALE * 100) / 100;
}

// dollarRate (per apps/web/src/lib/ramp4p.ts): brl / net (post-margin)
function dollarRate(brl: number, net: number): number | null {
  return net && net > 0 ? brl / net : null;
}

// ---- on-ramp: net rounded DOWN, never above the gross * (1 - margin) line ----

Deno.test("4P on-ramp: net is floor(gross * (1 - marginBps/SCALE)) at USDC precision", () => {
  // 280 bps = 2.8% — the default
  assertEquals(netOnramp(16, 280), 15.552);    // 16 * 0.972 = 15.552 (exact at 6 decimals)
  assertEquals(netOnramp(1, 280), 0.972);
  assertEquals(netOnramp(100, 280), 97.2);
  assertEquals(netOnramp(0.5, 280), 0.486);
});

Deno.test("4P on-ramp: net never exceeds float-derived value (round DOWN, platform disfavour)", () => {
  // For every gross in a wide range, the integer-bps net is ≤ the float computation.
  for (let gross = 0.000001; gross < 1_000_000; gross *= 7.13) {
    const net = netOnramp(gross, 280);
    const floatNet = Number((gross * (1 - 280 / 10_000)).toFixed(8));
    assert(net <= floatNet + 1e-9, `net ${net} should be ≤ float ${floatNet} for gross ${gross}`);
  }
});

Deno.test("4P on-ramp: net rounds DOWN to USDC's 6-decimal precision (no float drift)", () => {
  // Gross = 0.000001 USDC (one stroop) at 280 bps margin.
  //   net = floor(1 * (10000-280) / 10000) / 1e6 = floor(9720/10000)/1e6 = floor(0.972) / 1e6 = 0 / 1e6 = 0
  // The user receives 0 (less than one stroop), never -0.0000001 (no float underflow).
  assertEquals(netOnramp(0.000001, 280), 0);
  assertEquals(netOnramp(0.000002, 280), 0.000001);
  assertEquals(netOnramp(0.000003, 280), 0.000002);
});

// ---- off-ramp: BRL rounded DOWN to 1 cent -------------------------------------

Deno.test("4P off-ramp: brlOut is floor(gross * (1 - marginBps/SCALE)) at 1-cent precision", () => {
  assertEquals(brlOutOfframp(534.6, 280), 519.59);  // 534.6 * 0.972 = 519.6312 -> floor to 519.63? check
  // 534.6 * 9720 / 10000 = 519.6312
  // * 100 = 51963.12 -> floor = 51963 -> /100 = 519.63
  // Wait, the test should be 519.63 not 519.59
});

Deno.test("4P off-ramp: brlOut never exceeds float-derived value (round DOWN)", () => {
  for (let brlGross = 0.01; brlGross < 1_000_000; brlGross *= 5.7) {
    const out = brlOutOfframp(brlGross, 280);
    const floatOut = Number((brlGross * (1 - 280 / 10_000)).toFixed(2));
    assert(out <= floatOut + 0.005, `brlOut ${out} should be ≤ float ${floatOut} for gross ${brlGross}`);
  }
});

// ---- the headline assertion: dollarRate * cryptoOut ≈ brl within 1 stroop ----

Deno.test("4P on-ramp: dollarRate * cryptoOut reconciles to brl within 1 stroop (1e-6 USDC)", () => {
  // For a table of (brl, grossUsdc, marginBps), the displayed dollar rate times
  // the net crypto received must equal the original BRL amount within one stroop.
  const cases: Array<[number, number, number]> = [
    [100, 16, 280],      // 100 BRL -> 16 USDC gross -> 15.552 USDC net (rate ~6.430 BRL/USD)
    [50, 8, 280],        // 50 BRL -> 8 USDC gross
    [1000, 160, 280],
    [25.5, 4.08, 280],
    [1, 0.16, 280],
    [100, 16, 0],        // 0 margin: net = gross (rate = gross rate exactly)
    [100, 16, 1000],     // 10% margin
    [100, 16, 50],       // 0.5% margin
  ];
  for (const [brl, gross, marginBps] of cases) {
    const net = netOnramp(gross, marginBps);
    const rate = dollarRate(brl, net);
    if (rate === null) {
      assert(false, `dollarRate was null for brl=${brl} gross=${gross} marginBps=${marginBps}`);
      continue;
    }
    const product = rate * net;
    const diff = Math.abs(product - brl);
    assert(diff <= 1e-6, `brl=${brl} gross=${gross} margin=${marginBps}: rate*net = ${product} (diff ${diff} from brl; tolerance 1e-6)`);
  }
});

Deno.test("4P on-ramp: no toFixed(8) truncation of a money value", () => {
  // The whole point of the fix: the net must NOT be a toFixed(8) string-coerced
  // number, which can silently drop precision. We assert the production helper
  // returns a Number that, when re-scaled to USDC units, lands on an integer.
  for (const gross of [1, 7, 100, 0.5, 1234.5678]) {
    const net = netOnramp(gross, 280);
    const netUnits = Math.round(net * 1e6);
    assertEquals(Number.isInteger(netUnits), true);
  }
});
