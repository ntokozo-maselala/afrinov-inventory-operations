import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE_THEME_STORAGE_KEY, getAppearance, setAppearance } from '../hooks/useAppearance';
import { SettingsAppearance } from './SettingsSections';

vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({
    draft: { 'appearance.density': 'comfortable' },
    setDraft: vi.fn(),
    save: vi.fn(async () => ({ updated: 0 })),
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
    localStorage.clear();
    setAppearance({ theme: 'light', density: 'comfortable' });
  });

  it('applies and persists a selected theme immediately', async () => {
    const user = userEvent.setup();
    render(<SettingsAppearance />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'appearance.theme' }), 'dark');

    expect(getAppearance().theme).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBe('dark');
  });
});
