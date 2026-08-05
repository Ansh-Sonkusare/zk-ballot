import './App.css';
import { useMidnight } from './hooks/useMidnight';
import { WalletConnect } from './components/WalletConnect';
import { CircuitCall } from './components/CircuitCall';

export default function App() {
  const { address } = useMidnight();

  return (
    <div className="app">
      <header className="header">
        <span className="logo">
          <span className="logo-icon">🔒</span>
          Midnight Private Voting
        </span>
        <nav>
          <ul className="nav-links">
            <li>
              <a
                href="https://github.com/Ansh-Sonkusare/midnight"
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
        <WalletConnect />
        <CircuitCall walletAddress={address} />
      </main>

      <footer>
        Built on Midnight Network · Zero-Knowledge Privacy
      </footer>
    </div>
  );
}
