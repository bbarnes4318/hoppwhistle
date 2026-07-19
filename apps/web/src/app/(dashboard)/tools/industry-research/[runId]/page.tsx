import { RunView } from '@/features/industry-research/RunView';

export const metadata = { title: 'Research Run' };

export default function Page({ params }: { params: { runId: string } }) {
  return (
    <div className="p-6">
      <RunView runId={params.runId} />
    </div>
  );
}
