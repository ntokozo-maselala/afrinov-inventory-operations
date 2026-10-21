import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, perms } = vi.hoisted(() => ({ mockGet: vi.fn(), perms: { manage: true } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => perms.manage }),
}));

const { Projects } = await import('./Projects');
const { ToastProvider } = await import('../components/Toast');

const project = (projectNumber: string, name: string | null) => ({
  projectNumber, name, active: true, status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

const renderProjects = () => render(
  <MemoryRouter><ToastProvider><Projects /></ToastProvider></MemoryRouter>,
);

beforeEach(() => {
  perms.manage = true;
  mockGet.mockReset().mockResolvedValue([
    project('1369', 'Plant upgrade'), project('1402', null),
  ]);
});

describe('Projects material links', () => {
  it.each([true, false])('links every project to its own materials when management permission is %s', async (manage) => {
    perms.manage = manage;
    renderProjects();
    await screen.findByRole('link', { name: 'Materials for 1369' });
    expect(screen.getByRole('columnheader', { name: 'Materials' })).toBeInTheDocument();
    for (const number of ['1369', '1402']) {
      const row = screen.getByText(number).closest('tr')!;
      expect(within(row).getByRole('link', { name: `Materials for ${number}` }))
        .toHaveAttribute('href', `/materials?section=PROJECTS&project=${number}`);
    }
  });

  it('encodes a project number so reserved characters stay within the project query parameter', async () => {
    mockGet.mockResolvedValueOnce([project('A/B & 1', 'Special job')]);
    renderProjects();
    const link = await screen.findByRole('link', { name: 'Materials for A/B & 1' });
    expect(link).toHaveAttribute('href', '/materials?section=PROJECTS&project=A%2FB%20%26%201');
    const url = new URL(link.getAttribute('href')!, 'http://localhost');
    expect([...url.searchParams]).toEqual([['section', 'PROJECTS'], ['project', 'A/B & 1']]);
  });
});
