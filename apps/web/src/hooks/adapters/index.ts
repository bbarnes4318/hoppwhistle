/**
 * Project Cortex | Read-Only Adapter Hooks
 *
 * These hooks safely consume data from the Iron Dome (PhoneProvider, WebSocket)
 * without modifying any SIP/telephony logic.
 */

export {
  useCallState,
  useCallHistory,
  useAgentStatus,
  type CallTelemetry,
  type CallHistory,
} from './use-call-state';
export { useTelemetry, useLiveCallCount, type TelemetryData } from './use-telemetry';
