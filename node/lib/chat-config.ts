/**
 * Chat engine configuration.
 *
 * Downstream projects customize these values to change the AI personality,
 * model, and behavior. The defaults provide a helpful general-purpose assistant.
 */

export const CHAT_CONFIG = {
  /** Anthropic model ID */
  model: process.env.CHAT_MODEL || "claude-sonnet-4-20250514",

  /** Max tokens per response */
  maxTokens: parseInt(process.env.CHAT_MAX_TOKENS || "1024", 10),

  /** Max recent messages to include in context (older ones get summarized) */
  contextWindowSize: 20,

  /** App name injected into system prompt */
  appName: process.env.APP_NAME || "Coomander",
};

/**
 * System prompt template.
 *
 * Variables:
 *   {{APP_NAME}} — replaced with CHAT_CONFIG.appName
 *   {{CUSTOM_INSTRUCTIONS}} — replaced with getCustomInstructions() result
 *   {{USER_CONTEXT}} — replaced with per-request user context
 */
export const SYSTEM_PROMPT_TEMPLATE = `You are {{APP_NAME}}'s AI assistant.

You are helpful, concise, and friendly. You answer questions directly and suggest next steps when appropriate.

{{CUSTOM_INSTRUCTIONS}}

## Guidelines
- Be concise. Lead with the answer, then explain if needed.
- Use markdown for formatting (bold, lists, code blocks, links).
- If you reference a feature in the app, link to it: [Feature Name](/app/feature)
- If you don't know something, say so honestly.
- Never make up data or statistics.

{{USER_CONTEXT}}`;

/**
 * Override this function in downstream projects to inject custom instructions.
 * Return empty string for no custom instructions.
 */
export function getCustomInstructions(): string {
  return "";
}

/**
 * Build the final system prompt with variables replaced.
 */
export function buildSystemPrompt(userContext: string = ""): string {
  return SYSTEM_PROMPT_TEMPLATE
    .replace("{{APP_NAME}}", CHAT_CONFIG.appName)
    .replace("{{CUSTOM_INSTRUCTIONS}}", getCustomInstructions())
    .replace("{{USER_CONTEXT}}", userContext ? `## User Context\n${userContext}` : "");
}
