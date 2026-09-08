import type { Metadata } from 'next';

import { StateValueTool } from './StateValueTool';

export const metadata: Metadata = {
  title: 'State Value Evaluator | NetEnroll',
  description:
    'Rank all 51 US licensing jurisdictions by senior population reached per licensing dollar, and price out a multi-state licensing plan.',
};

export default function StateValuePage() {
  return <StateValueTool />;
}
