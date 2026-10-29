// The toast stack is bounded: a prolonged outage producing distinct failure
// messages must not fill the screen, and the newest failure is never lost.
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider, useToast } from './Toast';

function Raiser({ messages }: { messages: string[] }) {
  const toast = useToast();
  return (
    <button
      onClick={() => {
        for (const m of messages) toast.error('Could not complete that', m);
      }}
    >
      raise
    </button>
  );
}

describe('Toast — bounded error stack', () => {
  it('keeps only the most recent persistent errors', async () => {
    const messages = Array.from({ length: 8 }, (_, i) => `failure ${i + 1}`);
    render(
      <ToastProvider>
        <Raiser messages={messages} />
      </ToastProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'raise' }).click();
    });

    // Every message is distinct, so none is deduped; the visible stack is capped.
    expect(screen.getByText('failure 8')).toBeTruthy();
    expect(screen.queryByText('failure 1')).toBeNull();
    expect(screen.queryByText('failure 2')).toBeNull();
    expect(screen.getAllByText('Could not complete that').length).toBeLessThanOrEqual(3);
  });

  it('collapses identical messages arriving in one burst', async () => {
    render(
      <ToastProvider>
        <Raiser messages={['same failure', 'same failure', 'same failure']} />
      </ToastProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'raise' }).click();
    });

    expect(screen.getAllByText('same failure').length).toBe(1);
  });
});
