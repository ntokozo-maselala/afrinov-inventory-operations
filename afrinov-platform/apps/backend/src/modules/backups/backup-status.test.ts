// What Admins are told about backups (ADR-037).
import { describe, it, expect } from 'vitest';
import { backupHealth, type BackupRunView } from './backup-status.js';

const NOW = new Date('2026-11-11T08:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const run = (kind: BackupRunView['kind'], status: BackupRunView['status'], h: number, extra: Partial<BackupRunView> = {}): BackupRunView => ({
  kind, status, startedAt: hoursAgo(h + 0.1), finishedAt: hoursAgo(h), fileName: `afrinov-${h}.dump.gpg`, sizeBytes: 300_000, offsite: true, detail: null, ...extra,
});

describe('backupHealth', () => {
  it('says so when nothing was ever recorded', () => {
    const h = backupHealth([], NOW);
    expect(h.backup.state).toBe('NONE');
    expect(h.restoreTest.state).toBe('NONE');
    expect(h.recent).toEqual([]);
  });

  it('is happy with last night\'s backup, off site, and a recent restore test', () => {
    const h = backupHealth([run('BACKUP', 'OK', 14), run('RESTORE_TEST', 'OK', 24 * 30)], NOW);
    expect(h.backup).toMatchObject({ state: 'OK', lastSuccessAt: hoursAgo(14) });
    expect(h.restoreTest.state).toBe('OK');
  });

  it('calls a backup late after 26 hours', () => {
    expect(backupHealth([run('BACKUP', 'OK', 25)], NOW).backup.state).toBe('OK');
    expect(backupHealth([run('BACKUP', 'OK', 27)], NOW).backup.state).toBe('LATE');
  });

  it('puts a failed last backup first, even after an older success', () => {
    const h = backupHealth([run('BACKUP', 'OK', 38), run('BACKUP', 'FAILED', 14, { detail: 'upload failed' })], NOW);
    expect(h.backup.state).toBe('FAILED');
    expect(h.backup.lastRun?.detail).toBe('upload failed');
    expect(h.backup.lastSuccessAt).toBe(hoursAgo(38));
  });

  it('does not count a backup that never left the server as enough', () => {
    expect(backupHealth([run('BACKUP', 'OK', 14, { offsite: false })], NOW).backup.state).toBe('LOCAL_ONLY');
  });

  it('asks for a restore test after 92 days, or after one failed', () => {
    expect(backupHealth([run('RESTORE_TEST', 'OK', 24 * 91)], NOW).restoreTest.state).toBe('OK');
    expect(backupHealth([run('RESTORE_TEST', 'OK', 24 * 93)], NOW).restoreTest.state).toBe('DUE');
    expect(backupHealth([run('RESTORE_TEST', 'OK', 24 * 10), run('RESTORE_TEST', 'FAILED', 1)], NOW).restoreTest.state).toBe('FAILED');
  });

  it('lists the latest runs newest first', () => {
    const h = backupHealth([run('BACKUP', 'OK', 48), run('BACKUP', 'OK', 24), run('RESTORE_TEST', 'OK', 30)], NOW);
    expect(h.recent.map((r) => r.finishedAt)).toEqual([hoursAgo(24), hoursAgo(30), hoursAgo(48)]);
  });
});
