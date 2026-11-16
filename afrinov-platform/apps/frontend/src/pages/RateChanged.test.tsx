// When an exchange rate was last changed, in warning colour after 30 days (system audit D8).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RateChanged } from './SettingsSections';

const now = new Date('2026-11-15T08:00:00Z');

describe('RateChanged', () => {
  it('says when a rate was last changed', () => {
    render(<RateChanged value={19.8} updatedAt="2026-11-01T08:00:00Z" now={now} />);
    expect(screen.getByText(/^Last changed .*2026\.$/)).toBeInTheDocument();
  });

  it('calls out a rate changed more than 30 days ago', () => {
    render(<RateChanged value={18.2} updatedAt="2026-10-01T08:00:00Z" now={now} />);
    expect(screen.getByText(/45 days ago: check it is still right/)).toHaveClass('text-warning-700');
  });

  it('says nothing for a rate not set', () => {
    const { container } = render(<RateChanged value={0} updatedAt="2025-01-01T00:00:00Z" now={now} />);
    expect(container).toBeEmptyDOMElement();
  });
});
