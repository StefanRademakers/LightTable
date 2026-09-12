import { useMemo, useRef } from 'react';
import { createClipboardCommands, type ClipboardCommandPorts } from '../../application/clipboard/createClipboardCommands';

/** React supplies current ports; clipboard requests capture their own exact lifetime. */
export const useClipboardCommands = (ports: ClipboardCommandPorts) => {
  const current = useRef(ports);
  current.current = ports;
  return useMemo(() => createClipboardCommands(() => current.current), []);
};
