import type { Provider } from './types';

// Return availability only. Credentials never leave the server.
export function configuredProviders(): Provider[] {
  const providers: Provider[] = [];
  if (process.env.OPENAI_API_KEY?.trim()) providers.push('openai');
  if (process.env.GEMINI_API_KEY?.trim()) providers.push('gemini');
  return providers;
}
