import { PlatformAdapter, PlatformConfig } from './types'

// Platform registry to manage all messaging platform adapters
export class PlatformRegistry {
  private static instance: PlatformRegistry
  private adapters = new Map<string, PlatformAdapter>()

  static getInstance(): PlatformRegistry {
    if (!PlatformRegistry.instance) {
      PlatformRegistry.instance = new PlatformRegistry()
    }
    return PlatformRegistry.instance
  }

  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.config.name, adapter)
  }

  getAdapter(platformName: string): PlatformAdapter | undefined {
    return this.adapters.get(platformName)
  }

  getAllAdapters(): PlatformAdapter[] {
    return Array.from(this.adapters.values())
  }

  getSupportedPlatforms(): PlatformConfig[] {
    return this.getAllAdapters().map(adapter => adapter.config)
  }

  isSupported(platformName: string): boolean {
    return this.adapters.has(platformName)
  }
}

// Convenience function to get the registry
export const getPlatformRegistry = () => PlatformRegistry.getInstance()

// Platform utilities
export function formatPlatformName(platformName: string): string {
  switch (platformName.toLowerCase()) {
    case 'email':
    case 'gmail':
      return 'Email'
    case 'slack':
      return 'Slack'
    case 'whatsapp':
      return 'WhatsApp'
    case 'linkedin':
      return 'LinkedIn'
    default:
      return platformName.charAt(0).toUpperCase() + platformName.slice(1)
  }
}

export function getPlatformIcon(platformName: string): string {
  switch (platformName.toLowerCase()) {
    case 'email':
    case 'gmail':
      return '📧'
    case 'slack':
      return '💬'
    case 'whatsapp':
      return '📱'
    case 'linkedin':
      return '💼'
    default:
      return '💌'
  }
}

export function getPlatformColor(platformName: string): string {
  switch (platformName.toLowerCase()) {
    case 'email':
    case 'gmail':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100'
    case 'slack':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-100'
    case 'whatsapp':
      return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100'
    case 'linkedin':
      return 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100'
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'
  }
} 