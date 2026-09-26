import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

import { getActingTenantId, sendTenantRefusal } from '../lib/tenant-context.js';

/**
 * A `transcripts` row as this route reads it. Columns it only passes through
 * to the response are left as `unknown`.
 */
interface TranscriptRow {
  id: string;
  tenant_id: string;
  call_id: string;
  engine: unknown;
  language: unknown;
  duration_sec: unknown;
  full_text: string;
  speaker_labels: unknown;
  created_at: unknown;
}

/** A transcript joined with its segments and analysis. */
interface TranscriptDetailRow extends TranscriptRow {
  segments: unknown[] | null;
  billable: boolean | null;
  application_submitted: unknown;
  reasoning: unknown;
}

// Inline repository to avoid path issues
class TranscriptRepository {
  private pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async getTranscriptByCall(callId: string): Promise<TranscriptDetailRow | null> {
    const result = await this.pool.query<TranscriptDetailRow>(
      `SELECT t.*, 
              COALESCE(json_agg(
                json_build_object(
                  'id', ts.id,
                  'idx', ts.idx,
                  'start', ts.start_sec,
                  'end', ts.end_sec,
                  'speaker', ts.speaker,
                  'text', ts.text
                ) ORDER BY ts.idx
              ) FILTER (WHERE ts.id IS NOT NULL), '[]') as segments,
              ta.billable, ta.application_submitted, ta.reasoning
       FROM transcripts t
       LEFT JOIN transcript_segments ts ON ts.transcript_id = t.id
       LEFT JOIN transcript_analysis ta ON ta.transcript_id = t.id
       WHERE t.call_id = $1
       GROUP BY t.id, ta.billable, ta.application_submitted, ta.reasoning`,
      [callId]
    );
    return result.rows[0] || null;
  }

  async listTranscripts(tenantId: string, query?: string, limit: number = 20, offset: number = 0): Promise<TranscriptRow[]> {
    let sql = `SELECT t.* FROM transcripts t WHERE t.tenant_id = $1`;
    const params: (string | number)[] = [tenantId];
    if (query) {
      sql += ` AND t.full_text ILIKE $${params.length + 1}`;
      params.push(`%${query}%`);
    }
    sql += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const result = await this.pool.query<TranscriptRow>(sql, params);
    return result.rows;
  }
}

const repository = new TranscriptRepository();

export function registerTranscriptRoutes(fastify: FastifyInstance): Promise<void> {
  // Get transcript for a call
  fastify.get<{ Params: { callId: string } }>(
    '/api/v1/calls/:callId/transcript',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);
      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      try {
        const transcript = await repository.getTranscriptByCall(request.params.callId);

        if (!transcript) {
          void reply.code(404);
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'Transcript not found',
            },
          };
        }

        // Verify tenant access
        if (transcript.tenant_id !== tenantId) {
          void reply.code(403);
          return {
            error: {
              code: 'FORBIDDEN',
              message: 'Access denied',
            },
          };
        }

        return {
          id: transcript.id,
          callId: transcript.call_id,
          engine: transcript.engine,
          language: transcript.language,
          durationSec: transcript.duration_sec,
          fullText: transcript.full_text,
          speakerLabels: transcript.speaker_labels,
          segments: transcript.segments || [],
          analysis: transcript.billable !== null ? {
            billable: transcript.billable,
            applicationSubmitted: transcript.application_submitted,
            reasoning: transcript.reasoning,
          } : null,
          createdAt: transcript.created_at,
        };
      } catch (error) {
        void reply.code(500);
        return {
          error: {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : 'Failed to retrieve transcript',
          },
        };
      }
    }
  );

  // List transcripts with search
  fastify.get('/api/v1/transcripts', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const { q, page = 1, limit = 20 } = request.query as {
      q?: string;
      page?: number;
      limit?: number;
    };

    try {
      const offset = (page - 1) * limit;
      const transcripts = await repository.listTranscripts(tenantId, q, limit, offset);

      return {
        data: transcripts.map(t => ({
          id: t.id,
          callId: t.call_id,
          engine: t.engine,
          language: t.language,
          durationSec: t.duration_sec,
          fullText: t.full_text.substring(0, 200) + '...', // Preview
          speakerLabels: t.speaker_labels,
          createdAt: t.created_at,
        })),
        meta: {
          page,
          limit,
        },
      };
    } catch (error) {
      void reply.code(500);
      return {
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Failed to list transcripts',
        },
      };
    }
  });

  return Promise.resolve();
}

