'use client';

import {
  ReactFlow,
  Node,
  Edge,
  addEdge,
  Background,
  Controls,
  MiniMap,
  Connection,
  useNodesState,
  useEdgesState,
  MarkerType,
  NodeTypes,
  ReactFlowProvider,
} from '@xyflow/react';
import { Save, Download, Loader2 } from 'lucide-react';
import { useCallback, useState, useRef, useEffect } from 'react';

import '@xyflow/react/dist/style.css';
import { CustomNode } from './custom-node';
import { EdgeConfigPanel } from './edge-config-panel';
import { FlowSerializer } from './flow-serializer';
import { FlowSimulator } from './flow-simulator';
import { NodePalette } from './node-palette';
import { VersionControls } from './version-controls';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient } from '@/lib/api';


const nodeTypes: NodeTypes = {
  entry: CustomNode,
  ivr: CustomNode,
  if: CustomNode,
  queue: CustomNode,
  buyer: CustomNode,
  record: CustomNode,
  tag: CustomNode,
  whisper: CustomNode,
  timeout: CustomNode,
  fallback: CustomNode,
  hangup: CustomNode,
};

const initialNodes: Node[] = [
  {
    id: 'entry-1',
    type: 'entry',
    position: { x: 250, y: 100 },
    data: { label: 'Entry', nodeType: 'entry', config: {} },
  },
];

const initialEdges: Edge[] = [];

interface FlowListItem {
  id: string;
  name?: string;
  publishedVersion?: string | null;
  versions?: Array<{ version: string; published: boolean; createdAt: string }>;
}

export function FlowBuilder() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [flowName, setFlowName] = useState('New Flow');
  const [flowVersion, setFlowVersion] = useState('1.0.0');
  const [flowId, setFlowId] = useState<string | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: 'smoothstep',
            animated: true,
            markerEnd: {
              type: MarkerType.ArrowClosed,
            },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setSelectedEdge(null);
  }, []);

  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  const handleAddNode = useCallback(
    (nodeType: string, position: { x: number; y: number }) => {
      const id = `${nodeType}-${Date.now()}`;
      const newNode: Node = {
        id,
        type: nodeType,
        position,
        data: {
          label: nodeType.charAt(0).toUpperCase() + nodeType.slice(1),
          nodeType,
          config: getDefaultConfig(nodeType),
        },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type || !reactFlowWrapper.current) {
        return;
      }

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = {
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      };

      handleAddNode(type, position);
    },
    [handleAddNode]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleUpdateNode = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, config } }
            : node
        )
      );
    },
    [setNodes]
  );

  const handleUpdateEdge = useCallback(
    (edgeId: string, data: Record<string, unknown>) => {
      setEdges((eds) =>
        eds.map((edge) =>
          edge.id === edgeId ? { ...edge, data: { ...edge.data, ...data } } : edge
        )
      );
    },
    [setEdges]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((node) => node.id !== nodeId));
      setEdges((eds) =>
        eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
      );
      if (selectedNode?.id === nodeId) {
        setSelectedNode(null);
      }
    },
    [setNodes, setEdges, selectedNode]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((edge) => edge.id !== edgeId));
      if (selectedEdge?.id === edgeId) {
        setSelectedEdge(null);
      }
    },
    [setEdges, selectedEdge]
  );

  // Load flows list on mount
  useEffect(() => {
    loadFlows();
  }, []);

  const loadFlows = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<{ data: FlowListItem[] }>('/api/v1/flows');
      if (response.data?.data) {
        setFlows(response.data.data);
      }
    } catch (error) {
      console.error('Failed to load flows:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadFlow = async (flowIdToLoad: string, version?: string) => {
    setLoading(true);
    try {
      const url = version
        ? `/api/v1/flows/${flowIdToLoad}/versions/${version}`
        : `/api/v1/flows/${flowIdToLoad}`;
      
      const response = await apiClient.get<{ flow: any; version: string; flowId: string }>(url);
      
      if (response.data?.flow) {
        const serializer = new FlowSerializer();
        const { nodes: loadedNodes, edges: loadedEdges } = serializer.deserializeFromFlow(response.data.flow);
        
        setNodes(loadedNodes);
        setEdges(loadedEdges);
        setFlowId(response.data.flowId);
        setFlowName(response.data.flow.name || 'Unnamed Flow');
        setFlowVersion(response.data.version);
        setSelectedFlowId(flowIdToLoad);
      } else {
        alert(`Error: ${response.error?.message || 'Failed to load flow'}`);
      }
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : 'Failed to load flow'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleNewFlow = () => {
    setNodes(initialNodes);
    setEdges([]);
    setFlowId(null);
    setFlowName('New Flow');
    setFlowVersion('1.0.0');
    setSelectedFlowId(null);
  };

  const handleSaveFlow = useCallback(async () => {
    if (!flowName.trim()) {
      alert('Please enter a flow name');
      return;
    }

    setSaving(true);
    const serializer = new FlowSerializer();
    const flow = serializer.serializeToFlow(nodes, edges, flowName, flowVersion, flowId);
    
    try {
      const response = await apiClient.post<{ flowId: string; version: string; id: string }>('/api/v1/flows', flow);
      
      if (response.data) {
        setFlowId(response.data.flowId);
        setSelectedFlowId(response.data.flowId);
        await loadFlows(); // Refresh flows list
        alert('Flow saved successfully!');
      } else {
        alert(`Error: ${response.error?.message || 'Failed to save flow'}`);
      }
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : 'Failed to save flow'}`);
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, flowName, flowVersion, flowId]);

  const handleExportFlow = useCallback(() => {
    const serializer = new FlowSerializer();
    const flow = serializer.serializeToFlow(nodes, edges, flowName, flowVersion, flowId);
    const blob = new Blob([JSON.stringify(flow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${flowName}-${flowVersion}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, flowName, flowVersion, flowId]);

  return (
    <ReactFlowProvider>
      <div className="flex h-full w-full flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b bg-card px-3 py-2 flex-shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h1 className="text-lg font-bold whitespace-nowrap">Flow Builder</h1>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="flow-select" className="text-xs whitespace-nowrap">Flow:</Label>
              <Select
                value={selectedFlowId || 'new'}
                onValueChange={(value) => {
                  if (value === 'new') {
                    handleNewFlow();
                  } else {
                    loadFlow(value);
                  }
                }}
                disabled={loading}
              >
                <SelectTrigger id="flow-select" className="w-48 h-8 text-sm">
                  <SelectValue placeholder="Select a flow" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">+ New Flow</SelectItem>
                  {flows.map((flow) => (
                    <SelectItem key={flow.id} value={flow.id}>
                      {flow.name || flow.id} {flow.publishedVersion ? `(v${flow.publishedVersion})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <input
              type="text"
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              className="rounded border px-2 py-1 h-8 text-sm w-40"
              placeholder="Flow Name"
            />
            <input
              type="text"
              value={flowVersion}
              onChange={(e) => setFlowVersion(e.target.value)}
              className="rounded border px-2 py-1 h-8 w-20 text-sm"
              placeholder="Version"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button onClick={handleSaveFlow} variant="default" disabled={saving || loading} size="sm" className="h-8">
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Save
            </Button>
            <Button onClick={handleExportFlow} variant="outline" disabled={loading} size="sm" className="h-8">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export
            </Button>
            <Button onClick={() => setShowSimulator(!showSimulator)} variant="outline" size="sm" className="h-8">
              Simulator
            </Button>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden min-h-0">
          <NodePalette onAddNode={handleAddNode} />
          <div className="relative flex-1 min-w-0 h-full" ref={reactFlowWrapper} onDrop={onDrop} onDragOver={onDragOver}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              fitView
              className="h-full w-full"
            >
              <Background />
              <Controls />
              <MiniMap />
            </ReactFlow>
          </div>
          <div className="w-80 border-l bg-card p-4 overflow-y-auto flex-shrink-0 h-full">
            {selectedNode ? (
              <NodeConfigPanel
                node={selectedNode}
                onUpdate={handleUpdateNode}
                onDelete={handleDeleteNode}
              />
            ) : selectedEdge ? (
              <EdgeConfigPanel
                edge={selectedEdge}
                onUpdate={handleUpdateEdge}
                onDelete={handleDeleteEdge}
              />
            ) : (
              <div className="text-muted-foreground">Select a node or edge to configure</div>
            )}
          </div>
        </div>
        {showSimulator && (
          <FlowSimulator
            nodes={nodes}
            edges={edges}
            onClose={() => setShowSimulator(false)}
          />
        )}
      </div>
    </ReactFlowProvider>
  );
}

function NodeConfigPanel({
  node,
  onUpdate,
  onDelete,
}: {
  node: Node;
  onUpdate: (nodeId: string, config: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
}) {
  const config = (node.data.config || {}) as Record<string, unknown>;

  const handleConfigChange = (key: string, value: unknown) => {
    onUpdate(node.id, { ...config, [key]: value });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{node.data.label}</h3>
        <Button
          onClick={() => onDelete(node.id)}
          variant="destructive"
          size="sm"
        >
          Delete
        </Button>
      </div>
      <NodeConfigForm nodeType={node.data.nodeType} config={config} onChange={handleConfigChange} />
    </div>
  );
}

function NodeConfigForm({
  nodeType,
  config,
  onChange,
}: {
  nodeType: string;
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  switch (nodeType) {
    case 'entry':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium">Target Node ID</label>
          <input
            type="text"
            value={(config.target as string) || ''}
            onChange={(e) => onChange('target', e.target.value)}
            className="w-full rounded border px-2 py-1"
          />
        </div>
      );
    case 'ivr':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium">Prompt</label>
          <input
            type="text"
            value={(config.prompt as string) || ''}
            onChange={(e) => onChange('prompt', e.target.value)}
            className="w-full rounded border px-2 py-1"
            placeholder="Audio URL or text"
          />
          <label className="text-sm font-medium">Timeout (seconds)</label>
          <input
            type="number"
            value={(config.timeout as number) || 10}
            onChange={(e) => onChange('timeout', parseInt(e.target.value))}
            className="w-full rounded border px-2 py-1"
          />
          <label className="text-sm font-medium">Max Digits</label>
          <input
            type="number"
            value={(config.maxDigits as number) || 1}
            onChange={(e) => onChange('maxDigits', parseInt(e.target.value))}
            className="w-full rounded border px-2 py-1"
          />
        </div>
      );
    case 'if':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium">Condition</label>
          <textarea
            value={(config.condition as string) || ''}
            onChange={(e) => onChange('condition', e.target.value)}
            className="w-full rounded border px-2 py-1"
            placeholder='e.g., ${caller.number == "+1234567890"}'
            rows={3}
          />
        </div>
      );
    case 'queue':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium">Queue ID</label>
          <input
            type="text"
            value={(config.queueId as string) || ''}
            onChange={(e) => onChange('queueId', e.target.value)}
            className="w-full rounded border px-2 py-1"
          />
          <label className="text-sm font-medium">Timeout (seconds)</label>
          <input
            type="number"
            value={(config.timeout as number) || 60}
            onChange={(e) => onChange('timeout', parseInt(e.target.value))}
            className="w-full rounded border px-2 py-1"
          />
        </div>
      );
    case 'buyer':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium">Strategy</label>
          <select
            value={(config.strategy as string) || 'round-robin'}
            onChange={(e) => onChange('strategy', e.target.value)}
            className="w-full rounded border px-2 py-1"
          >
            <option value="round-robin">Round Robin</option>
            <option value="weighted">Weighted</option>
            <option value="least-calls">Least Calls</option>
          </select>
        </div>
      );
    case 'record':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium">Format</label>
          <select
            value={(config.format as string) || 'wav'}
            onChange={(e) => onChange('format', e.target.value)}
            className="w-full rounded border px-2 py-1"
          >
            <option value="wav">WAV</option>
            <option value="mp3">MP3</option>
          </select>
        </div>
      );
    case 'tag':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium">Tags (JSON)</label>
          <textarea
            value={JSON.stringify(config.tags || {}, null, 2)}
            onChange={(e) => {
              try {
                onChange('tags', JSON.parse(e.target.value));
              } catch {
                // Invalid JSON, ignore
              }
            }}
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            rows={5}
          />
        </div>
      );
    case 'whisper':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium">Caller Prompt</label>
          <input
            type="text"
            value={(config.callerPrompt as string) || ''}
            onChange={(e) => onChange('callerPrompt', e.target.value)}
            className="w-full rounded border px-2 py-1"
          />
          <label className="text-sm font-medium">Callee Prompt</label>
          <input
            type="text"
            value={(config.calleePrompt as string) || ''}
            onChange={(e) => onChange('calleePrompt', e.target.value)}
            className="w-full rounded border px-2 py-1"
          />
        </div>
      );
    case 'timeout':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium">Duration (seconds)</label>
          <input
            type="number"
            value={(config.duration as number) || 0}
            onChange={(e) => onChange('duration', parseInt(e.target.value))}
            className="w-full rounded border px-2 py-1"
          />
        </div>
      );
    case 'fallback':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium">Target Node IDs (comma-separated)</label>
          <input
            type="text"
            value={((config.targets as string[]) || []).join(', ')}
            onChange={(e) =>
              onChange(
                'targets',
                e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
              )
            }
            className="w-full rounded border px-2 py-1"
          />
        </div>
      );
    case 'hangup':
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium">Reason</label>
          <select
            value={(config.reason as string) || 'normal'}
            onChange={(e) => onChange('reason', e.target.value)}
            className="w-full rounded border px-2 py-1"
          >
            <option value="normal">Normal</option>
            <option value="busy">Busy</option>
            <option value="rejected">Rejected</option>
            <option value="timeout">Timeout</option>
            <option value="error">Error</option>
          </select>
        </div>
      );
    default:
      return <div>No configuration available</div>;
  }
}

function getDefaultConfig(nodeType: string): Record<string, unknown> {
  switch (nodeType) {
    case 'entry':
      return { target: '' };
    case 'ivr':
      return { prompt: '', timeout: 10, maxDigits: 1, choices: [], default: '' };
    case 'if':
      return { condition: '', then: '', else: '' };
    case 'queue':
      return { queueId: '', timeout: 60 };
    case 'buyer':
      return { buyers: [], strategy: 'round-robin' };
    case 'record':
      return { format: 'wav', channels: 'dual', beep: false };
    case 'tag':
      return { tags: {} };
    case 'whisper':
      return { callerPrompt: '', calleePrompt: '', timeout: 10 };
    case 'timeout':
      return { duration: 0 };
    case 'fallback':
      return { targets: [] };
    case 'hangup':
      return { reason: 'normal' };
    default:
      return {};
  }
}

