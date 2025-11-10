import { Pool } from 'pg';

import { logger } from './logger.js';

export interface TranscriptData {
  engine: string;
  language: string;
  durationSec: number;
  fullText: string;
  segments: Array<{
    start: number;
    end: number;
    speaker?: string;
    text: string;
  }>;
  speakerLabels: boolean;
  analysis?: {
    billable: string;
    applicationSubmitted: string;
    reasoning: string;
  } | null;
}

export class TranscriptRepository {
  private pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
    });
  }

  async upsertTranscript(
    tenantId: string,
    callId: string,
    data: TranscriptData
  ): Promise<string> {
    const client = await this.pool.connect();
    const transcriptId = `tr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      await client.query('BEGIN');

      // Upsert transcript
      await client.query(
        `INSERT INTO transcripts (id, tenant_id, call_id, engine, language, duration_sec, full_text, speaker_labels, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (call_id) DO UPDATE SET
           engine = EXCLUDED.engine,
           language = EXCLUDED.language,
           duration_sec = EXCLUDED.duration_sec,
           full_text = EXCLUDED.full_text,
           speaker_labels = EXCLUDED.speaker_labels`,
        [
          transcriptId,
          tenantId,
          callId,
          data.engine,
          data.language,
          data.durationSec,
          data.fullText,
          data.speakerLabels,
        ]
      );

      // Delete existing segments
      await client.query('DELETE FROM transcript_segments WHERE transcript_id = $1', [transcriptId]);

      // Insert segments
      if (data.segments && data.segments.length > 0) {
        const segmentValues = data.segments.map((seg, idx) => [
          `seg_${transcriptId}_${idx}`,
          transcriptId,
          idx,
          seg.start,
          seg.end,
          seg.speaker || null,
          seg.text,
        ]);

        const segmentQuery = `
          INSERT INTO transcript_segments (id, transcript_id, idx, start_sec, end_sec, speaker, text)
          VALUES ${segmentValues.map((_, i) => `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7})`).join(', ')}
        `;

        await client.query(
          segmentQuery,
          segmentValues.flat()
        );
      }

      // Upsert analysis
      if (data.analysis) {
        await client.query(
          `INSERT INTO transcript_analysis (transcript_id, billable, application_submitted, reasoning)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (transcript_id) DO UPDATE SET
             billable = EXCLUDED.billable,
             application_submitted = EXCLUDED.application_submitted,
             reasoning = EXCLUDED.reasoning`,
          [
            transcriptId,
            data.analysis.billable === 'Yes',
            data.analysis.applicationSubmitted === 'Yes',
            data.analysis.reasoning,
          ]
        );
      }

      await client.query('COMMIT');
      return transcriptId;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error upserting transcript:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getTranscriptByCall(callId: string): Promise<any> {
    const result = await this.pool.query(
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

  async listTranscripts(
    tenantId: string,
    query?: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<any[]> {
    let sql = `
      SELECT t.*, 
             COALESCE(json_agg(
               json_build_object(
                 'id', ts.id,
                 'idx', ts.idx,
                 'start', ts.start_sec,
                 'end', ts.end_sec,
                 'speaker', ts.speaker,
                 'text', ts.text
               ) ORDER BY ts.idx
             ) FILTER (WHERE ts.id IS NOT NULL), '[]') as segments
      FROM transcripts t
      LEFT JOIN transcript_segments ts ON ts.transcript_id = t.id
      WHERE t.tenant_id = $1
    `;

    const params: any[] = [tenantId];

    if (query) {
      sql += ` AND t.full_text ILIKE $${params.length + 1}`;
      params.push(`%${query}%`);
    }

    sql += ` GROUP BY t.id ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await this.pool.query(sql, params);
    return result.rows;
  }
}

