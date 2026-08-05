import { useState } from 'react';

const CONTRACT_ADDRESS = 'c89921b6fd8d84376298e274021ef64c497db4fa66fcac16019b81b10c00dd14';

type Phase = 'registration' | 'open' | 'closed' | 'results';

type Tallies = Record<1 | 2 | 3 | 4 | 5, number>;

// Simulate a commitment hash — never shows the actual rating value
function fakeCommitment(): string {
  const hex = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('');
  return `0x${hex}...`;
}

function truncate(s: string, head = 10, tail = 8): string {
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}

interface Props {
  walletAddress: string | null;
}

export function CircuitCall({ walletAddress }: Props) {
  const [phase, setPhase] = useState<Phase>('registration');
  const [isRegistered, setIsRegistered] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [selectedRating, setSelectedRating] = useState(0);
  const [isProving, setIsProving] = useState(false);
  const [provingMsg, setProvingMsg] = useState('');
  const [txHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [revealedRating, setRevealedRating] = useState<number | null>(null);
  const [tallies, setTallies] = useState<Tallies>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  const [winner, setWinner] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!walletAddress) {
    return (
      <div className="card">
        <p className="connect-prompt">Connect wallet to continue.</p>
      </div>
    );
  }

  async function simulate(ms: number, msg: string): Promise<void> {
    setIsProving(true);
    setProvingMsg(msg);
    setError(null);
    setSuccessMsg(null);
    await new Promise((r) => setTimeout(r, ms));
    setIsProving(false);
    setProvingMsg('');
  }

  async function handleRegister() {
    await simulate(2000, 'Generating proof...');
    setIsRegistered(true);
    setSuccessMsg('Registered successfully. Voting is now open.');
    setPhase('open');
  }

  async function handleVote() {
    if (selectedRating < 1) {
      setError('Please select a rating before submitting.');
      return;
    }
    await simulate(2500, 'Generating ZK proof locally... (your rating stays on your device)');
    const c = fakeCommitment();
    setCommitment(c);
    setHasVoted(true);
    setSuccessMsg('Vote committed on-chain. Your rating is private.');
    // advance to closed after 1 s
    setTimeout(() => setPhase('closed'), 1000);
  }

  async function handleReveal() {
    await simulate(1500, 'Verifying commitment...');
    const rating = selectedRating as 1 | 2 | 3 | 4 | 5;
    setRevealedRating(rating);
    const newTallies: Tallies = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    newTallies[rating] = 1;
    setTallies(newTallies);
    setWinner(rating);
    setPhase('results');
  }

  const totalVotes = Object.values(tallies).reduce((a, b) => a + b, 0);

  return (
    <div className="card poll-section">
      {/* Poll info */}
      <div className="poll-info">
        <div className="poll-title">Midnight Private Ratings Poll</div>
        <div className="poll-contract">{truncate(CONTRACT_ADDRESS, 14, 10)}</div>
        <span className={`phase-badge phase-${phase}`}>
          {phase === 'registration' && '● Registration'}
          {phase === 'open' && '● Voting Open'}
          {phase === 'closed' && '● Voting Closed'}
          {phase === 'results' && '● Results'}
        </span>
      </div>

      <hr className="divider" />

      {/* Privacy notice — always visible */}
      <div className="privacy-note">
        <span className="privacy-note-icon">🔒</span>
        <span>
          Your rating is known only to you. The network sees only a cryptographic commitment — not your actual rating.
        </span>
      </div>

      {/* Phase actions */}
      <div className="vote-section">
        {isProving && (
          <div className="loading">
            <span className="spinner" />
            {provingMsg}
          </div>
        )}

        {error && <p className="error-msg">{error}</p>}
        {successMsg && !isProving && <p className="success-msg">{successMsg}</p>}

        {!isProving && phase === 'registration' && (
          <button className="btn btn-primary" onClick={handleRegister}>
            Register to Vote
          </button>
        )}

        {!isProving && phase === 'open' && !isRegistered && (
          <p className="info-msg">You must register before voting opens.</p>
        )}

        {!isProving && phase === 'open' && isRegistered && !hasVoted && (
          <>
            <StarRating
              value={selectedRating}
              onChange={setSelectedRating}
              disabled={false}
            />
            <button
              className="btn btn-primary"
              onClick={handleVote}
              disabled={selectedRating < 1}
            >
              Submit Private Vote
            </button>
            <span className="vote-label">
              <strong>Your rating stays private until reveal</strong>{' '}
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>(private)</span>
            </span>
          </>
        )}

        {!isProving && phase === 'closed' && hasVoted && (
          <>
            {commitment && (
              <>
                <div className="vote-label">On-chain commitment (not your rating):</div>
                <div className="commitment-display">{commitment}</div>
              </>
            )}
            <button className="btn btn-primary" onClick={handleReveal}>
              Reveal Your Vote
            </button>
          </>
        )}

        {!isProving && phase === 'results' && (
          <ResultSection
            tallies={tallies}
            totalVotes={totalVotes}
            winner={winner}
            revealedRating={revealedRating}
          />
        )}
      </div>

      {/* Proved label — visible once voted */}
      {(hasVoted || txHash) && (
        <div className="proved-label">
          ✓ Proved without revealing your input
        </div>
      )}
    </div>
  );
}

/* Star rating sub-component */
interface StarRatingProps {
  value: number;
  onChange(v: number): void;
  disabled: boolean;
}

function StarRating({ value, onChange, disabled }: StarRatingProps) {
  const [hovered, setHovered] = useState(0);

  const display = hovered || value;

  return (
    <div>
      <div className="star-rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={`star-btn${display >= n ? ' filled' : ''}`}
            aria-label={`Rate ${n} out of 5`}
            disabled={disabled}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
          >
            ★
          </button>
        ))}
        <span className="rating-display">
          {value > 0 ? `Rating: ${value} / 5` : 'Select a rating'}
        </span>
      </div>
    </div>
  );
}

/* Results sub-component */
interface ResultSectionProps {
  tallies: Tallies;
  totalVotes: number;
  winner: number | null;
  revealedRating: number | null;
}

function ResultSection({ tallies, totalVotes, winner, revealedRating }: ResultSectionProps) {
  return (
    <div className="result-section">
      {([1, 2, 3, 4, 5] as const).map((n) => {
        const count = tallies[n];
        const pct = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
        const isWinner = n === winner;
        return (
          <div key={n} className="result-row">
            <span className="result-label">★ {n}</span>
            <div className="tally-bar-track">
              <div
                className={`tally-bar${isWinner ? ' winner-bar' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="tally-count">{count}</span>
            {isWinner && <span className="winner-star">👑</span>}
          </div>
        );
      })}

      {winner !== null && (
        <p className="success-msg">
          Winning rating: {winner} / 5
        </p>
      )}

      {revealedRating !== null && (
        <div className="proved-label">
          ✓ Your vote was counted privately
        </div>
      )}
    </div>
  );
}
