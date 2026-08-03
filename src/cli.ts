/**
 * CLI for interacting with the voting contract.
 *
 * Walks the full poll lifecycle as the organizer wallet:
 *   register → open → commit (private rating) → close → reveal → results.
 * The rating is a private witness: it is written to the wallet's private
 * state, never to the ledger. On-chain you only ever see the commitment hash
 * during voting and the per-rating tallies after reveal.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { Buffer } from 'buffer';

// Midnight SDK imports
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateSeed, getDeployment } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import { createPrivateState, witnesses, type VotingPrivateState } from './voting';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

// Enable WebSocket for GraphQL subscriptions
// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// Must match the privateStateId used at deploy time so the CLI reconnects to
// the same private state (the voter's sk + pending rating).
const PRIVATE_STATE_ID = 'votingPrivateState';

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'voting');

// Load compiled contract
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

// Check if contract is compiled
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
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

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

// ─── Private-state helpers ─────────────────────────────────────────────────────

// Store a pending private rating so commitVote()'s localGetVote() witness
// reads it. The value lives only in the encrypted level DB on this machine.
async function setPendingRating(providers: any, rating: bigint): Promise<void> {
  const current = (await providers.privateStateProvider.get(PRIVATE_STATE_ID)) as VotingPrivateState | null;
  await providers.privateStateProvider.set(PRIVATE_STATE_ID, { sk: current?.sk ?? createPrivateState().sk, vote: rating });
}

function renderState(ledgerState: any): string {
  const rating = (i: number) => (ledgerState[`rating${i}`] ?? 0n).toString();
  return [
    `  📋 Poll: "${ledgerState.pollName}"`,
    `  📋 Phase: ${Voting.VotingState[ledgerState.votingState] ?? ledgerState.votingState}`,
    `  📋 Registered voters: ${ledgerState.registeredVoters.size().toString()}`,
    `  📋 Votes committed: ${ledgerState.totalVotes.toString()}`,
    `  📊 Tallies: 1★=${rating(1)}  2★=${rating(2)}  3★=${rating(3)}  4★=${rating(4)}  5★=${rating(5)}`,
    ledgerState.result > 0n ? `  🏆 Winning rating: ${ledgerState.result.toString()}` : '  🏆 Result: not computed yet',
  ].join('\n');
}

// ─── Main CLI ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    Voting CLI                                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = createInterface({ input: stdin, output: stdout });

  // Check for deployment
  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}. Run \`npm run deploy -- --network ${network}\` first.`);
    process.exit(1);
  }
  console.log(`  Contract: ${deployment.address}`);
  console.log(`  Network: ${network}\n`);

  try {
    const seed = SEED;

    console.log('  Connecting to wallet...');
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

    // Persist sync state so the next run doesn't have to redo this work.
    await persistWalletState(network, walletCtx);
    const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

    // Setup providers and connect to contract
    console.log('  Connecting to contract...');
    const providers = await createProviders(walletCtx);

    const deployed: any = await findDeployedContract(providers, {
      compiledContract: compiledContract as any,
      contractAddress: deployment.address,
      // No initialPrivateState here: findDeployedContract would overwrite the
      // stored private state. Omitting it reconnects to the organizer's sk
      // written at deploy time (deploy must run first).
      privateStateId: PRIVATE_STATE_ID,
    });

    console.log('  ✅ Connected!\n');

    // Interactive CLI loop
    let running = true;
    while (running) {
      console.log('─── Menu ───────────────────────────────────────────────────────');
      console.log('  1. Register to vote');
      console.log('  2. Open voting (organizer)');
      console.log('  3. Commit my private rating (1-5)');
      console.log('  4. Close voting (organizer)');
      console.log('  5. Reveal my vote');
      console.log('  6. Compute results (organizer)');
      console.log('  7. View poll state');
      console.log('  8. Check wallet balance');
      console.log('  9. Exit\n');

      const choice = await rl.question('  Your choice: ');

      switch (choice.trim()) {
        case '1': {
          console.log('\n  Submitting transaction (this may take 30-60 seconds)...');
          try {
            const tx = await deployed.callTx.registerToVote();
            console.log('\n  ✅ Registered to vote.');
            console.log(`  Transaction ID: ${tx.public.txId}`);
            console.log(`  Block height: ${tx.public.blockHeight}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '2': {
          console.log('\n  Submitting transaction (this may take 30-60 seconds)...');
          try {
            const tx = await deployed.callTx.openVoting();
            console.log('\n  ✅ Voting is now OPEN.');
            console.log(`  Transaction ID: ${tx.public.txId}`);
            console.log(`  Block height: ${tx.public.blockHeight}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '3': {
          const ratingRaw = await rl.question('  Enter your private rating (1-5): ');
          const rating = BigInt(ratingRaw.trim());
          if (rating < 1n || rating > 5n) {
            console.log('\n  ❌ Rating must be between 1 and 5.\n');
            break;
          }
          // The rating is a private witness: it is stored in the wallet's
          // private state and only used inside the ZK circuit. It is never
          // written to the ledger — on-chain all that appears is the
          // commitment hash(rating, sk).
          await setPendingRating(providers, rating);
          console.log(`\n  Committing rating ${rating}... (this may take 30-60 seconds)`);
          console.log('  ℹ  The rating itself stays private; only its commitment goes on-chain.');
          try {
            const tx = await deployed.callTx.commitVote();
            console.log('\n  ✅ Vote committed privately.');
            console.log(`  Transaction ID: ${tx.public.txId}`);
            console.log(`  Block height: ${tx.public.blockHeight}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '4': {
          console.log('\n  Submitting transaction (this may take 30-60 seconds)...');
          try {
            const tx = await deployed.callTx.closeVoting();
            console.log('\n  ✅ Voting is now CLOSED.');
            console.log(`  Transaction ID: ${tx.public.txId}`);
            console.log(`  Block height: ${tx.public.blockHeight}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '5': {
          console.log('\n  Submitting transaction (this may take 30-60 seconds)...');
          try {
            const tx = await deployed.callTx.revealVote();
            console.log('\n  ✅ Vote revealed; tally updated.');
            console.log(`  Transaction ID: ${tx.public.txId}`);
            console.log(`  Block height: ${tx.public.blockHeight}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '6': {
          console.log('\n  Submitting transaction (this may take 30-60 seconds)...');
          try {
            const tx = await deployed.callTx.checkResults();
            console.log('\n  ✅ Results computed.');
            console.log(`  Transaction ID: ${tx.public.txId}`);
            console.log(`  Block height: ${tx.public.blockHeight}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '7': {
          console.log('\n  Reading poll state from blockchain...');
          try {
            const contractState = await providers.publicDataProvider.queryContractState(deployment.address);
            if (contractState) {
              console.log(`\n${renderState(Voting.ledger(contractState.data))}\n`);
            } else {
              console.log('\n  📋 No contract state found (contract may not be initialized yet)\n');
            }
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '8': {
          console.log('\n  Checking balance...');
          const currentState = await walletCtx.wallet.waitForSyncedState();
          const currentBalance = currentState.unshielded.balances[unshieldedToken().raw] ?? 0n;
          const dustBalance = currentState.dust.balance(new Date());
          console.log(`\n  tNight: ${currentBalance.toLocaleString()}`);
          console.log(`  DUST: ${dustBalance.toLocaleString()}\n`);
          break;
        }

        case '9':
          running = false;
          console.log('\n  👋 Goodbye!\n');
          break;

        default:
          console.log('\n  ❌ Invalid choice. Please enter 1-9.\n');
      }
    }

    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Error: ${message}`);
    if (message.includes('No private state found at private state ID')) {
      console.error('   This wallet has no private state for the voting contract.');
      console.error('   Run `npm run deploy -- --network <network>` first (or `npm run clean` then deploy).');
    }
  } finally {
    rl.close();
  }
}

main().catch(console.error);
