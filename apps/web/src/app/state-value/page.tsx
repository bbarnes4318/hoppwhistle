import type { Metadata } from 'next';

import { StateValueTool } from './StateValueTool';

export const metadata: Metadata = {
  // Bare, not "… | NetEnroll": the root layout applies a "%s · NetEnroll"
  // template, so any suffix here would render the brand twice.
  title: 'State Value Evaluator',
  description:
    'Rank US licensing jurisdictions by senior population reached per licensing dollar, for the state you are licensed in, and price out a multi-state licensing plan.',
};

export default function StateValuePage() {
  return <StateValueTool />;
}
