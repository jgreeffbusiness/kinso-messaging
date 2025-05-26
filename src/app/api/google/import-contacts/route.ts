import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@server/db'
import { filterRealContacts } from '@/lib/utils/bot-detection'

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
    
    // Get existing contacts to avoid duplicates
    const existingContacts = await prisma.contact.findMany({
      where: {
        userId: decoded.userId,
        OR: [
          { googleId: { in: realContacts.map(c => c.id).filter((id): id is string => !!id) } },
          { email: { in: realContacts.map(c => c.email).filter((email): email is string => !!email) } }
        ]
      },
      select: { googleId: true, email: true }
    })
    
    const existingGoogleIds = new Set(
      existingContacts
        .map(contact => contact.googleId)
        .filter(Boolean)
    )
    
    const existingEmails = new Set(
      existingContacts
        .map(contact => contact.email)
        .filter(Boolean)
    )
    
    // Filter out duplicates from real contacts
    const contactsToCreate = realContacts.filter(contact => {
      // Skip if we already have this Google ID
      if (contact.id && existingGoogleIds.has(contact.id)) return false
      
      // Skip if we already have this email
      if (contact.email && existingEmails.has(contact.email)) return false
      
      return true
    })
    
    console.log(`After filtering duplicates, importing ${contactsToCreate.length} contacts`)
    
    if (contactsToCreate.length === 0) {
      return NextResponse.json({
        success: true,
        imported: 0,
        filtered: filteredBots.length,
        message: filteredBots.length > 0 
          ? `All contacts were duplicates or bots (${filteredBots.length} filtered)`
          : "All contacts already exist"
      })
    }
    
    // Create contacts in database
    const result = await prisma.$transaction(async (prisma) => {
      const createdContacts = []
      
      // Create one by one to handle errors better
      for (const contact of contactsToCreate) {
        try {
          const created = await prisma.contact.create({
            data: {
              userId: decoded.userId,
              googleId: contact.id,
              fullName: contact.name || 'Unnamed Contact',
              email: contact.email,
              phone: contact.phone,
              photoUrl: contact.photoUrl,
              source: 'google'
            }
          })
          
          createdContacts.push(created)
        } catch (err) {
          console.error(`Failed to create contact ${contact.name}:`, err)
          // Continue with next contact
        }
      }
      
      return createdContacts
    })
    
    return NextResponse.json({
      success: true,
      imported: result.length,
      filtered: filteredBots.length,
      message: filteredBots.length > 0 
        ? `Imported ${result.length} contacts (filtered ${filteredBots.length} bots/automated accounts)`
        : `Imported ${result.length} contacts`
    })
    
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json(
      { error: 'Failed to import contacts' },
      { status: 500 }
    )
  }
} 