import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DownloadMenu } from './DownloadMenu';
import { ToastProvider } from './Toast';

function renderMenu(onDownload = vi.fn().mockResolvedValue(undefined), disabled = false) {
  render(<ToastProvider><DownloadMenu label="Download" onDownload={onDownload} disabled={disabled} /></ToastProvider>);
  return onDownload;
}

describe('DownloadMenu', () => {
  it('offers Excel and PDF, and downloads the one chosen', async () => {
    const onDownload = renderMenu();
    const button = screen.getByRole('button', { name: 'Download' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Excel (.xlsx)', 'PDF (.pdf)']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'PDF (.pdf)' }));
    await waitFor(() => expect(onDownload).toHaveBeenCalledWith('pdf'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape or a click elsewhere', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('reports a failed download', async () => {
    renderMenu(vi.fn().mockRejectedValue(new Error('Unable to reach the server.')));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }));
    expect(await screen.findByText('Unable to reach the server.')).toBeInTheDocument();
  });

  it('cannot be opened while there is nothing to download', () => {
    renderMenu(undefined, true);
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });
});
