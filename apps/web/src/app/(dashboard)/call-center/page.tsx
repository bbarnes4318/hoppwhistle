'use client';

import { RoleGuard } from '@/components/auth/role-guard';
import { CallCenterPortal } from '@/components/call-center/CallCenterPortal';

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
