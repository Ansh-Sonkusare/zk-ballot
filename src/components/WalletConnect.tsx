import { useMidnight } from '../hooks/useMidnight';

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 12)}...${addr.slice(-8)}`;
}

export function WalletConnect() {
  const { address, networkError, error, isConnecting, connect, disconnect } = useMidnight();

  const notFound = error?.includes('not found');

  return (
    <div className="card wallet-section">
      {networkError && <div className="wallet-alert">{networkError}</div>}

      {error && !notFound && <p className="error-msg">{error}</p>}

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
          {notFound ? (
            <span className="wallet-hint">
              Lace not detected —{' '}
              <a href="https://www.lace.io/" target="_blank" rel="noopener noreferrer">
                install Lace
              </a>{' '}
              or try again after it loads
            </span>
          ) : (
            <span className="wallet-hint">Required for proof generation</span>
          )}
        </div>
      )}
    </div>
  );
}
