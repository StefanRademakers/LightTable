import { useRef } from 'react';
import { Button } from './Button';
import { FieldRow } from './FieldRow';

export interface FileFieldProps {
  label: string;
  buttonLabel: string;
  accept: string;
  disabled?: boolean;
  title?: string;
  onFile: (file: File) => void | Promise<void>;
  onRejected?: () => void;
}

const acceptedFile = (file: File, accept: string) => {
  const rules = accept.split(',').map(rule => rule.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return true;
  const name = file.name.toLowerCase();
  const mediaType = file.type.toLowerCase();
  return rules.some(rule => rule.startsWith('.') ? name.endsWith(rule) : mediaType === rule);
};

export function FileField({
  label, buttonLabel, accept, disabled = false, title, onFile, onRejected
}: FileFieldProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const publish = (files: FileList | null) => {
    const file = Array.from(files ?? []).find(candidate => acceptedFile(candidate, accept));
    if (file) void onFile(file);
    else if (files?.length) onRejected?.();
  };
  return <FieldRow label={label} title={title}
    onDragEnter={event => { event.preventDefault(); event.stopPropagation(); }}
    onDragOver={event => {
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy';
    }}
    onDrop={event => {
      event.preventDefault(); event.stopPropagation(); publish(event.dataTransfer.files);
    }}>
    <Button disabled={disabled} onClick={() => input.current?.click()}>{buttonLabel}</Button>
    <input ref={input} type="file" accept={accept} hidden onChange={event => {
      publish(event.currentTarget.files);
      event.currentTarget.value = '';
    }} />
  </FieldRow>;
}
