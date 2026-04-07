import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

interface RequestStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

export const RequestContext = {
  run<T>(fn: () => T): T {
    return storage.run({ requestId: uuidv4() }, fn);
  },

  get(): RequestStore | undefined {
    return storage.getStore();
  },

  getRequestId(): string {
    return storage.getStore()?.requestId ?? '-';
  },
};
