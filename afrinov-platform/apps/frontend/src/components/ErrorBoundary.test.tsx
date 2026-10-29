import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';
import { recentDiagnostics, resetDiagnostics, reportError } from '../lib/diagnostics';

function Boom({ explode = true }: { explode?: boolean }) {
  if (explode) throw new Error('TypeError: cannot read properties of undefined (reading x)');
  return <p>Recovered content</p>;
}

afterEach(() => {
  resetDiagnostics();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('shows a calm fallback instead of a blank screen when a child throws', () => {
    // React logs the caught error; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary name="Dashboard"><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Something didn't go as expected")).toBeInTheDocument();
  });

  it('never renders the raw exception message or stack in the fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary name="Dashboard"><Boom /></ErrorBoundary>);
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).not.toContain('cannot read properties');
    expect(text).not.toContain('TypeError');
    expect(text).not.toMatch(/at\s+\S+/);
  });

  it('records the failure to the diagnostics sink with the boundary name', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary name="Stock"><Boom /></ErrorBoundary>);
    const events = recentDiagnostics();
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]?.source).toBe('boundary:Stock');
  });

  it('keeps unaffected siblings usable', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <>
        <p>Sidebar</p>
        <ErrorBoundary name="Panel"><Boom /></ErrorBoundary>
      </>,
    );
    expect(screen.getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('resets on an explicit user action, remounting the recovered child', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Wrapper() {
      const [explode, setExplode] = useState(true);
      return (
        <ErrorBoundary name="Panel" onReset={() => setExplode(false)}>
          <Boom explode={explode} />
        </ErrorBoundary>
      );
    }
    render(<Wrapper />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered content')).toBeInTheDocument();
  });

  it('supports a custom fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary name="Panel" fallback={({ reset }) => <button onClick={reset}>Custom retry</button>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Custom retry' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Custom retry' }));
  });
});

describe('diagnostics', () => {
  it('presents the event without exposing the raw message to the user', () => {
    const event = reportError(new Error('secret internal detail'), 'test');
    expect(event.presentation.message).not.toContain('secret internal detail');
    expect(event.detail).toContain('secret internal detail');
  });

  it('keeps the buffer bounded', () => {
    for (let i = 0; i < 80; i++) reportError(new Error(`e${i}`), 'test');
    expect(recentDiagnostics().length).toBeLessThanOrEqual(50);
  });
});
