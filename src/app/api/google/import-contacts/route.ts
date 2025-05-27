import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@server/db'
import { filterRealContacts } from '@/lib/utils/bot-detection'
import { contactUnificationService } from '@/lib/services/contact-unification-service'
import type { PlatformContact } from '@/lib/platforms/types'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

interface ContactToImport {
  id: string
  name: string
  email?: string
  phone?: string
  photoUrl?: string
}

export async function POST(request: Request) {
  try {
    // Get session cookie
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    // Verify the token
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    
    // Get contacts from request body
    const { contacts } = await request.json() as { contacts: ContactToImport[] }
    
    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return NextResponse.json(
        { error: 'No contacts provided' },
        { status: 400 }
      )
    }
    
    console.log(`Processing ${contacts.length} Google contacts for user ${decoded.userId}`)
    
    // Filter out bots and automated accounts
    const { realContacts, filteredBots } = filterRealContacts(contacts)
    
    // Log filtering results
    if (filteredBots.length > 0) {
      console.log(`Filtered out ${filteredBots.length} bots/automated accounts from Google:`)
      filteredBots.forEach(bot => {
        console.log(`  - ${bot.name} (${bot.email}): ${bot.botDetection.reasons.join(', ')}`)
      })
    }
    
    console.log(`Importing ${realContacts.length} real contacts (filtered ${filteredBots.length} bots)`)
    
    let imported = 0
    let matched = 0
    const errors: string[] = []
    
    // Process each contact through the unification service
    for (const contact of realContacts) {
      try {
        // Convert to PlatformContact format
        const platformContact: PlatformContact = {
          id: contact.id,
          name: contact.name || 'Unnamed Contact',
          email: contact.email || undefined,
          avatar: contact.photoUrl || undefined,
          handle: undefined, // Google contacts don't typically have handles
          platformSpecific: {
            phone: contact.phone,
            googleId: contact.id
          }
        }
        
        // Use contact unification service to find or create unified contact
        const unifiedContactId = await contactUnificationService.unifyContact(
          platformContact,
          'google',
          decoded.userId
        )
        
        // Check if this was a new contact or matched existing
        const existingContact = await prisma.contact.findUnique({
          where: { id: unifiedContactId }
        })
        
        if (existingContact) {
          const platformData = (existingContact.platformData as Record<string, unknown>) || {}
          if (platformData.google) {
            matched++
            console.log(`Matched existing contact: ${contact.name} (${contact.email})`)
          } else {
            imported++
            console.log(`Added Google identity to existing contact: ${contact.name} (${contact.email})`)
          }
        }
        
      } catch (error) {
        const errorMsg = `Failed to process contact ${contact.name}: ${error}`
        errors.push(errorMsg)
        console.error(errorMsg)
        // Continue with next contact instead of failing the whole import
      }
    }
    
    console.log(`Import completed: ${imported} new, ${matched} matched, ${errors.length} errors`)
    
    return NextResponse.json({
      success: true,
      imported,
      matched,
      filtered: filteredBots.length,
      errors: errors.length,
      message: errors.length > 0 
        ? `Imported ${imported} contacts, matched ${matched} existing (${errors.length} errors, ${filteredBots.length} filtered)`
        : `Imported ${imported} contacts, matched ${matched} existing (${filteredBots.length} filtered)`
    })
    
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json(
      { error: 'Failed to import contacts' },
      { status: 500 }
    )
  }
} 