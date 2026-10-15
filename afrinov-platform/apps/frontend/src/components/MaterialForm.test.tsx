import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));
vi.mock('../api/client', () => ({ api: { post: mockPost, get: vi.fn().mockResolvedValue({}) } }));

const { MaterialForm } = await import('./MaterialForm');

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
}

describe('MaterialForm', () => {
  it('asks for a serial number only for a tool, and sends it', async () => {
    mockPost.mockReset().mockResolvedValue({ id: 'm-1', sku: 'TL-1', name: 'Drill' });
    const onSaved = vi.fn();
    render(<MaterialForm onCancel={vi.fn()} onSaved={onSaved} onError={vi.fn()} />);
    expect(screen.queryByLabelText('Serial number')).not.toBeInTheDocument();
    fill('SKU / item code', 'TL-1');
    fill('Item name', 'Makita Hand Drill');
    fireEvent.change(screen.getByLabelText('Category', { exact: false }), { target: { value: 'TOOLS' } });
    fill('Serial number', ' 34322 ');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockPost).toHaveBeenCalledWith('/materials', expect.objectContaining({ category: 'TOOLS', serialNumber: '34322' }));
  });

  it('sends no serial number for anything else', async () => {
    mockPost.mockReset().mockResolvedValue({ id: 'm-2', sku: 'CON-1', name: 'Disc' });
    render(<MaterialForm onCancel={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} />);
    fill('SKU / item code', 'CON-1');
    fill('Item name', 'Disc');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0]![1]).toMatchObject({ serialNumber: undefined });
  });
});
