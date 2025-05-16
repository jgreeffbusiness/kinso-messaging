// src/server/trpc/context.ts
import { prisma } from '@/server/db'
import { cookies } from 'next/headers'
import { verify } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export async function createContext() {
  let user = null;
  
  // Get JWT session token from cookies
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('session')?.value

  if (sessionToken) {
    try {
      // Verify our JWT session token, not Firebase token
      const decoded = verify(sessionToken, JWT_SECRET) as { userId: string, authId: string }
      
      // Fetch user from database
      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.userId }
      })
      
      if (dbUser) {
        user = {
          id: dbUser.id,
          authId: dbUser.authId,
          email: dbUser.email
        }
      }
    } catch (err) {
      console.error('Invalid session token', err)
    }
  }

  return {
    prisma,
    user,
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>
