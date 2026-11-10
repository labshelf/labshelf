/** The AI credential port: each host keeps the user's provider API keys outside the synced library (in its secret store) and core reads them through this interface. */
export type AiProvider = 'anthropic' | 'openai';

export interface AiCredentialStore { get(provider: AiProvider): Promise<string | undefined>; set(provider: AiProvider, key: string): Promise<void>; delete(provider: AiProvider): Promise<void> }
