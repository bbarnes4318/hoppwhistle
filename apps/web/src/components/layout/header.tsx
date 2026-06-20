'use client';

import { Bell, Search, User } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function Header() {
 return (
 <header className="flex h-11 items-center justify-between border-b border-border bg-card px-4 flex-shrink-0">
 <div className="flex flex-1 items-center gap-3">
 <div className="relative flex-1 max-w-md">
 <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
 <Input
 type="search"
 id="global-search"
 name="global-search"
 placeholder="Search calls, numbers, campaigns..."
 className="pl-8 h-7 text-xs"
 />
 </div>
 </div>
 <div className="flex items-center gap-1.5">
 <Button variant="ghost" size="icon" className="h-7 w-7">
 <Bell className="h-4 w-4" />
 </Button>
 <Button variant="ghost" size="icon" className="h-7 w-7">
 <User className="h-4 w-4" />
 </Button>
 </div>
 </header>
 );
}

