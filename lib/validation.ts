import { ALL_PROVIDERS } from './llm'

export function validateProvider(provider?: string): string {
  if (!provider || !ALL_PROVIDERS.includes(provider)) {
    throw new Error(`Invalid provider: ${provider}. Available: ${ALL_PROVIDERS.join(', ')}`)
  }
  return provider
}