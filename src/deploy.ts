/**
 * Deploy the voting contract to a Midnight network (undeployed by default;
 * use --network preview|preprod for public networks).
 *
 * Non-interactive: scaffold → npm run setup runs straight through.
 * No readline prompts, no .midnight-seed file.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveNetwork, getOrCreateSeed, recordDeployment } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import { createPrivateState, witnesses } from './voting';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

// Midnight SDK imports
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// Identifier under which this contract's private state is stored. The voting
// contract's witnesses read the voter's dapp secret key (sk) and pending
// rating (vote) from this private state.
const PRIVATE_STATE_ID = 'votingPrivateState';

// Poll title published on-chain by the constructor. Override via POLL_NAME.
const POLL_NAME = process.env.POLL_NAME?.trim() || 'Midnight Private Ratings Poll';

// ─── Network configuration ─────────────────────────────────────────────────────
//
// Resolved from --network flag, .midnight-state.json, or defaulting to
// 'undeployed' (local devnet). Switch networks with: npm run network <name>

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

// ─── Proof server readiness ────────────────────────────────────────────────────
//
// The proof-server image is distroless and has no shell, so it can't run a
// container-side healthcheck. Poll it from the host before we submit anything
// that needs proofs.

async function waitForProofServer(maxAttempts = 60, delayMs = 2000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fetch(networkConfig.proofServer, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return true;
    } catch (err: any) {
      const code = err?.cause?.code || err?.code || '';
      if (code !== 'ECONNREFUSED' && code !== 'UND_ERR_CONNECT_TIMEOUT' && code !== 'UND_ERR_SOCKET') {
        return true;
      }
    }
    if (attempt < maxAttempts) {
      process.stdout.write(`\r  Waiting for proof server... (${attempt}/${maxAttempts})   `);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

// ─── Compiled contract loading ─────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'voting');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

const Voting = await import(pathToFileURL(contractPath).href);

const compiledContract = CompiledContract.make('voting', Voting.Contract).pipe(
  // The witnesses are structurally correct; cast only bridges the SDK's
  // (currently un-inferrable) conditional type in TS 6.
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

// ─── Providers ─────────────────────────────────────────────────────────────────

async function createProviders(walletCtx: WalletContext) {
  // The SDK requires the private-state password to be at least 16 characters.
  // The default below is a placeholder for local devnet only — set a strong
  // password via PRIVATE_STATE_PASSWORD when you move to a non-local target.
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    // In Midnight.js 4.1.x the WalletProvider interface returns the key objects
    // (CoinPublicKey / EncPublicKey) directly — no longer hex strings.
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      // balanceUnboundTransaction -> finalizeRecipe is the complete balancing
      // path in wallet-sdk 1.x; the earlier explicit signRecipe step is gone.
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'voting-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
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
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  Deploy voting to ${network}`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const seed = SEED;

  console.log('─── Wallet setup ───────────────────────────────────────────────\n');
  console.log('  Creating wallet...');
  const walletCtx = await createWallet({ network, networkConfig, seed });
  const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
  if (restoredCount > 0) {
    console.log(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`);
  }

  console.log('  Syncing with network...');
  console.log('  ℹ  This may take several minutes depending on network size.');
  console.log('     RPC disconnection messages during sync are normal and can be safely ignored.\n');
  const syncStart = Date.now();
  const syncInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - syncStart) / 1000);
    process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
  }, 5000);
  const state = await walletCtx.wallet.waitForSyncedState();
  clearInterval(syncInterval);
  process.stdout.write('\r  ✓ Synced with network.                                      \n');

  // Persist sync state now so a later deploy failure doesn't waste the sync work.
  await persistWalletState(network, walletCtx);

  const address = walletCtx.unshieldedKeystore.getBech32Address();
  let balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`\n  Wallet Address: ${address}`);
  console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

  if (network === 'undeployed' && balance === 0n) {
    console.error(
      '\n❌ Genesis-seed wallet has zero NIGHT. The devnet preset may not have minted to it.\n' +
        '   Check `docker compose ps` and `docker compose logs node`. Then `docker compose down -v` and retry.\n',
    );
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  // Faucet poll for public networks. The wallet has 0 tNIGHT until the user
  // funds the address from the network's faucet. The display balance is
  // authoritative here (unlike DUST, tNIGHT shows up immediately once the
  // faucet tx lands).
  if (network !== 'undeployed' && networkConfig.faucet) {
    // Same balance idiom used by check-balance.ts:
    //   state.unshielded.balances[unshieldedToken().raw] ?? 0n
    const initialBalance = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(
      Rx.filter((s) => s.isSynced),
    ));
    const initialTNight = initialBalance.unshielded.balances[unshieldedToken().raw] ?? 0n;
    if (initialTNight === 0n) {
      console.log('─── Fund Wallet ────────────────────────────────────────────────\n');
      console.log(`  Wallet address: ${address}`);
      console.log(`  Faucet:         ${networkConfig.faucet}`);
      console.log('');
      console.log('  Waiting for tNIGHT to arrive (poll every 10s)...');
      const rawTimeout = Number(process.env.MIDNIGHT_FAUCET_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 600_000;
      const start = Date.now();
      while (true) {
        await new Promise((r) => setTimeout(r, 10_000));
        const s = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((x) => x.isSynced)));
        const tn = s.unshielded.balances[unshieldedToken().raw] ?? 0n;
        if (tn > 0n) {
          console.log(`\n  Funded! tNIGHT balance: ${tn.toLocaleString()}\n`);
          break;
        }
        if (Date.now() - start > timeoutMs) {
          console.log(`\n  ❌ Funding not received within ${Math.round(timeoutMs / 60_000)} min.`);
          console.log(`  Address: ${address}`);
          console.log(`  Faucet:  ${networkConfig.faucet}`);
          console.log('  Re-run setup after funding — your seed is preserved.\n');
          await walletCtx.wallet.stop();
          process.exit(1);
        }
        const elapsed = Math.round((Date.now() - start) / 1000);
        process.stdout.write(`\r  ...still waiting (${elapsed}s elapsed)`);
      }
    }
  }

  // Register for DUST.
  console.log('─── DUST Token Setup ───────────────────────────────────────────\n');

  // Register any unregistered NIGHT UTXOs for DUST generation. A fresh UTXO may
  // not have generated enough projected DUST to cover the registration's own
  // fee yet (midnight-wallet#415), which the chain rejects. Retry with a delay
  // so enough DUST accrues; this is the documented workaround.
  const MAX_DUST_REGISTRATION_ATTEMPTS = 12;
  const DUST_REGISTRATION_RETRY_MS = 15_000;
  let registered = false;

  for (let attempt = 1; attempt <= MAX_DUST_REGISTRATION_ATTEMPTS && !registered; attempt++) {
    const dustState = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));

    const unregisteredUtxos = dustState.unshielded.availableCoins.filter(
      (c: any) => !c.meta?.registeredForDustGeneration,
    );
    if (unregisteredUtxos.length === 0) {
      registered = true;
      break;
    }

    console.log(`  Registering ${unregisteredUtxos.length} NIGHT UTXOs for DUST generation (attempt ${attempt}/${MAX_DUST_REGISTRATION_ATTEMPTS})...`);
    try {
      // The signDustRegistration callback (3rd arg) already produces a recipe
      // with N signatures matching N inputs. Do NOT call signRecipe again — that
      // would double-sign and the chain rejects with InputsSignaturesLengthMismatch
      // (Custom error 192). Matches upstream example-counter and example-bboard.
      const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
        unregisteredUtxos,
        walletCtx.unshieldedKeystore.getPublicKey(),
        (payload) => walletCtx.unshieldedKeystore.signData(payload),
      );
      const finalized = await walletCtx.wallet.finalizeRecipe(recipe);
      await walletCtx.wallet.submitTransaction(finalized);
      registered = true;
    } catch (err: any) {
      const msg = err?.message || err?.toString() || '';
      if (attempt < MAX_DUST_REGISTRATION_ATTEMPTS) {
        console.log(`  ⚠ Registration failed (${msg}). Retrying in ${DUST_REGISTRATION_RETRY_MS / 1000}s to let DUST accrue...`);
        await new Promise((r) => setTimeout(r, DUST_REGISTRATION_RETRY_MS));
      } else {
        throw err;
      }
    }
  }
  if (!registered) throw new Error('DUST registration failed after all retries');

  const finalDustState = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  if (finalDustState.dust.balance(new Date()) === 0n) {
    console.log('  Waiting for DUST tokens...');
    await Rx.firstValueFrom(
      walletCtx.wallet.state().pipe(
        Rx.throttleTime(5000),
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      ),
    );
  }
  console.log('  DUST tokens ready!\n');

  // Deploy.
  console.log('─── Deploy Contract ────────────────────────────────────────────\n');

  console.log('  Checking proof server...');
  const proofServerReady = await waitForProofServer();
  if (!proofServerReady) {
    console.log('\n  ❌ Proof server not responding. Run: docker compose up -d\n');
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  process.stdout.write('\r  Proof server ready!                                 \n');

  console.log('  Setting up providers...');
  const providers = await createProviders(walletCtx);

  // The wallet's reported DUST balance is a *time-projection* of what its
  // registered NIGHT will eventually generate; the tx-builder spends only
  // what the next block's timestamp accounts for, which lags wall-clock by
  // ~1 block on a fresh devnet. Sleeping ~1 block-time before attempt 1
  // closes that gap in the common case; the retry loop covers outliers.
  process.stdout.write('  Generating DUST...');
  await new Promise((r) => setTimeout(r, 6000));
  process.stdout.write(' done.\n');

  console.log('  Deploying contract...\n');

  // Fallback timing. The 6s pre-pause above handles the common case; this
  // loop covers genuine outliers (slow blocks, proof-server worker-pool
  // settling). Earlier 2s retries caused CI flakes where attempt 2's /prove
  // hit the proof-server before it had drained attempt 1's state — 5s gives
  // it room to settle between attempts. 20 × 5 = 100s total budget.
  const MAX_RETRIES = 20;
  const RETRY_DELAY_MS = 5000;
  let deployed: Awaited<ReturnType<typeof deployContract>> | undefined;

  // Recursively flatten an error's cause chain into a single searchable string.
  const flattenError = (err: any, depth = 0): string => {
    if (!err || depth > 6) return '';
    const msg = err?.message || err?.toString() || '';
    const cause = err?.cause ? flattenError(err.cause, depth + 1) : '';
    return `${msg} ${cause}`.trim();
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Midnight.js 4.1.x supplies private state via privateStateId +
      // initialPrivateState. The constructor takes the poll title and derives
      // the organizer's dapp-scoped public key from the private sk witness.
      deployed = await deployContract(providers, {
        compiledContract: compiledContract as any,
        args: [POLL_NAME],
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState: createPrivateState(),
      });
      break;
    } catch (err: any) {
      const errMsg = err?.message || err?.toString() || '';
      const errCause = err?.cause?.message || err?.cause?.toString() || '';
      const fullError = `${errMsg} ${errCause}`;
      const deepError = flattenError(err);

      // DUST shortage is the most common transient failure on a fresh devnet —
      // check it BEFORE proof-server connectivity, because dust-balancing errors
      // can surface through proof-server-shaped messages (the wallet talks to
      // the proof-server while building the dust portion of the tx).
      const isDustShortage =
        fullError.includes('Not enough Dust') ||
        fullError.includes('Insufficient Funds') ||
        fullError.includes('could not balance dust');

      // Quiet the first DUST-shortage retry: it's the expected race between
      // wall-clock projection and block-timestamp accounting and the loud
      // `Insufficient Funds: <huge number>` message scares first-time users.
      // Real failures still get the full diagnostic from attempt 2 onward.
      if (!(isDustShortage && attempt === 1)) {
        console.error(`\n  Attempt ${attempt} error: ${errMsg}`);
        if (errCause && errCause !== errMsg) console.error(`  Cause: ${errCause}`);
      }

      const isProofServerDown =
        deepError.includes('Failed to connect to Proof Server') ||
        deepError.includes('connect ECONNREFUSED 127.0.0.1:6300') ||
        deepError.includes('Failed to prove transaction');

      // DUST shortage and transient proof-server errors are retryable.
      if (isDustShortage || isProofServerDown) {
        if (attempt < MAX_RETRIES) {
          if (isDustShortage) {
            const currentState = await walletCtx.wallet.waitForSyncedState();
            const dustBalance = currentState.dust.balance(new Date());
            if (attempt === 1) {
              console.log(`  Still generating DUST, retrying in ${RETRY_DELAY_MS / 1000}s...`);
            } else {
              console.log(`  ⏳ DUST balance: ${dustBalance.toLocaleString()} (attempt ${attempt}/${MAX_RETRIES}); retrying in ${RETRY_DELAY_MS / 1000}s...`);
            }
          } else {
            console.log(`  ⏳ Proof server unavailable (attempt ${attempt}/${MAX_RETRIES}); retrying in ${RETRY_DELAY_MS / 1000}s...`);
          }
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        } else {
          console.log(`  ❌ Deployment failed after ${MAX_RETRIES} retries.`);
          await walletCtx.wallet.stop();
          process.exit(1);
        }
      } else {
        throw err;
      }
    }
  }

  if (!deployed) throw new Error('Deployment failed after all retries');

  const contractAddress = deployed.deployTxData.public.contractAddress;
  console.log('  ✅ Contract deployed successfully!\n');
  console.log(`  Contract Address: ${contractAddress}\n`);

  recordDeployment(network, contractAddress, address.toString());
  console.log('  Saved to .midnight-state.json\n');

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
  console.log('─── Deployment complete ────────────────────────────────────────\n');
  console.log('  Next: npm run cli\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
