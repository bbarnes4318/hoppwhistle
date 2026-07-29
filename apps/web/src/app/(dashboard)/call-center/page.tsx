'use client';

import { CallCenterPortal } from '@/components/call-center/CallCenterPortal';
import { RoleGuard } from '@/components/auth/role-guard';

function CallCenterPage(): JSX.Element {
  return <CallCenterPortal />;
}

export default function GuardedCallCenterPage() {
  return (
    <RoleGuard allowedRoles={['AGENT', 'ADMIN', 'OWNER']}>
      <CallCenterPage />
    </RoleGuard>
  );
}
