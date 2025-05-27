'use client'

import { EnhancedMessage } from '@hooks/useThreadedMessages'
import { Badge } from '@components/ui/badge'
import { Mail, Hash, MessageCircle, ChevronRight } from 'lucide-react'
import { cn } from '@lib/utils'
import { ThreadAnalysis } from '@/lib/thread-processor'

interface UrgentCommunicationItemProps {
  item: EnhancedMessage;
  onSelect: (itemId: string) => void; // Callback when item is selected
  isSelected: boolean;
}

const platformIcons = {
  gmail: Mail,
  email: Mail,
  slack: Hash,
  slack_thread_summary: Hash,
  thread_summary: MessageCircle, // Generic summary
  default: MessageCircle,
};

export function UrgentCommunicationItem({ item, onSelect, isSelected }: UrgentCommunicationItemProps) {
  const analysis: ThreadAnalysis | null | undefined = item.platformData?.analysis;
  const contactName = item.contact?.fullName || item.displayName || 'Unknown Contact';
  
  let platformKey = item.platform?.replace('_summary', '').replace('_thread', '') as keyof typeof platformIcons;
  if (!platformIcons[platformKey]) {
    platformKey = 'default';
  }
  const PlatformIcon = platformIcons[platformKey];

  let shortReason: string;
  if (analysis?.actionItems && analysis.actionItems.length > 0 && analysis.actionItems[0].title) {
    shortReason = analysis.actionItems[0].title;
  } else if (analysis?.summary) {
    shortReason = analysis.summary;
  } else {
    shortReason = item.content || '';
  }
  shortReason = shortReason.length > 70 ? shortReason.substring(0, 67) + '...' : shortReason;

  const urgencyLabel = analysis?.urgency?.toUpperCase();

  return (
    <div
      className={cn(
        "flex items-center justify-between p-3 rounded-lg cursor-pointer border border-transparent hover:bg-muted/80",
        isSelected ? "bg-muted border-primary/50" : "hover:border-muted-foreground/20",
      )}
      onClick={() => onSelect(item.id)}
    >
      <div className="flex items-center gap-3 flex-grow min-w-0">
        <PlatformIcon className={cn("h-5 w-5 flex-shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
        <div className="flex-grow min-w-0">
          <div className="flex items-center">
            <span className={cn("font-medium truncate", isSelected ? "text-primary" : "text-foreground")}>
              {contactName}
            </span>
          </div>
          <p className={cn("text-xs truncate", isSelected ? "text-primary/80" : "text-muted-foreground")}>
            {shortReason}
          </p>
        </div>
      </div>
      <div className="flex items-center flex-shrink-0 ml-3">
        {urgencyLabel && (urgencyLabel === 'URGENT' || urgencyLabel === 'HIGH') && (
            <Badge 
                variant={urgencyLabel === 'URGENT' ? 'destructive' : 'secondary'} 
                className={cn("text-xs px-1.5 py-0.5 h-fit whitespace-nowrap", urgencyLabel === 'URGENT' && "bg-red-600 text-white")}
            >
                {urgencyLabel}
            </Badge>
        )}
        <ChevronRight size={18} className={cn("ml-2", isSelected ? "text-primary" : "text-muted-foreground/70")} />
      </div>
    </div>
  );
}

export default UrgentCommunicationItem; 