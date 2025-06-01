import { google, Auth as GoogleAuth } from 'googleapis'
import { prisma } from '@server/db'
import { Prisma } from '@prisma/client'
import type { User } from '@prisma/client'

export const createOAuth2Client = (user: User): GoogleAuth.OAuth2Client => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )

  oauth2Client.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken,
    expiry_date: user.googleTokenExpiry
      ? new Date(user.googleTokenExpiry).getTime()
      : undefined,
  })

  oauth2Client.on('tokens', async tokens => {
    const update: Prisma.UserUpdateInput = {
      googleAccessToken: tokens.access_token,
      googleTokenExpiry: tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : undefined,
    }
    if (tokens.refresh_token) {
      update.googleRefreshToken = tokens.refresh_token
    }
    await prisma.user.update({ where: { id: user.id }, data: update })
    console.log(`Refreshed Google token for user ${user.id}`)
  })

  return oauth2Client
}

export async function manuallyRefreshGoogleToken(user: User): Promise<User> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )

  oauth2Client.setCredentials({ refresh_token: user.googleRefreshToken })

  try {
    const { credentials } = await oauth2Client.refreshAccessToken()
    const expiryDate = credentials.expiry_date
      ? new Date(credentials.expiry_date)
      : null
    return await prisma.user.update({
      where: { id: user.id },
      data: {
        googleAccessToken: credentials.access_token,
        googleTokenExpiry: expiryDate,
      },
    })
  } catch (error) {
    console.error('Manual token refresh failed:', error)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiry: null,
        googleIntegrations: Prisma.JsonNull,
      },
    })
    throw new Error(
      'Google authentication expired. Please reconnect your Google account.'
    )
  }
}

export function isGoogleTokenExpired(user: User): boolean {
  return (
    !user.googleAccessToken ||
    !user.googleRefreshToken ||
    (user.googleTokenExpiry && new Date(user.googleTokenExpiry) < new Date())
  )
}

export async function ensureValidAccessToken(user: User): Promise<User> {
  if (isGoogleTokenExpired(user)) {
    if (!user.googleRefreshToken) {
      throw new Error('Google not fully authenticated (no refresh token).')
    }
    return manuallyRefreshGoogleToken(user)
  }
  return user
}
