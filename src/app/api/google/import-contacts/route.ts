import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@/server/db'

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
    
    console.log(`Importing ${contacts.length} contacts for user ${decoded.userId}`)
    
    // Get existing contacts to avoid duplicates
    const existingContacts = await prisma.contact.findMany({
      where: {
        userId: decoded.userId,
        OR: [
          { googleId: { in: contacts.map(c => c.id).filter((id): id is string => !!id) } },
          { email: { in: contacts.map(c => c.email).filter((email): email is string => !!email) } }
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
    
    // Filter out duplicates
    const contactsToCreate = contacts.filter(contact => {
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
        message: "All contacts already exist"
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
      imported: result.length
    })
    
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json(
      { error: 'Failed to import contacts' },
      { status: 500 }
    )
  }
} 