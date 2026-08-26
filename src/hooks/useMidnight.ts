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
  enable(): Promise<LaceAPI>;
  isEnabled(): Promise<boolean>;
}

declare global {
  interface Window {
    midnight?: { mnLace?: MnLace };
  }
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
  const [isLaceInstalled, setIsLaceInstalled] = useState(Boolean(window.midnight?.mnLace));
  const apiRef = useRef<LaceAPI | null>(null);

  const connect = useCallback(async () => {
    const lace = window.midnight?.mnLace;
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

  // Extensions inject into window asynchronously; poll until Lace appears or timeout.
  useEffect(() => {
    if (window.midnight?.mnLace) return;
    let attempts = 0;
    const id = setInterval(() => {
      if (window.midnight?.mnLace) {
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
    const lace = window.midnight?.mnLace;
    if (!lace) return;

    lace.isEnabled().then((enabled) => {
      if (enabled) connect();
    }).catch(() => {
      // silently ignore — wallet may not be ready yet
    });
  }, [isLaceInstalled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { address, networkError, error, isConnecting, isLaceInstalled, connect, disconnect };
}
