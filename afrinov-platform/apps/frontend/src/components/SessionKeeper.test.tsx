// Idle sign-out on the screen (ADR-035): renew while the person works, warn
// in the last minute when they don't, end the session when the token runs out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';

const { mockPost, tokenStore } = vi.hoisted(() => ({ mockPost: vi.fn(), tokenStore: { value: null as string | null } }));
vi.mock('../api/client', () => ({
  api: { post: mockPost },
  FRONTEND_ONLY: false,
  SESSION_EXPIRED_EVENT: 'afrinov:session-expired',
  getToken: () => tokenStore.value,
  setToken: (t: string | null) => { tokenStore.value = t; },
}));

const { SessionKeeper } = await import('./SessionKeeper');
const { forgetOwnActivity } = await import('../lib/session');

const NOW = Date.parse('2026-11-11T08:00:00Z');
const s = (ms: number) => Math.floor(ms / 1000);

function token(claims: { iat: number; exp: number; auth_time?: number }): string {
  const part = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'HS256' })}.${part({ sub: 'u1', ...claims })}.sig`;
}
/** A token issued `ageMin` minutes ago for `lifeMin` minutes. */
const tokenAged = (ageMin: number, lifeMin = 60, signedInMinAgo = ageMin) => token({
  iat: s(NOW - ageMin * 60_000), exp: s(NOW - ageMin * 60_000 + lifeMin * 60_000), auth_time: s(NOW - signedInMinAgo * 60_000),
});

async function tick(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function mount() {
  const onSignOut = vi.fn();
  render(<SessionKeeper onSignOut={onSignOut} />);
  return onSignOut;
}

describe('SessionKeeper', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    forgetOwnActivity();
    mockPost.mockReset();
    tokenStore.value = null;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renews the token while the person is working', async () => {
    tokenStore.value = tokenAged(2);
    const renewed = token({ iat: s(NOW), exp: s(NOW) + 3600 });
    mockPost.mockResolvedValue({ token: renewed, user: { id: 'u1' } });
    mount();
    fireEvent.keyDown(window, { key: 'a' });
    await tick(1000);
    expect(mockPost).toHaveBeenCalledWith('/auth/refresh');
    expect(tokenStore.value).toBe(renewed);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('leaves the token alone while nothing is happening, then warns in the last minute', async () => {
    tokenStore.value = tokenAged(58.5);
    mount();
    await tick(1000);
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // 90 seconds were left; 31 have gone.
    await tick(30_000);
    expect(screen.getByRole('dialog', { name: 'Are you still there?' })).toBeInTheDocument();
    expect(screen.getByText(/signed out in 0:59/)).toBeInTheDocument();
    await tick(10_000);
    expect(screen.getByText(/signed out in 0:49/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('keeps the person signed in when they say so', async () => {
    tokenStore.value = tokenAged(59.5);
    const renewed = token({ iat: s(NOW), exp: s(NOW) + 3600 });
    mockPost.mockResolvedValue({ token: renewed, user: { id: 'u1' } });
    mount();
    await tick(1000);
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await tick(0);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(tokenStore.value).toBe(renewed);
    await tick(1000);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('signs out at once when the person chooses to', async () => {
    tokenStore.value = tokenAged(59.5);
    const onSignOut = mount();
    await tick(1000);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('ends the session when the token runs out, as a refused request would', async () => {
    const t = tokenAged(59.9);
    tokenStore.value = t;
    const ended = vi.fn();
    window.addEventListener('afrinov:session-expired', ended);
    try {
      mount();
      await tick(10_000);
      expect(ended).toHaveBeenCalledTimes(1);
      expect((ended.mock.calls[0]![0] as CustomEvent<{ token: string }>).detail.token).toBe(t);
      expect(mockPost).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('afrinov:session-expired', ended);
    }
  });

  it('counts work in another tab', async () => {
    tokenStore.value = tokenAged(59.5);
    mockPost.mockResolvedValue({ token: token({ iat: s(NOW), exp: s(NOW) + 3600 }), user: { id: 'u1' } });
    mount();
    // Another tab records its activity in storage.
    localStorage.setItem('afrinov.lastActivity', String(NOW));
    await tick(1000);
    expect(mockPost).toHaveBeenCalledWith('/auth/refresh');
  });

  it('asks for one renewal at a time, and waits before trying again after a failure', async () => {
    tokenStore.value = tokenAged(2);
    let fail: (e: unknown) => void = () => {};
    mockPost.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    mount();
    fireEvent.pointerDown(window);
    await tick(5000);
    expect(mockPost).toHaveBeenCalledTimes(1);
    await act(async () => { fail({ code: 'NETWORK_ERROR', message: 'offline' }); });
    fireEvent.pointerDown(window);
    await tick(20_000);
    expect(mockPost).toHaveBeenCalledTimes(1);
    await tick(15_000);
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('keeps a renewal from replacing the token of a newer sign-in', async () => {
    const old = tokenAged(2);
    tokenStore.value = old;
    let finish: (v: unknown) => void = () => {};
    mockPost.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    mount();
    fireEvent.keyDown(window, { key: 'a' });
    await tick(1000);
    const newer = token({ iat: s(NOW), exp: s(NOW) + 3600 });
    tokenStore.value = newer;
    await act(async () => { finish({ token: 'renewed-old-session', user: { id: 'u1' } }); });
    expect(tokenStore.value).toBe(newer);
  });

  it('says when the sign-in is at its 12 hours, with no offer to stay', async () => {
    // Issued 11h30 into the sign-in, running to its end.
    tokenStore.value = token({ iat: s(NOW - 29.5 * 60_000), exp: s(NOW + 30_000), auth_time: s(NOW + 30_000 - 12 * 3_600_000) });
    mount();
    fireEvent.keyDown(window, { key: 'a' });
    await tick(1000);
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Your sign-in is ending' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stay signed in' })).not.toBeInTheDocument();
    expect(screen.getByText(/A sign-in lasts 12 hours/)).toBeInTheDocument();
  });

  it('does nothing with a token it cannot read, such as the demo mode\'s', async () => {
    tokenStore.value = 'mock-token';
    mount();
    fireEvent.keyDown(window, { key: 'a' });
    await tick(120_000);
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
