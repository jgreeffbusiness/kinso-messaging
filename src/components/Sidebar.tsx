'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@lib/utils'
import { Button } from '@components/ui/button'
import { ScrollArea } from '@components/ui/scroll-area'
import { Sheet, SheetContent, SheetTrigger } from '@components/ui/sheet'
import { useAuthStore } from '@store/useAuthStore'

// Icons
import { 
  Menu, 
  Home, 
  MessageSquare, 
  Users, 
  Settings, 
  ChevronLeft,
  ChevronRight
} from 'lucide-react'

interface SidebarProps {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const logout = useAuthStore(state => state.logout)
  
  // Handle mobile detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
      if (window.innerWidth < 768) {
        setCollapsed(true)
      }
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])
  
  const navItems = [
    {
      title: 'Dashboard',
      href: '/dashboard',
      icon: Home
    },
    {
      title: 'Messages',
      href: '/messages',
      icon: MessageSquare
    },
    {
      title: 'Contacts',
      href: '/contacts',
      icon: Users
    },
    {
      title: 'Settings',
      href: '/settings',
      icon: Settings
    },
  ]
  
  const toggleCollapse = () => {
    setCollapsed(!collapsed)
  }

  const SidebarContent = (
    <div className={cn(
      "flex h-full flex-col",
      collapsed ? "items-center" : "items-start"
    )}>
      <div className={cn(
        "flex h-14 items-center px-4 py-2",
        collapsed ? "justify-center w-full" : "justify-between w-full"
      )}>
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="font-bold text-xl">App</span>
          </Link>
        )}
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={toggleCollapse}
          className={cn(
            "h-8 w-8",
            collapsed && "rotate-180"
          )}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </Button>
      </div>
      
      <ScrollArea className="flex-1 w-full">
        <nav className="flex flex-col gap-1 px-2 py-4">
          {navItems.map((item) => (
            <Link 
              key={item.href} 
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                pathname === item.href 
                  ? "bg-primary text-primary-foreground" 
                  : "hover:bg-muted",
                collapsed && "justify-center"
              )}
            >
              <item.icon size={20} />
              {!collapsed && <span>{item.title}</span>}
            </Link>
          ))}
        </nav>
      </ScrollArea>
    </div>
  )
  
  // Mobile sidebar with sheet
  if (isMobile) {
    return (
      <>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0">
            {SidebarContent}
          </SheetContent>
        </Sheet>
      </>
    )
  }
  
  // Desktop sidebar
  return (
    <div className={cn(
      "flex flex-col h-full border-r bg-background transition-all duration-300",
      collapsed ? "w-[70px]" : "w-[240px]",
      className
    )}>
      {SidebarContent}
    </div>
  )
} 