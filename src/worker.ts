/// <reference lib="webworker" />
/** Training and many raids run here, so the page never freezes. The job itself is `runJob` in `train.ts`. */
import { runJob, type WorkerRequest, type WorkerResponse } from './train';

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = (e: MessageEvent<WorkerRequest>) => runJob(e.data, post);
