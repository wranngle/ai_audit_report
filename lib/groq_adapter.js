/**
 * groq_adapter.js - Groq API Adapter for LLM Execution
 *
 * Provides fast inference using Groq's API with Llama and Mixtral models.
 * Used as fallback when Gemini API quotas are exhausted.
 */

/**
 * Groq model configuration
 * Free tier: 30 RPM, 14400 RPD per model
 */
export const GROQ_MODELS = {
  'llama-3.3-70b-versatile': {
    rpm: 30,
    rpd: 14400,
    context: 128000,
    tier: 'premium'
  },
  'llama-3.1-8b-instant': {
    rpm: 30,
    rpd: 14400,
    context: 128000,
    tier: 'fast'
  },
  // Decommissioned models (Aug-Dec 2025):
  // - llama3-70b-8192 → use llama-3.3-70b-versatile
  // - llama3-8b-8192 → use llama-3.1-8b-instant
  // - gemma2-9b-it → use llama-3.1-8b-instant
  // - mixtral-8x7b-32768 → decommissioned
  // - mistral-saba-24b → decommissioned
  'llama-3.2-1b-preview': {
    rpm: 30,
    rpd: 14400,
    context: 8192,
    tier: 'lite'
  }
};

/**
 * Groq model fallback order - updated 2025-12-15
 * Active models only. See GROQ_MODELS comments for decommissioned models.
 */
export const GROQ_FALLBACK_ORDER = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant'
];

/**
 * Calculate rate limit delay for Groq
 */
export function getGroqDelay(modelId) {
  const config = GROQ_MODELS[modelId];
  if (!config) {
    return 2000; // Default 2s
  }

  // 60000ms / 30 RPM = 2000ms with 10% buffer
  const baseDelay = Math.ceil(60000 / config.rpm);
  return Math.ceil(baseDelay * 1.1);
}

/**
 * Groq API Adapter
 */
export class GroqAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.GROQ_API_KEY;
    this.model = options.model || GROQ_FALLBACK_ORDER[0];
    this.verbose = options.verbose !== false;
    this.baseUrl = 'https://api.groq.com/openai/v1/chat/completions';

    this.stats = {
      tokensUsed: 0,
      requestCount: 0,
      modelUsed: this.model
    };
  }

  log(message) {
    if (this.verbose) {
      const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
      console.log(`[${timestamp}] ${message}`);
    }
  }

  getNextFallbackModel() {
    const currentIdx = GROQ_FALLBACK_ORDER.indexOf(this.model);
    if (currentIdx < 0 || currentIdx >= GROQ_FALLBACK_ORDER.length - 1) {
      return null;
    }
    return GROQ_FALLBACK_ORDER[currentIdx + 1];
  }

  /**
   * Call Groq API for text generation
   */
  async generate(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('Groq API key not configured. Set GROQ_API_KEY environment variable.');
    }

    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: options.temperature || 0.3,
      max_tokens: options.maxTokens || 2000
    };

    const maxRetries = options.maxRetries || 2;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        // Handle rate limits - NEVER wait, immediately try next model
        if (response.status === 429) {
          const nextModel = this.getNextFallbackModel();
          if (nextModel) {
            this.log(`Rate limited on ${this.model}, immediately switching to ${nextModel}`);
            this.model = nextModel;
            body.model = nextModel;
            this.stats.modelUsed = nextModel;
            continue;
          }
          // No more models available
          throw new Error(`Groq rate limited on all models: ${GROQ_FALLBACK_ORDER.join(', ')}`);
        }

        // Handle request too large - try smaller context model
        if (response.status === 413) {
          const nextModel = this.getNextFallbackModel();
          if (nextModel) {
            this.log(`Request too large for ${this.model}, switching to ${nextModel}`);
            this.model = nextModel;
            body.model = nextModel;
            this.stats.modelUsed = nextModel;
            continue;
          }
          const data = await response.json();
          throw new Error(`Request too large for all Groq models: ${data.error?.message || 'payload exceeds limits'}`);
        }

        const data = await response.json();

        if (!response.ok) {
          const errorMsg = data.error?.message || response.statusText;
          throw new Error(`Groq API error ${response.status}: ${errorMsg}`);
        }

        // Extract text from response
        const text = data.choices?.[0]?.message?.content || '';

        // Track usage
        if (data.usage) {
          this.stats.tokensUsed += data.usage.total_tokens;
        }
        this.stats.requestCount++;

        // Try to extract JSON if present, otherwise return plain text
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

        // Try to parse as JSON, but return text if it fails
        try {
          return JSON.parse(jsonText);
        } catch {
          // Not JSON, return as plain text
          return text.trim();
        }
      } catch (err) {
        lastError = err;

        // Check for retryable errors (network issues)
        const isRetryable = err.message.includes('fetch failed') ||
                           err.message.includes('network') ||
                           err.message.includes('ECONNRESET') ||
                           err.message.includes('timeout');

        if (isRetryable && attempt < maxRetries) {
          const retryDelay = 2000 * (attempt + 1);
          this.log(`Retry ${attempt + 1}/${maxRetries} after ${retryDelay / 1000}s...`);
          await this.sleep(retryDelay);
          continue;
        }

        break;
      }
    }

    throw new Error(`Groq API call failed: ${lastError.message}`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats() {
    return { ...this.stats };
  }
}

export default {
  GroqAdapter,
  GROQ_MODELS,
  GROQ_FALLBACK_ORDER,
  getGroqDelay
};
