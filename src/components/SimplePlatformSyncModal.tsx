'use client'

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from 'sonner';
import { Loader2, Link2Icon } from 'lucide-react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle, faSlack } from '@fortawesome/free-brands-svg-icons';

interface PlatformStatus {
  connected: boolean;
  needsAction?: boolean;
  message?: string;
}
interface UserPlatformStatuses {
  google?: PlatformStatus;
  slack?: PlatformStatus;
  [key: string]: PlatformStatus | undefined;
}

const PLATFORM_DEFINITIONS_FOR_SYNC: Array<{
    id: 'google' | 'slack'; 
    name: string; 
    description: string; 
    icon: React.ReactNode;
    authConnectUrl: string; 
}> = [
  { 
    id: 'google', 
    name: 'Google Contacts', 
    description: 'Sync contacts from your Google account.', 
    icon: <FontAwesomeIcon icon={faGoogle} className="h-5 w-5 text-red-500" />,
    authConnectUrl: '/api/auth/google/connect'
  },
  { 
    id: 'slack', 
    name: 'Slack Workspace', 
    description: 'Sync users from your workspace.', 
    icon: <FontAwesomeIcon icon={faSlack} className="h-5 w-5 text-purple-500" />,
    authConnectUrl: '/api/auth/slack'
  },
];

interface SimplePlatformSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncSuccess: () => void; // To refetch contacts on the main page
}

interface PlatformSyncResultDetail {
    status: string;
    message?: string;
    processed?: number;
    merged?: number;
    created?: number;
    flagged?: number;
    error?: string;
}

export function SimplePlatformSyncModal({
  isOpen,
  onClose,
  onSyncSuccess,
}: SimplePlatformSyncModalProps) {
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<'google' | 'slack'>>(new Set());
  const [platformStatuses, setPlatformStatuses] = useState<UserPlatformStatuses>({});
  const [isLoadingStatuses, setIsLoadingStatuses] = useState(true);
  const [isConnectingPlatform, setIsConnectingPlatform] = useState<string | null>(null); // For individual connect button
  const [isSyncing, setIsSyncing] = useState(false); // For the main "Start Sync" button

  const resetState = () => {
    setSelectedPlatforms(new Set());
    // platformStatuses will be refetched on open, no need to clear here explicitly unless desired
    setIsLoadingStatuses(true);
    setIsConnectingPlatform(null);
    setIsSyncing(false);
  };

  const handleModalClose = () => {
    resetState();
    onClose();
  };

  const fetchStatuses = async () => {
    setIsLoadingStatuses(true);
    try {
      const response = await fetch('/api/user/platform-status');
      if (!response.ok) throw new Error('Failed to fetch platform statuses');
      const data = await response.json();
      setPlatformStatuses(data);
    } catch (error) {
      console.error("Error fetching platform statuses:", error);
      toast.error("Could not load platform connection statuses.");
      setPlatformStatuses({
        google: { connected: false, needsAction: true, message: 'Error loading status.'},
        slack: { connected: false, needsAction: true, message: 'Error loading status.'} 
      });
    }
    setIsLoadingStatuses(false);
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatuses();
    } else {
      resetState(); // Ensure state is clean if modal is closed while connecting/syncing
    }
  }, [isOpen]);

  const handleTogglePlatform = (platformId: 'google' | 'slack') => {
    setSelectedPlatforms(prev => {
      const newSet = new Set(prev);
      if (newSet.has(platformId)) newSet.delete(platformId);
      else newSet.add(platformId);
      return newSet;
    });
  };

  const handleConnectPlatform = (platformId: 'google' | 'slack') => {
    const platformDef = PLATFORM_DEFINITIONS_FOR_SYNC.find(p => p.id === platformId);
    if (platformDef?.authConnectUrl) {
      setIsConnectingPlatform(platformId);
      window.location.href = platformDef.authConnectUrl;
      // After redirect and return, user might need to reopen modal, which will refetch statuses.
    } else {
      toast.error("Connection URL not configured.");
    }
  };

  const handleStartSync = async () => {
    if (selectedPlatforms.size === 0) {
      toast.info("Please select at least one platform to sync.");
      return;
    }
    setIsSyncing(true);
    try {
      const response = await fetch('/api/contacts/auto-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: Array.from(selectedPlatforms) })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Sync failed with status ${response.status}`);
      }
      
      let successMessage = result.message || "Sync process completed.";
      if (result.platformResults) {
          const platformSummaries = Object.entries(result.platformResults)
            .map(([key, valUntyped] : [string, unknown]) => {
                const val = valUntyped as PlatformSyncResultDetail;
                if(val.status === 'completed'){
                  return `${key.charAt(0).toUpperCase() + key.slice(1)}: ${val.created || 0} new, ${val.merged || 0} merged, ${val.flagged || 0} for review.`;
                } else if (val.status === 'failed') {
                  return `${key.charAt(0).toUpperCase() + key.slice(1)}: Failed (${val.error || 'Unknown reason'})`;
                }
                return null;
            }).filter(Boolean).join(' \n ');
          if(platformSummaries) successMessage += `\nDetails:\n${platformSummaries}`;
      }
      toast.success(successMessage, {duration: 10000, style: { whiteSpace: 'pre-line'} });
      onSyncSuccess();
      handleModalClose();

    } catch (error: unknown) {
      const e = error as Error;
      console.error("Auto-sync error:", e);
      toast.error(`Sync failed: ${e.message || 'An unknown error occurred.'}`);
    } finally {
      setIsSyncing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleModalClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sync Contacts from Platforms</DialogTitle>
          <DialogDescription>
            Select the platforms you want to sync contacts from. The system will automatically process them.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-3">
          {isLoadingStatuses ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="ml-2">Loading platform statuses...</p>
            </div>
          ) : (
            PLATFORM_DEFINITIONS_FOR_SYNC.map(platform => {
              const status = platformStatuses[platform.id];
              const isEffectivelyConnected = status?.connected && !status?.needsAction;
              
              return (
                <div key={platform.id} className="flex items-center space-x-2 p-2.5 border rounded-md min-h-[60px]">
                  {isEffectivelyConnected ? (
                    <Checkbox 
                      id={`sync-select-${platform.id}`} 
                      checked={selectedPlatforms.has(platform.id)}
                      onCheckedChange={() => handleTogglePlatform(platform.id)}
                      className="mt-0.5"
                    />
                  ) : (
                    <div className="w-[18px] h-[18px] flex-shrink-0" /> 
                  )}
                  <Label 
                    htmlFor={isEffectivelyConnected ? `sync-select-${platform.id}` : undefined}
                    className={`flex-grow min-w-0 p-1 rounded-sm flex items-center gap-2.5 ${isEffectivelyConnected ? 'cursor-pointer hover:bg-accent' : ''}`}
                  >
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">{platform.icon}</div>
                    <div className="flex-grow min-w-0">
                      <div className="font-semibold truncate">{platform.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{platform.description}</div>
                    </div>
                  </Label>
                  <div className="ml-auto flex-shrink-0 flex items-center justify-center w-[110px]">
                    {!isEffectivelyConnected ? (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleConnectPlatform(platform.id)}
                        disabled={isConnectingPlatform === platform.id}
                        className="whitespace-nowrap py-1 px-3 h-auto w-full"
                      >
                        {isConnectingPlatform === platform.id ? 
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : 
                          <Link2Icon className="h-4 w-4 mr-1.5" />}
                        {isConnectingPlatform === platform.id ? 'Connecting...' : 'Connect'}
                      </Button>
                    ) : (
                      <div className="w-[1px] h-full" /> // Takes up button space if connected
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={handleModalClose} disabled={isSyncing || isConnectingPlatform !== null}>
            Cancel
          </Button>
          <Button 
            onClick={handleStartSync} 
            disabled={selectedPlatforms.size === 0 || isLoadingStatuses || isSyncing || isConnectingPlatform !== null}
          >
            {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Start Sync ({selectedPlatforms.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 