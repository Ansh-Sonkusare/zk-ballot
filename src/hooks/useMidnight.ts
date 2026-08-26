import { useState, useEffect, useCallback, useRef } from 'react';

interface LaceState {
  address: string;
  networkId: string;
}

interface LaceAPI {
  state(): Promise<LaceState>;
}

interface MnLace {
  apiVersion: string;
  name: string;
  rdns?: string;
  enable(): Promise<LaceAPI>;
  isEnabled(): Promise<boolean>;
}

declare global {
  interface Window {
    midnight?: Record<string, MnLace>;
  }
}

function findLace(): MnLace | null {
  const midnight = window.midnight;
  if (!midnight) return null;
  // Legacy: window.midnight.mnLace
  if ('mnLace' in midnight) return midnight.mnLace;
  // New (4.x): UUID key with rdns 'io.lace.wallet' or name 'lace'
  return Object.values(midnight).find(v => v?.rdns === 'io.lace.wallet' || v?.name === 'lace') ?? null;
}

interface UseMidnightReturn {
  address: string | null;
  networkError: string | null;
  error: string | null;
  isConnecting: boolean;
  isLaceInstalled: boolean;
  connect(): Promise<void>;
  disconnect(): void;
}

export function useMidnight(): UseMidnightReturn {
  const [address, setAddress] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLaceInstalled, setIsLaceInstalled] = useState(Boolean(findLace()));
  const apiRef = useRef<LaceAPI | null>(null);

  const connect = useCallback(async () => {
    const lace = findLace();
    if (!lace) {
      setError('Lace wallet not found. Please install the Lace browser extension.');
      return;
    }

    setIsConnecting(true);
    setError(null);
    setNetworkError(null);

    try {
      const api = await lace.enable();
      apiRef.current = api;
      const state = await api.state();
      if (state.networkId !== 'preprod') {
        setNetworkError(`Connected to "${state.networkId}" — please switch Lace to Preprod network.`);
      }
      setAddress(state.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect to Lace wallet.');
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    apiRef.current = null;
    setAddress(null);
    setNetworkError(null);
    setError(null);
  }, []);

  // Extensions inject asynchronously; poll until Lace appears or timeout.
  useEffect(() => {
    if (findLace()) return;
    let attempts = 0;
    const id = setInterval(() => {
      if (findLace()) {
        setIsLaceInstalled(true);
        clearInterval(id);
      } else if (++attempts >= 20) {
        clearInterval(id);
      }
    }, 250);
    return () => clearInterval(id);
  }, []);

  // Auto-reconnect if already enabled
  useEffect(() => {
    const lace = findLace();
    if (!lace) return;
    lace.isEnabled().then((enabled) => {
      if (enabled) connect();
    }).catch(() => {});
  }, [isLaceInstalled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { address, networkError, error, isConnecting, isLaceInstalled, connect, disconnect };
}
