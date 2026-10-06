import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Field, Select } from './Field';
import { api, type ApiError } from '../api/client';

interface UserOption {
  id: string;
  name: string;
}

interface Transaction {
  id: string;
  postedAt: string;
  type: string;
  materialId: string;
  materialSku: string;
  materialName: string;
  locationId: string;
  locationName: string;
  quantity: string;
  actorId: string;
  actorName: string;
  projectNumber?: string | null;
  reasonCode?: string | null;
}

interface Props {
  transaction: Transaction;
  onClose: () => void;
  onUpdated: (updated: Transaction) => void;
  onError: (err: ApiError) => void;
}

export function TransactionDrawer({ transaction, onClose: _onClose, onUpdated, onError }: Props) {
  const [editing, setEditing] = useState(false);
  const [selectedActorId, setSelectedActorId] = useState(transaction.actorId);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // eslint-disable react-hooks/set-state-in-effect
  useEffect(() => {
    setSelectedActorId(transaction.actorId); // eslint-disable-line react-hooks/set-state-in-effect
    setEditing(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [transaction.id, transaction.actorId]);
  // eslint-enable react-hooks/set-state-in-effect

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const data = await api.get<UserOption[]>('/users/lookup');
      setUsers(data);
    } catch {
      onError({ code: 'NETWORK_ERROR', message: 'Unable to load users.' });
    } finally {
      setLoadingUsers(false);
    }
  }

  function handleEdit() {
    setEditing(true);
    setValidation(null);
    if (users.length === 0) {
      loadUsers();
    }
  }

  function handleCancel() {
    setEditing(false);
    setSelectedActorId(transaction.actorId);
    setValidation(null);
  }

  async function handleSave() {
    setValidation(null);
    if (!selectedActorId) {
      setValidation('Please select a valid issuing person.');
      return;
    }
    if (selectedActorId === transaction.actorId) {
      handleCancel();
      return;
    }

    setBusy(true);
    try {
      const updated = await api.patch<Transaction>(`/inventory-transactions/${transaction.id}`, {
        actorId: selectedActorId,
      });
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'NOT_FOUND') {
        setValidation('The inventory transaction could not be found.');
      } else if (e.code === 'VALIDATION_ERROR') {
        setValidation(e.message || 'Please select a valid issuing person.');
      } else if (e.code === 'FORBIDDEN') {
        onError({ code: 'FORBIDDEN', message: 'You do not have permission to change the issuing person.' });
      } else {
        onError({ code: 'NETWORK_ERROR', message: 'Unable to update the issuing person. Please try again.' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-h3 text-surface-900">Transaction details</h3>
        <dl className="text-sm grid grid-cols-1 sm:grid-cols-3 gap-y-2">
          <dt className="text-surface-500">When</dt>
          <dd className="col-span-2">{new Date(transaction.postedAt).toLocaleString()}</dd>
          <dt className="text-surface-500">Type</dt>
          <dd className="col-span-2">{transaction.type}</dd>
          <dt className="text-surface-500">Material</dt>
          <dd className="col-span-2">{transaction.materialSku} — {transaction.materialName}</dd>
          <dt className="text-surface-500">Location</dt>
          <dd className="col-span-2">{transaction.locationName}</dd>
          <dt className="text-surface-500">Quantity</dt>
          <dd className="col-span-2 text-num">{transaction.quantity}</dd>
          {transaction.projectNumber && (
            <>
              <dt className="text-surface-500">Project</dt>
              <dd className="col-span-2 text-mono text-xs">{transaction.projectNumber}</dd>
            </>
          )}
          {transaction.reasonCode && (
            <>
              <dt className="text-surface-500">Reason</dt>
              <dd className="col-span-2">{transaction.reasonCode.replace(/_/g, ' ').toLowerCase()}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="space-y-3 border-t border-surface-200 pt-4">
        <h3 className="text-h3 text-surface-900">Issued By</h3>
        {editing ? (
          <div className="space-y-2">
            <Field label="Issuing person" htmlFor="actor" required>
              <Select
                id="actor"
                required
                value={selectedActorId}
                onChange={(e) => setSelectedActorId(e.target.value)}
                invalid={!!validation}
                disabled={loadingUsers}
              >
                <option value="">— select —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </Field>
            {validation && <p className="text-sm text-danger-700">{validation}</p>}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{transaction.actorName || '—'}</span>
            <Button size="sm" variant="secondary" onClick={handleEdit}>Edit</Button>
          </div>
        )}
      </section>

      {editing && (
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
          <Button variant="ghost" type="button" onClick={handleCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="button" onClick={handleSave} loading={busy} disabled={!selectedActorId || selectedActorId === transaction.actorId}>
            Save Changes
          </Button>
        </div>
      )}
    </div>
  );
}
