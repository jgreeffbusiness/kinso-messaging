import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import '@lib/firebase-admin'
import { adminAuth } from '@lib/firebase-admin'
import { prisma } from '@server/db'
import { sign } from 'jsonwebtoken'

// JWT secret should be in env vars
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'
const SESSION_EXPIRY = 60 * 60 * 24 * 7 // 7 days

export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json()
    
    // Verify Firebase token
    const decodedToken = await adminAuth.verifyIdToken(idToken)
    
    // Find or create user in database
    const user = await prisma.user.upsert({
      where: { authId: decodedToken.uid },
      update: {
        email: decodedToken.email,
        name: decodedToken.name || '',
        photoUrl: decodedToken.picture,
        updatedAt: new Date()
      },
      create: {
        authId: decodedToken.uid,
        email: decodedToken.email || '',
        name: decodedToken.name || '',
        photoUrl: decodedToken.picture,
        authProvider: 'firebase',
      }
    })
    
    // Create session token
    const sessionToken = sign(
      { 
        userId: user.id,
        authId: user.authId,
      },
      JWT_SECRET,
      { expiresIn: SESSION_EXPIRY }
    )
    
    // Set HTTP-only cookie
    const cookieStore = await cookies()
    cookieStore.set({
      name: 'session',
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_EXPIRY
    })
    
    // Return user data (excluding sensitive info)
    return NextResponse.json({
      user: {
        id: user.id,
        authId: user.authId,
        email: user.email,
        name: user.name,
        photoUrl: user.photoUrl
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 401 }
    )
  }
} 