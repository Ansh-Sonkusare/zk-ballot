# Midnight Private Counter

> A privacy-preserving counter smart contract on the Midnight network that adds a secret, bounded amount to a public running total while proving the amount is valid — without ever publishing it.

## Contract Address

| Network  | Address                          |
|----------|----------------------------------|
| Preview  | `75cf79d6124c64dde9112f2b852664f7a1ba9f4c2e8b64f1be7b92dcf82a0063` |
| Preprod  | [not deployed]                   |

## What This Does

This contract maintains a public running `total` counter on the Midnight blockchain. Anyone can call `increment` to add an amount to the total, along with an optional public note. The twist is that the *amount being added* (`secretDelta`) is a private witness: the caller proves in zero-knowledge that the amount is a valid number between 1 and 10 inclusive, but the amount itself is never written to the blockchain. An observer sees the total grow, but cannot attribute any specific contribution to any caller without additional off-chain context.

It also exposes a pure `readTotal` circuit so dApps can query the current total without any state change.

## Privacy Model

- **What is PUBLIC (on-chain, visible to anyone):**
  - `total` — the running counter, updated with every `increment`.
  - `lastNote` — an optional short message a caller deliberately publishes.

- **What is PRIVATE (private witness, never on-chain):**
  - `secretDelta` — the exact amount a caller adds. It is a witness input to the zero-knowledge circuit, used in the bounded-arithmetic constraints, and is never stored in the ledger, never returned by a circuit, and never wrapped in `disclose()`.

- **What the user PROVES without revealing:**
  - That their contribution is between `1` and `10` (inclusive) and that the public total was updated correctly by that contribution — all without publishing the contribution itself. The zero-knowledge proof attests to the arithmetic; the raw witness stays on the prover's machine.

## Tech Stack

- **Midnight network** — zero-knowledge smart contract platform
- **Compact language** — Midnight's smart contract language (compiler 0.31.x)
- **Node.js v22+** — runtime for tooling and tests
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
npm run cli preview

# 6. Run the on-chain end-to-end check (read + increment)
NODE_OPTIONS="--max-old-space-size=12288" npm run test:e2e -- preview

# 7. Switch networks
npm run network preview   # or preprod
```

## Run Tests

```bash
npm test
```

This compiles the contract and runs the Vitest suite in `tests/counter.test.ts`, covering circuit logic (range checks), ledger state transitions, and verification that private inputs are never exposed in public or private state.

## End-to-End Check

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm run test:e2e -- preview
```

`scripts/e2e-check.ts` reconnects to the deployed contract, reads the on-chain total, performs a real `increment` (secret amount 7), then verifies the public total grew by exactly that amount while the ledger only exposes `total` and `lastNote`.

## Initial Idea

[LEAVE PLACEHOLDER — I will fill this in manually]

## Screenshots

[LEAVE PLACEHOLDER — I will add compile output and contract address screenshots]
