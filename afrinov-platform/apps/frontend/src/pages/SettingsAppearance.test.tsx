import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE_THEME_STORAGE_KEY, getAppearance, setAppearance } from '../hooks/useAppearance';
import { SettingsAppearance } from './SettingsSections';

const mocks = vi.hoisted(() => ({
  setDraft: vi.fn(), save: vi.fn(async () => ({ updated: 0 })),
}));

vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({
    draft: { 'appearance.density': 'comfortable' },
    setDraft: mocks.setDraft,
    save: mocks.save,
    saving: false,
  }),
}));

vi.mock('../components/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

vi.mock('./Settings', () => {
  const definitions = {
    'appearance.theme': {
      key: 'appearance.theme', value: 'light', type: 'enum', category: 'appearance',
      description: 'Theme', isEditable: true, enumOptions: ['system', 'light', 'dark'], updatedAt: '', updatedById: null,
    },
    'appearance.density': {
      key: 'appearance.density', value: 'comfortable', type: 'enum', category: 'appearance',
      description: 'Density', isEditable: true, enumOptions: ['comfortable', 'compact'], updatedAt: '', updatedById: null,
    },
  };
  return {
    useCategorySettings: () => Object.values(definitions),
    useSetting: (key: keyof typeof definitions) => definitions[key],
    SectionPanel: ({ title, description, children }: { title: string; description?: string; children: ReactNode }) => (
      <section><h2>{title}</h2><p>{description}</p>{children}</section>
    ),
    EnumField: ({ def, value, onChange }: { def: { key: string; enumOptions: string[] | null }; value: string; onChange: (value: string) => void }) => (
      <label>{def.key}<select aria-label={def.key} value={value} onChange={(event) => onChange(event.target.value)}>
        {(def.enumOptions ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select></label>
    ),
    BooleanField: () => null,
    NumberField: () => null,
    TextField: () => null,
  };
});

describe('SettingsAppearance theme control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setAppearance({ theme: 'light', density: 'comfortable' });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setAppearance({ theme: 'light', density: 'comfortable' });
    localStorage.clear();
  });

  it('applies and persists a selected theme immediately', async () => {
    const user = userEvent.setup();
    render(<SettingsAppearance />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'appearance.theme' }), 'dark');

    expect(getAppearance().theme).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBe('dark');
    expect(mocks.setDraft).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('displays the browser theme ahead of the server definition and follows external appearance changes', () => {
    setAppearance({ theme: 'dark' });
    render(<SettingsAppearance />);

    expect(screen.getByRole('combobox', { name: 'appearance.theme' })).toHaveValue('dark');
    act(() => setAppearance({ theme: 'system' }));
    expect(screen.getByRole('combobox', { name: 'appearance.theme' })).toHaveValue('system');
  });

  it('switches from dark to light immediately without saving the server draft', async () => {
    setAppearance({ theme: 'dark' });
    render(<SettingsAppearance />);

    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'appearance.theme' }), 'light');

    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBe('light');
    expect(mocks.setDraft).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([true, false])('applies an explicit System choice immediately with OS dark=%s', async (systemDark) => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: systemDark } as MediaQueryList);
    render(<SettingsAppearance />);

    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'appearance.theme' }), 'system');

    expect(getAppearance().theme).toBe('system');
    expect(document.documentElement.classList.contains('dark')).toBe(systemDark);
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBe('system');
    expect(mocks.setDraft).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('stages density changes without altering the immediately applied browser theme', async () => {
    setAppearance({ theme: 'dark' });
    render(<SettingsAppearance />);

    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'appearance.density' }), 'compact');

    expect(mocks.setDraft).toHaveBeenCalledExactlyOnceWith('appearance.density', 'compact');
    expect(getAppearance()).toEqual({ theme: 'dark', density: 'comfortable' });
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBe('dark');
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
