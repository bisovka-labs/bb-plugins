import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from './server.ts';

test('missing credentials stay unavailable; a live settings update takes effect without reload', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'speechkit' });
  plugin(bb);
  try {
    const service = harness.registrations.aiServiceRegistrations[0];
    assert.equal((await service.status()).ready, false);
    await assert.rejects(service.transcribe(new File(['audio'], 'test.wav'), { signal: new AbortController().signal, hint: null }), /key is missing/);
    await harness.behavior.setSettings({ apiKey: 'test-key-not-a-credential' });
    assert.equal((await service.status()).ready, true);
    await assert.rejects(service.transcribe(new File([], 'empty.wav'), { signal: new AbortController().signal, hint: null }), /non-empty/);
  } finally { await harness.lifecycle.dispose(); }
});
