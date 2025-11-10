'use client';

import { use } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Save, Eye } from 'lucide-react';

// Mock flow builder - simplified visual representation
export default function FlowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Flow Builder</h1>
          <p className="text-muted-foreground">Campaign: {id}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </Button>
          <Button variant="outline">
            <Play className="mr-2 h-4 w-4" />
            Test Dial
          </Button>
          <Button>
            <Save className="mr-2 h-4 w-4" />
            Save Flow
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Visual Flow Builder</CardTitle>
          <CardDescription>Drag and drop nodes to build your call flow</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[600px] border-2 border-dashed rounded-lg flex items-center justify-center bg-muted/50">
            <div className="text-center">
              <p className="text-lg font-semibold mb-2">Flow Builder Canvas</p>
              <p className="text-sm text-muted-foreground">
                Visual drag-and-drop flow builder will be rendered here
              </p>
              <div className="mt-4 flex gap-2 justify-center">
                <Badge>Entry</Badge>
                <Badge>IVR</Badge>
                <Badge>Queue</Badge>
                <Badge>Buyer</Badge>
                <Badge>Record</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

