/**
 * End-to-end check for the counter contract.
 *
 * Reconnects to the deployed counter contract, reads its ledger state,
 * performs an increment (write path), and verifies the total changed by the
 * secret amount. Exits 0 on success. Used by `npm run test:e2e`.
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
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

// Must match the privateStateId used at deploy time (witness-free → empty state).
const PRIVATE_STATE_ID = 'counterPrivateState';

// Must match MAX_DELTA in the contract.
const MAX_DELTA = 10n;

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
  const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'counter');
  const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
  if (!fs.existsSync(contractPath)) fail('Compiled contract missing — run `npm run compile`.');
  const Counter = await import(pathToFileURL(contractPath).href);
  const compiledContract = CompiledContract.make('counter', Counter.Contract).pipe(
    CompiledContract.withVacantWitnesses,
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
      privateStateStoreName: 'counter-state',
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
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
    });
  } catch (err: any) {
    await walletCtx.wallet.stop();
    fail(`findDeployedContract threw: ${err?.message ?? err}`);
  }

  // 4. Read the current on-chain ledger state
  const beforeState = await providers.publicDataProvider.queryContractState(deployment.address);
  if (!beforeState) {
    await walletCtx.wallet.stop();
    fail(`queryContractState returned null for ${deployment.address}`);
  }
  const beforeLedger = Counter.ledger(beforeState.data);
  const beforeTotal = beforeLedger.total;
  console.log(`📋 Total before increment: ${beforeTotal.toString()}`);
  console.log(`   Last note before: "${beforeLedger.lastNote}"`);

  // 5. Perform an increment (write path). The secret delta is a private
  // witness: it is never written to the ledger, only its range is proved.
  const delta = 7n;
  const note = `e2e-check-${Date.now()}`;
  console.log(`\n🚀 Incrementing by secret amount ${delta}...`);
  try {
    const tx = await deployed.callTx.increment(delta, note);
    console.log(`   txId: ${tx.public.txId}`);
    console.log(`   blockHeight: ${tx.public.blockHeight}`);
  } catch (err: any) {
    await walletCtx.wallet.stop();
    fail(`increment threw: ${err?.message ?? err}`);
  }

  // 6. Read state again and verify the public total grew by exactly delta —
  // while the ledger exposes only total+note (the secret stays off-chain).
  const afterState = await providers.publicDataProvider.queryContractState(deployment.address);
  if (!afterState) {
    await walletCtx.wallet.stop();
    fail(`queryContractState (after) returned null`);
  }
  const afterLedger = Counter.ledger(afterState.data);
  const afterTotal = afterLedger.total;
  console.log(`📋 Total after increment: ${afterTotal.toString()}`);
  console.log(`   Last note after: "${afterLedger.lastNote}"`);

  const expected = beforeTotal + delta;
  if (afterTotal !== expected) {
    await walletCtx.wallet.stop();
    fail(`total mismatch: expected ${expected}, got ${afterTotal}`);
  }
  if (afterLedger.lastNote !== note) {
    await walletCtx.wallet.stop();
    fail(`note mismatch: expected "${note}", got "${afterLedger.lastNote}"`);
  }

  console.log(`\n✅ e2e-check passed`);
  console.log(`   contractAddress: ${deployment.address}`);
  console.log(`   network:         ${network}`);
  console.log(`   delta kept private: yes (only total+note are on-chain)`);

  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
