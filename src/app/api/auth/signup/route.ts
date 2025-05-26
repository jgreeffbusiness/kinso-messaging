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
    const { idToken, name, email } = await request.json()
    
    if (!idToken) {
      return NextResponse.json(
        { error: 'ID token is required' },
        { status: 400 }
      )
    }
    
    // Verify Firebase token
    let decodedToken
    try {
      decodedToken = await adminAuth.verifyIdToken(idToken)
    } catch (tokenError) {
      console.error('Firebase token verification failed:', tokenError)
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    
    // Extract user information from Firebase token
    const {
      uid: authId,
      email: tokenEmail,
      picture: photoUrl
    } = decodedToken
    
    // Use provided data or fallback to token data
    const userData = {
      authId,
      email: email || tokenEmail || '',
      name: name || decodedToken.name || '',
      photoUrl
    }
    
    console.log(`🔐 Signup request for user: ${userData.email} (${authId})`)
    
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { authId }
    })
    
    if (existingUser) {
      return NextResponse.json(
        { error: 'User already exists. Please sign in instead.' },
        { status: 409 }
      )
    }
    
    // Create new user in database
    const user = await prisma.user.create({
      data: {
        authId: userData.authId,
        email: userData.email,
        name: userData.name,
        photoUrl: userData.photoUrl,
        authProvider: 'firebase',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })
    
    console.log(`✨ New user created: ${user.email} (${user.id})`)
    
    // Create session token
    const sessionToken = sign(
      { 
        userId: user.id,
        authId: user.authId,
        email: user.email,
        iat: Math.floor(Date.now() / 1000)
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
      success: true,
      user: {
        id: user.id,
        authId: user.authId,
        email: user.email,
        name: user.name,
        photoUrl: user.photoUrl,
        isNewUser: true,
        hasGoogleIntegration: false,
        hasSlackIntegration: false
      },
      message: 'Account created successfully'
    })
  } catch (error) {
    console.error('❌ Signup error:', error)
    return NextResponse.json(
      { 
        error: 'Account creation failed',
        details: process.env.NODE_ENV === 'development' ? error instanceof Error ? error.message : String(error) : undefined
      },
      { status: 500 }
    )
  }
} 