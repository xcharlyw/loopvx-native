import { planSync, type RemoteEntry, type SyncMemory } from './syncPlan';

const mem = (m: Partial<SyncMemory> = {}): SyncMemory => ({ synced: new Set(), deleted: new Set(), lastSyncAt: 0, ...m });
const remote = (id: string, updatedAt: number): RemoteEntry => ({ id, updatedAt, fileId: `f-${id}` });

describe('planSync', () => {
  it('uploads new local items and downloads new remote ones', () => {
    const plan = planSync([{ id: 'a', updatedAt: 1 }], [remote('b', 1)], mem());
    expect(plan.upload).toEqual([{ id: 'a' }]);
    expect(plan.download).toEqual([remote('b', 1)]);
  });

  it('lets the newer side win and skips equal ones', () => {
    const plan = planSync(
      [
        { id: 'a', updatedAt: 5 },
        { id: 'b', updatedAt: 1 },
        { id: 'c', updatedAt: 3 },
      ],
      [remote('a', 2), remote('b', 9), remote('c', 3)],
      mem(),
    );
    expect(plan.upload).toEqual([{ id: 'a', fileId: 'f-a' }]);
    expect(plan.download).toEqual([remote('b', 9)]);
  });

  it('deletes on Drive what was deleted here', () => {
    const plan = planSync([], [remote('a', 1)], mem({ deleted: new Set(['a']) }));
    expect(plan.deleteRemote).toEqual([remote('a', 1)]);
    expect(plan.download).toEqual([]);
  });

  it('deletes here what another device deleted', () => {
    const plan = planSync([{ id: 'a', updatedAt: 1 }], [], mem({ synced: new Set(['a']), lastSyncAt: 10 }));
    expect(plan.deleteLocal).toEqual(['a']);
    expect(plan.upload).toEqual([]);
  });

  it('keeps an item deleted elsewhere if it was edited here since the last sync', () => {
    const plan = planSync([{ id: 'a', updatedAt: 20 }], [], mem({ synced: new Set(['a']), lastSyncAt: 10 }));
    expect(plan.upload).toEqual([{ id: 'a' }]);
    expect(plan.deleteLocal).toEqual([]);
  });
});
