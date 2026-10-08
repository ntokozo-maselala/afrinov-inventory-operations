// Recipient and project pickers shared by every screen that issues stock.
// Issued To is required (ADR-008); the project is optional but chosen from the
// project list, so consumption reports are not split by typing variations.
import { useEffect, useState } from 'react';
import { Field, Select } from './Field';
import { api } from '../api/client';

export interface RecipientOption { id: string; name: string; type: 'WORKER' | 'MACHINE' | 'SITE' | 'CONTRACTOR' }
export interface ProjectOption { projectNumber: string; name?: string | null }

const TYPE_GROUP: Array<[RecipientOption['type'], string]> = [
  ['WORKER', 'Workers'],
  ['MACHINE', 'Machines'],
  ['SITE', 'Sites'],
  ['CONTRACTOR', 'Contractors'],
];

/** Active recipients and projects, loaded once per form. */
export function useIssueOptions(): { recipients: RecipientOption[]; projects: ProjectOption[]; loading: boolean } {
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    Promise.all([
      api.get<RecipientOption[]>('/recipients?active=true').catch(() => []),
      api.get<ProjectOption[]>('/projects?active=true').catch(() => []),
    ]).then(([r, p]) => {
      if (!live) return;
      setRecipients(r);
      setProjects(p);
      setLoading(false);
    });
    return () => { live = false; };
  }, []);
  return { recipients, projects, loading };
}

/** Render the required recipient picker, grouping supplied options by recipient type. */
export function RecipientSelect({ id, value, onChange, recipients, invalid, disabled }: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  recipients: RecipientOption[];
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <Field label="Issued to" htmlFor={id} required help="Who is receiving the stock: a worker, machine, site or contractor.">
      <Select id={id} required value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid} disabled={disabled}>
        <option value="">— choose —</option>
        {TYPE_GROUP.map(([type, label]) => {
          const group = recipients.filter((r) => r.type === type);
          return group.length > 0 && (
            <optgroup key={type} label={label}>
              {group.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </optgroup>
          );
        })}
      </Select>
    </Field>
  );
}

/** Render an optional project picker whose values are canonical project numbers. */
export function ProjectSelect({ id, value, onChange, projects, disabled }: {
  id: string;
  value: string;
  onChange: (projectNumber: string) => void;
  projects: ProjectOption[];
  disabled?: boolean;
}) {
  return (
    <Field label="Project (optional)" htmlFor={id} help="Link the issue to a project so it shows in consumption reports.">
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">No project</option>
        {projects.map((p) => (
          <option key={p.projectNumber} value={p.projectNumber}>{p.projectNumber}{p.name ? ` · ${p.name}` : ''}</option>
        ))}
      </Select>
    </Field>
  );
}
