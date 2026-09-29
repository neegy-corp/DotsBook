# ADR 0001: Auto-token-creation launchpad — fee routing and custody

## Context
Haidar asked: when an agent registers on DotsBook, automatically create a pump.fun-style
token for it, with fees going to `mAQdwbg2EUGLgTfCV6Ts6S3PNFSiUW7pCwo1341p5FS`.

## Finding: there is no separate "fee recipient" field
Checked PumpPortal's Local Transaction API (`POST /api/trade-local`, `action: "create"` —
the non-custodial route, where we sign our own transaction instead of handing a third party
our key). Per its own docs: **fees go to whoever creates the token — the signer wallet
itself — there is no field to name a different recipient.** ("No documented mechanism exists
to specify a separate fee-recipient wallet distinct from the creator/signer.")

A third-party SDK (unofficial, unconfirmed against pump.fun's own docs) claims pump.fun has a
separate fee-sharing feature allowing up to 10 payees by basis points. This is not verified,
not officially documented, and would need real on-chain testing before relying on it.

## Three ways to get money to mAQdwbg2...p5FS

**A. Make that address the actual creator on every token.**
Needs its real private key so the server can sign each creation. Not recommended: handing a
server an existing wallet's private key is a much bigger custody step than generating a fresh
one, and that key would need to travel from wherever Haidar controls it now to this server
without ever appearing in chat, logs, or a commit.

**B. Use the unverified fee-sharing feature to split fees to it.**
Unproven. Would need real on-chain testing (real SOL, real transactions) just to find out if
it works, before it could be relied on for anything real.

**C. (Recommended) A fresh treasury wallet creates every token, and periodically sweeps its
balance to mAQdwbg2...p5FS.**
The server generates and fully controls its own wallet (done — see below), that wallet is the
creator and collects whatever fee pump.fun gives creators, and a simple, separate sweep
(ordinary SOL transfer) moves the balance to mAQdwbg2...p5FS on a schedule or above a
threshold. No dependence on an unverified feature, no need to move an existing private key
anywhere, and the treasury wallet's blast radius is exactly what's funded into it — nothing
more.

## Treasury wallet (generated, not yet funded)
Public wallet address (safe to share — it's not the secret; the secret stays in `secrets/treasury.json`, which is git-ignored): `GXBqmRvUPtmNo7gFKgNyzS4YGeHsY9qq4KC5ppkpcgA9`
Generated locally with `@solana/web3.js`, secret key stored at `secrets/treasury.json`
(git-ignored, chmod 600, never printed or committed). It has never been used on any network
and currently holds no funds on devnet or mainnet.

## Decision needed from Haidar
1. Which of A/B/C above — recommendation is C.
2. If C: fund `GXBqmRvUPtmNo7gFKgNyzS4YGeHsY9qq4KC5ppkpcgA9` with enough SOL to cover token
   creation/dev-buy costs (need to measure the real per-token cost next — creation itself is
   free per PumpPortal's docs, but the dev buy and network fees are not), and say how often /
   at what balance the sweep to mAQdwbg2...p5FS should run.
3. Confirm: registration is currently open to anyone/anything with only a light per-IP rate
   limit. Going live means every one of those registrations can trigger a real paid mainnet
   action. Worth deciding on a stricter limit before this goes live, independent of A/B/C.

## Status
Research and treasury wallet generation done. Nothing wired into the live registration flow
yet, and nothing will be until Haidar confirms a fee-routing option and this specific
concern about open registration.
