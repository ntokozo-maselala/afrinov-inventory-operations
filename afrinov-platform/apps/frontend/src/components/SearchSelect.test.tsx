import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchSelect, matches, type SearchOption } from './SearchSelect';

const OPTIONS: SearchOption[] = [
  { value: 'a', label: 'Cutting disc (DISC-115)', detail: 'A-1 · 10 each' },
  { value: 'b', label: 'Welding gloves (GLOVE-L)', detail: 'B-2 · 4 pair', keywords: 'PPE' },
];

describe('SearchSelect', () => {
  it('matches every typed word anywhere in the label, detail or keywords, ignoring case', () => {
    expect(matches(OPTIONS[1]!, 'glove b-2')).toBe(true);
    expect(matches(OPTIONS[1]!, 'ppe')).toBe(true);
    expect(matches(OPTIONS[1]!, 'glove a-1')).toBe(false);
  });

  it('keeps the chosen item when Escape abandons a search', () => {
    const onChange = vi.fn();
    render(<SearchSelect id="s" value="a" onChange={onChange} options={OPTIONS} />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue('Cutting disc (DISC-115)');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'glo' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('Cutting disc (DISC-115)');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows at most 50 matches and says how many more there are', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: `Bolt M${i}` }));
    render(<SearchSelect id="s" value="" onChange={() => {}} options={many} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option')).toHaveLength(50);
    expect(screen.getByText('10 more. Keep typing to narrow the list.')).toBeInTheDocument();
  });
});
