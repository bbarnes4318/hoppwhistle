import { NextResponse } from 'next/server';

const VAPI_API_KEY = process.env.VAPI_API_KEY || 'b8c9e434-32ca-4cbc-ae39-b6c4583622c2';
const VAPI_BASE = 'https://api.vapi.ai';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const res = await fetch(`${VAPI_BASE}/assistant/${params.id}`, {
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
    });
    if (!res.ok) throw new Error(`Vapi API error: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch assistant' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const res = await fetch(`${VAPI_BASE}/assistant/${params.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Vapi API error: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update assistant' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const res = await fetch(`${VAPI_BASE}/assistant/${params.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
    });
    if (!res.ok) throw new Error(`Vapi API error: ${res.status}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete assistant' },
      { status: 500 }
    );
  }
}
