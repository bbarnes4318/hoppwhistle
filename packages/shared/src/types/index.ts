import { z } from 'zod';

// Common types for the CallFabric platform

export const CallSchema = z.object({
  id: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  status: z.enum(['initiated', 'ringing', 'answered', 'completed', 'failed']),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Call = z.infer<typeof CallSchema>;

export const RouteSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  pattern: z.string(),
  destination: z.string(),
  priority: z.number().int().positive(),
});

export type Route = z.infer<typeof RouteSchema>;

