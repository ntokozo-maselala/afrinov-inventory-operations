import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Material } from '../api/types';

const { mockPost, mockPatch, mockGet } = vi.hoisted(() => ({ mockPost: vi.fn(), mockPatch: vi.fn(), mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { post: mockPost, patch: mockPatch, get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

const { MaterialForm } = await import('./MaterialForm');
const SAVED = { id: 'm-new', sku: '1369-PIPE', name: 'Pipe' };

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
}

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => path.startsWith('/projects')
    ? [{ projectNumber: '1369', name: 'Plant upgrade', status: 'ACTIVE', active: true }]
    : {});
  mockPost.mockReset().mockResolvedValue(SAVED);
  mockPatch.mockReset().mockResolvedValue(SAVED);
});

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

const PROJECT_ITEM: Material = {
  id: 'm-project', sku: '1369-PIPE', name: 'Pipe', category: 'PROJECT_MATERIAL',
  unitOfMeasure: 'each', requiredStock: '99', unitCost: '12.5000', active: true,
  projectNumber: '1369', project: { projectNumber: '1369', name: 'Plant upgrade' },
};

function renderForm(props: Partial<ComponentProps<typeof MaterialForm>> = {}) {
  const callbacks = { onCancel: vi.fn(), onSaved: vi.fn(), onError: vi.fn() };
  render(<MaterialForm {...callbacks} {...props} />);
  return callbacks;
}

function fillIdentity() {
  fill('SKU / item code', ' 1369-PIPE ');
  fill('Item name', ' Pipe ');
}

describe('MaterialForm sections', () => {
  it('lists active, planning, on-hold and legacy projects, excluding inactive, completed and cancelled projects', async () => {
    mockGet.mockImplementation(async (path: string) => path.startsWith('/projects') ? [
      { projectNumber: 'ACTIVE', status: 'ACTIVE', active: true },
      { projectNumber: 'PLAN', name: 'Planned job', status: 'PLANNING', active: true },
      { projectNumber: 'HOLD', status: 'ON_HOLD', active: true },
      { projectNumber: 'LEGACY', name: null },
      { projectNumber: 'INACTIVE', status: 'ACTIVE', active: false },
      { projectNumber: 'DONE', status: 'COMPLETED', active: true },
      { projectNumber: 'CANCELLED', status: 'CANCELLED', active: true },
    ] : {});
    renderForm({ section: 'PROJECTS' });
    await screen.findByRole('option', { name: 'LEGACY' });
    expect(mockGet).toHaveBeenCalledWith('/projects?active=true');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '— choose a project —', 'ACTIVE', 'PLAN · Planned job', 'HOLD', 'LEGACY',
    ]);
  });

  it('shows a project-loading error and blocks creating an unassigned Projects item', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/projects')) throw { code: 'FORBIDDEN', message: 'Unavailable' };
      return {};
    });
    const { onSaved } = renderForm({ section: 'PROJECTS' });
    expect(await screen.findByText('Couldn’t load projects. Close and reopen to try again.')).toBeInTheDocument();
    fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.getByText('Choose the project this material is for.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('creates a Projects item with the supplied project, trimming its fields and omitting Stores fields', async () => {
    const { onSaved } = renderForm({ section: 'PROJECTS', projectNumber: '1369' });
    await screen.findByRole('option', { name: '1369 · Plant upgrade' });
    expect(screen.getByLabelText(/^Project\b/)).toHaveValue('1369');
    expect(screen.queryByLabelText('Category', { exact: false })).not.toBeInTheDocument();
    fillIdentity();
    fill('Unit of measure', ' m ');
    fill('Description', ' Galvanised pipe ');
    fill('Unit cost', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED));
    expect(mockPost).toHaveBeenCalledExactlyOnceWith('/materials', {
      sku: '1369-PIPE', name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm',
      description: 'Galvanised pipe', unitCost: 0, projectNumber: '1369', serialNumber: undefined,
    });
  });

  it('does not send a tool category, serial number or invalid reorder level after switching to Projects', async () => {
    const { onSaved } = renderForm();
    fillIdentity();
    fill('Category', 'TOOLS');
    fill('Serial number', 'SN-1');
    fill('Reorder level', '-1');
    fireEvent.click(screen.getByRole('radio', { name: /Projects/ }));
    await screen.findByRole('option', { name: '1369 · Plant upgrade' });
    fill(/^Project\b/, '1369');
    expect(screen.queryByLabelText('Serial number')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reorder level')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = mockPost.mock.calls[0]![1];
    expect(body).toMatchObject({ category: 'PROJECT_MATERIAL', projectNumber: '1369' });
    expect(body.serialNumber).toBeUndefined();
    expect(body).not.toHaveProperty('requiredStock');
  });

  it('uses Stores fields and omits the selected project after switching back to Stores', async () => {
    const { onSaved } = renderForm({ section: 'PROJECTS', projectNumber: '1369' });
    await screen.findByRole('option', { name: '1369 · Plant upgrade' });
    fillIdentity();
    fireEvent.click(screen.getByRole('radio', { name: /Stores/ }));
    fill('Category', 'TOOLS');
    fill('Serial number', ' SN-2 ');
    fill('Reorder level', '0');
    expect(screen.queryByLabelText(/^Project\b/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = mockPost.mock.calls[0]![1];
    expect(body).toMatchObject({ category: 'TOOLS', requiredStock: 0, serialNumber: 'SN-2' });
    expect(body).not.toHaveProperty('projectNumber');
  });

  it('does not fetch project options for a Stores item', async () => {
    renderForm();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(expect.stringMatching(/^\/settings\/values/)));
    expect(mockGet.mock.calls.some(([path]) => path.startsWith('/projects'))).toBe(false);
  });

  it.each(['', '-0.1'])('rejects Stores reorder level %j before calling the API', (value) => {
    const { onSaved } = renderForm();
    fillIdentity();
    fill('Reorder level', value);
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.getByText('Reorder level must be 0 or positive.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('blocks saving an unassigned Projects item until a project is chosen, then clears the error', async () => {
    const { onSaved } = renderForm({ initial: { ...PROJECT_ITEM, projectNumber: null, project: null } });
    await screen.findByRole('option', { name: '1369 · Plant upgrade' });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText('Choose the project this material is for.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Project\b/)).toHaveValue('');
    expect(mockPatch).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    fill(/^Project\b/, '1369');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED));
    expect(screen.queryByText('Choose the project this material is for.')).not.toBeInTheDocument();
    expect(mockPatch).toHaveBeenCalledExactlyOnceWith('/materials/m-project', {
      name: 'Pipe', unitOfMeasure: 'each', unitCost: 12.5, description: null, projectNumber: '1369',
    });
  });

  it.each([null, { projectNumber: '1369', name: null }])('keeps an assigned project fixed without needing its name (%j)', async (project) => {
    const { onSaved } = renderForm({ initial: { ...PROJECT_ITEM, project }, section: 'STORES', projectNumber: 'OTHER' });
    expect(screen.getByRole('radio', { name: /Projects/ })).toBeChecked();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByLabelText(/^SKU/)).toBeDisabled();
    expect(screen.getByLabelText(/^Project\b/)).toBeDisabled();
    expect(screen.getByLabelText(/^Project\b/)).toHaveValue('1369');
    fill('Item name', ' New pipe ');
    fill('Unit cost', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockPatch).toHaveBeenCalledExactlyOnceWith('/materials/m-project', {
      name: 'New pipe', unitOfMeasure: 'each', unitCost: null, description: null,
    });
    expect(mockGet.mock.calls.some(([path]) => path.startsWith('/projects'))).toBe(false);
  });

  it('reports a rejected project assignment and allows the user to retry', async () => {
    const error = { code: 'VALIDATION_ERROR', message: 'This project is no longer open.' };
    mockPatch.mockRejectedValueOnce(error);
    const { onError, onSaved } = renderForm({ initial: { ...PROJECT_ITEM, projectNumber: null, project: null } });
    await screen.findByRole('option', { name: '1369 · Plant upgrade' });
    fill(/^Project\b/, '1369');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED));
    expect(mockPatch).toHaveBeenCalledTimes(2);
  });

  it('uses the existing Stores section and category on edit even when Projects defaults are supplied', async () => {
    const { onSaved } = renderForm({
      initial: { ...PROJECT_ITEM, category: 'TOOLS', projectNumber: null, project: null, serialNumber: 'SN-1' },
      section: 'PROJECTS', projectNumber: 'OTHER',
    });
    expect(screen.getByRole('radio', { name: /Stores/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Stores/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Projects/ })).toBeDisabled();
    expect(screen.getByLabelText(/^Category/)).toHaveValue('TOOLS');
    expect(screen.getByLabelText(/^Category/)).toBeDisabled();
    fill('Reorder level', '2.5');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockPatch).toHaveBeenCalledExactlyOnceWith('/materials/m-project', {
      name: 'Pipe', unitOfMeasure: 'each', unitCost: 12.5, description: null, requiredStock: 2.5, serialNumber: 'SN-1',
    });
  });
});
