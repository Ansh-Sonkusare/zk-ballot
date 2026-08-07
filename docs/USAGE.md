# How to Use Midnight Private Voting

## What You Need
- **Lace wallet** browser extension (Chrome/Firefox)
- Set Lace to **Preprod** network
- Some tDUSK tokens for gas (get from the Preprod faucet)

## Step-by-Step Guide

1. **Install Lace wallet** — download from lace.io, create or import a wallet
2. **Switch to Preprod** — in Lace settings, select "Preprod" network
3. **Connect your wallet** — click "Connect Lace Wallet" on the dApp
4. **Register to vote** — click "Register to Vote"; Lace generates a ZK proof that registers your dapp-scoped public key
5. **Wait for voting to open** — the poll organizer opens the ballot
6. **Cast your private vote** — select a star rating (1–5), click "Submit Private Vote"; Lace generates a proof locally; only the cryptographic commitment (not your rating) goes on-chain
7. **Wait for voting to close** — the organizer closes the ballot
8. **Reveal your vote** — click "Reveal Your Vote"; Lace proves your commitment matches without re-broadcasting your rating; the tally for your rating increments by 1
9. **See results** — once the organizer calls "Compute Results", the winning rating is published

## What Gets Proved (and What Stays Private)

| Action | What's Proved On-Chain | What Stays Private |
|--------|----------------------|---------------------|
| Register | Your dapp-scoped public key is registered | Your wallet's raw secret key |
| Commit vote | hash(rating, sk) stored; rating is in [1,5] | Your actual rating |
| Reveal vote | hash(rating, sk) matches the stored commitment | Your rating (only the tally increments) |

**Key guarantee:** Between commit and reveal, even the organizer cannot tell how you voted.

## Troubleshooting

- **"Lace wallet not found"** — install the Lace browser extension from lace.io
- **"Wrong network"** — switch Lace to Preprod in wallet settings
- **Proof generation takes a long time** — this is normal; ZK proofs are computationally intensive
- **Transaction rejected** — check you have enough tDUSK for gas; get more from the Preprod faucet
- **"Already registered"** — each wallet can only register once per poll
