import { PolicyDetailView } from '@/components/retention/PolicyDetailView';

interface PolicyDetailPageProps {
  params: {
    id: string;
  };
}

export default function PolicyDetailPage({ params }: PolicyDetailPageProps): JSX.Element {
  return <PolicyDetailView policyId={params.id} />;
}
