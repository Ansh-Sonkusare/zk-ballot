import { useMidnight } from '../hooks/useMidnight';

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 12)}...${addr.slice(-8)}`;
}

export function WalletConnect() {
  const { address, networkError, error, isConnecting, isLaceInstalled, connect, disconnect } = useMidnight();

  if (!isLaceInstalled) {
    return (
      <div className="card wallet-section">
        <p>
          <strong>Lace wallet not found.</strong>{' '}
          <a className="install-link" href="https://www.lace.io/" target="_blank" rel="noopener noreferrer">
            Install Lace
          </a>
        </p>
        <p className="install-desc">
          Lace is required for zero-knowledge proof generation. Your private inputs never leave your device.
        </p>
      </div>
    );
  }

  return (
    <div className="card wallet-section">
      {networkError && (
        <div className="wallet-alert">
          {networkError}
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}

      {address ? (
        <div className="wallet-connected">
          <span className="wallet-dot" />
          <span className="wallet-address">{truncateAddress(address)}</span>
          <span className="wallet-badge">Preprod</span>
          <button className="btn btn-danger btn-sm" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      ) : isConnecting ? (
        <div className="loading">
          <span className="spinner" />
          Connecting to Lace...
        </div>
      ) : (
        <div className="wallet-disconnected">
          <button className="btn btn-primary" onClick={connect}>
            Connect Lace Wallet
          </button>
          <span className="wallet-hint">Required for proof generation</span>
        </div>
      )}
    </div>
  );
}
