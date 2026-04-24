'use client';

import {
 AudioLines,
 Bot,
 ClipboardCheck,
 Clock,
 Disc3,
 DollarSign,
 FileText,
 GitBranch,
 Headphones,
 LayoutDashboard,
 Megaphone,
 PhoneCall,
 Receipt,
 Settings,
 Shield,
 Users,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

interface NavItem {
 name: string;
 href: string;
 icon: React.ComponentType<{ className?: string }>;
 title?: string;
 // If set, hide from BUYER-ONLY users (those without ADMIN/OWNER)
 hideFromBuyerOnly?: boolean;
}

// Main navigation items
const navigation: NavItem[] = [
 { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
 {
 name: 'AI Voice',
 href: '/voice-agents',
 icon: Bot,
 title: 'AI voice agents & outbound campaigns',
 },
 {
 name: 'Call Center',
 href: '/call-center',
 icon: Headphones,
 title: 'Integrated dialer with scripting & quoting',
 },
 { name: 'Numbers', href: '/numbers', icon: PhoneCall },
 { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
 { name: 'Flows', href: '/flows', icon: GitBranch },
 { name: 'Call Logs', href: '/calls', icon: AudioLines },
 {
 name: 'Retention',
 href: '/retention',
 icon: ClipboardCheck,
 title: 'Policy onboarding & retention queue',
 hideFromBuyerOnly: true,
 },
 {
 name: 'Insurance Leads',
 href: '/insurance-leads',
 icon: FileText,
 title: 'ACA & FE lead ingestion pipeline',
 hideFromBuyerOnly: true,
 },
 { name: 'Billing', href: '/billing', icon: Receipt },
 {
 name: 'My Payroll',
 href: '/payroll',
 icon: Clock,
 title: 'Track hours & view earnings',
 hideFromBuyerOnly: true,
 },
 { name: 'Institutional Profile', href: '/settings', icon: Settings },
 {
   name: 'Music Console',
   href: '/music-console',
   icon: Disc3,
   title: 'Music industry streaming analytics & campaigns',
 },
];

const toolsNavigation: NavItem[] = [
 { name: 'Recording Analyzer', href: '/tools/recording-analyzer', icon: AudioLines },
];

// Admin section - only visible to ADMIN/OWNER
const adminNavigation: NavItem[] = [
 { name: 'Users', href: '/settings/users', icon: Users },
 { name: 'Webhooks', href: '/settings/webhooks', icon: FileText },
 {
 name: 'DNC Lists',
 href: '/settings/dnc',
 icon: Shield,
 },
 { name: 'Quotas & Budgets', href: '/settings/quotas', icon: DollarSign },
 {
 name: 'Payroll Admin',
 href: '/admin/payroll',
 icon: Receipt,
 title: 'Manage contractor payroll',
 },
];

export function Sidebar() {
 const pathname = usePathname();
 const { hasFullAccess, isBuyerOnly } = useAuth();

 // Filter navigation items based on user access level
 const filterNavItems = (items: NavItem[]): NavItem[] => {
 // ADMIN/OWNER sees EVERYTHING - no filtering
 if (hasFullAccess) {
 return items;
 }

 // Buyer-only users: filter out items marked hideFromBuyerOnly
 if (isBuyerOnly) {
 return items.filter(item => !item.hideFromBuyerOnly);
 }

 // Default: show all
 return items;
 };

 const visibleNavigation = filterNavItems(navigation);
 const visibleToolsNav = filterNavItems(toolsNavigation);
 // Admin section: only show to users with full access (ADMIN/OWNER)
 const visibleAdminNav = hasFullAccess ? adminNavigation : [];

 return (
 <div className="flex h-full w-64 flex-col border-r border-border bg-card">
 <div className="flex h-16 items-center border-b border-border px-6">
 <Image
 src="/hopwhistle.png"
 alt="Hopwhistle"
 width={120}
 height={40}
 className="h-8 w-auto"
 priority
 />
 </div>
 <nav className="flex-1 space-y-0.5 overflow-y-auto p-4">
 {/* Buyer Portal indicator - only for buyer-only users */}
 {isBuyerOnly && (
 <div className="mb-4 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-primary bg-primary/10 rounded-md text-center border border-primary/20">
 Buyer Portal
 </div>
 )}

 {visibleNavigation.map(item => {
 const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
 return (
 <Link
 key={item.name}
 href={item.href}
 title={item.title}
 className={cn(
 'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150',
 isActive
 ? 'bg-muted text-primary border-l-2 border-primary'
 : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
 )}
 >
 <item.icon className="h-5 w-5" />
 {item.name}
 </Link>
 );
 })}

 {visibleToolsNav.length > 0 && (
 <div className="pt-4">
 <div className="px-3 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
 Tools
 </div>
 {visibleToolsNav.map(item => {
 const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
 return (
 <Link
 key={item.name}
 href={item.href}
 className={cn(
 'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150',
 isActive
 ? 'bg-muted text-primary border-l-2 border-primary'
 : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
 )}
 >
 <item.icon className="h-5 w-5" />
 {item.name}
 </Link>
 );
 })}
 </div>
 )}

 {visibleAdminNav.length > 0 && (
 <div className="pt-4">
 <div className="px-3 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
 Admin
 </div>
 {visibleAdminNav.map(item => {
 const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
 return (
 <Link
 key={item.name}
 href={item.href}
 title={item.title}
 className={cn(
 'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150',
 isActive
 ? 'bg-muted text-primary border-l-2 border-primary'
 : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
 )}
 >
 <item.icon className="h-5 w-5" />
 {item.name}
 </Link>
 );
 })}
 </div>
 )}
 </nav>
 </div>
 );
}

