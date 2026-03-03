import { NextResponse } from 'next/server';

const VAPI_API_KEY = process.env.VAPI_API_KEY || 'b8c9e434-32ca-4cbc-ae39-b6c4583622c2';
const VAPI_BASE = 'https://api.vapi.ai';

export async function GET() {
  try {
    const res = await fetch(`${VAPI_BASE}/assistant`, {
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
    });
    if (!res.ok) throw new Error(`Vapi API error: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch assistants' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${VAPI_BASE}/assistant`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || `Vapi API error: ${res.status}`);
    }
    const data = await res.json();
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create assistant' },
      { status: 500 }
    );
  }
}
