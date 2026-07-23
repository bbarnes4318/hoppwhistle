import crypto from 'crypto';
import { getPrismaClient } from '../lib/prisma.js';

export interface SipPasswordDerivationParams {
  tenantId: string;
  userId: string;
  extension: string;
  credentialVersion?: number;
  domain?: string;
  masterSecret?: string;
}

export function deriveSipPassword(params: SipPasswordDerivationParams): string {
  const master = params.masterSecret || process.env.SIP_CREDENTIAL_MASTER_SECRET;
  if (!master || master.length < 32 || master === '1234' || master === 'demo-key') {
    throw new Error('SIP_CREDENTIAL_MASTER_SECRET must be at least 32 characters and securely configured');
  }
  const domain = params.domain || 'freeswitch';
  const version = params.credentialVersion ?? 1;
  const data = `hopwhistle:sip-password:v1:${params.tenantId}:${params.userId}:${domain}:${params.extension}:${version}`;
  return crypto.createHmac('sha256', master).update(data).digest('hex');
}

export function verifyInternalApiKey(apiKey: string | null | undefined): boolean {
  if (!apiKey) return false;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || secret.length < 16 || secret === 'demo-key' || secret === 'ClueCon') return false;

  const b1 = Buffer.from(apiKey);
  const b2 = Buffer.from(secret);
  if (b1.length !== b2.length) return false;
  return crypto.timingSafeEqual(b1, b2);
}

export function verifyDirectoryInternalApiKey(apiKey: string | null | undefined): boolean {
  if (!apiKey) return false;
  const secret = process.env.DIRECTORY_INTERNAL_API_SECRET || process.env.INTERNAL_API_SECRET;
  if (!secret || secret.length < 16) return false;

  const b1 = Buffer.from(apiKey);
  const b2 = Buffer.from(secret);
  if (b1.length !== b2.length) return false;
  return crypto.timingSafeEqual(b1, b2);
}

export async function provisionExtensionForUser(params: {
  tenantId: string;
  userId: string;
  domain?: string;
}): Promise<{ extension: string; credentialVersion: number }> {
  const prisma = getPrismaClient();
  const domain = params.domain || 'freeswitch';

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.sipIdentity.findUnique({
      where: { userId: params.userId },
    });

    if (existing) {
      const updated = await tx.sipIdentity.update({
        where: { id: existing.id },
        data: {
          credentialVersion: existing.credentialVersion + 1,
          status: 'ACTIVE',
        },
      });
      return { extension: updated.extension, credentialVersion: updated.credentialVersion };
    }

    const usedIdentities = await tx.sipIdentity.findMany({
      where: { domain },
      select: { extension: true },
    });
    const usedExtensions = new Set(usedIdentities.map((i) => i.extension));

    let allocated: string | null = null;
    for (let ext = 1000; ext <= 1099; ext++) {
      const extStr = ext.toString();
      if (!usedExtensions.has(extStr)) {
        allocated = extStr;
        break;
      }
    }

    if (!allocated) {
      throw new Error('CAPACITY_EXCEEDED: No available SIP extensions in range 1000-1099');
    }

    const newIdentity = await tx.sipIdentity.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        domain,
        extension: allocated,
        credentialVersion: 1,
        status: 'ACTIVE',
      },
    });

    return { extension: newIdentity.extension, credentialVersion: newIdentity.credentialVersion };
  });
}

export async function renderDirectoryXmlForExtension(params: {
  user?: string;
  domain?: string;
  apiKey?: string | null;
}): Promise<string> {
  if (!verifyDirectoryInternalApiKey(params.apiKey)) {
    return `<?xml version="1.0" encoding="UTF-8"?><document type="freeswitch/xml"><section name="result"><result status="not found"/></section></document>`;
  }

  if (!params.user) {
    return `<?xml version="1.0" encoding="UTF-8"?><document type="freeswitch/xml"><section name="result"><result status="not found"/></section></document>`;
  }

  const prisma = getPrismaClient();
  const domain = params.domain || 'freeswitch';
  const identity = await prisma.sipIdentity.findUnique({
    where: { domain_extension: { domain, extension: params.user } },
  });

  if (!identity || identity.status !== 'ACTIVE') {
    return `<?xml version="1.0" encoding="UTF-8"?><document type="freeswitch/xml"><section name="result"><result status="not found"/></section></document>`;
  }

  let password: string;
  try {
    password = deriveSipPassword({
      tenantId: identity.tenantId,
      userId: identity.userId,
      extension: identity.extension,
      credentialVersion: identity.credentialVersion,
      domain: identity.domain,
    });
  } catch {
    return `<?xml version="1.0" encoding="UTF-8"?><document type="freeswitch/xml"><section name="result"><result status="not found"/></section></document>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="directory">
    <domain name="${domain}">
      <user id="${identity.extension}">
        <params>
          <param name="password" value="${password}"/>
          <param name="vm-password" value="${identity.extension}"/>
          <param name="jsonrpc-allowed-methods" value="verto.invite,verto.answer,verto.attach,verto.info,verto.display,verto.bye,verto.modify,verto.media,verto.ping"/>
        </params>
        <variables>
          <variable name="toll_allow" value="domestic,international,local"/>
          <variable name="accountcode" value="${identity.extension}"/>
          <variable name="user_context" value="default"/>
          <variable name="verto_context" value="default"/>
          <variable name="verto_dialplan" value="XML"/>
          <variable name="effective_caller_id_name" value="Hopwhistle Agent"/>
          <variable name="effective_caller_id_number" value="${identity.extension}"/>
        </variables>
      </user>
    </domain>
  </section>
</document>`;
}

export interface SignedCallContext {
  version: number;
  jti: string;
  issuedAt: number;
  expiresAt: number;
  callId?: string;
  tenantId: string;
  userId?: string;
  campaignId?: string;
  fromNumberId: string;
  callerId: string;
  destination: string;
  sourceType: 'vapi' | 'ai_dialer' | 'softphone';
}

export function createSignedContextToken(
  context: Omit<SignedCallContext, 'version' | 'jti' | 'issuedAt' | 'expiresAt'>,
  ttlSeconds = 300
): string {
  const secret = process.env.CALL_CONTEXT_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('CALL_CONTEXT_SIGNING_SECRET is missing or must be at least 32 characters');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: SignedCallContext = {
    ...context,
    version: 1,
    jti: crypto.randomBytes(16).toString('hex'),
    issuedAt: now,
    expiresAt: now + ttlSeconds,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifySignedContextToken(token: string): SignedCallContext | null {
  const secret = process.env.CALL_CONTEXT_SIGNING_SECRET;
  if (!secret || secret.length < 32) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const b1 = Buffer.from(sig);
  const b2 = Buffer.from(expectedSig);
  if (b1.length !== b2.length || !crypto.timingSafeEqual(b1, b2)) return null;

  try {
    const payload: SignedCallContext = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.expiresAt < now || payload.issuedAt > now + 30) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface AuthenticatedOriginateParams {
  tenantId: string;
  userId: string;
  campaignId?: string;
  requestedCallerId?: string;
  rotationRequested?: boolean;
}

export interface AuthenticatedOriginateResult {
  valid: boolean;
  callerId?: string;
  fromNumberId?: string;
  reason?: string;
}

export async function resolveCallerIdForAuthenticatedOriginate(
  params: AuthenticatedOriginateParams
): Promise<AuthenticatedOriginateResult> {
  const prisma = getPrismaClient();

  let targetCid = params.requestedCallerId ? params.requestedCallerId.replace(/\D/g, '') : '';
  if (targetCid.length === 10) targetCid = '1' + targetCid;

  if (targetCid && targetCid.length === 11 && targetCid.startsWith('1')) {
    const pn = await prisma.phoneNumber.findFirst({
      where: {
        tenantId: params.tenantId,
        status: 'ACTIVE',
        number: { endsWith: targetCid.slice(-10) },
      },
    });

    if (pn) {
      const providerLower = (pn.provider || '').toLowerCase();
      const isApprovedFracTEL = providerLower === 'fractel' || providerLower === 'fractel_sbc';
      if (!isApprovedFracTEL) {
        return { valid: false, reason: 'UNAPPROVED_CARRIER_PROVIDER' };
      }

      if (pn.userId && pn.userId !== params.userId) {
        return { valid: false, reason: 'USER_MISMATCH' };
      }
      if (pn.campaignId && params.campaignId && pn.campaignId !== params.campaignId) {
        return { valid: false, reason: 'CAMPAIGN_MISMATCH' };
      }

      return {
        valid: true,
        callerId: targetCid,
        fromNumberId: pn.id,
      };
    }
  }

  const fallbackCid = process.env.FRACTEL_DEFAULT_CALLER_ID
    ? process.env.FRACTEL_DEFAULT_CALLER_ID.replace(/\D/g, '')
    : '';

  if (fallbackCid.length === 11 && !fallbackCid.includes('555')) {
    const fallbackPn = await prisma.phoneNumber.findFirst({
      where: {
        tenantId: params.tenantId,
        status: 'ACTIVE',
        number: { endsWith: fallbackCid.slice(-10) },
      },
    });

    if (fallbackPn) {
      const providerLower = (fallbackPn.provider || '').toLowerCase();
      if (providerLower === 'fractel' || providerLower === 'fractel_sbc') {
        return {
          valid: true,
          callerId: fallbackCid,
          fromNumberId: fallbackPn.id,
        };
      }
    }
  }

  return { valid: false, reason: 'NO_VALID_TENANT_CALLER_ID' };
}

export interface InternalCallValidationParams {
  callId?: string;
  signedContext?: string;
  destination?: string;
  sipUser?: string;
  channelUuid?: string;
  internalApiKey?: string | null;
}

export interface InternalCallValidationResult {
  valid: boolean;
  callerId?: string;
  source?: string;
  reason?: string;
}

export async function resolveCallerIdForInternalCall(
  params: InternalCallValidationParams
): Promise<InternalCallValidationResult> {
  if (!verifyInternalApiKey(params.internalApiKey)) {
    return { valid: false, reason: 'UNAUTHORIZED_INTERNAL_REQUEST' };
  }

  const prisma = getPrismaClient();

  if (params.signedContext) {
    const ctx = verifySignedContextToken(params.signedContext);
    if (!ctx) {
      return { valid: false, reason: 'INVALID_SIGNED_CONTEXT' };
    }

    if (params.destination) {
      const cleanDest = params.destination.replace(/\D/g, '');
      const cleanCtxDest = ctx.destination.replace(/\D/g, '');
      if (cleanDest && cleanCtxDest && !cleanDest.endsWith(cleanCtxDest.slice(-10))) {
        return { valid: false, reason: 'DESTINATION_MISMATCH' };
      }
    }

    const pn = await prisma.phoneNumber.findFirst({
      where: { id: ctx.fromNumberId },
    });

    if (!pn || pn.tenantId !== ctx.tenantId || pn.status !== 'ACTIVE') {
      return { valid: false, reason: 'SIGNED_CONTEXT_NUMBER_INVALID' };
    }

    const providerLower = (pn.provider || '').toLowerCase();
    if (providerLower !== 'fractel' && providerLower !== 'fractel_sbc') {
      return { valid: false, reason: 'UNAPPROVED_CARRIER_PROVIDER' };
    }

    return {
      valid: true,
      callerId: ctx.callerId,
      source: 'signed_context',
    };
  }

  if (params.callId) {
    const cleanCallId = params.callId.trim();
    const call = await prisma.call.findFirst({
      where: {
        OR: [
          { id: cleanCallId },
          { callSid: cleanCallId },
          { callSid: `call_${cleanCallId}` },
          { callSid: `fs-${cleanCallId}` },
        ],
      },
    });

    if (call) {
      if (call.status !== 'INITIATED') {
        return { valid: false, reason: 'INVALID_CALL_STATUS' };
      }

      const nowMs = Date.now();
      const callStartedMs = call.startedAt ? new Date(call.startedAt).getTime() : nowMs;
      if (nowMs - callStartedMs > 300000) {
        return { valid: false, reason: 'CALL_RECORD_EXPIRED' };
      }

      if (params.destination) {
        const cleanDest = params.destination.replace(/\D/g, '');
        const cleanCallDest = call.toNumber ? call.toNumber.replace(/\D/g, '') : '';
        if (cleanDest && cleanCallDest && !cleanDest.endsWith(cleanCallDest.slice(-10))) {
          return { valid: false, reason: 'DESTINATION_MISMATCH' };
        }
      }

      if (params.sipUser && call.createdById) {
        const identity = await prisma.sipIdentity.findUnique({
          where: { userId: call.createdById },
        });

        if (!identity || identity.extension !== params.sipUser || identity.status !== 'ACTIVE') {
          return { valid: false, reason: 'SIP_IDENTITY_MISMATCH' };
        }
      }

      if (params.channelUuid && call.metadata && typeof call.metadata === 'object') {
        const meta = call.metadata as Record<string, unknown>;
        if (meta.authorizedChannelUuid && meta.authorizedChannelUuid !== params.channelUuid) {
          return { valid: false, reason: 'REPLAY_CHANNEL_REUSED' };
        }
      }

      if (!call.fromNumberId) {
        return { valid: false, reason: 'CALL_RECORD_MISSING_FROM_NUMBER_ID' };
      }

      const pn = await prisma.phoneNumber.findFirst({
        where: { id: call.fromNumberId },
      });

      if (!pn) {
        return { valid: false, reason: 'PHONE_NUMBER_RECORD_NOT_FOUND' };
      }

      if (pn.tenantId !== call.tenantId) {
        return { valid: false, reason: 'TENANT_MISMATCH' };
      }

      if (pn.status !== 'ACTIVE') {
        return { valid: false, reason: 'PHONE_NUMBER_INACTIVE' };
      }

      const providerLower = (pn.provider || '').toLowerCase();
      if (providerLower !== 'fractel' && providerLower !== 'fractel_sbc') {
        return { valid: false, reason: 'UNAPPROVED_CARRIER_PROVIDER' };
      }

      let candidateCid = call.callerId ? call.callerId.replace(/\D/g, '') : '';
      if (candidateCid.length === 10) candidateCid = '1' + candidateCid;
      let pnNorm = pn.number ? pn.number.replace(/\D/g, '') : '';
      if (pnNorm.length === 10) pnNorm = '1' + pnNorm;

      if (candidateCid !== pnNorm) {
        return { valid: false, reason: 'CALLER_ID_NUMBER_MISMATCH' };
      }

      if (params.channelUuid) {
        try {
          const currentMeta = (call.metadata as Record<string, unknown>) || {};
          await prisma.call.update({
            where: { id: call.id },
            data: {
              metadata: {
                ...currentMeta,
                authorizedChannelUuid: params.channelUuid,
                authorizedAt: new Date().toISOString(),
              },
            },
          });
        } catch {
          // ignore concurrency metadata update warning
        }
      }

      return {
        valid: true,
        callerId: candidateCid,
        source: 'call_record',
      };
    }
  }

  return { valid: false, reason: 'NO_VALID_TENANT_CALLER_ID' };
}
