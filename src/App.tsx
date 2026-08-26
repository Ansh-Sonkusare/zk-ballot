import './App.css';
import { ShieldCheck } from 'lucide-react';
import { useMidnight } from './hooks/useMidnight';
import { WalletConnect } from './components/WalletConnect';
import { CircuitCall } from './components/CircuitCall';

export default function App() {
  const wallet = useMidnight();

  return (
    <div className="app">
      <header className="header">
        <span className="logo">
          <ShieldCheck size={18} strokeWidth={2} color="var(--accent)" />
          midnight/zk
        </span>
        <nav>
          <ul className="nav-links">
            <li>
              <a
                href="https://github.com/Ansh-Sonkusare/zk-ballot"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
            </li>
            <li>
              <a
                href="https://www.risein.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Rise In Challenge
              </a>
            </li>
          </ul>
        </nav>
      </header>

      <main className="main">
        <div style={{ animationDelay: '0.05s' }}>
          <WalletConnect {...wallet} />
        </div>
        <div style={{ animationDelay: '0.15s', opacity: 0, animation: 'fadeInUp 0.35s 0.15s cubic-bezier(0.4,0,0.2,1) forwards' }}>
          <CircuitCall walletAddress={wallet.address} />
        </div>
      </main>

      <footer>
        Built by <a href="https://github.com/Ansh-Sonkusare" target="_blank" rel="noopener noreferrer">Ansh Sonkusare</a> on the Midnight Network · <a href="https://midnight.network" target="_blank" rel="noopener noreferrer">midnight.network</a>
      </footer>
    </div>
  );
}
