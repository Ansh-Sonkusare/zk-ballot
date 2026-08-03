import {
  type CircuitContext,
  sampleContractAddress,
  createConstructorContext,
  createCircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Contract, type Ledger, ledger } from '../contracts/managed/voting/contract/index.js';
import {
  createPrivateState,
  witnesses,
  type VotingPrivateState,
} from '../src/voting.js';

setNetworkId('undeployed');

export { createPrivateState, witnesses };
export type { VotingPrivateState };

/**
 * In-memory simulator for the voting contract. Executes circuits without proof
 * generation by chaining CircuitContexts, so tests run instantly and
 * deterministically. Multiple voters are simulated by re-wrapping the shared
 * contract state with a different private state (a different `sk` = a
 * different voter identity), matching how the wallet would act for each voter.
 */
export class VotingSimulator {
  readonly contract: Contract<VotingPrivateState>;
  readonly organizerState: VotingPrivateState;
  circuitContext: CircuitContext<VotingPrivateState>;

  constructor(pollName = 'Test poll') {
    this.contract = new Contract<VotingPrivateState>(witnesses as any);
    this.organizerState = createPrivateState();
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(this.organizerState, '0'.repeat(64)),
        pollName,
      );
    this.circuitContext = createCircuitContext(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState,
    );
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  getPrivateState(): VotingPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  setVote(rating: bigint): void {
    this.circuitContext.currentPrivateState.vote = rating;
  }

  /** Re-wrap the shared contract state with a different voter's private state. */
  switchVoter(privateState: VotingPrivateState): void {
    this.circuitContext = createCircuitContext(
      sampleContractAddress(),
      this.circuitContext.currentZswapLocalState,
      this.circuitContext.currentQueryContext.state,
      privateState,
    );
  }

  switchToOrganizer(): void {
    this.switchVoter(this.organizerState);
  }

  private run(fn: (ctx: CircuitContext<VotingPrivateState>) => { context: CircuitContext<VotingPrivateState> }): void {
    this.circuitContext = fn(this.circuitContext).context;
  }

  registerToVote(): void {
    this.run(this.contract.impureCircuits.registerToVote);
  }

  openVoting(): void {
    this.run(this.contract.impureCircuits.openVoting);
  }

  commitVote(): void {
    this.run(this.contract.impureCircuits.commitVote);
  }

  closeVoting(): void {
    this.run(this.contract.impureCircuits.closeVoting);
  }

  revealVote(): void {
    this.run(this.contract.impureCircuits.revealVote);
  }

  checkResults(): void {
    this.run(this.contract.impureCircuits.checkResults);
  }
}
