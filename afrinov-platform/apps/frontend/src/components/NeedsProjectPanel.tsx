// "Needs a project" (materials sections roadmap, Phase 3): Project Material
// that came in without a project, from the old category or the stock workbook
// import, listed so a store controller can give each item the project it was
// bought for, several at a time. Until then an item keeps its stock and
// history but is not issued or ordered.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from './Button';
import { Field, Select } from './Field';
import { Alert } from './Alert';
import { useApi } from '../hooks/useApi';
import { useToast } from './Toast';
import { api, type ApiError } from '../api/client';
import type { Material } from '../api/types';

interface ProjectOpt { projectNumber: string; name?: string | null; status?: string; active?: boolean }

/** Projects that can take material: active, and not completed or cancelled (as the server checks). */
const isOpen = (p: ProjectOpt) => p.active !== false && p.status !== 'COMPLETED' && p.status !== 'CANCELLED';

export function NeedsProjectPanel({ items, onAssigned }: { items: Material[]; onAssigned: () => void }) {
  const projects = useApi<ProjectOpt[]>('/projects?active=true');
  const openProjects = (projects.data ?? []).filter(isOpen);
  const [ticked, setTicked] = useState<string[]>([]);
  const [projectNumber, setProjectNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const toast = useToast();
  const chosen = ticked.filter((id) => items.some((m) => m.id === id));
  const allTicked = items.length > 0 && chosen.length === items.length;

  async function assign() {
    if (!projectNumber || chosen.length === 0) return;
    setBusy(true);
    setFailures([]);
    const failed: string[] = [];
    let done = 0;
    // One at a time: each is its own change, audited on its own.
    for (const id of chosen) {
      const m = items.find((x) => x.id === id)!;
      try {
        await api.patch(`/materials/${id}`, { projectNumber });
        done++;
      } catch (err) {
        failed.push(`${m.sku}: ${(err as ApiError).message}`);
      }
    }
    setBusy(false);
    setFailures(failed);
    setTicked(failed.length ? chosen.filter((id) => failed.some((f) => f.startsWith(`${items.find((x) => x.id === id)!.sku}:`))) : []);
    if (done > 0) toast.success(`${done} item${done === 1 ? '' : 's'} given project ${projectNumber}`);
    onAssigned();
  }

  return (
    <section aria-labelledby="needs-project-h" className="surface-card p-4 mb-4 space-y-3 border-warning-300">
      <div className="space-y-1">
        <h2 id="needs-project-h" className="text-h3 text-surface-900">Needs a project <span className="text-surface-500 font-normal tabular-nums">{items.length}</span></h2>
        <p className="text-sm text-surface-600 max-w-prose">
          These items are Projects material with no project yet. Tick the ones bought for the same project, choose it, and give them that project. Until then they keep their stock but can&rsquo;t be issued or ordered.
        </p>
      </div>
      <ul className="divide-y divide-surface-100 border border-surface-200 rounded">
        <li className="flex items-center gap-3 px-3 py-2 bg-surface-50 text-sm">
          <input
            id="needs-project-all" type="checkbox" checked={allTicked}
            onChange={() => setTicked(allTicked ? [] : items.map((m) => m.id))}
          />
          <label htmlFor="needs-project-all" className="text-surface-600">Tick all</label>
        </li>
        {items.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <input
              id={`needs-project-${m.id}`} type="checkbox" aria-label={`Give ${m.sku} a project`}
              checked={chosen.includes(m.id)}
              onChange={(e) => setTicked(e.target.checked ? [...chosen, m.id] : chosen.filter((x) => x !== m.id))}
            />
            <Link to={`/materials/${m.id}`} className="btn-link text-mono">{m.sku}</Link>
            <span className="text-surface-700 truncate">{m.name}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Project" htmlFor="needs-project-choice" className="w-full sm:w-72" error={projects.error ? 'Couldn’t load projects. Reload the page to try again.' : null}>
          <Select id="needs-project-choice" value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)}>
            <option value="">{projects.loading ? 'Loading…' : '— choose a project —'}</option>
            {openProjects.map((p) => <option key={p.projectNumber} value={p.projectNumber}>{p.projectNumber}{p.name ? ` · ${p.name}` : ''}</option>)}
          </Select>
        </Field>
        <Button variant="primary" onClick={() => void assign()} loading={busy} disabled={!projectNumber || chosen.length === 0}>
          {chosen.length > 0 ? `Give ${chosen.length} item${chosen.length === 1 ? '' : 's'} this project` : 'Tick the items first'}
        </Button>
      </div>
      {failures.length > 0 && (
        <Alert tone="danger" title="Some items kept no project">
          <ul className="list-disc pl-5">{failures.map((f) => <li key={f}>{f}</li>)}</ul>
        </Alert>
      )}
    </section>
  );
}
