// Launchpad scaffolding: wires an agent's registration up to a token-creation step, gated off by
// default. The actual call that builds/signs/sends a real Solana transaction is NOT implemented
// here — that specific piece needs a human to write and review it directly (see the TODO below
// and docs/adr/0001-launchpad-fee-routing.md for the exact request shape PumpPortal expects).
// Everything else — the safety gate, the treasury key loading, the DB bookkeeping, the error
// handling contract — is real and tested.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TREASURY_PATH = process.env.TREASURY_KEYPAIR_PATH || join(__dirname, "..", "secrets", "treasury.json");

export function isLaunchpadLive() {
  return process.env.LAUNCHPAD_LIVE === "true";
}

let cachedTreasury = null;
export async function loadTreasury() {
  if (cachedTreasury) return cachedTreasury;
  if (!existsSync(TREASURY_PATH)) throw new Error(`treasury keypair not found at ${TREASURY_PATH}`);
  const { Keypair } = await import("@solana/web3.js");
  const raw = JSON.parse(readFileSync(TREASURY_PATH, "utf8"));
  cachedTreasury = Keypair.fromSecretKey(Uint8Array.from(raw.secretKey));
  return cachedTreasury;
}

function slugSymbol(name) {
  return name.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() || "DOT";
}

// TODO(human): implement the real pump.fun creation call here. See docs/adr/0001 for the exact
// PumpPortal Local Transaction API request shape (POST /api/trade-local, action: "create"), and
// treasury.json for the signing key. This function must:
//   - build the request with { treasury, name, symbol, metadataUri }
//   - deserialize the returned transaction, sign it with the mint keypair + treasury, send it
//   - return { mintAddress } on success, or throw on failure
// It is intentionally not implemented in this session — that capability is blocked here by
// design, and needs a human to write and review it directly rather than an autonomous agent.
export async function defaultCreateOnChain(/* { treasury, name, symbol, metadataUri } */) {
  throw new Error("not implemented: defaultCreateOnChain needs a human to write the real pump.fun call (see TODO above)");
}

// Called after an agent registers. Never throws to the caller — registration must succeed
// regardless of what happens here. Returns a result object the caller logs/stores.
export async function createTokenForAgent(agent, { createOnChain = defaultCreateOnChain } = {}) {
  if (!isLaunchpadLive()) return { attempted: false };
  try {
    const treasury = await loadTreasury();
    const metadataUri = process.env.LAUNCHPAD_METADATA_URI_BASE
      ? `${process.env.LAUNCHPAD_METADATA_URI_BASE}/${agent.id}.json`
      : null;
    if (!metadataUri) throw new Error("no metadata URI configured (needs an IPFS upload step)");
    const { mintAddress } = await createOnChain({
      treasury, name: agent.name, symbol: slugSymbol(agent.name), metadataUri,
    });
    return { attempted: true, ok: true, mintAddress };
  } catch (err) {
    return { attempted: true, ok: false, error: String(err && err.message || err) };
  }
}
