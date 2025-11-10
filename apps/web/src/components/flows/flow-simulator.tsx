'use client';

import { useState, useCallback, useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { X, Play, Pause, RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface FlowSimulatorProps {
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
}

interface SimulationState {
  currentNodeId: string | null;
  path: string[];
  variables: Record<string, unknown>;
  events: Array<{ type: string; timestamp: string; data?: unknown }>;
}

export function FlowSimulator({ nodes, edges, onClose }: FlowSimulatorProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [simulationState, setSimulationState] = useState<SimulationState>({
    currentNodeId: null,
    path: [],
    variables: {
      caller: { number: '+1234567890' },
      callee: { number: '+0987654321' },
      hour: new Date().getHours(),
    },
    events: [],
  });

  const entryNode = useMemo(() => nodes.find((n) => n.type === 'entry'), [nodes]);
  const nodeMap = useMemo(() => {
    const map = new Map<string, Node>();
    nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [nodes]);

  const edgeMap = useMemo(() => {
    const map = new Map<string, Edge[]>();
    edges.forEach((edge) => {
      if (!map.has(edge.source)) {
        map.set(edge.source, []);
      }
      map.get(edge.source)!.push(edge);
    });
    return map;
  }, [edges]);

  const handleStartSimulation = useCallback(() => {
    if (!entryNode) {
      alert('No entry node found');
      return;
    }

    const target = (entryNode.data.config?.target as string) || '';
    const firstNodeId = target || edges.find((e) => e.source === entryNode.id)?.target;

    if (!firstNodeId) {
      alert('No target node found from entry');
      return;
    }

    setIsRunning(true);
    setSimulationState({
      currentNodeId: firstNodeId,
      path: [entryNode.id, firstNodeId],
      variables: {
        caller: { number: '+1234567890' },
        callee: { number: '+0987654321' },
        hour: new Date().getHours(),
      },
      events: [
        {
          type: 'call.started',
          timestamp: new Date().toISOString(),
          data: { from: '+1234567890', to: '+0987654321' },
        },
      ],
    });
  }, [entryNode, edges]);

  const handleInjectEvent = useCallback(
    (eventType: string, eventData?: unknown) => {
      if (!simulationState.currentNodeId) return;

      const currentNode = nodeMap.get(simulationState.currentNodeId);
      if (!currentNode) return;

      const newEvents = [
        ...simulationState.events,
        {
          type: eventType,
          timestamp: new Date().toISOString(),
          data: eventData,
        },
      ];

      // Process event and determine next node
      const nextNodeId = processEvent(
        currentNode,
        eventType,
        eventData,
        edgeMap,
        simulationState.variables
      );

      if (nextNodeId) {
        setSimulationState({
          ...simulationState,
          currentNodeId: nextNodeId,
          path: [...simulationState.path, nextNodeId],
          events: newEvents,
        });
      } else {
        setSimulationState({
          ...simulationState,
          events: newEvents,
        });
      }
    },
    [simulationState, nodeMap, edgeMap]
  );

  const handleReset = useCallback(() => {
    setIsRunning(false);
    setSimulationState({
      currentNodeId: null,
      path: [],
      variables: {
        caller: { number: '+1234567890' },
        callee: { number: '+0987654321' },
        hour: new Date().getHours(),
      },
      events: [],
    });
  }, []);

  const currentNode = simulationState.currentNodeId
    ? nodeMap.get(simulationState.currentNodeId)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-4xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Flow Simulator</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={handleStartSimulation} disabled={isRunning}>
              <Play className="mr-2 h-4 w-4" />
              Start Simulation
            </Button>
            <Button onClick={handleReset} variant="outline">
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
          </div>

          {currentNode && (
            <div className="rounded border bg-muted p-4">
              <div className="font-semibold">Current Node: {currentNode.data.label}</div>
              <div className="text-sm text-muted-foreground">ID: {currentNode.id}</div>
              <div className="mt-2 text-sm">Type: {currentNode.type}</div>
            </div>
          )}

          <div className="rounded border bg-muted p-4">
            <div className="mb-2 font-semibold">Execution Path</div>
            <div className="flex flex-wrap gap-2">
              {simulationState.path.map((nodeId, index) => {
                const node = nodeMap.get(nodeId);
                return (
                  <div
                    key={index}
                    className={`rounded px-2 py-1 text-xs ${
                      nodeId === simulationState.currentNodeId
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background'
                    }`}
                  >
                    {node?.data.label || nodeId}
                    {index < simulationState.path.length - 1 && (
                      <span className="ml-2">→</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {currentNode && (
            <div className="rounded border bg-muted p-4">
              <div className="mb-2 font-semibold">Inject Event</div>
              <div className="flex flex-wrap gap-2">
                {getAvailableEvents(currentNode.type).map((eventType) => (
                  <Button
                    key={eventType}
                    size="sm"
                    variant="outline"
                    onClick={() => handleInjectEvent(eventType)}
                  >
                    {eventType}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded border bg-muted p-4">
            <div className="mb-2 font-semibold">Events</div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {simulationState.events.map((event, index) => (
                <div key={index} className="text-xs">
                  <span className="font-mono text-muted-foreground">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                  : <span className="font-semibold">{event.type}</span>
                  {event.data && (
                    <span className="ml-2 text-muted-foreground">
                      {JSON.stringify(event.data)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function getAvailableEvents(nodeType: string): string[] {
  switch (nodeType) {
    case 'ivr':
      return ['dtmf.received', 'call.ended'];
    case 'queue':
      return ['queue.connected', 'queue.timeout', 'call.ended'];
    case 'whisper':
      return ['whisper.accepted', 'whisper.rejected', 'call.ended'];
    case 'record':
      return ['recording.completed', 'call.ended'];
    case 'buyer':
      return ['call.answered', 'call.ended'];
    default:
      return ['call.answered', 'call.ended'];
  }
}

function processEvent(
  currentNode: Node,
  eventType: string,
  eventData: unknown,
  edgeMap: Map<string, Edge[]>,
  variables: Record<string, unknown>
): string | null {
  const outgoingEdges = edgeMap.get(currentNode.id) || [];
  const config = (currentNode.data.config || {}) as Record<string, unknown>;

  switch (currentNode.type) {
    case 'ivr': {
      if (eventType === 'dtmf.received') {
        const digits = (eventData as { digits?: string })?.digits || '';
        // Find edge with matching condition
        const matchingEdge = outgoingEdges.find(
          (e) => e.data?.condition === digits
        );
        return matchingEdge?.target || (config.default as string) || null;
      }
      break;
    }

    case 'if': {
      // Evaluate condition (simplified)
      const condition = (config.condition as string) || '';
      // In real implementation, evaluate condition against variables
      const result = evaluateCondition(condition, variables);
      const thenEdge = outgoingEdges.find((e) => e.data?.condition === 'true');
      const elseEdge = outgoingEdges.find((e) => e.data?.condition === 'false');
      return result ? thenEdge?.target || (config.then as string) || null : elseEdge?.target || (config.else as string) || null;
    }

    case 'queue': {
      if (eventType === 'queue.connected') {
        return (config.onConnect as string) || outgoingEdges.find((e) => e.data?.condition === 'connected')?.target || null;
      }
      if (eventType === 'queue.timeout') {
        return (config.onTimeout as string) || outgoingEdges.find((e) => e.data?.condition === 'timeout')?.target || null;
      }
      break;
    }

    case 'whisper': {
      if (eventType === 'whisper.accepted') {
        return (config.onAccept as string) || outgoingEdges.find((e) => e.data?.condition === 'accept')?.target || null;
      }
      if (eventType === 'whisper.rejected') {
        return (config.onReject as string) || outgoingEdges.find((e) => e.data?.condition === 'reject')?.target || null;
      }
      break;
    }

    case 'record': {
      if (eventType === 'recording.completed') {
        return (config.onComplete as string) || outgoingEdges.find((e) => e.data?.condition === 'complete')?.target || null;
      }
      break;
    }

    default: {
      // For nodes with simple next flow
      return outgoingEdges[0]?.target || (config.next as string) || null;
    }
  }

  return null;
}

function evaluateCondition(condition: string, variables: Record<string, unknown>): boolean {
  // Simplified condition evaluation
  // In production, use a proper expression evaluator
  try {
    // Replace variable references
    let evalCondition = condition;
    evalCondition = evalCondition.replace(/\$\{caller\.number\}/g, "'+1234567890'");
    evalCondition = evalCondition.replace(/\$\{hour\}/g, String(variables.hour || 12));
    
    // Very basic evaluation (not safe for production)
    if (evalCondition.includes('==')) {
      const [left, right] = evalCondition.split('==').map((s) => s.trim());
      return left === right;
    }
    if (evalCondition.includes('>=')) {
      const [left, right] = evalCondition.split('>=').map((s) => parseInt(s.trim()));
      return left >= right;
    }
    return false;
  } catch {
    return false;
  }
}

