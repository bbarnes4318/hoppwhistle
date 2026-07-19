import { RunView } from '@/features/industry-research/RunView';

export const metadata = { title: 'Investigation — Industry Research' };

export default function Page({ params }: { params: { runId: string } }) {
  return <RunView runId={params.runId} />;
}
