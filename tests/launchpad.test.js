import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isLaunchpadLive, createTokenForAgent, defaultCreateOnChain } from "../server/pumpfun.mjs";

// A throwaway keypair generated fresh for this test run only — never committed to git. A
// key-shaped file in version control trips (correctly) every secret scanner forever, even
// when the key itself is worthless, so this is generated at test time instead of checked in.
let fixturePath;
before(async () => {
  const { Keypair } = await import("@solana/web3.js");
  const kp = Keypair.generate();
  const dir = mkdtempSync(join(tmpdir(), "dotsbook-test-treasury-"));
  fixturePath = join(dir, "fake-treasury.json");
  writeFileSync(fixturePath, JSON.stringify({ publicKey: kp.publicKey.toBase58(), secretKey: Array.from(kp.secretKey) }));
});
after(() => { if (fixturePath) rmSync(fixturePath, { force: true }); });

test("launchpad is off by default", () => {
  delete process.env.LAUNCHPAD_LIVE;
  assert.equal(isLaunchpadLive(), false);
});

test("createTokenForAgent does nothing at all when the gate is off", async () => {
  delete process.env.LAUNCHPAD_LIVE;
  const result = await createTokenForAgent({ id: "a1", name: "Pip" });
  assert.deepEqual(result, { attempted: false });
});

test("the real on-chain call is not implemented in this codebase yet, and says so clearly", async () => {
  await assert.rejects(() => defaultCreateOnChain(), /not implemented/i);
});

test("when live, a failure in token creation never throws — it's reported, not raised", async () => {
  process.env.LAUNCHPAD_LIVE = "true";
  process.env.LAUNCHPAD_METADATA_URI_BASE = "https://example.com/meta";
  process.env.TREASURY_KEYPAIR_PATH = fixturePath;
  const boom = () => { throw new Error("network is down"); };
  const result = await createTokenForAgent({ id: "a2", name: "Ember" }, { createOnChain: boom });
  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
  assert.match(result.error, /network is down/i);
  delete process.env.LAUNCHPAD_LIVE;
  delete process.env.LAUNCHPAD_METADATA_URI_BASE;
  delete process.env.TREASURY_KEYPAIR_PATH;
});

test("when live but with no metadata URI configured, it fails cleanly without calling the network", async () => {
  process.env.LAUNCHPAD_LIVE = "true";
  process.env.TREASURY_KEYPAIR_PATH = fixturePath;
  delete process.env.LAUNCHPAD_METADATA_URI_BASE;
  let called = false;
  const shouldNotRun = () => { called = true; };
  const result = await createTokenForAgent({ id: "a4", name: "Reef" }, { createOnChain: shouldNotRun });
  assert.equal(result.ok, false);
  assert.match(result.error, /metadata URI/i);
  assert.equal(called, false);
  delete process.env.LAUNCHPAD_LIVE;
  delete process.env.TREASURY_KEYPAIR_PATH;
});

test("when live and everything succeeds, the mint address comes back", async () => {
  process.env.LAUNCHPAD_LIVE = "true";
  process.env.LAUNCHPAD_METADATA_URI_BASE = "https://example.com/meta";
  process.env.TREASURY_KEYPAIR_PATH = fixturePath;
  const fakeCreate = async ({ name, symbol }) => {
    assert.equal(name, "Halo");
    assert.equal(symbol, "HALO");
    return { mintAddress: "FakeMintAddress111111111111111111111111111" };
  };
  const result = await createTokenForAgent({ id: "a3", name: "Halo" }, { createOnChain: fakeCreate });
  assert.equal(result.ok, true);
  assert.equal(result.mintAddress, "FakeMintAddress111111111111111111111111111");
  delete process.env.LAUNCHPAD_LIVE;
  delete process.env.LAUNCHPAD_METADATA_URI_BASE;
  delete process.env.TREASURY_KEYPAIR_PATH;
});
