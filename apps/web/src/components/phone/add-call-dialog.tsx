'use client';

import { Phone, Plus, Search, User, Users, X } from 'lucide-react';
import { useCallback, useState, type ChangeEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { usePhone } from './phone-provider';

// ============================================================================
// Add Call Dialog
// ============================================================================

interface AddCallDialogProps {
  onClose: () => void;
}

type Tab = 'agents' | 'queues' | 'external';

interface MockAgent {
  id: string;
  name: string;
  extension: string;
  status: 'available' | 'busy' | 'offline';
}

interface MockQueue {
  id: string;
  name: string;
  waitingCalls: number;
  availableAgents: number;
}

// Mock data for demo (shared with transfer dialog for consistency)
const mockAgents: MockAgent[] = [
  { id: '1', name: 'John Smith', extension: '1001', status: 'available' },
  { id: '2', name: 'Jane Doe', extension: '1002', status: 'busy' },
  { id: '3', name: 'Bob Wilson', extension: '1003', status: 'available' },
  { id: '4', name: 'Alice Brown', extension: '1004', status: 'offline' },
];

const mockQueues: MockQueue[] = [
  { id: 'q1', name: 'Sales', waitingCalls: 2, availableAgents: 5 },
  { id: 'q2', name: 'Support', waitingCalls: 5, availableAgents: 3 },
  { id: 'q3', name: 'Billing', waitingCalls: 0, availableAgents: 2 },
];

export function AddCallDialog({ onClose }: AddCallDialogProps): JSX.Element {
  const { addThirdParty } = usePhone();
  const [activeTab, setActiveTab] = useState<Tab>('agents');
  const [searchQuery, setSearchQuery] = useState('');
  const [externalNumber, setExternalNumber] = useState('');

  // Filter agents
  const filteredAgents = mockAgents.filter(
    agent =>
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.extension.includes(searchQuery)
  );

  // Filter queues
  const filteredQueues = mockQueues.filter(queue =>
    queue.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle add agent
  const handleAddAgent = useCallback(
    (agent: MockAgent) => {
      void addThirdParty(agent.extension);
      onClose();
    },
    [addThirdParty, onClose]
  );

  // Handle add queue
  const handleAddQueue = useCallback(
    (queue: MockQueue) => {
      void addThirdParty(`queue:${queue.id}`);
      onClose();
    },
    [addThirdParty, onClose]
  );

  // Handle add external number
  const handleAddExternal = useCallback(() => {
    if (!externalNumber) return;
    void addThirdParty(externalNumber);
    onClose();
  }, [addThirdParty, externalNumber, onClose]);

  // Handle search input
  const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  // Handle external number input
  const handleExternalChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setExternalNumber(e.target.value);
  }, []);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      onClick={handleBackdropClick}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Add to call"
    >
      {/* Backdrop: the same scrim as components/ui/dialog. */}
      <div
        className="absolute inset-0 bg-[rgba(16,24,40,0.45)] animate-in fade-in-0 duration-200 motion-reduce:animate-none"
        aria-hidden
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={cn(
          'relative z-10 w-full sm:max-w-md sm:mx-4',
          'bg-surface max-h-[92dvh] overflow-y-auto',
          'rounded-t-[20px] sm:rounded-card border border-rule shadow-pop',
          'animate-in fade-in-0 slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200 motion-reduce:animate-none'
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-rule flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-tint flex items-center justify-center">
              <Plus className="w-5 h-5 text-brand-ink" />
            </div>
            <div>
              <h2 className="text-ink text-lg font-semibold">Add to Call</h2>
              <p className="text-ink-3 text-sm">Select a participant to add</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
            autoFocus
            className="text-ink-2 hover:text-ink [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4">
          <div className="flex gap-1 p-1 bg-sunken rounded-lg">
            {(['agents', 'queues', 'external'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'flex-1 py-2 px-3 rounded-[6px] text-xs font-medium transition-[color,background-color,box-shadow] duration-150 ne-motion flex items-center justify-center gap-1.5',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-[44px]',
                  activeTab === tab
                    ? 'bg-surface text-ink shadow-card'
                    : 'text-ink-2 hover:text-ink'
                )}
              >
                {tab === 'agents' && <User className="w-3.5 h-3.5" />}
                {tab === 'queues' && <Users className="w-3.5 h-3.5" />}
                {tab === 'external' && <Phone className="w-3.5 h-3.5" />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Search (for agents and queues) */}
          {activeTab !== 'external' && (
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
              <Input
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder={`Search ${activeTab}...`}
                className="pl-10 bg-surface border-rule text-ink placeholder:text-ink-3"
              />
            </div>
          )}

          {/* Agents List */}
          {activeTab === 'agents' && (
            <div className="space-y-2 max-h-[250px] overflow-y-auto">
              {filteredAgents.map(agent => (
                <button
                  key={agent.id}
                  onClick={() => handleAddAgent(agent)}
                  disabled={agent.status !== 'available'}
                  className={cn(
                    'w-full p-3 rounded-card flex items-center gap-3 text-left',
                    'transition-colors duration-150 ne-motion',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    agent.status === 'available'
                      ? 'bg-sunken hover:bg-surface border border-transparent hover:border-rule-strong'
                      : 'opacity-50 cursor-not-allowed bg-sunken border border-transparent'
                  )}
                >
                  <div
                    className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center',
                      agent.status === 'available'
                        ? 'bg-live-tint text-live-ink'
                        : agent.status === 'busy'
                          ? 'bg-ringing-tint text-ringing-ink'
                          : 'bg-sunken text-ink-3'
                    )}
                  >
                    <User className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-ink text-sm font-medium">{agent.name}</p>
                    <p className="text-ink-3 text-xs">Ext. {agent.extension}</p>
                  </div>
                  <span
                    className={cn(
                      'text-xs px-2 py-0.5 rounded-full',
                      agent.status === 'available'
                        ? 'bg-live-tint text-live-ink'
                        : agent.status === 'busy'
                          ? 'bg-ringing-tint text-ringing-ink'
                          : 'bg-sunken text-ink-3'
                    )}
                  >
                    {agent.status === 'available'
                      ? 'Available'
                      : agent.status === 'busy'
                        ? 'On a call'
                        : 'Offline'}
                  </span>
                </button>
              ))}
              {filteredAgents.length === 0 && (
                <p className="text-center text-sm text-ink-3 py-8">No agents found</p>
              )}
            </div>
          )}

          {/* Queues List */}
          {activeTab === 'queues' && (
            <div className="space-y-2 max-h-[250px] overflow-y-auto">
              {filteredQueues.map(queue => (
                <button
                  key={queue.id}
                  onClick={() => handleAddQueue(queue)}
                  disabled={queue.availableAgents === 0}
                  className={cn(
                    'w-full p-3 rounded-card flex items-center gap-3 text-left',
                    'transition-colors duration-150 ne-motion',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    queue.availableAgents > 0
                      ? 'bg-sunken hover:bg-surface border border-transparent hover:border-rule-strong'
                      : 'opacity-50 cursor-not-allowed bg-sunken border border-transparent'
                  )}
                >
                  <div className="w-10 h-10 rounded-full bg-brand-tint flex items-center justify-center">
                    <Users className="w-5 h-5 text-brand-ink" />
                  </div>
                  <div className="flex-1">
                    <p className="text-ink text-sm font-medium">{queue.name}</p>
                    <p className="text-ink-3 text-xs">
                      {queue.waitingCalls} waiting • {queue.availableAgents} available
                    </p>
                  </div>
                </button>
              ))}
              {filteredQueues.length === 0 && (
                <p className="text-center text-sm text-ink-3 py-8">No queues found</p>
              )}
            </div>
          )}

          {/* External Number */}
          {activeTab === 'external' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-ink-3 mb-2">Phone Number</label>
                <Input
                  value={externalNumber}
                  onChange={handleExternalChange}
                  placeholder="+1 (555) 000-0000"
                  className="bg-surface border-rule text-ink placeholder:text-ink-3"
                />
              </div>
              <Button onClick={handleAddExternal} disabled={!externalNumber} className="w-full">
                <Phone className="w-4 h-4 mr-2" />
                Call {externalNumber || 'Number'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AddCallDialog;
