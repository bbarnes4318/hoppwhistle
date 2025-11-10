# Routing DSL

A human-readable Domain Specific Language (DSL) for defining IVRs, queues, and call routing flows.

## Features

- **YAML/JSON DSL** - Define flows in a simple, readable format
- **11 Node Types** - Entry, IVR, If, Queue, Buyer, Record, Tag, Whisper, Timeout, Fallback, Hangup
- **Parser & Validator** - Validates flow structure and node references
- **Execution Engine** - Executes flows and advances state based on telephony events
- **Flow Versioning** - Store multiple versions and publish/rollback
- **TypeScript Types** - Full type safety with Zod schemas

## Node Types

### Entry

Starting point of a flow. Points to the first node to execute.

### IVR

Interactive Voice Response with DTMF input collection. Supports:

- Custom prompts (audio URLs)
- DTMF digit matching
- Timeout handling
- Max digits limit

### If

Conditional branching based on expressions. Supports:

- Variable evaluation
- Then/else paths

### Queue

Route calls to a queue. Supports:

- Queue ID specification
- Wait music/announcements
- Timeout handling
- Max size limits
- Connection callbacks

### Buyer

Route to buyers with rotation strategies. Supports:

- Multiple buyers with weights
- Round-robin, weighted, and least-calls strategies
- Concurrency limits per buyer
- Daily call caps
- Enable/disable buyers

### Record

Record the call. Supports:

- Format selection (wav, mp3)
- Single or dual channel recording
- Beep before recording
- Completion/error callbacks

### Tag

Add metadata/tags to the call for tracking and analytics.

### Whisper

Play announcements to caller/callee before connecting. Supports:

- Separate prompts for caller and callee
- Accept/reject handling
- Timeout

### Timeout

Wait for a specified duration before continuing.

### Fallback

Try multiple nodes in sequence, falling back if one fails.

### Hangup

End the call with a specified reason.

## Usage

### Creating a Flow

```typescript
import { parseFlow, createExecutionPlan } from '@callfabric/routing-dsl';

const flow = {
  id: 'my-flow',
  name: 'My Flow',
  version: '1.0.0',
  entry: {
    id: 'entry-1',
    type: 'entry',
    target: 'ivr-1',
  },
  nodes: [
    {
      id: 'ivr-1',
      type: 'ivr',
      prompt: 'https://example.com/prompt.wav',
      choices: [
        { digits: '1', target: 'queue-sales' },
        { digits: '2', target: 'queue-support' },
      ],
      default: 'hangup-1',
    },
    {
      id: 'queue-sales',
      type: 'queue',
      queueId: 'sales-queue',
      onConnect: 'hangup-1',
    },
    {
      id: 'hangup-1',
      type: 'hangup',
      reason: 'normal',
    },
  ],
};

// Parse and validate
const validatedFlow = parseFlow(flow);

// Create execution plan
const plan = createExecutionPlan(validatedFlow);
```

### Executing a Flow

```typescript
import { FlowEngine } from './services/flow-engine';

const engine = new FlowEngine({
  callId: 'call-123',
  tenantId: 'tenant-456',
  plan: plan,
});

// Start execution
await engine.start();

// Process telephony events
await engine.processEvent({
  type: 'dtmf.received',
  callId: 'call-123',
  digits: '1',
});
```

## Examples

See `src/examples.ts` for complete examples:

- Simple direct route
- IVR with DTMF menu
- Buyer rotation with weights and limits
- Complex flow with multiple node types

## API Endpoints

- `POST /api/v1/flows` - Create/update a flow version
- `GET /api/v1/flows` - List all flows
- `GET /api/v1/flows/:flowId` - Get published version
- `GET /api/v1/flows/:flowId/versions` - Get all versions
- `GET /api/v1/flows/:flowId/versions/:version` - Get specific version
- `POST /api/v1/flows/:flowId/versions/:version/publish` - Publish a version
- `POST /api/v1/flows/:flowId/rollback` - Rollback to previous version
- `POST /api/v1/flows/validate` - Validate a flow without storing
- `POST /api/v1/flows/execute` - Execute a flow for a call
- `POST /api/v1/flows/events` - Process telephony event

## Testing

```bash
pnpm --filter @callfabric/routing-dsl test
```

Tests cover:

- Flow parsing and validation
- Node reference validation
- Execution of all node types
- Flow versioning and publish/rollback
