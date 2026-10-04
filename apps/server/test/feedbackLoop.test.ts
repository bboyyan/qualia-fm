import { expect, it } from 'vitest';
import { InMemoryLedger } from '../src/ledger/fake.js';
import { MockEditorialPlanner } from '../src/providers/mockPlanner.js';
import type { EditorialInput } from '../src/services/editorialInput.js';
import { bootstrap, planRequest, postPlan, testApp, waitForJob } from './helpers.js';

it('V4 waits for ledger before planner and includes the saved rating and reason on every round', async () => {
  const ledger = new InMemoryLedger();
  await ledger.append({ date: '2026-10-04T00:00:00.000Z', seed: 'TEST seed', recommendation: 'TEST recommendation', rating: '愛', reason: 'TEST reason' });
  let release!: () => void;
  const waiting = new Promise<void>((r) => { release = r; });
  const inputs: EditorialInput[] = [];
  const mock = new MockEditorialPlanner();
  const client = await bootstrap(testApp({}, {
    ledger: { append: (row) => ledger.append(row), read: async () => { await waiting; return ledger.read(); } },
    planner: { draft: async (input, context) => { inputs.push(input); return mock.draft(input, context); } },
  }).app);
  const first = await postPlan(client, planRequest());
  await new Promise((r) => setTimeout(r, 20));
  expect(inputs).toHaveLength(0);
  release();
  await waitForJob(client, first.body.jobId);
  await waitForJob(client, (await postPlan(client, planRequest())).body.jobId);
  expect(inputs).toHaveLength(2);
  expect(inputs.map((input) => input.history)).toEqual([await ledger.read(), await ledger.read()]);
});
