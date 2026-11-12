// Closing something that must be clear first (system audit P2): a location
// with nothing on it, a project with nothing still depending on it. The
// server says what is in the way; this lists it and keeps the action back
// until the list is empty. The server checks again when the action is taken.
import { useApi } from '../hooks/useApi';
import { Alert } from './Alert';
import { Button } from './Button';
import { Modal } from './Modal';
import { Skeleton } from './Skeleton';

export interface Blocker {
  kind: string;
  text: string;
}

interface ClearFirstDialogProps {
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** What happens once it is clear. */
  description: string;
  /** The server's list of what is in the way: `{ blockers }`. */
  checkPath: string;
  /** What to do about the list, shown above it. */
  blockedIntro: string;
  confirmLabel: string;
  loading?: boolean;
}

export function ClearFirstDialog({ onClose, onConfirm, title, description, checkPath, blockedIntro, confirmLabel, loading }: ClearFirstDialogProps) {
  const check = useApi<{ blockers: Blocker[] }>(checkPath);
  const blockers = check.data?.blockers ?? null;
  const clear = blockers !== null && blockers.length === 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} loading={loading} disabled={!clear}>{confirmLabel}</Button>
        </>
      }
    >
      {check.loading && blockers === null && <Skeleton h={48} />}
      {check.error && <Alert tone="warning" title="Couldn't check what is in the way">{check.error.message}</Alert>}
      {clear && <p className="text-sm text-surface-700">{description}</p>}
      {blockers !== null && blockers.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-surface-700">{blockedIntro}</p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-surface-900">
            {blockers.map((b) => <li key={b.kind + b.text}>{b.text}</li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}
