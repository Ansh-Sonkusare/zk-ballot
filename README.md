# Midnight Private Voting

> A privacy-preserving voting smart contract on the Midnight network where registered voters rate a poll from 1 to 5 in secret. Ratings are committed as hidden hashes, votes are tallied in zero-knowledge, and the per-rating tally (and winner) is only revealed after the poll closes.

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

## Tech Stack

- **Midnight network** — zero-knowledge smart contract platform
- **Compact language** — Midnight's smart contract language (compiler 0.5.1, language version ≥ 0.23.0, 6 circuits)
- **Node.js v22+** — runtime for tooling and tests
- **Vitest** — circuit + ledger test suite
- **Docker** — runs the local proof server on port 6300

## Prerequisites

- Node.js v22 or newer
- Docker (with a running daemon)
- The Compact toolchain — install with:
  ```bash
  curl --proto '=https' --tlsv1.2 -LsSf \
    https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
  compact update
  ```
- The proof server image (pin 8.1.0 — the `latest` tag resolves to 7.0.0-rc.1, which hangs in proof generation on Apple Silicon):
  ```bash
  docker run -d --name midnight-proof-server -p 6300:6300 midnightntwrk/proof-server:8.1.0
  ```

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Compile the Compact contract into circuits + keys
npm run compile

# 3. Run the tests (compiles, then runs vitest)
npm test

# 4. Deploy to the Preview network
NODE_OPTIONS="--max-old-space-size=12288" npm run deploy -- --network preview
#     The script prints a wallet address — fund it at the Preview faucet,
#     wait for funding, and the deployment proceeds automatically.

# 5. Interact with the deployed contract (interactive menu)
npm run cli

# 6. Run the on-chain end-to-end check (full poll lifecycle)
NODE_OPTIONS="--max-old-space-size=12288" npm run test:e2e

# 7. Switch networks
npm run network preview   # or preprod
```

## Run Tests

```bash
npm test
```

This compiles the contract and runs the Vitest suite in `tests/voting.test.ts`, covering registration rules, phase enforcement, private-commit correctness, rating bounds, double-vote prevention, commit–reveal consistency, tallies, and the winner computation.

## End-to-End Check

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm run test:e2e
```

`scripts/e2e-check.ts` reconnects to the deployed contract and walks the entire poll lifecycle on-chain — register → open → commit → close → reveal → results — asserting at each step. It also verifies the privacy property: after committing a rating, every public tally is still `0` (only the commitment hash is visible), and only after reveal does the matching tally increment.

> Note: the e2e check requires a fresh deploy (the poll must be in the `REGISTRATION` phase). Run `npm run deploy -- --network preview` before `npm run test:e2e`.

## Interactive CLI

```bash
npm run cli
```

Presents a menu to run each step of the poll. Ratings are entered privately; the CLI stores them in the wallet's encrypted private state and they never appear on-chain before reveal.

## Initial Idea

This project is Level 1 of the **Midnight Builder Challenge** on Rise In. The brief was to replace the example counter contract with a privacy-preserving smart contract that meaningfully uses Midnight's zero-knowledge features.

The idea: **a poll where nobody can tell how you voted.** Real-world votes are public for good reason (accountability), but ratings, surveys, and anonymous feedback are the opposite — people answer honestly only when they know their rating stays secret. So I built a "Midnight Private Ratings Poll": organizers open a poll, registered voters rate it 1–5, and every rating is hidden behind a commitment until the poll closes.

The key design decisions:

- **Commit–reveal** — during voting, only `hash(rating, sk)` goes on-chain. The rating (and the secret key) live in the voter's private state and are consumed as witnesses inside the ZK circuit. Reveal recomputes the hash and proves it matches the stored commitment, so the voter can't change their mind — but the rating is only visible as an entry in the final tally, never attributed to a voter.
- **Registered-voter gating (the official Election Contract pattern)** — a dapp-scoped public key per voter, one entry in `registeredVoters`, no ballot coins. This replaces an earlier idea of minting a ballot NFT to gate voting; research showed that wiring a voter-held coin through the circuit needs SDK-level transient handling that isn't exposed in a documented example, so the registered-voter approach is both simpler and the pattern Midnight's own election example uses.
- **Organizer-only transitions** — open, close, and results are restricted to the organizer's dapp-scoped key, so a poll can't be tampered with mid-flow.

The poll lifecycle mirrors how a real secret ballot runs: registration → open → commit → close → reveal → results.

## Screenshots

Below are the key terminal outputs from the build and deployment. I'll replace these with captured screenshots:

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

**3. On-chain e2e check (full poll lifecycle, privacy verified)**

```text
$ npm run test:e2e
📋 Poll: "Midnight Private Ratings Poll"
📋 Phase: REGISTRATION
🚀 Registering to vote...        ✅
🚀 Opening voting...             ✅
🚀 Committing private rating 5...   ✅
   ✓ Rating stays hidden: all tallies are 0 after commit; only the commitment is on-chain.
🚀 Closing voting...             ✅
🚀 Revealing vote (rating 5)...  ✅
🚀 Computing results...          ✅
   tallies: 1★=0 2★=0 3★=0 4★=0 5★=1
   winner: 5
```
