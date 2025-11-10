'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import {
  LayoutDashboard,
  Phone,
  Megaphone,
  PhoneCall,
  Receipt,
  Settings,
  Users,
  FileText,
  Shield,
  GitBranch,
  DollarSign,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Numbers', href: '/numbers', icon: Phone },
  { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { name: 'Flows', href: '/flows', icon: GitBranch },
  { name: 'Calls', href: '/calls', icon: PhoneCall },
  { name: 'Billing', href: '/billing', icon: Receipt },
  { name: 'Settings', href: '/settings', icon: Settings },
];

const adminNavigation = [
  { name: 'Users', href: '/settings/users', icon: Users },
  { name: 'Webhooks', href: '/settings/webhooks', icon: FileText },
  { name: 'DNC Lists', href: '/settings/dnc', icon: Shield },
  { name: 'Quotas & Budgets', href: '/settings/quotas', icon: DollarSign },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center border-b px-6">
        <Image
          src="/hopwhistle.png"
          alt="Hopwhistle"
          width={120}
          height={40}
          className="h-8 w-auto"
          priority
        />
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {navigation.map(item => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
        <div className="pt-4">
          <div className="px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            Admin
          </div>
          {adminNavigation.map(item => {
            const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
