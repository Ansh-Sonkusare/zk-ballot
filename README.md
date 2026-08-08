# Midnight Private Voting

[![CI](https://github.com/Ansh-Sonkusare/midnight/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansh-Sonkusare/midnight/actions/workflows/ci.yml)

> A privacy-preserving voting smart contract on the Midnight network where registered voters rate a poll from 1 to 5 in secret. Ratings are committed as hidden hashes, votes are tallied in zero-knowledge, and the per-rating tally (and winner) is only revealed after the poll closes.

## Live Demo

**[midnight-private-voting.vercel.app](https://midnight-private-voting.vercel.app)**

## Contract Address

| Network  | Address                          |
|----------|----------------------------------|
| Preview  | `c89921b6fd8d84376298e274021ef64c497db4fa66fcac16019b81b10c00dd14` |
| Preprod  | [not deployed]                   |

## What This Does

This contract runs an on-chain poll with a full lifecycle:

1. **Registration** — the organizer opens a poll; dapp-scoped public keys can register to vote (one entry per voter).
2. **Open** — voting opens; registered voters commit a private rating from 1 to 5.
3. **Close** — voting closes; no more commits are accepted.
4. **Reveal** — voters reveal their vote; the tally for that rating increments.
5. **Results** — the organizer computes the winning rating (ties resolve to the lower rating).

The twist is the *rating itself* is a private witness. During voting, the only thing that goes on-chain is `hash(rating, secretKey)` — a commitment. An observer can see that a vote was committed but learns nothing about the rating. Only at reveal time does the corresponding public tally increment, one rating at a time, so the final distribution is public but no individual vote can be attributed to a voter.

## Privacy Model

- **What is PUBLIC (on-chain, visible to anyone):**
  - `pollName` — the poll title.
  - `organizer` — the dapp-scoped public key of the organizer.
  - `registeredVoters` — the set of dapp-scoped keys allowed to vote.
  - `hashedVoteMap` — one commitment `hash(rating, sk)` per committed vote.
  - `totalVotes` — how many votes have been committed.
  - `rating1`…`rating5`, `result` — the tally and winning rating, revealed only after the poll closes.

- **What is PRIVATE (private witness, never on-chain):**
  - `sk` — the voter's dapp secret key; its dapp-scoped public key is what identifies them on-chain, the raw key stays in the wallet's private state.
  - `vote` — the pending rating in `[1, 5]`, held only in the voter's private state and consumed by the commit/reveal circuits.

- **What the user PROVES without revealing:**
  - During **commit**: that the hidden rating is in `[1, 5]` and that `hashedVoteMap[voterKey] = hash(rating, sk)` — a correct commitment, without disclosing the rating.
  - During **reveal**: that `hash(rating, sk)` equals the stored commitment, so the voter cannot change their mind after committing. The proof attests to the arithmetic; the raw rating and key stay on the prover's machine.

## Privacy Claim

An on-chain observer can see:
- That a wallet registered to vote (via its dapp-scoped public key)
- That a commitment `hash(rating, sk)` was stored for that voter
- Final per-rating tallies (after reveal)

An on-chain observer **cannot** see:
- The actual rating chosen (until the voter reveals it, and even then only the tally increments — not which voter chose which rating)
- The voter's raw secret key
- Any correlation between voter identity and specific rating across polls

## Tech Stack

- **Midnight network** — zero-knowledge smart contract platform
- **Compact language** — Midnight's smart contract language (compiler 0.5.1, language version ≥ 0.23.0, 6 circuits)
- **Midnight.js SDK** — `@midnight-ntwrk/*` packages v4.1.1
- **React 18 + Vite** — frontend build
- **Lace wallet** — browser wallet for Midnight (handles ZK proof generation)
- **Node.js v22+** — runtime for tooling and tests
- **Vitest** — circuit + ledger test suite
- **Docker** — runs the local proof server on port 6300

## Prerequisites

- Node.js v22 or newer
- Docker (with a running daemon)
- Lace wallet browser extension (for the frontend)
- The Compact toolchain — install with:
  ```bash
  curl --proto '=https' --tlsv1.2 -LsSf \
    https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
  compact update
  ```
- The proof server image (pin 8.1.0):
  ```bash
  docker run -d --name midnight-proof-server -p 6300:6300 midnightntwrk/proof-server:8.1.0
  ```

## Setup & Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Compile the Compact contract into circuits + keys
npm run compile

# 3. Run the tests
npm test

# 4. Start the frontend dev server
npm run dev
# → opens http://localhost:5173

# 5. (Optional) Deploy to the Preview network
NODE_OPTIONS="--max-old-space-size=12288" npm run deploy -- --network preview

# 6. (Optional) Run the interactive CLI
npm run cli
```

## Run Tests

```bash
npm test
```

This compiles the contract and runs the Vitest suite in `tests/voting.test.ts`, covering 13 scenarios:
- Registration rules (once per voter, registration-phase only)
- Phase enforcement (open/close ordering)
- Private-commit correctness (tallies stay zero until reveal)
- Rating bounds (rejects 0 and 6)
- Double-vote prevention
- Commit–reveal consistency (cannot change rating after committing)
- Tallies and winner computation (ties resolve lower)
- Unregistered voter rejection

## CI/CD

On every push to `main` and every pull request, GitHub Actions:
1. Checks out the code
2. Sets up Node.js v22
3. Installs the Compact compiler
4. Runs `npm run compile` to compile the contract
5. Runs `npm run test:only` (Vitest suite, no re-compilation needed)

See `.github/workflows/ci.yml`.

## Product Proposal

See `PROPOSAL.md` — fill in the "What is the product", "Why Midnight", and "Mainnet Feasibility" sections manually.

## Demo Video

[PLACEHOLDER — add link after recording the 2-minute demo]

## Initial Idea

This project is Level 1 of the **Midnight Builder Challenge** on Rise In. The brief was to replace the example counter contract with a privacy-preserving smart contract that meaningfully uses Midnight's zero-knowledge features.

The idea: **a poll where nobody can tell how you voted.** Real-world votes are public for good reason (accountability), but ratings, surveys, and anonymous feedback are the opposite — people answer honestly only when they know their rating stays secret. So I built a "Midnight Private Ratings Poll": organizers open a poll, registered voters rate it 1–5, and every rating is hidden behind a commitment until the poll closes.

The key design decisions:

- **Commit–reveal** — during voting, only `hash(rating, sk)` goes on-chain. The rating (and the secret key) live in the voter's private state and are consumed as witnesses inside the ZK circuit. Reveal recomputes the hash and proves it matches the stored commitment, so the voter can't change their mind — but the rating is only visible as an entry in the final tally, never attributed to a voter.
- **Registered-voter gating (the official Election Contract pattern)** — a dapp-scoped public key per voter, one entry in `registeredVoters`, no ballot coins. This replaces an earlier idea of minting a ballot NFT to gate voting; research showed that wiring a voter-held coin through the circuit needs SDK-level transient handling that isn't exposed in a documented example, so the registered-voter approach is both simpler and the pattern Midnight's own election example uses.
- **Organizer-only transitions** — open, close, and results are restricted to the organizer's dapp-scoped key, so a poll can't be tampered with mid-flow.

## Screenshots

**1. Compact contract compilation (6 circuits built)**

```text
$ npm run compile
Compiling 6 circuits:
  ...voting.compact -> contracts/managed/voting
```

**2. Contract deployed to the Preview network**

```text
$ NODE_OPTIONS="--max-old-space-size=12288" npm run deploy -- --network preview
...
  Wallet Address: mn_addr_preview1mct324vcuypgfqn5q69etuyfsdr0jnl40yw66yct8jhj9nnagpksn2fwrg
  ✅ Contract deployed successfully!
  Contract Address: c89921b6fd8d84376298e274021ef64c497db4fa66fcac16019b81b10c00dd14
  Saved to .midnight-state.json
```

**3. Tests passing (13/13)**

```text
$ npm run test:only
 ✓ tests/voting.test.ts (13 tests) 444ms
 Test Files  1 passed (1)
      Tests  13 passed (13)
```
