'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { 
  Filter,
  Zap,
  Calendar,
  CheckCircle,
  Clock,
  Mail,
  MessageSquare,
  Phone,
  Users,
  Briefcase,
  Heart,
  Bell,
  Archive,
  ChevronDown,
  X
} from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from '@lib/utils'

interface SmartFilter {
  id: string
  name: string
  icon: React.ReactNode
  count: number
  color: string
  description: string
  aiPowered?: boolean
}

interface FilterCategory {
  name: string
  filters: SmartFilter[]
}

interface SmartFilterSystemProps {
  activeFilters: string[]
  onFiltersChange: (filters: string[]) => void
  messageCounts: {
    total: number
    unread: number
    needsAttention: number
    scheduled: number
    processed: number
    byPlatform: {
      gmail: number
      slack: number
      whatsapp: number
    }
    byCategory: {
      meeting: number
      commercial: number
      personal: number
      administrative: number
      notification: number
    }
  }
}

export default function SmartFilterSystem({ 
  activeFilters, 
  onFiltersChange, 
  messageCounts 
}: SmartFilterSystemProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['AI-Powered', 'Status'])

  const toggleFilter = (filterId: string) => {
    if (activeFilters.includes(filterId)) {
      onFiltersChange(activeFilters.filter(id => id !== filterId))
    } else {
      onFiltersChange([...activeFilters, filterId])
    }
  }

  const clearAllFilters = () => {
    onFiltersChange([])
  }

  const toggleCategory = (categoryName: string) => {
    if (expandedCategories.includes(categoryName)) {
      setExpandedCategories(expandedCategories.filter(name => name !== categoryName))
    } else {
      setExpandedCategories([...expandedCategories, categoryName])
    }
  }

  const filterCategories: FilterCategory[] = [
    {
      name: 'AI-Powered',
      filters: [
        {
          id: 'needs_attention',
          name: 'Needs Attention',
          icon: <Zap className="h-4 w-4" />,
          count: messageCounts.needsAttention,
          color: 'bg-orange-100 text-orange-700 border-orange-200',
          description: 'Messages requiring immediate action',
          aiPowered: true
        },
        {
          id: 'scheduled',
          name: 'Scheduled',
          icon: <Calendar className="h-4 w-4" />,
          count: messageCounts.scheduled,
          color: 'bg-blue-100 text-blue-700 border-blue-200',
          description: 'Meetings and events detected',
          aiPowered: true
        },
        {
          id: 'ai_processed',
          name: 'AI Processed',
          icon: <CheckCircle className="h-4 w-4" />,
          count: messageCounts.processed,
          color: 'bg-green-100 text-green-700 border-green-200',
          description: 'Analyzed and summarized',
          aiPowered: true
        }
      ]
    },
    {
      name: 'Status',
      filters: [
        {
          id: 'unread',
          name: 'Unread',
          icon: <Mail className="h-4 w-4" />,
          count: messageCounts.unread,
          color: 'bg-blue-100 text-blue-700 border-blue-200',
          description: 'Messages you haven\'t read yet'
        },
        {
          id: 'processing',
          name: 'Processing',
          icon: <Clock className="h-4 w-4 animate-spin" />,
          count: Math.max(0, messageCounts.total - messageCounts.processed),
          color: 'bg-gray-100 text-gray-700 border-gray-200',
          description: 'AI is analyzing these messages'
        }
      ]
    },
    {
      name: 'Platforms',
      filters: [
        {
          id: 'gmail',
          name: 'Gmail',
          icon: <Mail className="h-4 w-4" />,
          count: messageCounts.byPlatform.gmail,
          color: 'bg-red-100 text-red-700 border-red-200',
          description: 'Email messages'
        },
        {
          id: 'slack',
          name: 'Slack',
          icon: <MessageSquare className="h-4 w-4" />,
          count: messageCounts.byPlatform.slack,
          color: 'bg-purple-100 text-purple-700 border-purple-200',
          description: 'Slack messages'
        },
        {
          id: 'whatsapp',
          name: 'WhatsApp',
          icon: <Phone className="h-4 w-4" />,
          count: messageCounts.byPlatform.whatsapp,
          color: 'bg-green-100 text-green-700 border-green-200',
          description: 'WhatsApp messages'
        }
      ]
    },
    {
      name: 'Categories',
      filters: [
        {
          id: 'meeting',
          name: 'Meetings',
          icon: <Users className="h-4 w-4" />,
          count: messageCounts.byCategory.meeting,
          color: 'bg-blue-100 text-blue-700 border-blue-200',
          description: 'Meeting invitations and discussions',
          aiPowered: true
        },
        {
          id: 'commercial',
          name: 'Business',
          icon: <Briefcase className="h-4 w-4" />,
          count: messageCounts.byCategory.commercial,
          color: 'bg-indigo-100 text-indigo-700 border-indigo-200',
          description: 'Business and commercial communications',
          aiPowered: true
        },
        {
          id: 'personal',
          name: 'Personal',
          icon: <Heart className="h-4 w-4" />,
          count: messageCounts.byCategory.personal,
          color: 'bg-pink-100 text-pink-700 border-pink-200',
          description: 'Personal messages and communications',
          aiPowered: true
        },
        {
          id: 'administrative',
          name: 'Admin',
          icon: <Archive className="h-4 w-4" />,
          count: messageCounts.byCategory.administrative,
          color: 'bg-gray-100 text-gray-700 border-gray-200',
          description: 'Administrative and system messages',
          aiPowered: true
        },
        {
          id: 'notification',
          name: 'Notifications',
          icon: <Bell className="h-4 w-4" />,
          count: messageCounts.byCategory.notification,
          color: 'bg-yellow-100 text-yellow-700 border-yellow-200',
          description: 'Notifications and alerts',
          aiPowered: true
        }
      ]
    }
  ]

  const activeFilterCount = activeFilters.length

  return (
    <div className="flex items-center gap-2">
      {/* Active Filter Chips */}
      {activeFilters.map(filterId => {
        const filter = filterCategories
          .flatMap(cat => cat.filters)
          .find(f => f.id === filterId)
        
        if (!filter) return null

        return (
          <Badge 
            key={filterId}
            variant="secondary" 
            className={cn("flex items-center gap-1 px-2 py-1", filter.color)}
          >
            {filter.icon}
            <span className="text-xs">{filter.name}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-3 w-3 p-0 ml-1 hover:bg-black/10"
              onClick={(e) => {
                e.stopPropagation()
                toggleFilter(filterId)
              }}
            >
              <X className="h-2 w-2" />
            </Button>
          </Badge>
        )
      })}

      {/* Clear All Button */}
      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAllFilters}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Clear all
        </Button>
      )}

      {/* Main Filter Button */}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            size="sm"
            className={cn(
              "flex items-center gap-1",
              activeFilterCount > 0 && "bg-blue-50 border-blue-200 text-blue-700"
            )}
          >
            <Filter className="h-4 w-4" />
            Filter
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 text-xs">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        
        <PopoverContent className="w-80 p-0" align="start">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">Smart Filters</h3>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  className="text-xs"
                >
                  Clear all
                </Button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              AI-powered categorization and filtering
            </p>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {filterCategories.map(category => (
              <div key={category.name} className="border-b last:border-b-0">
                <Button
                  variant="ghost"
                  className="w-full justify-between p-3 h-auto rounded-none"
                  onClick={() => toggleCategory(category.name)}
                >
                  <span className="font-medium text-sm">{category.name}</span>
                  <ChevronDown 
                    className={cn(
                      "h-4 w-4 transition-transform",
                      expandedCategories.includes(category.name) && "rotate-180"
                    )} 
                  />
                </Button>
                
                {expandedCategories.includes(category.name) && (
                  <div className="p-2 space-y-1 bg-gray-50">
                    {category.filters.map(filter => (
                      <div
                        key={filter.id}
                        className={cn(
                          "flex items-center gap-3 p-2 rounded cursor-pointer transition-colors",
                          "hover:bg-white",
                          activeFilters.includes(filter.id) && "bg-white ring-1 ring-blue-200"
                        )}
                        onClick={() => toggleFilter(filter.id)}
                      >
                        <div className={cn("flex items-center gap-2 flex-1 min-w-0")}>
                          <div className={cn("p-1 rounded", filter.color)}>
                            {filter.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{filter.name}</span>
                              {filter.aiPowered && (
                                <Badge variant="outline" className="text-xs bg-purple-50 text-purple-600 border-purple-200">
                                  AI
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate">
                              {filter.description}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {filter.count}
                          </Badge>
                          <Switch 
                            checked={activeFilters.includes(filter.id)}
                            onCheckedChange={() => toggleFilter(filter.id)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Quick Actions */}
          <div className="p-3 border-t bg-gray-50">
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="flex-1 text-xs"
                onClick={() => onFiltersChange(['needs_attention'])}
              >
                🔥 Urgent Only
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="flex-1 text-xs"
                onClick={() => onFiltersChange(['unread'])}
              >
                📭 Unread Only  
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
} 