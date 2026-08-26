import { Wallet, Lock, Zap, LogOut, Radio, ExternalLink } from 'lucide-react';
import type { UseMidnightReturn } from '../hooks/useMidnight';

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 12)}...${addr.slice(-8)}`;
}

function formatTNight(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
}

export function WalletConnect({
  address,
  networkError,
  error,
  isConnecting,
  isWalletInstalled,
  tNight,
  dust,
  connect,
  disconnect,
}: UseMidnightReturn) {
  const notFound = error?.includes('not found');

  return (
    <div className="card wallet-section">
      {networkError && <div className="wallet-alert">{networkError}</div>}
      {error && !notFound && <p className="error-msg">{error}</p>}

      {address ? (
        <div className="wallet-connected">
          <span className="wallet-dot" />
          <span className="wallet-address">{truncateAddress(address)}</span>

          <span className="wallet-badge">
            <Radio size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
            Preview
          </span>

          <div className="balance-pills">
            {tNight !== null && (
              <span className="balance-pill">
                <Lock size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                {formatTNight(tNight)} tNIGHT
              </span>
            )}

            {dust !== null && (
              <span className="balance-pill">
                <Zap size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                {dust} DUST
              </span>
            )}
          </div>

          <button
            className="btn btn-danger btn-sm"
            onClick={disconnect}
            title="Disconnect"
            aria-label="Disconnect wallet"
          >
            <LogOut size={14} />
          </button>
        </div>
      ) : isConnecting ? (
        <div className="loading">
          <span className="spinner" />
          Connecting to 1am...
        </div>
      ) : (
        <div className="wallet-disconnected">
          <button className="btn btn-primary" onClick={connect}>
            <Wallet size={16} />
            Connect 1am Wallet
          </button>
          {notFound ? (
            <span className="wallet-hint">
              1am not detected —{' '}
              <a
                href="https://1am.finance/"
                target="_blank"
                rel="noopener noreferrer"
                className="install-link"
              >
                install 1am <ExternalLink size={11} style={{ verticalAlign: 'middle' }} />
              </a>
            </span>
          ) : (
            <span className="wallet-hint">
              {isWalletInstalled ? 'Click to connect your Midnight wallet' : 'Required for proof generation'}
            </span>
          )}
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, maxWidth: 340 }}>Zero-knowledge proofs generated locally. Your private inputs never leave your device.</p>
        </div>
      )}
    </div>
  );
}
