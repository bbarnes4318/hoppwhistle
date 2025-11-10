import { readFileSync } from 'fs';
import { join } from 'path';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent } from '@/components/ui/card';

export default function PrivacyPolicyPage() {
  let content = '# Privacy Policy\n\nContent not available.';
  try {
    const filePath = join(process.cwd(), 'docs/legal/PRIVACY_POLICY.md');
    content = readFileSync(filePath, 'utf-8');
  } catch (error) {
    // Fallback: try relative path
    try {
      const filePath = join(process.cwd(), '../../docs/legal/PRIVACY_POLICY.md');
      content = readFileSync(filePath, 'utf-8');
    } catch {
      // Use default content
    }
  }

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4">
      <Card>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none p-8">
          <ReactMarkdown>{content}</ReactMarkdown>
        </CardContent>
      </Card>
    </div>
  );
}

