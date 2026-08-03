/**
 * End-to-end check for the voting contract.
 *
 * Reconnects to the deployed voting contract and walks the complete poll
 * lifecycle on-chain, verifying the ledger at every step:
 *
 *   register → open → commit (private rating) → close → reveal → results
 *
 * The rating is a private witness: only its commitment appears on-chain
 * during the voting phase, and only the final per-rating tally appears after
 * reveal. Exits 0 on success. Used by `npm run test:e2e`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateSeed, getDeployment } from '../src/network';
import { createWallet, persistWalletState } from '../src/wallet';
import { createPrivateState, witnesses, type VotingPrivateState } from '../src/voting';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

// Must match the privateStateId used at deploy time.
const PRIVATE_STATE_ID = 'votingPrivateState';

// The rating exercised by the e2e flow.
const RATING = 5n;

// ─── Network configuration ─────────────────────────────────────────────────────

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

function fail(msg: string): never {
  console.error(`❌ e2e-check failed: ${msg}`);
  process.exit(1);
}

function isHexAddress(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s) && s.length >= 32;
}

async function main() {
  // 1. Deployment sanity
  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}.`);
    process.exit(1);
  }
  if (!isHexAddress(deployment.address)) {
    fail(`Deployment address missing or invalid: ${JSON.stringify(deployment, null, 2)}`);
  }

  // 2. Build wallet and providers
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'voting');
  const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
  if (!fs.existsSync(contractPath)) fail('Compiled contract missing — run `npm run compile`.');
  const Voting = await import(pathToFileURL(contractPath).href);
const compiledContract = CompiledContract.make('voting', Voting.Contract).pipe(
  // The witnesses are structurally correct; cast only bridges the SDK's
  // (currently un-inferrable) conditional type in TS 6.
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
  await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'voting-state',
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      privateStoragePasswordProvider: () => 'Local-Devnet-Development-Placeholder-1',
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(
      networkConfig.proofServer,
      zkConfigProvider,
      { timeout: Number(process.env.PROOF_TIMEOUT_MS) || 1_200_000 },
    ),
    walletProvider,
    midnightProvider: walletProvider,
  };

  // 3. Reconnect to the deployed contract
  let deployed: any;
  try {
    deployed = await findDeployedContract(providers, {
      contractAddress: deployment.address,
      compiledContract: compiledContract as any,
      // No initialPrivateState here: findDeployedContract would overwrite the
      // stored private state. Omitting it reconnects to the organizer's sk
      // written at deploy time (deploy must run first).
      privateStateId: PRIVATE_STATE_ID,
    });
  } catch (err: any) {
    await walletCtx.wallet.stop();
    fail(`findDeployedContract threw: ${err?.message ?? err}`);
  }

  const readLedger = async () => {
    const cs = await providers.publicDataProvider.queryContractState(deployment.address);
    if (!cs) fail(`queryContractState returned null for ${deployment.address}`);
    return Voting.ledger(cs.data);
  };

  // 4. Initial state
  const initial = await readLedger();
  console.log(`📋 Poll: "${initial.pollName}"`);
  console.log(`📋 Phase: ${Voting.VotingState[initial.votingState]}`);
  if (initial.votingState !== Voting.VotingState.REGISTRATION) {
    await walletCtx.wallet.stop();
    fail(`expected REGISTRATION phase, got ${Voting.VotingState[initial.votingState]} (re-run on a fresh deploy)`);
  }

  // 5. Register + open
  console.log('\n🚀 Registering to vote...');
  let tx = await deployed.callTx.registerToVote();
  console.log(`   txId: ${tx.public.txId} @ block ${tx.public.blockHeight}`);
  let ledger = await readLedger();
  if (ledger.registeredVoters.size() !== 1n) fail(`expected 1 registered voter, got ${ledger.registeredVoters.size()}`);

  console.log('🚀 Opening voting...');
  tx = await deployed.callTx.openVoting();
  console.log(`   txId: ${tx.public.txId} @ block ${tx.public.blockHeight}`);
  ledger = await readLedger();
  if (ledger.votingState !== Voting.VotingState.OPEN) fail(`expected OPEN phase`);

  // 6. Commit a private rating. The rating is stored in the wallet's private
  // state and consumed as a witness by the circuit — the ledger only records
  // the commitment hash(rating, sk), never the rating itself.
  console.log(`\n🚀 Committing private rating ${RATING}...`);
  const privateState = (await providers.privateStateProvider.get(PRIVATE_STATE_ID)) as VotingPrivateState | null;
  await providers.privateStateProvider.set(PRIVATE_STATE_ID, {
    sk: privateState?.sk ?? createPrivateState().sk,
    vote: RATING,
  });
  tx = await deployed.callTx.commitVote();
  console.log(`   txId: ${tx.public.txId} @ block ${tx.public.blockHeight}`);
  ledger = await readLedger();
  if (ledger.totalVotes !== 1n) fail(`expected totalVotes=1, got ${ledger.totalVotes}`);
  if (ledger.hashedVoteMap.size() !== 1n) fail(`expected 1 committed hash`);
  // Privacy check: the rating must NOT be visible in any tally yet.
  for (const key of ['rating1', 'rating2', 'rating3', 'rating4', 'rating5'] as const) {
    if (ledger[key] !== 0n) fail(`tally ${key} moved during commit (leak)`);
  }
  console.log('   ✓ Rating stays hidden: all tallies are 0 after commit; only the commitment is on-chain.');

  // 7. Close + reveal
  console.log('🚀 Closing voting...');
  tx = await deployed.callTx.closeVoting();
  console.log(`   txId: ${tx.public.txId} @ block ${tx.public.blockHeight}`);
  ledger = await readLedger();
  if (ledger.votingState !== Voting.VotingState.CLOSED) fail(`expected CLOSED phase`);

  console.log(`🚀 Revealing vote (rating ${RATING})...`);
  tx = await deployed.callTx.revealVote();
  console.log(`   txId: ${tx.public.txId} @ block ${tx.public.blockHeight}`);
  ledger = await readLedger();
  if (ledger.rating5 !== 1n) fail(`expected rating5=1 after reveal, got ${ledger.rating5}`);
  for (const key of ['rating1', 'rating2', 'rating3', 'rating4'] as const) {
    if (ledger[key] !== 0n) fail(`unexpected ${key}=${ledger[key]}`);
  }

  // 8. Results
  console.log('🚀 Computing results...');
  tx = await deployed.callTx.checkResults();
  console.log(`   txId: ${tx.public.txId} @ block ${tx.public.blockHeight}`);
  ledger = await readLedger();
  if (ledger.result !== RATING) fail(`expected result=${RATING}, got ${ledger.result}`);

  console.log(`\n✅ e2e-check passed`);
  console.log(`   contractAddress: ${deployment.address}`);
  console.log(`   network:         ${network}`);
  console.log(`   poll:            "${ledger.pollName}"`);
  console.log(`   tallies:         1★=${ledger.rating1} 2★=${ledger.rating2} 3★=${ledger.rating3} 4★=${ledger.rating4} 5★=${ledger.rating5}`);
  console.log(`   winner:          ${ledger.result}`);
  console.log(`   rating kept private during voting: yes (commitments only)`);

  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
