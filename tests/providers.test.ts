import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuredProviders } from '../lib/providers';

afterEach(() => vi.unstubAllEnvs());
describe('provider availability', () => {
  it('allows Gemini alone without an OpenAI key and returns only provider names', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', 'private-gemini-key');
    expect(configuredProviders()).toEqual(['gemini']);
  });
  it('offers both configured providers and ignores empty keys', () => {
    vi.stubEnv('OPENAI_API_KEY', 'private-openai-key');
    vi.stubEnv('GEMINI_API_KEY', 'private-gemini-key');
    expect(configuredProviders()).toEqual(['openai', 'gemini']);
    vi.stubEnv('OPENAI_API_KEY', ' ');
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(configuredProviders()).toEqual([]);
  });
});
