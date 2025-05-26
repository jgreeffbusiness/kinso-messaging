// Main platform initialization and exports

import { getPlatformRegistry } from './registry'
import { EmailAdapter } from './adapters/email'
import { SlackAdapter } from './adapters/slack'

// Initialize all platform adapters
export function initializePlatforms() {
  const registry = getPlatformRegistry()
  
  // Register email adapter (wraps existing Gmail functionality)
  registry.registerAdapter(new EmailAdapter())
  
  // Register Slack adapter (new platform)
  registry.registerAdapter(new SlackAdapter())
  
  console.log('Initialized platforms:', registry.getSupportedPlatforms().map(p => p.displayName))
}

// Re-export everything from types and registry for convenience
export * from './types'
export * from './registry'
export { EmailAdapter } from './adapters/email'
export { SlackAdapter } from './adapters/slack'

// Auto-initialize when imported
initializePlatforms() 