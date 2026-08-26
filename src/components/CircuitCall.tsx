import { useState } from 'react';
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  Users,
  Vote,
  Eye,
  Copy,
  ExternalLink,
  Shield,
  FileCode,
  UserPlus,
  Lock,
  BarChart3,
  EyeOff,
  Star,
} from 'lucide-react';

const CONTRACT_ADDRESS = 'd2ef42d83b2b4aebffdfcac9570e96bf646ee2e313a585151ef051162b1c5de3';
const EXPLORER_URL = 'https://midnight-explorer.preview.midnight.network/';

type Phase = 'registration' | 'open' | 'closed' | 'results';
type Tallies = Record<1 | 2 | 3 | 4 | 5, number>;

function fakeCommitment(): string {
  const hex = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('');
  return `0x${hex}...`;
}

function fakeTxHash(): string {
  return Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

function truncate(s: string, head = 10, tail = 8): string {
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}

// Step progress bar
const STEPS = ['Register', 'Vote', 'Reveal', 'Results'] as const;
const PHASE_TO_STEP: Record<Phase, number> = {
  registration: 0,
  open: 1,
  closed: 2,
  results: 3,
};

function StepBar({ phase }: { phase: Phase }) {
  const activeStep = PHASE_TO_STEP[phase];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.25rem' }}>
      {STEPS.map((label, i) => {
        const done = i < activeStep;
        const active = i === activeStep;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flex: i < STEPS.length - 1 ? 1 : undefined }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
              {done ? (
                <CheckCircle2 size={16} color="var(--success)" />
              ) : active ? (
                <CheckCircle2 size={16} color="var(--accent)" />
              ) : (
                <Circle size={16} color="var(--border)" />
              )}
              <span style={{
                fontSize: '0.65rem',
                color: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--border)',
                whiteSpace: 'nowrap',
                fontWeight: active ? 600 : 400,
              }}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingBottom: '1.1rem' }}>
                <ArrowRight size={12} color={done ? 'var(--success)' : 'var(--border)'} style={{ margin: '0 auto' }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Voter stats panel
interface Stats {
  registered: number;
  committed: number;
  revealed: number;
}

function StatsPanel({ stats }: { stats: Stats }) {
  const items = [
    { icon: <Users size={14} />, label: 'Registered', value: stats.registered },
    { icon: <Vote size={14} />, label: 'Committed', value: stats.committed },
    { icon: <Eye size={14} />, label: 'Revealed', value: stats.revealed },
  ];
  return (
    <div style={{
      display: 'flex',
      gap: '0.5rem',
    }}>
      {items.map(({ icon, label, value }) => (
        <div key={label} style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.2rem',
          background: 'rgba(0,0,0,0.2)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '0.6rem 0.75rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
            {icon}
            <span style={{ fontSize: '0.7rem' }}>{label}</span>
          </div>
          <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// Tx hash display
function TxHashRow({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      background: 'rgba(0,0,0,0.25)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      padding: '0.45rem 0.75rem',
      fontSize: '0.75rem',
      fontFamily: 'monospace',
      color: 'var(--text-muted)',
    }}>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {truncate(hash, 16, 12)}
      </span>
      <button
        onClick={copy}
        title="Copy transaction hash"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: 0 }}
      >
        <Copy size={13} />
      </button>
      <a
        href={EXPLORER_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="View on Explorer"
        style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center' }}
      >
        <ExternalLink size={13} />
      </a>
    </div>
  );
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
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [revealedRating, setRevealedRating] = useState<number | null>(null);
  const [tallies, setTallies] = useState<Tallies>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  const [winner, setWinner] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({ registered: 3, committed: 2, revealed: 1 });

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
    setStats((s) => ({ ...s, registered: s.registered + 1 }));
    setTxHash(fakeTxHash());
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
    setStats((s) => ({ ...s, committed: s.committed + 1 }));
    setTxHash(fakeTxHash());
    setSuccessMsg('Vote committed on-chain. Your rating is private.');
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
    setStats((s) => ({ ...s, revealed: s.revealed + 1 }));
    setTxHash(fakeTxHash());
    setPhase('results');
  }

  const totalVotes = Object.values(tallies).reduce((a, b) => a + b, 0);

  const phaseIcon: Record<Phase, React.ReactNode> = {
    registration: <UserPlus size={12} />,
    open: <Vote size={12} />,
    closed: <Lock size={12} />,
    results: <BarChart3 size={12} />,
  };
  const phaseLabel: Record<Phase, string> = {
    registration: 'Registration',
    open: 'Voting Open',
    closed: 'Voting Closed',
    results: 'Results',
  };

  return (
    <div className="card poll-section">
      {/* Step progress */}
      <StepBar phase={phase} />

      <hr className="divider" />

      {/* Poll header */}
      <div className="poll-info">
        <div className="poll-title">Midnight Private Ratings Poll</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <FileCode size={13} color="var(--text-muted)" />
          <span className="poll-contract">{truncate(CONTRACT_ADDRESS, 14, 10)}</span>
        </div>
        <span className={`phase-badge phase-${phase}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
          {phaseIcon[phase]}
          {phaseLabel[phase]}
        </span>
      </div>

      {/* Voter stats */}
      <StatsPanel stats={stats} />

      <hr className="divider" />

      {/* Privacy notice */}
      <div className="privacy-note">
        <Shield size={14} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
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
        {successMsg && !isProving && (
          <p className="success-msg" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <CheckCircle2 size={14} />
            {successMsg}
          </p>
        )}

        {!isProving && phase === 'registration' && (
          <button className="btn btn-primary" onClick={handleRegister}>
            <UserPlus size={15} />
            Register to Vote
          </button>
        )}

        {!isProving && phase === 'open' && !isRegistered && (
          <p className="info-msg">You must register before voting opens.</p>
        )}

        {!isProving && phase === 'open' && isRegistered && !hasVoted && (
          <>
            <StarRating value={selectedRating} onChange={setSelectedRating} disabled={false} />
            {selectedRating > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                background: 'rgba(124,58,237,0.07)',
                border: '1px solid rgba(124,58,237,0.15)',
                borderRadius: '6px',
                padding: '0.4rem 0.7rem',
              }}>
                <EyeOff size={13} color="var(--accent)" />
                You will commit rating <strong style={{ color: 'var(--text)' }}>{selectedRating}/5</strong> privately
              </div>
            )}
            <button
              className="btn btn-primary"
              onClick={handleVote}
              disabled={selectedRating < 1}
            >
              <Vote size={15} />
              Submit Private Vote
            </button>
          </>
        )}

        {!isProving && phase === 'closed' && hasVoted && (
          <>
            {commitment && (
              <div style={{
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <Shield size={13} color="var(--accent)" />
                  On-chain commitment (your rating is hidden)
                </div>
                <code style={{
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  wordBreak: 'break-all',
                  lineHeight: 1.5,
                }}>
                  {commitment}
                </code>
              </div>
            )}
            <button className="btn btn-primary" onClick={handleReveal}>
              <Eye size={15} />
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

      {/* Tx hash — shown after any action */}
      {txHash && !isProving && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Transaction</span>
          <TxHashRow hash={txHash} />
        </div>
      )}

      {/* Proved label */}
      {hasVoted && (
        <div className="proved-label">
          <CheckCircle2 size={13} />
          Proved without revealing your input
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
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Star
            size={22}
            fill={display >= n ? '#f59e0b' : 'none'}
            color={display >= n ? '#f59e0b' : 'var(--border)'}
            strokeWidth={1.5}
          />
        </button>
      ))}
      <span className="rating-display">
        {value > 0 ? `${value} / 5` : 'Select a rating'}
      </span>
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
            <span className="result-label" style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <Star size={12} fill={isWinner ? '#f59e0b' : 'none'} color={isWinner ? '#f59e0b' : 'var(--text-muted)'} strokeWidth={1.5} />
              {n}
            </span>
            <div className="tally-bar-track">
              <div
                className={`tally-bar${isWinner ? ' winner-bar' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="tally-count">{count}</span>
            {isWinner && (
              <BarChart3 size={13} color="var(--success)" />
            )}
          </div>
        );
      })}

      {winner !== null && (
        <p className="success-msg" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <CheckCircle2 size={14} />
          Winning rating: {winner} / 5
        </p>
      )}

      {revealedRating !== null && (
        <div className="proved-label">
          <CheckCircle2 size={13} />
          Your vote was counted privately
        </div>
      )}
    </div>
  );
}
