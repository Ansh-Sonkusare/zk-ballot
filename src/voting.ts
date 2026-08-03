import { randomBytes } from 'node:crypto';

// Shared private-state types, initial state, and witness implementations for
// the voting contract. Used by the deploy script, the CLI, the e2e check, and
// the in-memory simulator (tests) so every entry point behaves identically.
//
// `sk` is the caller's dapp secret key — its dapp-scoped public key
// (getDappPubKey(sk)) is what identifies a voter on-chain; the raw sk is only
// ever held in the voter's private state. `vote` is the voter's pending
// private rating in [1,5], consumed by commitVote() and re-checked by
// revealVote().
export type VotingPrivateState = {
  sk: Uint8Array;
  vote: bigint;
};

export function createPrivateState(): VotingPrivateState {
  return { sk: randomBytes(32), vote: 0n };
}

export const witnesses = {
  localSk: ({ privateState }: { privateState: VotingPrivateState }) =>
    [privateState, privateState.sk] as [VotingPrivateState, Uint8Array],
  localGetVote: ({ privateState }: { privateState: VotingPrivateState }) =>
    [privateState, privateState.vote] as [VotingPrivateState, bigint],
};
