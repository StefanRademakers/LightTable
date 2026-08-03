/// <reference lib="webworker" />

import type { TextEngineWorkerRequest } from './textEngineProtocol';
import type { TextWorkerRequest } from '@lighttable/text-core';

type BootstrapRequest = TextEngineWorkerRequest | TextWorkerRequest;

const describeBootstrapFailure = (reason: unknown) => {
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}${reason.stack ? `\n${reason.stack}` : ''}`;
  }
  return `Unknown worker bootstrap failure: ${String(reason)}`;
};

const bootstrapHandler = (event: MessageEvent<BootstrapRequest>) => {
  void import('./textLayout.worker').then(() => {
    const implementationHandler = self.onmessage;
    if (!implementationHandler || implementationHandler === bootstrapHandler) {
      throw new Error('The text worker implementation did not install its message handler.');
    }
    implementationHandler.call(self, event);
  }).catch((reason: unknown) => {
    self.postMessage({
      kind: 'error',
      protocolVersion: 1,
      requestId: event.data.requestId,
      message: describeBootstrapFailure(reason)
    });
  });
};

self.onmessage = bootstrapHandler;
