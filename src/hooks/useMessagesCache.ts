import { trpc } from '@utils/trpc'

/**
 * Hook for managing messages cache intelligently
 * Provides utilities for invalidating cache when new messages arrive
 */
export function useMessagesCache() {
  const utils = trpc.useUtils()

  /**
   * Invalidate messages cache when new messages arrive (via webhooks)
   * This will cause a refetch only if the data is being actively viewed
   */
  const invalidateMessages = async () => {
    await utils.message.getAll.invalidate()
  }

  /**
   * Invalidate specific query without forcing immediate refetch
   * Useful for when webhooks indicate new data is available
   */
  const markAsStale = () => {
    utils.message.getAll.invalidate()
  }

  return {
    invalidateMessages,
    markAsStale
  }
} 