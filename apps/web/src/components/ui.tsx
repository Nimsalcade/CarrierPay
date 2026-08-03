import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ApiError } from '../api/client';
import { money } from '../lib/format';

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'indigo';

const TONE_CLASS: Record<Tone, string> = {
  green: 'badge-green',
  amber: 'badge-amber',
  red: 'badge-red',
  blue: 'badge-blue',
  gray: 'badge-gray',
  indigo: 'badge-indigo',
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge ${TONE_CLASS[tone]}`}>{children}</span>;
}

/** Map a domain status string to a badge tone. */
export function statusTone(status: string): Tone {
  const up = status.toUpperCase();
  if (['ACTIVE', 'APPROVED', 'PUBLISHED', 'DELIVERED', 'AVAILABLE', 'OK', 'PAID', 'BOOKED'].includes(up)) return 'green';
  if (['PENDING', 'PENDING_APPROVAL', 'CALCULATED', 'IN_TRANSIT', 'ASSIGNED', 'GENERATING', 'PROPOSED', 'APPROVED_FOR_CALCULATION', 'DRAFT'].includes(up)) return 'blue';
  if (['SUSPENDED', 'FAILED', 'STALE', 'TERMINATED', 'CANCELLED', 'OUT_OF_SERVICE', 'VOID', 'REJECTED', 'PAYROLL_LOCKED'].includes(up)) return 'red';
  if (['ENDED', 'SUPERSEDED', 'RETIRED'].includes(up)) return 'gray';
  return 'gray';
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status.replace(/_/g, ' ')}</Badge>;
}

export function Spinner({ large }: { large?: boolean }) {
  return (
    <div className="center-fill">
      <div className={`spinner${large ? ' spinner-lg' : ''}`} />
      <span className="muted small">Loading…</span>
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      {error}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="emptystate">
      <div style={{ fontSize: 20, marginBottom: 6 }}>{title}</div>
      {hint ? <div className="small muted">{hint}</div> : null}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={width ? { maxWidth: width } : undefined} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className="small muted">{hint}</div> : null}
      {error ? <div className="err">{error}</div> : null}
    </div>
  );
}

export function Money({ cents, signed }: { cents: number; signed?: boolean }) {
  return <span className="mono">{signed ? (cents < 0 ? `-${money(Math.abs(cents))}` : money(cents)) : money(cents)}</span>;
}

export function ConfirmButton({
  label,
  onConfirm,
  confirmLabel = 'Confirm',
  tone = 'btn-outline',
}: {
  label: ReactNode;
  onConfirm: () => void;
  confirmLabel?: string;
  tone?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  if (armed) {
    return (
      <span className="flex">
        <button
          className="btn btn-danger btn-sm"
          onClick={() => {
            onConfirm();
            setArmed(false);
          }}
        >
          {confirmLabel}
        </button>
        <button
          className="btn btn-outline btn-sm"
          onClick={() => {
            setArmed(false);
            if (timer.current) clearTimeout(timer.current);
          }}
        >
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button
      className={`btn ${tone} btn-sm`}
      onClick={() => {
        setArmed(true);
        timer.current = setTimeout(() => setArmed(false), 4000);
      }}
    >
      {label}
    </button>
  );
}

/** Extract a flat field-error string list for form display. */
export function fieldErrorText(err: ApiError): string[] {
  if (!err.fieldErrors) return [];
  return Object.entries(err.fieldErrors).map(([k, v]) => `${k}: ${v.join(', ')}`);
}
