// What Admins are told about backups (ADR-037). The server works out each
// state from the runs the backup service records (GET /backups/status); this
// turns it into words, for the Dashboard card and Settings → Data & backup.
import { formatDateTime } from './format';

export interface BackupRun {
  kind: 'BACKUP' | 'RESTORE_TEST';
  status: 'OK' | 'FAILED';
  startedAt: string;
  finishedAt: string;
  fileName: string | null;
  sizeBytes: number | null;
  offsite: boolean;
  detail: string | null;
}

export interface BackupHealth {
  backup: { state: 'NONE' | 'OK' | 'LATE' | 'FAILED' | 'LOCAL_ONLY'; lastSuccessAt: string | null; lastRun: BackupRun | null };
  restoreTest: { state: 'NONE' | 'OK' | 'DUE' | 'FAILED'; lastSuccessAt: string | null; lastRun: BackupRun | null };
  recent: BackupRun[];
}

export type Tone = 'success' | 'warning' | 'danger';

export interface Notice { tone: Tone; title: string; text: string }

const since = (iso: string | null) => (iso ? `Last good one ${formatDateTime(iso)}.` : 'None has ever succeeded.');

export function backupNotice(h: BackupHealth['backup']): Notice {
  switch (h.state) {
    case 'NONE':
      return { tone: 'danger', title: 'No backup recorded', text: 'The backup service has never reported a backup. Until it does, a lost server means lost stock records.' };
    case 'FAILED':
      return { tone: 'danger', title: 'The last backup failed', text: `${h.lastRun?.detail ?? 'No reason was given.'} ${since(h.lastSuccessAt)}` };
    case 'LATE':
      return { tone: 'danger', title: 'No backup in the last day', text: `The backup service may have stopped. ${since(h.lastSuccessAt)}` };
    case 'LOCAL_ONLY':
      return { tone: 'warning', title: 'Backups stay on the server', text: `The last one, ${formatDateTime(h.lastSuccessAt!)}, was not copied off site, so losing the server loses it too.` };
    default:
      return { tone: 'success', title: 'Backed up', text: `Last backup ${formatDateTime(h.lastSuccessAt!)}, copied off site.` };
  }
}

export function restoreTestNotice(h: BackupHealth['restoreTest']): Notice {
  switch (h.state) {
    case 'NONE':
      return { tone: 'warning', title: 'No restore tested', text: 'A backup is only known to work once it has been restored. Run the restore test.' };
    case 'FAILED':
      return { tone: 'danger', title: 'The last restore test failed', text: `${h.lastRun?.detail ?? 'No reason was given.'} ${since(h.lastSuccessAt)}` };
    case 'DUE':
      return { tone: 'warning', title: 'Restore test due', text: `Restores are tested every three months. Last passed ${formatDateTime(h.lastSuccessAt!)}.` };
    default:
      return { tone: 'success', title: 'Restore tested', text: `Last passed ${formatDateTime(h.lastSuccessAt!)}.` };
  }
}

/** The one line the Dashboard shows: the worse of the two, or nothing when both are fine. */
export function dashboardNotice(h: BackupHealth): Notice | null {
  const b = backupNotice(h.backup);
  const r = restoreTestNotice(h.restoreTest);
  if (b.tone === 'danger') return b;
  if (r.tone === 'danger') return r;
  if (b.tone === 'warning') return b;
  if (r.tone === 'warning') return r;
  return null;
}

export function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
