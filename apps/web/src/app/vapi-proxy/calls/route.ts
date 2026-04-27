import { NextResponse } from 'next/server';

const VAPI_API_KEY = process.env.VAPI_API_KEY || 'b8c9e434-32ca-4cbc-ae39-b6c4583622c2';
const VAPI_BASE = 'https://api.vapi.ai';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || '50';
    const assistantId = searchParams.get('assistantId') || '';

    let url = `${VAPI_BASE}/call?limit=${limit}`;
    if (assistantId) url += `&assistantId=${assistantId}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Vapi API error: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch calls' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[Vapi Proxy] POST payload:', JSON.stringify(body, null, 2));

    // Convert raw phone number to Vapi phoneNumberId UUID
    let finalPhoneNumberId = body.phoneNumberId;
    if (finalPhoneNumberId && finalPhoneNumberId.startsWith('+')) {
      const pnRes = await fetch(`${VAPI_BASE}/phone-number`, {
        headers: { Authorization: `Bearer ${VAPI_API_KEY}` }
      });
      if (pnRes.ok) {
        const phoneNumbers = await pnRes.json();
        const matched = phoneNumbers.find((pn: any) => pn.number === finalPhoneNumberId);
        if (matched) {
          const original = finalPhoneNumberId;
          finalPhoneNumberId = matched.id;
          body.phoneNumberId = finalPhoneNumberId;
          console.log(`[Vapi Proxy] Mapped ${original} to UUID ${matched.id}`);
        } else {
          throw new Error(`Phone number ${finalPhoneNumberId} not found in Vapi account.`);
        }
      }
    }

    const res = await fetch(`${VAPI_BASE}/call/phone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[Vapi Proxy] Vapi API Error Response:', text);
      let err;
      try { err = JSON.parse(text); } catch (e) { err = { message: text }; }
      throw new Error(err.message || `Vapi API error: ${res.status}`);
    }
    const data = await res.json();
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create call' },
      { status: 500 }
    );
  }
}
