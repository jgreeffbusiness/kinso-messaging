import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'
import { prisma } from '@server/db'

// JWT secret should be in env vars
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'
const GOOGLE_PEOPLE_API = 'https://people.googleapis.com/v1/people/me/connections'

export async function GET(request: Request) {
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
    
    // Check if contacts integration is enabled
    const integrations = user.googleIntegrations as any
    if (!integrations?.contacts) {
      return NextResponse.json(
        { error: 'Contacts integration not enabled' },
        { status: 400 }
      )
    }
    
    // Fetch contacts from Google
    const response = await fetch(
      `${GOOGLE_PEOPLE_API}?personFields=names,emailAddresses,phoneNumbers,photos&pageSize=100`, 
      {
        headers: {
          Authorization: `Bearer ${user.googleAccessToken}`
        }
      }
    )
    
    if (!response.ok) {
      console.error('Google API error:', await response.text())
      return NextResponse.json(
        { error: 'Failed to fetch contacts from Google' },
        { status: 500 }
      )
    }
    
    const data = await response.json()
    
    // Transform the contacts
    const contacts = data.connections?.map((contact: any) => ({
      id: contact.resourceName,
      name: contact.names?.[0]?.displayName || 'Unknown',
      email: contact.emailAddresses?.[0]?.value,
      phone: contact.phoneNumbers?.[0]?.value,
      photoUrl: contact.photos?.[0]?.url
    })) || []
    
    return NextResponse.json({ contacts })
  } catch (error) {
    console.error('Contact fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch contacts' },
      { status: 500 }
    )
  }
} 