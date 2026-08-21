import { ButtonBase } from '../ui/ButtonBase';
import {
  Component,
  Fragment,
  type ErrorInfo,
  type ReactNode
} from 'react';

interface DocumentRuntimeErrorBoundaryProps {
  readonly documentId: string;
  readonly active: boolean;
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly onError?: (message: string) => void;
}

interface DocumentRuntimeErrorBoundaryState {
  readonly error: Error | null;
  readonly retryVersion: number;
}

export const normalizeDocumentRuntimeError = (failure: unknown): Error =>
  failure instanceof Error
    ? failure
    : new Error(String(failure));

/**
 * Contains failures in the one active editor binding.
 *
 * GPU and async failures remain owned by application controllers; changing the
 * active document clears a prior binding error without remounting the editor.
 */
export class DocumentRuntimeErrorBoundary extends Component<
  DocumentRuntimeErrorBoundaryProps,
  DocumentRuntimeErrorBoundaryState
> {
  state: DocumentRuntimeErrorBoundaryState = {
    error: null,
    retryVersion: 0
  };

  static getDerivedStateFromError(failure: unknown): Partial<DocumentRuntimeErrorBoundaryState> {
    return { error: normalizeDocumentRuntimeError(failure) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('LightTable document runtime failed', error, info);
    this.props.onError?.(error.message);
  }

  componentDidUpdate(previous: DocumentRuntimeErrorBoundaryProps): void {
    if (previous.documentId !== this.props.documentId && this.state.error) {
      this.setState({ error: null });
    }
  }

  private retry = (): void => {
    this.setState((current) => ({
      error: null,
      retryVersion: current.retryVersion + 1
    }));
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main
          className="lighttable-document-failure"
          hidden={!this.props.active}
          aria-hidden={!this.props.active}
        >
          <section className="lighttable-launcher__card" role="alert">
            <h1>{this.props.title}</h1>
            <p>This document runtime stopped unexpectedly. Other open documents remain available.</p>
            <pre>{this.state.error.message}</pre>
            <div className="lighttable-document-failure__actions">
              <ButtonBase className="action-button" type="button" onClick={this.retry}>
                Retry document
              </ButtonBase>
              <ButtonBase className="action-button" type="button" onClick={this.props.onClose}>
                Close document
              </ButtonBase>
            </div>
          </section>
        </main>
      );
    }

    return (
      <Fragment key={this.state.retryVersion}>
        {this.props.children}
      </Fragment>
    );
  }
}
