import { Button, TextArea } from '@lighttable/ui';
import React, { useEffect, useRef, useState } from 'react';
import type { ActionRecordingEditResult } from '../../../application/actions/semanticActionRecorder';

export const ActionStepRationaleEditor: React.FC<{
  readonly rationale: string | null;
  readonly disabled: boolean;
  readonly onApply: (rationale: string) => ActionRecordingEditResult;
}> = ({ rationale, disabled, onApply }) => {
  const [value, setValue] = useState(rationale ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const appliedRationale = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    setValue(rationale ?? '');
    if (appliedRationale.current !== rationale) setMessage(null);
    appliedRationale.current = undefined;
  }, [rationale]);
  return <div className="lighttable-action-step-rationale">
    <label>User-facing rationale
      <TextArea tabIndex={-1} value={value} maxLength={280} disabled={disabled}
        placeholder="Why this visible step exists"
        onChange={(event) => setValue(event.currentTarget.value)} />
    </label>
    <span>{value.length}/280</span>
    <Button type="button" disabled={disabled || value.trim() === (rationale ?? '')}
      onClick={() => {
        const result = onApply(value);
        if (result.ok) appliedRationale.current = value.trim() || null;
        setMessage(result.ok ? 'Rationale updated.' : result.error);
      }}>Apply rationale</Button>
    {message ? <p role="status">{message}</p> : null}
  </div>;
};
