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

  it('starts bounded file preparation before the renderer drains the queue', async () => {
    const queue = new DesktopLaunchFileQueue<string>(2);
    const first = path.resolve('fixtures', 'first.jpg');
    const second = path.resolve('fixtures', 'second.png');
    const ignored = path.resolve('fixtures', 'ignored.webp');
    const started: string[] = [];
    queue.enqueue([first]);
    expect(started).toEqual([]);
    queue.configureLoader(async (filePath) => {
      started.push(filePath);
      return `prepared:${path.basename(filePath)}`;
    });
    queue.enqueue([second, ignored]);

    expect(started).toEqual([first, second]);
    expect(queue.size).toBe(2);
    const prepared = queue.takeAllPrepared();
    expect(prepared.map(({ filePath }) => filePath)).toEqual([first, second]);
    await expect(Promise.all(prepared.map(({ payload }) => payload))).resolves.toEqual([
      'prepared:first.jpg', 'prepared:second.png'
    ]);
  });
});
