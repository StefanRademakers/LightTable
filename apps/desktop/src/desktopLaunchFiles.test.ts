import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { bitmapLaunchFilesFromArgv, DesktopLaunchFileQueue } from './desktopLaunchFiles';

describe('desktop bitmap launch files', () => {
  it('keeps supported absolute bitmap arguments in launch order', () => {
    const root = path.resolve('fixtures');
    expect(bitmapLaunchFilesFromArgv([
      'LightTable.exe', '--squirrel-firstrun',
      path.join(root, 'a.PNG'), path.join(root, 'b.jpg'), path.join(root, 'c.webp'),
      path.join(root, 'd.TIFF'), path.join(root, 'ignored.psd'), 'relative.png'
    ])).toEqual([
      path.join(root, 'a.PNG'), path.join(root, 'b.jpg'), path.join(root, 'c.webp'),
      path.join(root, 'd.TIFF')
    ]);
  });

  it('deduplicates queued paths without losing first insertion order', () => {
    const queue = new DesktopLaunchFileQueue();
    const first = path.resolve('fixtures', 'first.png');
    const second = path.resolve('fixtures', 'second.tif');
    queue.enqueue([first, second, first]);
    expect(queue.size).toBe(2);
    expect(queue.takeAll()).toEqual([first, second]);
    expect(queue.takeAll()).toEqual([]);
  });
});
