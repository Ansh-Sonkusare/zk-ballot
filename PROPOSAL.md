# Product Proposal

## What is the product, and who uses it?

**Midnight Private Ratings Poll** is a decentralised polling platform where participants rate a subject on a 1–5 scale and the final tally is verifiable on-chain — but no individual's rating is ever attributable to them, even after the poll closes.

The primary users are:

- **Course and event organisers** who want honest feedback from students or attendees. When people know their rating is truly anonymous, they stop self-censoring and give the rating they actually feel.
- **Product and engineering teams** running retrospectives or feature prioritisation polls where social pressure (or fear of management retaliation) distorts transparent votes.
- **DAO governance** committees that want sentiment data before a binding vote — a private straw poll that cannot be gamed by visible early votes.
- **Academic researchers** collecting sensitive survey data where participant anonymity is a legal or ethical requirement.

The poll organiser opens a registration window, enables voting, and later triggers the reveal phase. Participants interact through a browser wallet (Lace) and never need to understand the cryptography — the privacy guarantee is built into the protocol, not dependent on the organiser's honesty.

## Why Midnight specifically?

Anonymous ratings require more than "trust the server". Any transparent-chain solution (Ethereum, Cardano, Solana) has the same problem: every committed vote is a public transaction that can be correlated with a wallet address. Even with ring signatures or mixing, the timing of a vote leaks information.

Midnight solves this at the protocol level in two ways that no transparent chain can replicate:

1. **Private witnesses in ZK circuits.** The voter's actual rating never enters the transaction. The circuit proves `hash(rating, secretKey) == storedCommitment` and that `rating ∈ [1, 5]` — the proof is valid without the verifier ever seeing either value. On a transparent chain you would need an off-chain trusted third party to do this; on Midnight the prover is the voter's own wallet.

2. **Dapp-scoped public keys.** Each wallet appears under a different pseudonymous key in every dapp it uses. An on-chain analyst cannot link a voter's participation in this poll to their participation in any other dapp — the identities are cryptographically separated at the wallet level.

The commit–reveal design means the organiser cannot peek at live ratings and selectively close the poll when their preferred outcome is locked in. The network sees only hash commitments during voting; individual attributable ratings are never broadcast.

A transparent chain could tally a poll, but it cannot make the individual votes private. Midnight can do both.

## Data Model

| Data Point           | Type            | Disclosed To                               |
|----------------------|-----------------|--------------------------------------------|
| `pollName`           | Public ledger   | Everyone                                   |
| `organizer`          | Public ledger   | Everyone                                   |
| `votingState`        | Public ledger   | Everyone                                   |
| `registeredVoters`   | Public ledger   | Everyone                                   |
| `hashedVoteMap`      | Public ledger   | Everyone (commitment only, not the rating) |
| `totalVotes`         | Public ledger   | Everyone                                   |
| `rating1..5`         | Public ledger   | Everyone (after each voter's reveal)       |
| `result`             | Public ledger   | Everyone (after organiser calls results)   |
| `sk` (secret key)    | Private witness | No one — stays in the voter's Lace wallet  |
| `vote` (rating 1–5)  | Private witness | No one — consumed inside the ZK circuit    |

## Mainnet Feasibility

Yes. The contract is deliberately compact — 6 circuits, no on-chain coin flow, no transient coins to manage. The poll lifecycle is entirely driven by the registered voter set and the organiser key, both of which already exist as public ledger state.

The main open items before a mainnet launch are:

- **Multi-poll support.** The current contract is single-poll. A factory or parameterised constructor would let one deployment host multiple concurrent polls without redeploying.
- **Deadline enforcement.** Phase transitions are currently organiser-triggered. An on-chain deadline (block height or timestamp, if Midnight exposes one) would make the poll tamper-resistant even if the organiser disappears.
- **Frontend hardening.** The current frontend simulates proof generation delays; wiring it to the real Lace proof pipeline and handling mainnet fee estimation are the remaining frontend tasks.

None of these require changes to the privacy model or the ZK circuits. The core cryptographic design is mainnet-ready today.
