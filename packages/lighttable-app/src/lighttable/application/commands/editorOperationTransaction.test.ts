import { describe, expect, it, vi } from 'vitest';
import { runEditorOperationTransaction } from './editorOperationTransaction';

describe('runEditorOperationTransaction', () => {
  it('keeps completed steps after commit', () => {
    let value = 0;
    runEditorOperationTransaction({ operation: 'test' }, (transaction) => {
      transaction.step('first', () => { value += 1; }, () => { value -= 1; });
      transaction.step('second', () => { value += 2; }, () => { value -= 2; });
    });
    expect(value).toBe(3);
  });

  it('rolls partial mutations back in reverse order', () => {
    const order: string[] = [];
    expect(() => runEditorOperationTransaction({ operation: 'test' }, (transaction) => {
      transaction.step('first', () => order.push('apply first'), () => {
        order.push('rollback first');
      });
      transaction.step('second', () => {
        order.push('apply second');
        throw new Error('second failed');
      }, () => {
        order.push('rollback second');
      });
    })).toThrow('second failed');
    expect(order).toEqual([
      'apply first',
      'apply second',
      'rollback second',
      'rollback first'
    ]);
  });

  it('reports rollback failure without hiding the original cause', () => {
    const original = new Error('apply failed');
    const onEvent = vi.fn();
    let thrown: unknown;
    try {
      runEditorOperationTransaction({ operation: 'test', onEvent }, (transaction) => {
        transaction.step('broken', () => { throw original; }, () => {
          throw new Error('rollback failed');
        });
      });
    } catch (reason) {
      thrown = reason;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).cause).toBe(original);
    expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'failed' }));
  });

  it('does not let a diagnostics observer change operation semantics', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let changed = false;
    expect(() => runEditorOperationTransaction({
      operation: 'test',
      onEvent: () => { throw new Error('observer failed'); }
    }, (transaction) => {
      transaction.step('change', () => { changed = true; }, () => { changed = false; });
    })).not.toThrow();
    expect(changed).toBe(true);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
