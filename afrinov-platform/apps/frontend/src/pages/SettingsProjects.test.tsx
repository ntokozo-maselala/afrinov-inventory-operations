// Settings → Projects (Project Tracking Roadmap, Phase 2.5): the step templates
// and the closed days, each one entry per line, saved as text.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPatch } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPatch: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: mockPatch, put: vi.fn(), del: vi.fn() },
  FRONTEND_ONLY: false,
  isSafeServerMessage: () => true,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['ADMIN'] } }) }));
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: true }));

const { SettingsProvider, useSettings } = await import('../hooks/useSettings');
const { SettingsProjects } = await import('./SettingsSections');
const { ToastProvider } = await import('../components/Toast');

function Loaded() { return useSettings().loading ? null : <SettingsProjects />; }

const setting = (key: string, value: string) => ({
  key, value, type: 'string', category: 'projects', description: `About ${key}`, isEditable: true, enumOptions: null, updatedAt: '', updatedById: null,
});

describe('Settings: projects', () => {
  it('shows the templates and closed days as text, one per line, and saves a change', async () => {
    mockGet.mockReset().mockImplementation(async (path: string) => (path === '/settings'
      ? [setting('projects.stepTemplates', 'Workshop job: Kick-off, Engineering'), setting('projects.closedDays', '')]
      : []));
    mockPatch.mockReset().mockImplementation(async (_path: string, body: { updates: Record<string, unknown> }) =>
      Object.entries(body.updates).map(([key, value]) => setting(key, String(value))));
    render(<MemoryRouter><ToastProvider><SettingsProvider canEdit><Loaded /></SettingsProvider></ToastProvider></MemoryRouter>);

    const templates = await screen.findByDisplayValue('Workshop job: Kick-off, Engineering');
    expect(templates.tagName).toBe('TEXTAREA');
    const textareas = screen.getAllByRole('textbox');
    const closed = textareas.find((t) => t !== templates)!;
    fireEvent.change(closed, { target: { value: '2026-12-25 Christmas Day\n2026-12-26 Day of Goodwill' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/settings', { updates: { 'projects.closedDays': '2026-12-25 Christmas Day\n2026-12-26 Day of Goodwill' } }));
  });
});
