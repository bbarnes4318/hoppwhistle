'use client';

import { Phone, PhoneForwarded, Search, User, Users, X } from 'lucide-react';
import { useCallback, useState, type ChangeEvent } from 'react';

import { usePhone } from './phone-provider';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ============================================================================
// Call Transfer Dialog
// ============================================================================

interface CallTransferDialogProps {
 onClose: () => void;
}

type TransferTab = 'agents' | 'queues' | 'external';

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

// Mock data for demo
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

export function CallTransferDialog({ onClose }: CallTransferDialogProps): JSX.Element {
 const { transferCall } = usePhone();
 const [activeTab, setActiveTab] = useState<TransferTab>('agents');
 const [searchQuery, setSearchQuery] = useState('');
 const [externalNumber, setExternalNumber] = useState('');
 const [transferType, setTransferType] = useState<'blind' | 'warm'>('blind');

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

 // Handle transfer to agent
 const handleAgentTransfer = useCallback(
 (agent: MockAgent) => {
 void transferCall(agent.extension, transferType);
 onClose();
 },
 [transferCall, transferType, onClose]
 );

 // Handle transfer to queue
 const handleQueueTransfer = useCallback(
 (queue: MockQueue) => {
 void transferCall(`queue:${queue.id}`, transferType);
 onClose();
 },
 [transferCall, transferType, onClose]
 );

 // Handle transfer to external number
 const handleExternalTransfer = useCallback(() => {
 if (!externalNumber) return;
 void transferCall(externalNumber, transferType);
 onClose();
 }, [transferCall, externalNumber, transferType, onClose]);

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
 className="fixed inset-0 z-50 flex items-center justify-center"
 onClick={handleBackdropClick}
 role="dialog"
 aria-modal="true"
 >
 {/* Backdrop */}
 <div className="absolute inset-0 bg-black/60 " />

 {/* Modal */}
 <div
 className={cn(
 'relative z-10 w-full max-w-md mx-4',
 'bg-muted',
 'rounded-2xl border border-white/10 shadow-sm',
 'overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200'
 )}
 onClick={e => e.stopPropagation()}
 >
 {/* Header */}
 <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
 <PhoneForwarded className="w-5 h-5 text-cyan-400" />
 </div>
 <div>
 <h2 className="text-white text-lg font-semibold">Transfer Call</h2>
 <p className="text-gray-500 text-sm">Select a destination</p>
 </div>
 </div>
 <Button
 variant="ghost"
 size="icon"
 onClick={onClose}
 className="text-gray-400 hover:text-white"
 >
 <X className="w-5 h-5" />
 </Button>
 </div>

 {/* Transfer Type Toggle */}
 <div className="px-6 py-3 border-b border-white/10">
 <div className="flex gap-2">
 <button
 onClick={() => setTransferType('blind')}
 className={cn(
 'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all',
 transferType === 'blind'
 ? 'bg-cyan-500 text-white'
 : 'bg-white/5 text-gray-400 hover:bg-white/10'
 )}
 >
 Blind Transfer
 </button>
 <button
 onClick={() => setTransferType('warm')}
 className={cn(
 'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all',
 transferType === 'warm'
 ? 'bg-cyan-500 text-white'
 : 'bg-white/5 text-gray-400 hover:bg-white/10'
 )}
 >
 Warm Transfer
 </button>
 </div>
 <p className="text-gray-500 text-xs mt-2">
 {transferType === 'blind'
 ? 'Call will be transferred immediately'
 : 'You can speak to the recipient before transferring'}
 </p>
 </div>

 {/* Tabs */}
 <div className="px-6 pt-4">
 <div className="flex gap-1 p-1 bg-white/5 rounded-lg">
 {(['agents', 'queues', 'external'] as const).map(tab => (
 <button
 key={tab}
 onClick={() => setActiveTab(tab)}
 className={cn(
 'flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5',
 activeTab === tab
 ? 'bg-cyan-500 text-white'
 : 'text-gray-400 hover:text-white hover:bg-white/5'
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
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
 <Input
 value={searchQuery}
 onChange={handleSearchChange}
 placeholder={`Search ${activeTab}...`}
 className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-gray-500"
 />
 </div>
 )}

 {/* Agents List */}
 {activeTab === 'agents' && (
 <div className="space-y-2 max-h-[250px] overflow-y-auto">
 {filteredAgents.map(agent => (
 <button
 key={agent.id}
 onClick={() => handleAgentTransfer(agent)}
 disabled={agent.status !== 'available'}
 className={cn(
 'w-full p-3 rounded-lg flex items-center gap-3 text-left',
 'transition-all',
 agent.status === 'available'
 ? 'bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/10'
 : 'opacity-50 cursor-not-allowed bg-white/5'
 )}
 >
 <div
 className={cn(
 'w-10 h-10 rounded-full flex items-center justify-center',
 agent.status === 'available'
 ? 'bg-emerald-500/10 text-emerald-400'
 : agent.status === 'busy'
 ? 'bg-amber-500/10 text-amber-400'
 : 'bg-gray-500/10 text-gray-400'
 )}
 >
 <User className="w-5 h-5" />
 </div>
 <div className="flex-1">
 <p className="text-white text-sm font-medium">{agent.name}</p>
 <p className="text-gray-500 text-xs">Ext. {agent.extension}</p>
 </div>
 <span
 className={cn(
 'text-xs px-2 py-0.5 rounded-full',
 agent.status === 'available'
 ? 'bg-emerald-500/10 text-emerald-400'
 : agent.status === 'busy'
 ? 'bg-amber-500/10 text-amber-400'
 : 'bg-gray-500/10 text-gray-400'
 )}
 >
 {agent.status}
 </span>
 </button>
 ))}
 {filteredAgents.length === 0 && (
 <p className="text-center text-gray-500 py-8">No agents found</p>
 )}
 </div>
 )}

 {/* Queues List */}
 {activeTab === 'queues' && (
 <div className="space-y-2 max-h-[250px] overflow-y-auto">
 {filteredQueues.map(queue => (
 <button
 key={queue.id}
 onClick={() => handleQueueTransfer(queue)}
 disabled={queue.availableAgents === 0}
 className={cn(
 'w-full p-3 rounded-lg flex items-center gap-3 text-left',
 'transition-all',
 queue.availableAgents > 0
 ? 'bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/10'
 : 'opacity-50 cursor-not-allowed bg-white/5'
 )}
 >
 <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
 <Users className="w-5 h-5 text-purple-400" />
 </div>
 <div className="flex-1">
 <p className="text-white text-sm font-medium">{queue.name}</p>
 <p className="text-gray-500 text-xs">
 {queue.waitingCalls} waiting • {queue.availableAgents} available
 </p>
 </div>
 </button>
 ))}
 {filteredQueues.length === 0 && (
 <p className="text-center text-gray-500 py-8">No queues found</p>
 )}
 </div>
 )}

 {/* External Number */}
 {activeTab === 'external' && (
 <div className="space-y-4">
 <div>
 <label className="block text-xs text-gray-400 mb-2">Phone Number</label>
 <Input
 value={externalNumber}
 onChange={handleExternalChange}
 placeholder="+1 (555) 000-0000"
 className="bg-white/5 border-white/10 text-white placeholder:text-gray-500"
 />
 </div>
 <Button
 onClick={handleExternalTransfer}
 disabled={!externalNumber}
 className="w-full bg-primary"
 >
 <PhoneForwarded className="w-4 h-4 mr-2" />
 Transfer to {externalNumber || 'Number'}
 </Button>
 </div>
 )}
 </div>
 </div>
 </div>
 );
}

export default CallTransferDialog;


