import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@server/db'

// JWT secret should be in env vars
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'
const GOOGLE_PEOPLE_API = 'https://people.googleapis.com/v1/people/me/connections'
const GOOGLE_GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export async function POST(request: Request) {
  try {
    // Get session cookie
    const cookieStore = cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (!sessionCookie) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    // Verify the token
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string }
    
    // Fetch user data
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    })
    
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }
    
    // Check if token exists and is valid
    if (!user.googleAccessToken || 
        (user.googleTokenExpiry && new Date(user.googleTokenExpiry) < new Date())) {
      return NextResponse.json(
        { error: 'Google authorization required' },
        { status: 401 }
      )
    }
    
    // Get sync options from request
    const { syncContacts, syncEmails } = await request.json()
    
    // Check if integrations are enabled
    const integrations = user.googleIntegrations as any || {}
    
    let contactsAdded = 0
    let emailsAssociated = 0
    
    // Sync contacts if enabled
    if (syncContacts && integrations.contacts) {
      const contactsResult = await syncUserContacts(user.googleAccessToken, user.id)
      contactsAdded = contactsResult.added
    }
    
    // Sync emails if enabled
    if (syncEmails && integrations.gmail && contactsAdded > 0) {
      const emailsResult = await syncContactEmails(user.googleAccessToken, user.id)
      emailsAssociated = emailsResult.associated
    }
    
    return NextResponse.json({
      success: true,
      contactsAdded,
      emailsAssociated
    })
    
  } catch (error) {
    console.error('Sync error:', error)
    return NextResponse.json(
      { error: 'Failed to sync' },
      { status: 500 }
    )
  }
}

async function syncUserContacts(accessToken: string, userId: string) {
  // Fetch contacts from Google
  const response = await fetch(
    `${GOOGLE_PEOPLE_API}?personFields=names,emailAddresses,phoneNumbers,photos&pageSize=100`, 
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  )
  
  if (!response.ok) {
    throw new Error(`Failed to fetch contacts: ${response.status}`)
  }
  
  const data = await response.json()
  
  if (!data.connections || data.connections.length === 0) {
    return { added: 0 }
  }
  
  // Get existing contacts to avoid duplicates
  const existingContacts = await prisma.contact.findMany({
    where: { userId },
    select: { googleId: true, email: true }
  })
  
  const existingGoogleIds = new Set(
    existingContacts.map(contact => contact.googleId).filter(Boolean)
  )
  
  // Process contacts
  const contactsToCreate = []
  
  for (const contact of data.connections) {
    const googleId = contact.resourceName
    
    // Skip if already exists
    if (existingGoogleIds.has(googleId)) {
      continue
    }
    
    const name = contact.names?.[0]?.displayName || 'Unknown'
    const email = contact.emailAddresses?.[0]?.value
    const phone = contact.phoneNumbers?.[0]?.value
    const photoUrl = contact.photos?.[0]?.url
    
    // Must have at least a name
    if (name) {
      contactsToCreate.push({
        userId,
        googleId,
        name,
        email,
        phone,
        photoUrl,
        source: 'google'
      })
    }
  }
  
  // Bulk create contacts
  if (contactsToCreate.length > 0) {
    await prisma.contact.createMany({
      data: contactsToCreate,
      skipDuplicates: true,
    })
  }
  
  return { added: contactsToCreate.length }
}

async function syncContactEmails(accessToken: string, userId: string) {
  // Get all contacts with email addresses
  const contacts = await prisma.contact.findMany({
    where: { 
      userId,
      email: { not: null }
    },
    select: {
      id: true,
      email: true
    }
  })
  
  // Create email-to-contact mapping
  const emailToContactMap = new Map()
  for (const contact of contacts) {
    if (contact.email) {
      emailToContactMap.set(contact.email, contact.id)
    }
  }
  
  let totalEmailsProcessed = 0
  
  // For each contact with email, fetch their emails
  for (const [email, contactId] of emailToContactMap.entries()) {
    // Search for emails from/to this contact
    const searchQuery = encodeURIComponent(`from:${email} OR to:${email}`)
    const response = await fetch(
      `${GOOGLE_GMAIL_API}/messages?q=${searchQuery}&maxResults=50`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    )
    
    if (!response.ok) {
      console.error(`Failed to fetch emails for ${email}: ${response.status}`)
      continue
    }
    
    const data = await response.json()
    
    if (!data.messages || data.messages.length === 0) {
      continue
    }
    
    // Save email references to database
    const emailEntries = data.messages.map((message: any) => ({
      contactId,
      userId,
      messageId: message.id,
      threadId: message.threadId,
    }))
    
    // Save emails to database
    await prisma.contactEmail.createMany({
      data: emailEntries,
      skipDuplicates: true,
    })
    
    totalEmailsProcessed += emailEntries.length
  }
  
  return { associated: totalEmailsProcessed }
} 