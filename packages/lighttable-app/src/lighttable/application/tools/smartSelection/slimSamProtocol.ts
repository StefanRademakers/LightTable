export type SlimSamWorkerRequest =
  | {
      readonly type: 'prepare';
      readonly requestId: number;
      readonly sourceId: string;
      readonly revision: number;
      readonly image: Blob;
    }
  | {
      readonly type: 'point';
      readonly requestId: number;
      readonly sourceId: string;
      readonly point: readonly [number, number];
      readonly hardEdge: boolean;
    }
  | {
      readonly type: 'box';
      readonly requestId: number;
      readonly sourceId: string;
      readonly box: readonly [number, number, number, number];
      readonly hardEdge: boolean;
    }
  | {
      readonly type: 'subject';
      readonly requestId: number;
      readonly sourceId: string;
      readonly hardEdge: boolean;
    }
  | { readonly type: 'dispose-source'; readonly sourceId: string }
  | { readonly type: 'dispose' };

export type SlimSamWorkerResponse =
  | {
      readonly type: 'status';
      readonly requestId: number;
      readonly status: string;
      readonly message?: string;
      readonly progress?: number;
    }
  | {
      readonly type: 'prepared';
      readonly requestId: number;
      readonly sourceId: string;
      readonly revision: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly type: 'candidates';
      readonly requestId: number;
      readonly sourceId: string;
      readonly width: number;
      readonly height: number;
      readonly masks: readonly ArrayBuffer[];
      readonly scores: readonly number[];
    }
  | { readonly type: 'superseded'; readonly requestId: number }
  | { readonly type: 'error'; readonly requestId: number; readonly message: string };
