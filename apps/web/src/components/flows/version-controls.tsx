'use client';

import { Send, RotateCcw, GitCompare } from 'lucide-react';
import { useState, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api';

interface FlowVersion {
 version: string;
 published: boolean;
 createdAt: string;
}

interface VersionControlsProps {
 flowId: string | null;
 onVersionChange?: (version: string) => void;
}

export function VersionControls({ flowId, onVersionChange }: VersionControlsProps) {
 const [versions, setVersions] = useState<FlowVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (flowId) {
      void loadVersions();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId]);

 const loadVersions = async () => {
 if (!flowId) return;
 try {
 const response = await apiClient.get<{ data: FlowVersion[] }>(
 `/api/v1/flows/${flowId}/versions`
 );
 if (response.data) {
 setVersions(response.data.data || []);
 }
 } catch (error) {
 console.error('Failed to load versions:', error);
 }
 };

 const handlePublish = async (version: string) => {
 if (!flowId) return;
 setLoading(true);
 try {
 const response = await apiClient.post(
 `/api/v1/flows/${flowId}/versions/${version}/publish`
 );
 if (response.data) {
          await loadVersions();
          toast({ title: 'Success', description: 'Flow published successfully!' });
        } else {
          toast({
            title: 'Error',
            description: response.error?.message || 'Failed to publish',
            variant: 'destructive',
          });
        }
      } catch (error) {
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to publish',
          variant: 'destructive',
        });
 } finally {
 setLoading(false);
 }
 };

 const handleRollback = async (version: string) => {
 if (!flowId) return;
 if (!confirm(`Rollback to version ${version}?`)) return;
 setLoading(true);
 try {
 const response = await apiClient.post(`/api/v1/flows/${flowId}/rollback`, { version });
 if (response.data) {
          await loadVersions();
          toast({ title: 'Success', description: 'Flow rolled back successfully!' });
          onVersionChange?.(version);
        } else {
          toast({
            title: 'Error',
            description: response.error?.message || 'Failed to rollback',
            variant: 'destructive',
          });
        }
      } catch (error) {
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to rollback',
          variant: 'destructive',
        });
 } finally {
 setLoading(false);
 }
 };

  const handleShowDiff = (version: string) => {
    if (!flowId) return;
    // setDiffVersion(version);
    // TODO: Implement diff view
    toast({
      title: 'Info',
      description: `Diff view for version ${version} (to be implemented)`,
    });
  };

 if (!flowId) {
 return null;
 }

 return (
 <div className="border-t bg-card p-4">
 <div className="flex items-center justify-between">
 <div>
 <h3 className="text-sm font-semibold">Versions</h3>
 <div className="mt-2 flex flex-wrap gap-2">
 {versions.map((v) => (
 <div
 key={v.version}
 className="flex items-center gap-2 rounded border bg-background px-3 py-1"
 >
 <span className="text-sm">
 v{v.version}
 {v.published && (
 <span className="ml-2 rounded bg-green-500 px-1 text-xs text-white">
 Published
 </span>
 )}
 </span>
 {!v.published && (
               <Button
                 size="sm"
                 variant="outline"
                 onClick={() => { void handlePublish(v.version); }}
                 disabled={loading}
               >
 <Send className="mr-1 h-3 w-3" />
 Publish
 </Button>
 )}
 {v.published && (
               <Button
                 size="sm"
                 variant="outline"
                 onClick={() => { void handleRollback(v.version); }}
                 disabled={loading}
               >
 <RotateCcw className="mr-1 h-3 w-3" />
 Rollback
 </Button>
 )}
 <Button
 size="sm"
 variant="ghost"
 onClick={() => handleShowDiff(v.version)}
 >
 <GitCompare className="h-3 w-3" />
 </Button>
 </div>
 ))}
 </div>
 </div>
 </div>
 </div>
 );
}


