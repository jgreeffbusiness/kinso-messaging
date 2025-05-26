import { prisma } from '@/server/db'
import { PlatformContact } from '@/lib/platforms/types'
import { shouldFilterContact, detectBot } from '@/lib/utils/bot-detection'

interface ContactMatchScore {
  contactId: string
  score: number
  matchReasons: string[]
}

interface UnifiedContact {
  id: string
  fullName: string
  email?: string
  platformIdentities: {
    platform: string
    platformContactId: string
    handle?: string
    email?: string
    name?: string
    metadata?: Record<string, unknown>
  }[]
}

export class ContactUnificationService {
  
  /**
   * Main function: Takes a platform contact and finds or creates a unified contact
   * Filters out bots and automated accounts
   */
  async unifyContact(
    platformContact: PlatformContact, 
    platform: string, 
    userId: string
  ): Promise<string> {
    
    // First, check if this is a bot/automated account
    if (shouldFilterContact(platformContact)) {
      const detection = detectBot(platformContact)
      console.log(`Rejecting bot contact from ${platform}:`, platformContact.name, detection.reasons)
      throw new Error(`Contact rejected: ${detection.reasons.join(', ')}`)
    }
    
    // Step 1: Try to find existing matches
    const matches = await this.findContactMatches(platformContact, userId)
    
    if (matches.length > 0) {
      // Use the best match
      const bestMatch = matches[0]
      await this.addPlatformIdentity(bestMatch.contactId, platformContact, platform)
      return bestMatch.contactId
    }
    
    // Step 2: No matches found, create new unified contact
    return await this.createUnifiedContact(platformContact, platform, userId)
  }

  /**
   * Find potential contact matches using multiple strategies
   */
  private async findContactMatches(
    platformContact: PlatformContact, 
    userId: string
  ): Promise<ContactMatchScore[]> {
    
    const matches: ContactMatchScore[] = []
    
    // Strategy 1: Email exact match (highest priority)
    if (platformContact.email) {
      const emailMatches = await prisma.contact.findMany({
        where: {
          userId,
          email: platformContact.email
        }
      })
      
      emailMatches.forEach(contact => {
        matches.push({
          contactId: contact.id,
          score: 100,
          matchReasons: ['email_exact_match']
        })
      })
    }

    // Strategy 2: Name similarity + email domain match
    if (platformContact.email && platformContact.name) {
      const emailDomain = platformContact.email.split('@')[1]
      const nameMatches = await this.findNameSimilarityMatches(
        platformContact.name, 
        emailDomain, 
        userId
      )
      
      nameMatches.forEach(match => {
        matches.push({
          contactId: match.id,
          score: 75,
          matchReasons: ['name_similarity', 'email_domain_match']
        })
      })
    }

    // Strategy 3: Handle/username match
    if (platformContact.handle) {
      const handleMatches = await this.findHandleMatches(platformContact.handle, userId)
      
      handleMatches.forEach(match => {
        matches.push({
          contactId: match.id,
          score: 60,
          matchReasons: ['handle_match']
        })
      })
    }

    // Strategy 4: Name-only fuzzy match (lowest priority)
    if (platformContact.name) {
      const fuzzyMatches = await this.findFuzzyNameMatches(platformContact.name, userId)
      
      fuzzyMatches.forEach(match => {
        matches.push({
          contactId: match.id,
          score: 40,
          matchReasons: ['name_fuzzy_match']
        })
      })
    }

    // Sort by score (highest first) and remove duplicates
    return this.deduplicateAndSort(matches)
  }

  /**
   * Find contacts with similar names and matching email domains
   */
  private async findNameSimilarityMatches(
    name: string, 
    emailDomain: string, 
    userId: string
  ) {
    // Split name into parts for flexible matching
    const nameParts = name.toLowerCase().split(' ').filter(part => part.length > 1)
    
    const contacts = await prisma.contact.findMany({
      where: {
        userId,
        email: {
          contains: emailDomain
        }
      }
    })

    return contacts.filter(contact => {
      const contactNameParts = contact.fullName.toLowerCase().split(' ')
      
      // Check if at least 2 name parts match
      const matchingParts = nameParts.filter(part => 
        contactNameParts.some(contactPart => 
          contactPart.includes(part) || part.includes(contactPart)
        )
      )
      
      return matchingParts.length >= Math.min(2, nameParts.length)
    })
  }

  /**
   * Find contacts with matching handles across platforms
   */
  private async findHandleMatches(handle: string, userId: string) {
    const contacts = await prisma.contact.findMany({
      where: {
        userId,
        OR: [
          { email: { contains: handle } },
          { fullName: { contains: handle, mode: 'insensitive' } }
        ]
      }
    })
    
    return contacts
  }

  /**
   * Fuzzy name matching using simple similarity
   */
  private async findFuzzyNameMatches(name: string, userId: string) {
    const contacts = await prisma.contact.findMany({
      where: { userId }
    })

    return contacts.filter(contact => {
      const similarity = this.calculateNameSimilarity(name, contact.fullName)
      return similarity > 0.7 // 70% similarity threshold
    })
  }

  /**
   * Simple name similarity calculation
   */
  private calculateNameSimilarity(name1: string, name2: string): number {
    const s1 = name1.toLowerCase().trim()
    const s2 = name2.toLowerCase().trim()
    
    if (s1 === s2) return 1.0
    
    // Check if one name contains the other
    if (s1.includes(s2) || s2.includes(s1)) return 0.8
    
    // Simple word overlap calculation
    const words1 = s1.split(' ').filter(w => w.length > 1)
    const words2 = s2.split(' ').filter(w => w.length > 1)
    
    const commonWords = words1.filter(word => 
      words2.some(w => w.includes(word) || word.includes(w))
    )
    
    return commonWords.length / Math.max(words1.length, words2.length)
  }

  /**
   * Remove duplicates and sort by score
   */
  private deduplicateAndSort(matches: ContactMatchScore[]): ContactMatchScore[] {
    const uniqueMatches = new Map<string, ContactMatchScore>()
    
    matches.forEach(match => {
      const existing = uniqueMatches.get(match.contactId)
      if (!existing || match.score > existing.score) {
        uniqueMatches.set(match.contactId, match)
      }
    })
    
    return Array.from(uniqueMatches.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 5) // Top 5 matches only
  }

  /**
   * Create a new unified contact
   */
  private async createUnifiedContact(
    platformContact: PlatformContact,
    platform: string,
    userId: string
  ): Promise<string> {
    
    // Clean platform data - remove undefined values
    const cleanedMetadata = platformContact.platformSpecific 
      ? Object.fromEntries(
          Object.entries(platformContact.platformSpecific).filter(([key, value]) => value !== undefined)
        )
      : {}
    
    const platformData = {
      [platform]: {
        platformContactId: platformContact.id,
        handle: platformContact.handle || null,
        email: platformContact.email || null,
        name: platformContact.name,
        metadata: cleanedMetadata,
        addedAt: new Date().toISOString()
      }
    }
    
    const contact = await prisma.contact.create({
      data: {
        userId,
        fullName: platformContact.name,
        email: platformContact.email,
        photoUrl: platformContact.avatar,
        platformData
      }
    })
    
    console.log(`Created new unified contact ${contact.id} for ${platform} contact ${platformContact.id}`)
    return contact.id
  }

  /**
   * Add platform identity to existing unified contact
   */
  private async addPlatformIdentity(
    contactId: string,
    platformContact: PlatformContact,
    platform: string
  ): Promise<void> {
    
    const contact = await prisma.contact.findUnique({
      where: { id: contactId }
    })
    
    if (!contact) return
    
    const existingPlatformData = (contact.platformData as Record<string, unknown>) || {}
    
    // Clean platform data - remove undefined values
    const cleanedMetadata = platformContact.platformSpecific 
      ? Object.fromEntries(
          Object.entries(platformContact.platformSpecific).filter(([key, value]) => value !== undefined)
        )
      : {}
    
    // Add or update platform identity
    existingPlatformData[platform] = {
      platformContactId: platformContact.id,
      handle: platformContact.handle || null,
      email: platformContact.email || null,
      name: platformContact.name,
      metadata: cleanedMetadata,
      addedAt: new Date().toISOString()
    }
    
    // Update primary contact info if platform has better data
    const updates: Record<string, unknown> = { platformData: existingPlatformData as any }
    
    if (!contact.email && platformContact.email) {
      updates.email = platformContact.email
    }
    
    if (!contact.photoUrl && platformContact.avatar) {
      updates.photoUrl = platformContact.avatar
    }
    
    await prisma.contact.update({
      where: { id: contactId },
      data: updates
    })
    
    console.log(`Added ${platform} identity to unified contact ${contactId}`)
  }

  /**
   * Get unified contact with all platform identities
   */
  async getUnifiedContact(contactId: string): Promise<UnifiedContact | null> {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId }
    })
    
    if (!contact) return null
    
    const platformData = (contact.platformData as Record<string, unknown>) || {}
    const platformIdentities = Object.entries(platformData).map(([platform, data]) => ({
      platform,
      ...(data as Record<string, unknown>)
    }))
    
    return {
      id: contact.id,
      fullName: contact.fullName,
      email: contact.email || undefined,
      platformIdentities: platformIdentities as UnifiedContact['platformIdentities']
    }
  }

  /**
   * Find platform-specific contact ID for a unified contact
   */
  async getPlatformContactId(
    unifiedContactId: string, 
    platform: string
  ): Promise<string | null> {
    
    const contact = await prisma.contact.findUnique({
      where: { id: unifiedContactId }
    })
    
    if (!contact) return null
    
    const platformData = (contact.platformData as Record<string, unknown>) || {}
    const platformInfo = platformData[platform] as { platformContactId?: string } | undefined
    
    return platformInfo?.platformContactId || null
  }
}

// Singleton instance
export const contactUnificationService = new ContactUnificationService() 