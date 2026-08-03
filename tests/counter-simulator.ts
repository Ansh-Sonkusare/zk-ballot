import {
  type CircuitContext,
  sampleContractAddress,
  createConstructorContext,
  createCircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Contract, type Ledger, ledger } from '../contracts/managed/counter/contract/index.js';

setNetworkId('undeployed');

// The contract has no witness functions, so no witness implementation is
// needed. Circuit parameters (like `secretDelta`) are the private witnesses.
export type CounterPrivateState = {};

export const witnesses: Record<string, never> = {};

/**
 * In-memory simulator for the counter contract. Executes circuits without
 * proof generation by chaining CircuitContexts, so tests run instantly and
 * deterministically. The same compiled contract artifacts are used.
 */
export class CounterSimulator {
  readonly contract: Contract<CounterPrivateState>;
  circuitContext: CircuitContext<CounterPrivateState>;

  constructor() {
    this.contract = new Contract<CounterPrivateState>(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(createConstructorContext({}, '0'.repeat(64)));
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

  getPrivateState(): CounterPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  readTotal(): bigint {
    return this.contract.impureCircuits.readTotal(this.circuitContext).result;
  }

  increment(secretDelta: bigint, publicNote: string): Ledger {
    this.circuitContext = this.contract.impureCircuits.increment(
      this.circuitContext,
      secretDelta,
      publicNote,
    ).context;
    return this.getLedger();
  }
}
