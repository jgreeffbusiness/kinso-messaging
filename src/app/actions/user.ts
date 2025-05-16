'use server'

import { prisma } from '@/server/db'

type UserData = {
  authId: string
  authProvider?: string
  email: string
  name: string
  photoUrl?: string
  googleAccessToken?: string
  googleTokenExpiry?: Date
}

export async function createOrUpdateUser(userData: UserData) {
  return prisma.user.upsert({
    where: { authId: userData.authId },
    update: {
      email: userData.email,
      name: userData.name,
      photoUrl: userData.photoUrl,
      authProvider: userData.authProvider,
      googleAccessToken: userData.googleAccessToken,
      googleTokenExpiry: userData.googleTokenExpiry,
      updatedAt: new Date(),
    },
    create: {
      authId: userData.authId,
      authProvider: userData.authProvider,
      email: userData.email,
      name: userData.name,
      photoUrl: userData.photoUrl,
      googleAccessToken: userData.googleAccessToken,
      googleTokenExpiry: userData.googleTokenExpiry,
    },
  })
} 