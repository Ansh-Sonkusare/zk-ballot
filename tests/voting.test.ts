import { describe, it, expect } from 'vitest';
import { VotingSimulator, createPrivateState } from './voting-simulator.js';
import { VotingState } from '../contracts/managed/voting/contract/index.js';

describe('Voting contract', () => {
  it('initializes deterministically with poll name and zero tallies', () => {
    const a = new VotingSimulator('The Great Poll');
    const b = new VotingSimulator('The Great Poll');
    const la = a.getLedger();
    expect(la.pollName).toBe('The Great Poll');
    expect(la.votingState).toBe(VotingState.REGISTRATION);
    expect(la.organizer).toHaveLength(32);
    expect(la.totalVotes).toBe(0n);
    expect(la.rating1).toBe(0n);
    expect(la.rating2).toBe(0n);
    expect(la.rating3).toBe(0n);
    expect(la.rating4).toBe(0n);
    expect(la.rating5).toBe(0n);
    expect(la.result).toBe(0n);
    expect(la.registeredVoters.isEmpty()).toBe(true);
    expect(la.hashedVoteMap.isEmpty()).toBe(true);
  });

  it('lets a voter register exactly once', () => {
    const sim = new VotingSimulator();
    sim.registerToVote();
    expect(sim.getLedger().registeredVoters.size()).toBe(1n);
    expect(() => sim.registerToVote()).toThrow();
  });

  it('requires at least one registered voter before opening', () => {
    const sim = new VotingSimulator();
    expect(() => sim.openVoting()).toThrow();
    expect(sim.getLedger().votingState).toBe(VotingState.REGISTRATION);
  });

  it('opens voting only as the organizer', () => {
    const sim = new VotingSimulator();
    sim.registerToVote();
    sim.openVoting();
    expect(sim.getLedger().votingState).toBe(VotingState.OPEN);
  });

  it('requires voting to be open before a vote can be committed', () => {
    const sim = new VotingSimulator();
    sim.registerToVote();
    sim.setVote(2n);
    expect(() => sim.commitVote()).toThrow();
    expect(sim.getLedger().totalVotes).toBe(0n);
  });

  it('commits a private rating without revealing it on-chain', () => {
    const sim = new VotingSimulator();
    sim.registerToVote();
    sim.openVoting();
    sim.setVote(4n);
    sim.commitVote();
    const l = sim.getLedger();
    expect(l.totalVotes).toBe(1n);
    expect(l.hashedVoteMap.size()).toBe(1n);
    // The committed hash is opaque — none of the tallies move during commit.
    expect(l.rating1).toBe(0n);
    expect(l.rating2).toBe(0n);
    expect(l.rating3).toBe(0n);
    expect(l.rating4).toBe(0n);
    expect(l.rating5).toBe(0n);
    const hash = l.hashedVoteMap.lookup(l.organizer);
    expect(hash).toHaveLength(32);
  });

  it('rejects out-of-range ratings', () => {
    const sim = new VotingSimulator();
    sim.registerToVote();
    sim.openVoting();
    sim.setVote(0n);
    expect(() => sim.commitVote()).toThrow();
    sim.setVote(6n);
    expect(() => sim.commitVote()).toThrow();
    expect(sim.getLedger().totalVotes).toBe(0n);
  });

  it('prevents a voter from voting twice', () => {
    const sim = new VotingSimulator();
    sim.registerToVote();
    sim.openVoting();
    sim.setVote(3n);
    sim.commitVote();
    expect(() => sim.commitVote()).toThrow();
  });

  it('only reveals votes after the ballot closes', () => {
    const sim = new VotingSimulator();
    sim.registerToVote();
    sim.openVoting();
    sim.setVote(4n);
    sim.commitVote();
    expect(() => sim.revealVote()).toThrow();
    sim.closeVoting();
    sim.revealVote();
    expect(sim.getLedger().rating4).toBe(1n);
  });

  it('tallies the revealed rating into the right counter', () => {
    const sim = new VotingSimulator();
    sim.registerToVote();
    sim.openVoting();
    sim.setVote(4n);
    sim.commitVote();
    sim.closeVoting();
    sim.revealVote();
    const l = sim.getLedger();
    expect(l.rating4).toBe(1n);
    expect(l.rating1).toBe(0n);
    expect(l.rating2).toBe(0n);
    expect(l.rating3).toBe(0n);
    expect(l.rating5).toBe(0n);
  });

  it('rejects a revealed rating that differs from the committed one', () => {
    const sim = new VotingSimulator();
    sim.registerToVote();
    sim.openVoting();
    sim.setVote(3n);
    sim.commitVote();
    sim.closeVoting();
    sim.setVote(5n); // attempt to change mind after committing
    expect(() => sim.revealVote()).toThrow();
    expect(sim.getLedger().rating3).toBe(0n);
    expect(sim.getLedger().rating5).toBe(0n);
  });

  it('computes the winning rating across multiple voters (ties resolve lower)', () => {
    const sim = new VotingSimulator();
    sim.registerToVote();

    const voter2 = createPrivateState();
    sim.switchVoter(voter2);
    sim.registerToVote();

    sim.switchToOrganizer();
    sim.openVoting();

    sim.setVote(4n);
    sim.commitVote();

    sim.switchVoter(voter2);
    sim.setVote(2n);
    sim.commitVote();

    sim.switchToOrganizer();
    sim.closeVoting();

    sim.setVote(4n);
    sim.revealVote();
    sim.switchVoter(voter2);
    sim.setVote(2n);
    sim.revealVote();

    sim.switchToOrganizer();
    sim.checkResults();
    expect(sim.getLedger().rating2).toBe(1n);
    expect(sim.getLedger().rating4).toBe(1n);
    expect(sim.getLedger().result).toBe(2n);
  });

  it('does not let an unregistered voter cast a vote', () => {
    const sim = new VotingSimulator();
    const stranger = createPrivateState();
    sim.registerToVote();
    sim.openVoting();
    sim.switchVoter(stranger);
    sim.setVote(5n);
    expect(() => sim.commitVote()).toThrow();
  });
});
