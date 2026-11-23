/** The page's side of the worker: start one job, hear its progress, cancel it. */
import type { Adam, Model } from './model';
import type { RaidCounts } from './raids';
import type { TrainStats, WorkerRequest, WorkerResponse } from './train';

export type JobResult = { model: Model; stats: TrainStats; adam?: Adam } | { counts: RaidCounts };

/** Run one job in a Web Worker; `cancel` stops it and keeps nothing. */
export function runInWorker(
  req: WorkerRequest,
  onProgress: (msg: Extract<WorkerResponse, { type: 'progress' }>) => void,
): { result: Promise<JobResult>; cancel: () => void } {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let reject: (e: Error) => void = () => {};
  const result = new Promise<JobResult>((res, rej) => {
    reject = rej;
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') return onProgress(msg);
      worker.terminate();
      if (msg.type === 'done') res({ model: msg.model, stats: msg.stats, adam: msg.adam });
      else if (msg.type === 'raidsDone') res({ counts: msg.counts });
      else rej(new Error(msg.message));
    };
    worker.onerror = (e) => { worker.terminate(); rej(new Error(e.message || 'Training failed')); };
  });
  worker.postMessage(req);
  return { result, cancel: () => { worker.terminate(); reject(new Error('cancelled')); } };
}
