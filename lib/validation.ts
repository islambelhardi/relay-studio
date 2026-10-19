import { z } from 'zod';
export const briefSchema = z.object({ audience: z.string().trim().min(1).max(200), tone: z.string().trim().min(1).max(200), targetWords: z.number().int().min(300).max(3000) });
export const runSchema = z.object({ documentId: z.uuid(), title: z.string().trim().min(1).max(160), brief: briefSchema, provider: z.enum(['openai', 'gemini']).default('openai') });
export const MAX_UPLOAD = 10 * 1024 * 1024;
export const extensions = ['txt','md','pdf','docx'];
