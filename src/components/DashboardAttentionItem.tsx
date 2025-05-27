'use client'

import Link from 'next/link'
import { EnhancedMessage } from '@hooks/useThreadedMessages'
import { Button } from '@components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@components/ui/card'
import { Badge } from '@components/ui/badge'
import { Zap, ArrowRight } from 'lucide-react'

interface DashboardAttentionItemProps {
  item: EnhancedMessage;
}

export function DashboardAttentionItem({ item }: DashboardAttentionItemProps) {
  const analysis = item.platformData?.analysis;
  const contactName = item.contact?.fullName || item.displayName || 'Unknown Contact';
  const platform = item.platform?.replace('_summary', '').replace('_thread', '');

  return (
    <Card className="mb-4 shadow-lg hover:shadow-xl transition-shadow h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-lg">{contactName}</CardTitle>
            <CardDescription className="text-sm">
              Conversation on <span className="capitalize font-medium">{platform}</span>
            </CardDescription>
          </div>
          <Badge variant={analysis?.urgency === 'urgent' || analysis?.urgency === 'high' ? "destructive" : "secondary"}>
            {analysis?.urgency?.toUpperCase() || 'NEEDS REVIEW'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-grow flex flex-col justify-between">
        <div>
          <p className="text-sm text-muted-foreground mb-3 leading-relaxed line-clamp-4">
            {item.platformData?.aiSummary || item.content}
          </p>
          {analysis?.actionItems && analysis.actionItems.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-amber-700 mb-1 uppercase flex items-center">
                <Zap size={14} className="mr-1.5" /> Action Items:
              </h4>
              <ul className="space-y-1 list-disc list-inside pl-1">
                {analysis.actionItems.slice(0, 2).map((action: string, index: number) => (
                  <li key={index} className="text-sm text-amber-900">
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex justify-end mt-4">
          <Link href={`/messages?threadId=${item.id}&contactId=${item.contact?.id}`} passHref>
            <Button variant="outline" size="sm" className="flex items-center">
              View Conversation <ArrowRight size={14} className="ml-2" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default DashboardAttentionItem; 