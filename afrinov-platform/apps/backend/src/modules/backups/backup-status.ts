// Whether backups can be trusted (ADR-037). The backup service
// (apps/backend/backup) records each run in backup_runs; this reads them and
// says what an Admin needs to know: a backup failed, is late, never left the
// server, or no restore has been tried lately. A backup nobody hears about
// failing is the usual way a business finds out it has none.
import { prisma } from '../../shared/db.js';

/** A day's backup, with the evening's slack: later than this is late. */
export const BACKUP_LATE_HOURS = 26;
/** Restores are tried every three months (12-operations/backup-and-recovery.md). */
export const RESTORE_TEST_DUE_DAYS = 92;
const RECENT = 14;

export interface BackupRunView {
  kind: 'BACKUP' | 'RESTORE_TEST';
  status: 'OK' | 'FAILED';
  startedAt: string;
  finishedAt: string;
  fileName: string | null;
  sizeBytes: number | null;
  offsite: boolean;
  detail: string | null;
}

export type BackupState = 'NONE' | 'OK' | 'LATE' | 'FAILED' | 'LOCAL_ONLY';
export type RestoreTestState = 'NONE' | 'OK' | 'DUE' | 'FAILED';

export interface BackupHealth {
  backup: { state: BackupState; lastSuccessAt: string | null; lastRun: BackupRunView | null };
  restoreTest: { state: RestoreTestState; lastSuccessAt: string | null; lastRun: BackupRunView | null };
  recent: BackupRunView[];
}

const hoursSince = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / 3_600_000;

/**
 * What the runs say, newest first. A failed last backup wins over an older
 * success; a success that stayed on the server is not enough.
 */
export function backupHealth(runs: BackupRunView[], now: Date): BackupHealth {
  const byNewest = [...runs].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  const backups = byNewest.filter((r) => r.kind === 'BACKUP');
  const tests = byNewest.filter((r) => r.kind === 'RESTORE_TEST');
  const lastBackup = backups[0] ?? null;
  const lastGoodBackup = backups.find((r) => r.status === 'OK') ?? null;
  const lastTest = tests[0] ?? null;
  const lastGoodTest = tests.find((r) => r.status === 'OK') ?? null;

  let backup: BackupState = 'OK';
  if (!lastBackup) backup = 'NONE';
  else if (lastBackup.status === 'FAILED') backup = 'FAILED';
  else if (!lastGoodBackup || hoursSince(lastGoodBackup.finishedAt, now) > BACKUP_LATE_HOURS) backup = 'LATE';
  else if (!lastGoodBackup.offsite) backup = 'LOCAL_ONLY';

  let restoreTest: RestoreTestState = 'OK';
  if (!lastTest) restoreTest = 'NONE';
  else if (lastTest.status === 'FAILED') restoreTest = 'FAILED';
  else if (!lastGoodTest || hoursSince(lastGoodTest.finishedAt, now) > RESTORE_TEST_DUE_DAYS * 24) restoreTest = 'DUE';

  return {
    backup: { state: backup, lastSuccessAt: lastGoodBackup?.finishedAt ?? null, lastRun: lastBackup },
    restoreTest: { state: restoreTest, lastSuccessAt: lastGoodTest?.finishedAt ?? null, lastRun: lastTest },
    recent: byNewest.slice(0, RECENT),
  };
}

export const BackupStatusService = {
  async health(now = new Date()): Promise<BackupHealth> {
    // The last fortnight of each kind is enough to know the latest of each.
    const rows = await prisma.backupRun.findMany({ orderBy: { finishedAt: 'desc' }, take: 60 });
    const lastTests = rows.some((r) => r.kind === 'RESTORE_TEST')
      ? []
      : await prisma.backupRun.findMany({ where: { kind: 'RESTORE_TEST' }, orderBy: { finishedAt: 'desc' }, take: 2 });
    return backupHealth([...rows, ...lastTests].map((r) => ({
      kind: r.kind as BackupRunView['kind'],
      status: r.status as BackupRunView['status'],
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt.toISOString(),
      fileName: r.fileName,
      sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
      offsite: r.offsite,
      detail: r.detail,
    })), now);
  },
};
