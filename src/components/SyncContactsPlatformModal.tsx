'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@components/ui/dialog'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { PlatformContact } from '@/lib/platforms/types'
import { Avatar, AvatarFallback, AvatarImage } from '@components/ui/avatar'
import { ScrollArea } from '@components/ui/scroll-area'
import { Badge } from '@components/ui/badge'
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGoogle, faSlack } from '@fortawesome/free-brands-svg-icons'
import { ArrowRightIcon, Link2Icon, CheckCircle2Icon } from 'lucide-react'

// Helper function to format platform name
const formatPlatformName = (source?: string): string => {
  if (!source) return 'Unknown Platform';
  if (source.toLowerCase().includes('google')) return 'Google';
  if (source.toLowerCase().includes('slack')) return 'Slack';
  // Fallback: Clean up the source string
  return source
    .replace(/_webhook_message|_contact_import|_contacts|_contact/gi, '') // Remove common suffixes/prefixes
    .replace(/_/g, ' ') // Replace underscores with spaces
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim() || 'Platform';
};

// Extend ContactMatchScore if backend can provide this
interface ContactMatchScore {
  contactId: string; 
  fullName?: string; 
  email?: string;    
  avatar?: string; // Assuming find-matches can return avatar for existing contact
  score: number;
  matchReasons: string[];
  existingPlatformSources?: string[]; // e.g., ['google', 'slack']
}

interface ReviewItem {
  platformContact: PlatformContact;
  potentialMatches: ContactMatchScore[];
  isLoadingMatches: boolean;
  // userDecision?: 'merge' | 'new' | 'skip'; // Will be added later
  // mergeTargetId?: string; // Will be added later
}

interface SyncContactsPlatformModalProps {
  isOpen: boolean
  onClose: () => void
  onFetchFromPlatforms: (platforms: Array<'google' | 'slack'>) => Promise<void>
  fetchedContacts: PlatformContact[]
  isLoadingPlatform: 'google' | 'slack' | null
  refetchContactsOnSuccess: () => void | Promise<void>; // New prop to refresh main contact list
}

// Define types for user decisions (will be used in Phase B/C)
export interface UserContactDecision {
  platformContactId: string
  decision: 'merge' | 'new' | 'skip'
  mergeTargetId?: string
  platformContactData: PlatformContact
}

interface PlatformStatus {
  connected: boolean;
  needsAction?: boolean;
  message?: string;
}
interface UserPlatformStatuses {
  google?: PlatformStatus;
  slack?: PlatformStatus;
  [key: string]: PlatformStatus | undefined; // Index signature
}

const PLATFORM_DEFINITIONS: Array<{
    id: 'google' | 'slack'; 
    name: string; 
    description: string; 
    icon: React.ReactNode;
    authType: 'redirect'; // Both will now use redirect for robust token handling
    authConnectUrl: string; // Made non-optional as redirect type always needs it
}> = [
  { 
    id: 'google', 
    name: 'Google Contacts', 
    description: 'Import from your Google account.', 
    icon: <FontAwesomeIcon icon={faGoogle} className="h-5 w-5 text-red-500" />,
    authType: 'redirect',
    authConnectUrl: '/api/auth/google/connect' // Server-side OAuth flow
  },
  { 
    id: 'slack', 
    name: 'Slack Workspace', 
    description: 'Import users from your workspace.', 
    icon: <FontAwesomeIcon icon={faSlack} className="h-5 w-5 text-purple-500" />,
    authType: 'redirect',
    authConnectUrl: '/api/auth/slack'
  },
];

export function SyncContactsPlatformModal({
  isOpen,
  onClose: parentOnClose,
  onFetchFromPlatforms,
  fetchedContacts,
  isLoadingPlatform,
  refetchContactsOnSuccess
}: SyncContactsPlatformModalProps) {
  
  const [newContactsWithoutMatches, setNewContactsWithoutMatches] = useState<ReviewItem[]>([]);
  const [contactsWithPotentialMerges, setContactsWithPotentialMerges] = useState<ReviewItem[]>([]);
  
  const [selectedNewContacts, setSelectedNewContacts] = useState<Set<string>>(new Set());
  const [userDecisions, setUserDecisions] = useState<Record<string, UserContactDecision>>({}) 
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<'google' | 'slack'>>(new Set())
  const [isLoadingAnyMatches, setIsLoadingAnyMatches] = useState(false);
  const [hasAttemptedFetch, setHasAttemptedFetch] = useState(false);
  const [platformStatuses, setPlatformStatuses] = useState<UserPlatformStatuses>({});
  const [isLoadingPlatformStatuses, setIsLoadingPlatformStatuses] = useState(true);
  const [isConnectingPlatform, setIsConnectingPlatform] = useState<string | null>(null);

  const resetModalState = () => {
    setNewContactsWithoutMatches([]);
    setContactsWithPotentialMerges([]);
    setUserDecisions({});
    setSelectedNewContacts(new Set());
    setIsLoadingAnyMatches(false);
    setHasAttemptedFetch(false);
    setSelectedPlatforms(new Set());
    setPlatformStatuses({});
    setIsLoadingPlatformStatuses(true);
    setIsConnectingPlatform(null);
  };

  const handleModalClose = () => {
    resetModalState();
    parentOnClose();
  };

  useEffect(() => {
    if (!isOpen) {
      resetModalState();
    }
  }, [isOpen]);

  const fetchPlatformStatuses = async () => {
    setIsLoadingPlatformStatuses(true);
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
    setIsLoadingPlatformStatuses(false);
  };

  useEffect(() => {
    if (isOpen) {
      fetchPlatformStatuses();
    } else {
      resetModalState(); 
    }
  }, [isOpen]);

  useEffect(() => {
    if (hasAttemptedFetch && fetchedContacts) {
      if (fetchedContacts.length > 0) {
        setIsLoadingAnyMatches(true);
        const itemsToProcess: ReviewItem[] = fetchedContacts.map(pc => ({
          platformContact: pc,
          potentialMatches: [],
          isLoadingMatches: true, 
        }));
        
        setNewContactsWithoutMatches([]);
        setContactsWithPotentialMerges([]);
        setUserDecisions({});
        setSelectedNewContacts(new Set());

        const platformContactsToFindMatchesFor = itemsToProcess.map(item => item.platformContact);

        fetch('/api/contacts/find-matches', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platformContacts: platformContactsToFindMatchesFor }) 
        })
        .then(response => {
          if (!response.ok) {
            // Handle non-2xx responses globally for the batch if needed, or rely on individual error flags
            return response.json().then(errData => {
                throw new Error(errData.error || `Batch find-matches failed with status ${response.status}`);
            });
          }
          return response.json();
        })
        .then(batchData => {
          const batchResults = batchData.results as Array<{ inputId: string; matches: ContactMatchScore[]; error?: string }>;          
          const matchesMap = new Map<string, {matches: ContactMatchScore[], error?: string}>();
          batchResults.forEach(result => {
            matchesMap.set(result.inputId, {matches: result.matches, error: result.error});
          });

          const processedItemsWithMatches = itemsToProcess.map(item => {
            const resultForThisItem = matchesMap.get(item.platformContact.id);
            if (resultForThisItem?.error) {
              console.warn(`Error finding matches for ${item.platformContact.name}: ${resultForThisItem.error}`);
            }
            return {
              ...item,
              potentialMatches: resultForThisItem?.matches || [],
              isLoadingMatches: false // Mark as processed even if error occurred for this item
            };
          });
          
          const noMatchesList: ReviewItem[] = [];
          const withMatchesList: ReviewItem[] = [];
          const loggedInUserName = "Jacques Greeff";

          processedItemsWithMatches.forEach(item => {
            if (item.platformContact.name === loggedInUserName) return;
            // If an error occurred for this specific item during find-matches, treat as no matches found for UI simplicity
            const hasErrorForThisItem = !!matchesMap.get(item.platformContact.id)?.error;

            if (item.potentialMatches.length === 0 || hasErrorForThisItem) {
              noMatchesList.push(item);
            } else {
              withMatchesList.push(item);
            }
          });
          setNewContactsWithoutMatches(noMatchesList.sort((a,b) => a.platformContact.name.localeCompare(b.platformContact.name)));
          setContactsWithPotentialMerges(withMatchesList.sort((a,b) => a.platformContact.name.localeCompare(b.platformContact.name)));
          setIsLoadingAnyMatches(false); 
        })
        .catch(error => {
          console.error("Error during batch find-matches call or processing:", error);
          toast.error("An unexpected error occurred while finding matches.");
          setNewContactsWithoutMatches([]); 
          setContactsWithPotentialMerges([]);
          setIsLoadingAnyMatches(false); 
        });
      } else { 
        setNewContactsWithoutMatches([]);
        setContactsWithPotentialMerges([]);
        setUserDecisions({});
        setSelectedNewContacts(new Set());
        setIsLoadingAnyMatches(false); 
      }
    } else if (!hasAttemptedFetch) {
        if (isLoadingAnyMatches) setIsLoadingAnyMatches(false);
        if (newContactsWithoutMatches.length > 0) setNewContactsWithoutMatches([]);
        if (contactsWithPotentialMerges.length > 0) setContactsWithPotentialMerges([]);
    }
  }, [fetchedContacts, hasAttemptedFetch]);

  const totalFetchedContacts = newContactsWithoutMatches.length + contactsWithPotentialMerges.length;

  const handleToggleSelectNewContact = (contactId: string) => {
    setSelectedNewContacts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(contactId)) newSet.delete(contactId);
      else newSet.add(contactId);
      return newSet;
    });
  };

  const handleImportSelectedNew = () => {
    const newDecisions: Record<string, UserContactDecision> = {};
    newContactsWithoutMatches.forEach(item => {
      if (selectedNewContacts.has(item.platformContact.id)) {
        newDecisions[item.platformContact.id] = {
          platformContactId: item.platformContact.id,
          decision: 'new',
          platformContactData: item.platformContact
        };
      }
    });
    setUserDecisions(prev => ({ ...prev, ...newDecisions }));
    toast.success(`${selectedNewContacts.size} new contacts marked for import.`);
  };
  
  const handleSkipRemainingNew = () => {
    const skipDecisions: Record<string, UserContactDecision> = {};
    let skippedCount = 0;
    newContactsWithoutMatches.forEach(item => {
      if (!userDecisions[item.platformContact.id] && !selectedNewContacts.has(item.platformContact.id)) {
        skipDecisions[item.platformContact.id] = {
          platformContactId: item.platformContact.id,
          decision: 'skip',
          platformContactData: item.platformContact
        };
        skippedCount++;
      }
    });
    setUserDecisions(prev => ({ ...prev, ...skipDecisions }));
    if (skippedCount > 0) toast.info(`${skippedCount} remaining new contacts marked to skip.`);
  };

  const handleTogglePlatform = (platformId: 'google' | 'slack') => {
    setSelectedPlatforms(prev => {
      const newSet = new Set(prev)
      if (newSet.has(platformId)) {
        newSet.delete(platformId)
      } else {
        newSet.add(platformId)
      }
      return newSet
    })
  }

  const handleFetchClicked = async () => {
    if (selectedPlatforms.size === 0) {
      toast.error("Please select at least one platform to sync.")
      return
    }
    setHasAttemptedFetch(true);
    setIsLoadingAnyMatches(true);
    await onFetchFromPlatforms(Array.from(selectedPlatforms))
  }

  const getInitials = (name?: string | null): string => {
    if (!name || typeof name !== 'string') return '?'
    return name.split(' ').filter(Boolean).map(part => part[0]).join('').toUpperCase().substring(0, 2) || '?'
  }

  const handleDecision = (platformContact: PlatformContact, decision: 'merge' | 'new' | 'skip', mergeTargetId?: string) => {
    setUserDecisions(prev => ({
      ...prev,
      [platformContact.id]: {
        platformContactId: platformContact.id,
        decision,
        mergeTargetId: decision === 'merge' ? mergeTargetId : undefined,
        platformContactData: platformContact
      }
    }));
  };

  const handleFinalize = async () => {
    const decisionsToFinalize = Object.values(userDecisions);
    const allReviewableContacts = totalFetchedContacts;

    if (decisionsToFinalize.length !== allReviewableContacts && allReviewableContacts > 0) {
        const undecidedContacts = 
            [...newContactsWithoutMatches, ...contactsWithPotentialMerges]
            .filter(item => !item.isLoadingMatches && !userDecisions[item.platformContact.id])
            .length;
        if (undecidedContacts > 0) {
            toast.error(`Please make a decision for all ${undecidedContacts} remaining contacts.`);
            return;
        }
    }
    if (decisionsToFinalize.length === 0 && allReviewableContacts > 0) {
      toast.info("No decisions have been made yet.");
      return;
    }
    if (decisionsToFinalize.length === 0 && allReviewableContacts === 0 && hasAttemptedFetch) {
      toast.info("No contacts were found or no decisions needed.");
      handleModalClose();
      return;
    }

    setIsFinalizing(true);
    toast.info("Finalizing import...", { id: 'finalize-toast' });
    try {
      const response = await fetch('/api/contacts/finalize-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions: decisionsToFinalize }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        console.error("Finalize import error response:", result);
        const errorMessages = result.errors && result.errors.length > 0 
          ? result.errors.map((e: { platformContactName?: string, error: string }) => 
              `${e.platformContactName || 'A contact'} (${e.error})`
            ).join(', ') 
          : result.error || 'An unknown error occurred during finalization.';
        const fullMessage = result.message ? `${result.message} Details: ${errorMessages}` : `Failed to finalize: ${errorMessages}`;
        toast.error(fullMessage, { 
          id: 'finalize-toast',
          duration: 10000,
          description: response.status === 207 ? `Imported: ${result.imported}, Merged: ${result.merged}, Skipped: ${result.skipped}` : undefined
        });
      } else {
        toast.success(result.message || "Contacts processed successfully!", { 
          id: 'finalize-toast',
          description: `Imported: ${result.imported}, Merged: ${result.merged}, Skipped: ${result.skipped}`
        });
        await refetchContactsOnSuccess();
        handleModalClose();
      }
    } catch (error) {
      console.error("Critical error during finalize import:", error);
      toast.error("Critical error: Failed to finalize import.", { 
        id: 'finalize-toast', 
        description: error instanceof Error ? error.message : 'Please check the console.' 
      });
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleConnectPlatform = async (platformId: 'google' | 'slack') => {
    const platformDef = PLATFORM_DEFINITIONS.find(p => p.id === platformId);
    if (!platformDef || !platformDef.authConnectUrl) { // Check authConnectUrl explicitly
      toast.error("Platform connection information is missing.");
      console.error(`Auth connect URL missing or platform definition not found for: ${platformId}`);
      return;
    }
    
    // For redirect flow, we can set a connecting state, though the page will navigate away.
    // This helps if there's any brief delay before navigation or if we want to disable other actions.
    setIsConnectingPlatform(platformId);
    
    // Simple redirect
    window.location.href = platformDef.authConnectUrl;
    
    // No need to setIsConnectingPlatform(null) here as the page is navigating away.
    // The state will reset when the modal is reopened or re-initialized.
  };

  const renderPlatformIcons = (sources?: string[]) => {
    if (!sources || sources.length === 0) return null;
    return (
      <span className="ml-1 text-xs">
        (Linked: {sources.map(src => {
          const platformDef = PLATFORM_DEFINITIONS.find(p => p.id === src || src.startsWith(p.id));
          if (platformDef && React.isValidElement(platformDef.icon)) {
            return <span key={src} className="inline-block mx-0.5">{React.cloneElement(platformDef.icon as React.ReactElement<{ className?: string }>, { className: 'h-3 w-3 inline-block' })}</span>;
          }
          return null;
        })})
      </span>
    );
  };

  if (!isOpen) return null;
  
  const totalDecided = Object.keys(userDecisions).length;
  const totalReviewable = newContactsWithoutMatches.filter(c => !c.isLoadingMatches).length + 
                        contactsWithPotentialMerges.filter(c => !c.isLoadingMatches).length;

  let currentView = 'platformSelection';
  if (isLoadingAnyMatches) {
    currentView = 'loadingMatches';
  } else if (hasAttemptedFetch && totalFetchedContacts === 0) {
    currentView = 'noContactsFoundAfterFetch';
  } else if (totalFetchedContacts > 0) {
    currentView = 'reviewContacts';
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleModalClose}>
      <DialogContent 
        className={currentView === 'platformSelection' ? "sm:max-w-md" : "sm:max-w-3xl max-h-[90vh] flex flex-col"}
      >
        <DialogHeader>
          <DialogTitle>Sync & Unify Contacts</DialogTitle>
          <DialogDescription>
            {currentView === 'reviewContacts' ? 
              `Step 2: Review ${totalFetchedContacts} contact(s) and choose how to import.` :
              'Step 1: Select platform(s) to fetch new contacts from.'
            }
            {currentView === 'loadingMatches' && 'Fetching contacts and finding matches...'}
            {currentView === 'noContactsFoundAfterFetch' && 'Processing complete.'}
          </DialogDescription>
        </DialogHeader>
        
        {currentView === 'loadingMatches' && (
            <div className="flex items-center justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="ml-2">Finding matches...</p>
            </div>
        )}

        {currentView === 'noContactsFoundAfterFetch' && (
             <div className="py-4 text-center">
                <p className="text-muted-foreground">No new contacts found from the selected platform(s) to review.</p>
            </div>
        )}

        {currentView === 'platformSelection' && (
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground px-1">Select platforms to import contacts from:</p>
            {isLoadingPlatformStatuses ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="ml-2">Loading platform statuses...</p>
              </div>
            ) : (
              PLATFORM_DEFINITIONS.map(platform => {
                const status = platformStatuses[platform.id];
                const isConnected = status?.connected && !status?.needsAction;
                
                return (
                  <div key={platform.id} className="flex items-center space-x-2 p-2 border rounded-md min-h-[56px]">
                    <div className="flex-shrink-0 w-[20px]">
                      {isConnected && (
                        <Checkbox 
                          id={`platform-${platform.id}`} 
                          checked={selectedPlatforms.has(platform.id)}
                          onCheckedChange={() => handleTogglePlatform(platform.id)}
                          className="mt-0.5"
                        />
                      )}
                    </div>
                    <Label 
                      htmlFor={isConnected ? `platform-${platform.id}` : undefined}
                      className={`flex-grow min-w-0 p-1 rounded-sm flex items-center gap-2 ${isConnected ? 'cursor-pointer hover:bg-accent' : ''}`}
                    >
                      <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">{platform.icon}</div>
                      <div className="flex-grow min-w-0">
                        <div className="font-semibold truncate">{platform.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{platform.description}</div>
                      </div>
                    </Label>
                    
                    {/* Container for Connect button / Loader / Placeholder to stabilize width */}
                    <div className="ml-auto flex-shrink-0 flex items-center justify-center w-[110px]"> {/* Increased fixed width */}
                      {!isConnected ? (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => handleConnectPlatform(platform.id)}
                          disabled={isConnectingPlatform === platform.id} // Disable while attempting to redirect
                          className="whitespace-nowrap py-1 px-3 h-auto w-full"
                        >
                          {isConnectingPlatform === platform.id ? 
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : 
                            <Link2Icon className="h-4 w-4 mr-1.5" />}
                          {isConnectingPlatform === platform.id ? 'Redirecting...' : 'Connect'} {/* Updated text */}
                        </Button>
                      ) : isLoadingPlatform === platform.id ? (
                         <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      ) : (
                         null // No placeholder needed if button container has fixed width
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <Button 
              onClick={handleFetchClicked} 
              disabled={selectedPlatforms.size === 0 || isLoadingPlatformStatuses || isLoadingAnyMatches || !!isLoadingPlatform}
              className="w-full mt-4"
            >
              {(isLoadingPlatformStatuses || isLoadingAnyMatches || isLoadingPlatform) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Fetch Contacts from Selected ({selectedPlatforms.size})
            </Button>
          </div>
        )}

        {currentView === 'reviewContacts' && (
          <div className="flex-grow overflow-hidden flex flex-col mt-1 space-y-3 p-1">
            {/* Section 1: New Contacts (No Matches) - Keep compact */}
            {newContactsWithoutMatches.length > 0 && (
              <section className="p-2 border rounded-md bg-slate-50/50">
                <div className="flex justify-between items-center mb-1.5">
                  <h3 className="text-[15px] font-semibold text-slate-700">New Contacts ({newContactsWithoutMatches.length})</h3>
                  <div className="space-x-2">
                    <Button variant="outline" size="sm" onClick={handleImportSelectedNew} disabled={selectedNewContacts.size === 0}>
                        Mark Selected ({selectedNewContacts.size}) to Import
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleSkipRemainingNew}>Mark Remaining to Skip</Button>
                  </div>
                </div>
                <ScrollArea className="max-h-52 pr-1">
                  <div className="space-y-1">
                    {newContactsWithoutMatches.map(item => (
                      <div key={item.platformContact.id} className={`p-1.5 border rounded-md flex items-center gap-2 text-sm ${userDecisions[item.platformContact.id]?.decision === 'new' ? 'bg-green-50/70 border-green-200' : userDecisions[item.platformContact.id]?.decision === 'skip' ? 'bg-red-50/70 border-red-200' : 'bg-white'}`}>
                        <Checkbox id={`select-new-${item.platformContact.id}`}
                          checked={selectedNewContacts.has(item.platformContact.id) || userDecisions[item.platformContact.id]?.decision === 'new'}
                          onCheckedChange={() => handleToggleSelectNewContact(item.platformContact.id)}
                          disabled={!!userDecisions[item.platformContact.id]?.decision}
                          className="mt-0"
                        />
                        <Avatar className="h-7 w-7"><AvatarImage src={item.platformContact.avatar} /><AvatarFallback>{getInitials(item.platformContact.name)}</AvatarFallback></Avatar>
                        <div className="flex-grow min-w-0">
                          <p className="font-medium truncate">{item.platformContact.name}</p>
                          <p className="text-xs text-muted-foreground truncate leading-tight">
                            {item.platformContact.email || item.platformContact.handle}
                            <Badge variant="outline" className="ml-1.5 text-[10px] py-0 px-1">From: {formatPlatformName(String(item.platformContact.platformSpecific?.source || ''))}</Badge>
                          </p>
                        </div>
                        {userDecisions[item.platformContact.id] && ( <Badge variant={userDecisions[item.platformContact.id].decision === 'new' ? 'default' : 'destructive'} className="ml-auto text-xs">{userDecisions[item.platformContact.id].decision.toUpperCase()}</Badge> )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </section>
            )}

            {/* Section 2: Potential Merges & High Confidence Matches - REWORKED */}
            {contactsWithPotentialMerges.length > 0 && (
              <section className="p-2 border rounded-md bg-slate-50/50">
                <h3 className="text-[15px] font-semibold text-slate-700 mb-1.5">
                  Review Suggestions ({contactsWithPotentialMerges.length})
                </h3>
                <ScrollArea className="max-h-[calc(70vh - 220px)] pr-1"> {/* Adjusted max-h */}
                  <div className="space-y-2.5">
                    {contactsWithPotentialMerges.map(item => {
                      const decisionMade = userDecisions[item.platformContact.id];
                      const bestMatch = item.potentialMatches.length > 0 
                        ? item.potentialMatches.reduce((best, current) => (current.score > best.score ? current : best), item.potentialMatches[0])
                        : null; 
                      const isHighConfidenceScenario = bestMatch && bestMatch.score === 100;

                      return (
                        <div key={item.platformContact.id} className={`p-2.5 border rounded-md shadow-sm ${decisionMade ? 'bg-blue-50/60 border-blue-200' : 'bg-white'}`}>
                          {decisionMade ? (
                            <div className="mb-2 p-1.5 bg-blue-100 rounded-md border border-blue-300 text-center">
                                <p className="text-xs text-blue-700 font-medium">
                                    Selected: <span className="font-bold">{decisionMade.decision.toUpperCase()}</span>
                                    {decisionMade.decision === 'merge' && 
                                     ` with ${item.potentialMatches.find(m=>m.contactId === decisionMade.mergeTargetId)?.fullName || 'selected match'}`}
                                </p>
                            </div>
                          ) : (
                            <React.Fragment>
                              <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
                                <Avatar className="h-8 w-8"><AvatarImage src={item.platformContact.avatar} /><AvatarFallback>{getInitials(item.platformContact.name)}</AvatarFallback></Avatar>
                                <div className="flex-grow min-w-0">
                                  <p className="text-sm font-medium truncate">{item.platformContact.name}</p>
                                  <p className="text-xs text-muted-foreground truncate leading-tight">
                                    {item.platformContact.email || item.platformContact.handle}
                                    <Badge variant="outline" className="ml-1.5 text-[10px] py-0 px-1">New from: {formatPlatformName(String(item.platformContact.platformSpecific?.source || ''))}</Badge>
                                  </p>
                                </div>
                              </div>

                              {isHighConfidenceScenario && bestMatch ? (
                                <div className="p-2 bg-green-50/50 rounded-md border border-green-200 space-y-2">
                                  <div className="flex items-center justify-center gap-2 mb-1">
                                     <CheckCircle2Icon className="h-4 w-4 text-green-600 flex-shrink-0"/> 
                                     <p className="text-sm font-medium text-green-700">Strongly Matched with Existing Contact:</p>
                                  </div>
                                  <div className="flex items-center gap-2 text-xs">
                                    <Avatar className="h-7 w-7"><AvatarImage src={bestMatch.avatar} /><AvatarFallback>{getInitials(bestMatch.fullName)}</AvatarFallback></Avatar>
                                    <div className="min-w-0">
                                        <p className="font-medium truncate">{bestMatch.fullName}{renderPlatformIcons(bestMatch.existingPlatformSources)}</p>
                                        {bestMatch.email && <p className="text-slate-600 truncate">{bestMatch.email}</p>}
                                    </div>
                                  </div>
                                  <p className="text-[11px] text-center text-muted-foreground mt-1">Reason: {bestMatch.matchReasons.join(', ')}</p>
                                  <div className="flex justify-around gap-2 mt-2">
                                    <Button className="bg-green-600 hover:bg-green-700 text-white flex-1 px-2 py-1 h-auto text-xs" onClick={() => handleDecision(item.platformContact, 'merge', bestMatch.contactId)}>Confirm & Merge</Button>
                                    <Button variant="outline" className="flex-1 px-2 py-1 h-auto text-xs" onClick={() => handleDecision(item.platformContact, 'new')}>It&apos;s Different, Import New</Button>
                                  </div>
                                   <Button variant="ghost" className="w-full mt-1 text-muted-foreground px-2 py-1 h-auto text-xs" onClick={() => handleDecision(item.platformContact, 'skip')}>Skip This New Contact</Button>
                                </div>
                              ) : (
                                <div className="space-y-1.5">
                                  <p className="text-xs font-semibold text-amber-800 text-center">Potential existing contact(s) to merge with:</p>
                                  {item.potentialMatches.map(match => (
                                    <div key={match.contactId} className="p-1.5 bg-amber-50/40 rounded border border-amber-200">
                                      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-2 items-center">
                                        {/* Left: Existing Contact */}
                                        <div className="text-xs text-right">
                                          <p className="font-medium truncate">{match.fullName} {renderPlatformIcons(match.existingPlatformSources)}</p>
                                          {match.email && <p className="text-slate-600 truncate leading-tight">{match.email}</p>}
                                        </div>
                                        <ArrowRightIcon className="h-4 w-4 text-slate-400 transform rotate-180" /> {/* Points Left */}
                                        {/* Right: New (already shown at top, this column is just for visual balance) */}
                                        <div className="text-xs text-left">
                                          <p className="font-medium truncate">Merge with <span className="text-amber-700">{item.platformContact.name}</span></p>
                                          <p className="text-[11px] text-muted-foreground">({match.matchReasons.join(', ')} - Score: {match.score})</p>
                                        </div>
                                      </div>
                                      <div className="text-center mt-1">
                                        <Button variant="outline" className="px-2.5 py-0.5 h-auto text-xs" onClick={() => handleDecision(item.platformContact, 'merge', match.contactId)}>Merge with {match.fullName}</Button>
                                      </div>
                                    </div>
                                  ))}
                                  <div className="mt-2 pt-2 border-t border-dotted flex flex-wrap gap-2 items-center justify-center">
                                    <Button className="bg-sky-600 hover:bg-sky-700 text-white px-2 py-1 h-auto text-xs" onClick={() => handleDecision(item.platformContact, 'new')}>Import <span className="font-semibold ml-1">{item.platformContact.name}</span> as New</Button>
                                    <Button variant="ghost" className="px-2 py-1 h-auto text-xs" onClick={() => handleDecision(item.platformContact, 'skip')}>Skip <span className="font-semibold ml-1">{item.platformContact.name}</span></Button>
                                  </div>
                                </div>
                              )}
                            </React.Fragment>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </section>
            )}
          </div>
        )}
        
        <DialogFooter className="mt-auto pt-4 justify-end">
          {currentView === 'reviewContacts' && (totalFetchedContacts > 0 || totalDecided > 0) && (
            <Button 
              type="button" 
              onClick={handleFinalize} 
              disabled={isLoadingPlatform !== null || isFinalizing}
            >
              {isFinalizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Finalize Import ({totalDecided}/{totalReviewable} Processed)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 