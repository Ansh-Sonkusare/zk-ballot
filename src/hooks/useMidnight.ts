import { useState, useEffect, useCallback, useRef } from 'react';

// ─── 1am wallet types (from window.midnight['1am']) ───────────────────────────

interface OneAMConfig {
  networkId: string;
  indexerUri: string;
  proverServerUri: string;
}

interface OneAMConnectedAPI {
  getConfiguration(): Promise<OneAMConfig>;
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
  getUnshieldedBalances(): Promise<Record<string, bigint>>;
  getDustBalance(): Promise<{ balance: string; cap: string }>;
}

interface OneAMInitialAPI {
  name: string;
  apiVersion: string;
  connect(networkId: string): Promise<OneAMConnectedAPI>;
}

declare global {
  interface Window {
    midnight?: Record<string, unknown>;
  }
}

const NETWORK = 'preview';

function find1am(): OneAMInitialAPI | null {
  const w = window.midnight?.['1am'] as OneAMInitialAPI | undefined;
  return w ?? null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseMidnightReturn {
  address: string | null;
  networkError: string | null;
  error: string | null;
  isConnecting: boolean;
  isWalletInstalled: boolean;
  tNight: bigint | null;
  dust: string | null;
  connect(): Promise<void>;
  disconnect(): void;
}

export function useMidnight(): UseMidnightReturn {
  const [address, setAddress] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isWalletInstalled, setIsWalletInstalled] = useState(Boolean(find1am()));
  const [tNight, setTNight] = useState<bigint | null>(null);
  const [dust, setDust] = useState<string | null>(null);
  const apiRef = useRef<OneAMConnectedAPI | null>(null);

  const connect = useCallback(async () => {
    const wallet = find1am();
    if (!wallet) {
      setError('1am wallet not found. Install the 1am browser extension.');
      return;
    }

    setIsConnecting(true);
    setError(null);
    setNetworkError(null);

    try {
      const api = await wallet.connect(NETWORK);
      apiRef.current = api;
      const [config, { unshieldedAddress }, balances, dustBal] = await Promise.all([
        api.getConfiguration(),
        api.getUnshieldedAddress(),
        api.getUnshieldedBalances(),
        api.getDustBalance(),
      ]);
      if (config.networkId !== NETWORK) {
        setNetworkError(`Connected to "${config.networkId}" — please switch to ${NETWORK} in 1am.`);
      }
      setAddress(unshieldedAddress);
      setTNight(balances['tNIGHT'] ?? null);
      setDust(dustBal.balance);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    apiRef.current = null;
    setAddress(null);
    setNetworkError(null);
    setError(null);
    setTNight(null);
    setDust(null);
  }, []);

  // Poll for wallet injection (extensions inject asynchronously)
  useEffect(() => {
    if (find1am()) return;
    let attempts = 0;
    const id = setInterval(() => {
      if (find1am()) {
        setIsWalletInstalled(true);
        clearInterval(id);
      } else if (++attempts >= 40) {
        clearInterval(id);
      }
    }, 250);
    return () => clearInterval(id);
  }, []);

  return { address, networkError, error, isConnecting, isWalletInstalled, tNight, dust, connect, disconnect };
}
