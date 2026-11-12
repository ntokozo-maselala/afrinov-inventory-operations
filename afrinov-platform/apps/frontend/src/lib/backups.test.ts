// What Admins are told about backups (ADR-037).
import { describe, it, expect } from 'vitest';
import { backupNotice, dashboardNotice, formatSize, restoreTestNotice, type BackupHealth } from './backups';

const at = '2026-11-10T16:30:00Z';
const health = (backup: BackupHealth['backup']['state'], restore: BackupHealth['restoreTest']['state'], detail: string | null = null): BackupHealth => ({
  backup: { state: backup, lastSuccessAt: backup === 'NONE' ? null : at, lastRun: { kind: 'BACKUP', status: backup === 'FAILED' ? 'FAILED' : 'OK', startedAt: at, finishedAt: at, fileName: 'f', sizeBytes: 1, offsite: true, detail } },
  restoreTest: { state: restore, lastSuccessAt: restore === 'NONE' ? null : at, lastRun: null },
  recent: [],
});

describe('backup notices', () => {
  it('gives the reason a backup failed, and when one last worked', () => {
    const n = backupNotice(health('FAILED', 'OK', 'kept on this server, but copying off site failed').backup);
    expect(n.tone).toBe('danger');
    expect(n.text).toMatch(/copying off site failed/);
    expect(n.text).toMatch(/Last good one/);
  });

  it('warns when a backup never left the server', () => {
    expect(backupNotice(health('LOCAL_ONLY', 'OK').backup)).toMatchObject({ tone: 'warning', title: 'Backups stay on the server' });
  });

  it('asks for a restore test when none was run or one is due', () => {
    expect(restoreTestNotice(health('OK', 'NONE').restoreTest).tone).toBe('warning');
    expect(restoreTestNotice(health('OK', 'DUE').restoreTest).title).toBe('Restore test due');
  });

  it('puts the worse news on the Dashboard, and nothing when all is well', () => {
    expect(dashboardNotice(health('OK', 'OK'))).toBeNull();
    expect(dashboardNotice(health('LOCAL_ONLY', 'FAILED'))?.title).toBe('The last restore test failed');
    expect(dashboardNotice(health('LATE', 'DUE'))?.title).toBe('No backup in the last day');
    expect(dashboardNotice(health('OK', 'DUE'))?.title).toBe('Restore test due');
  });

  it('shows sizes people read', () => {
    expect(formatSize(null)).toBe('—');
    expect(formatSize(36_539)).toBe('36 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
