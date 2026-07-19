import { RunsList } from '@/features/industry-research/RunsList';

export const metadata = { title: 'Industry Research' };

export default function Page() {
  return (
    <div className="p-6">
      <RunsList />
    </div>
  );
}
