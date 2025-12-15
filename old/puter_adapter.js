/**
 * puter_adapter.js - Puter.com Free LLM API Adapter
 *
 * Provides free access to GPT, Claude, Gemini and 400+ models via Puter.js
 * No API keys required - uses "User-Pays" model
 *
 * See: https://developer.puter.com/tutorials/free-llm-api/
 */

/**
 * Available Puter models (subset of 400+)
 */
export const PUTER_MODELS = {
  'gpt-4o': { provider: 'openai', tier: 'premium' },
  'gpt-4o-mini': { provider: 'openai', tier: 'fast' },
  'claude-3-5-sonnet': { provider: 'anthropic', tier: 'premium' },
  'claude-3-haiku': { provider: 'anthropic', tier: 'fast' },
  'gemini-2.0-flash': { provider: 'google', tier: 'fast' },
  'gemini-1.5-pro': { provider: 'google', tier: 'premium' },
  'llama-3.1-70b': { provider: 'meta', tier: 'standard' },
  'mistral-large': { provider: 'mistral', tier: 'premium' }
};

export const PUTER_FALLBACK_ORDER = [
  'gpt-4o-mini',
  'claude-3-haiku',
  'gemini-2.0-flash',
  'llama-3.1-70b'
];

/**
 * Puter API Adapter - Server-side implementation
 * Note: Puter.js is designed for browser use. For server-side, we use their REST API.
 */
export class PuterAdapter {
  constructor(options = {}) {
    this.model = options.model || PUTER_FALLBACK_ORDER[0];
    this.verbose = options.verbose !== false;
    // Puter's server-side API endpoint
    this.baseUrl = 'https://api.puter.com/ai/chat';

    this.stats = {
      tokensUsed: 0,
      requestCount: 0,
      modelUsed: this.model
    };
  }

  log(message) {
    if (this.verbose) {
      const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
      console.log(`[${timestamp}] Puter: ${message}`);
    }
  }

  getNextFallbackModel() {
    const currentIdx = PUTER_FALLBACK_ORDER.indexOf(this.model);
    if (currentIdx < 0 || currentIdx >= PUTER_FALLBACK_ORDER.length - 1) {
      return null;
    }
    return PUTER_FALLBACK_ORDER[currentIdx + 1];
  }

  /**
   * Generate text using Puter API
   * Note: Puter's free tier has usage limits per user session
   */
  async generate(systemPrompt, userPrompt, options = {}) {
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: options.temperature || 0.3,
      max_tokens: options.maxTokens || 2000
    };

    const maxRetries = options.maxRetries || 3;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        // Handle rate limits - immediately try next model
        if (response.status === 429 || response.status === 503) {
          const nextModel = this.getNextFallbackModel();
          if (nextModel) {
            this.log(`Rate limited on ${this.model}, switching to ${nextModel}`);
            this.model = nextModel;
            body.model = nextModel;
            this.stats.modelUsed = nextModel;
            continue;
          }
          throw new Error(`Puter rate limited on all models`);
        }

        const data = await response.json();

        if (!response.ok) {
          const errorMsg = data.error?.message || response.statusText;
          throw new Error(`Puter API error ${response.status}: ${errorMsg}`);
        }

        // Extract text from response
        const text = data.choices?.[0]?.message?.content || data.content || '';

        // Track usage
        if (data.usage) {
          this.stats.tokensUsed += data.usage.total_tokens || 0;
        }
        this.stats.requestCount++;

        // Try to extract JSON if present
        let jsonText = text.trim();
        if (jsonText.startsWith('```json')) {
          jsonText = jsonText.slice(7);
        }
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.slice(3);
        }
        if (jsonText.endsWith('```')) {
          jsonText = jsonText.slice(0, -3);
        }
        jsonText = jsonText.trim();

        // Try to parse as JSON
        try {
          return JSON.parse(jsonText);
        } catch {
          return text.trim();
        }
      } catch (err) {
        lastError = err;

        const isRetryable = err.message.includes('fetch failed') ||
                           err.message.includes('network') ||
                           err.message.includes('ECONNRESET');

        if (isRetryable && attempt < maxRetries) {
          const retryDelay = 1000 * (attempt + 1);
          this.log(`Retry ${attempt + 1}/${maxRetries} after ${retryDelay / 1000}s...`);
          await this.sleep(retryDelay);
          continue;
        }

        break;
      }
    }

    throw new Error(`Puter API call failed: ${lastError.message}`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats() {
    return { ...this.stats };
  }
}

export default {
  PuterAdapter,
  PUTER_MODELS,
  PUTER_FALLBACK_ORDER
};
