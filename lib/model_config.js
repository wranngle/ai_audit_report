/**
 * model_config.js - Gemini API Model Configuration and Fallback
 *
 * Defines model priority order and rate limits for automatic fallback.
 * Free tier limits are enforced by Google - when exceeded, we fall back to next available model.
 */

/**
 * Model configuration with rate limits
 * Format: [free_tier, paid_tier]
 * RPM = Requests Per Minute
 * TPM = Tokens Per Minute
 * RPD = Requests Per Day
 */
export const MODEL_CONFIGS = {
  'gemini-2.5-flash': {
    rpm: [5, 6],
    tpm: [250000, 2990],
    rpd: [20, 21],
    category: 'text-out',
    tier: 'premium'
  },
  'gemini-2.5-flash-lite': {
    rpm: [10, 10],
    tpm: [250000, 250000],
    rpd: [20, 20],
    category: 'text-out',
    tier: 'lite'
  },
  'gemma-3-27b': {
    rpm: [19, 30],
    tpm: [3490, 15000],
    rpd: [65, 14400],
    category: 'other',
    tier: 'large'
  },
  'gemma-3-12b': {
    rpm: [30, 30],
    tpm: [15000, 15000],
    rpd: [14400, 14400],
    category: 'other',
    tier: 'medium'
  },
  'gemma-3-4b': {
    rpm: [30, 30],
    tpm: [15000, 15000],
    rpd: [14400, 14400],
    category: 'other',
    tier: 'small'
  },
  'gemma-3-2b': {
    rpm: [30, 30],
    tpm: [15000, 15000],
    rpd: [14400, 14400],
    category: 'other',
    tier: 'tiny'
  },
  'gemma-3-1b': {
    rpm: [30, 30],
    tpm: [15000, 15000],
    rpd: [14400, 14400],
    category: 'other',
    tier: 'micro'
  }
};

/**
 * Model fallback priority (best to worst quality)
 * When a model hits rate limits, automatically fall back to next available model
 */
export const MODEL_FALLBACK_ORDER = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemma-3-27b',
  'gemma-3-12b',
  'gemma-3-4b',
  'gemma-3-2b',
  'gemma-3-1b'
];

/**
 * Calculate rate limit delay for a model
 * @param {string} modelId - Model identifier
 * @param {boolean} usePaidTier - Whether using paid tier (default: false for free tier)
 * @returns {number} Delay in milliseconds between requests
 */
export function getModelDelay(modelId, usePaidTier = false) {
  const config = MODEL_CONFIGS[modelId];
  if (!config) {
    console.warn(`Unknown model: ${modelId}, using default 3s delay`);
    return 3000;
  }

  const rpm = usePaidTier ? config.rpm[1] : config.rpm[0];

  // Calculate delay: 60000ms / requests_per_minute
  // Add 10% buffer to avoid edge cases
  const baseDelay = Math.ceil(60000 / rpm);
  const delayWithBuffer = Math.ceil(baseDelay * 1.1);

  return delayWithBuffer;
}

/**
 * Get the next fallback model
 * @param {string} currentModel - Current model that failed
 * @returns {string|null} Next model to try, or null if no fallback available
 */
export function getNextFallbackModel(currentModel) {
  const currentIndex = MODEL_FALLBACK_ORDER.indexOf(currentModel);

  if (currentIndex === -1) {
    // Unknown model, start from beginning
    return MODEL_FALLBACK_ORDER[0];
  }

  if (currentIndex >= MODEL_FALLBACK_ORDER.length - 1) {
    // Already at last model
    return null;
  }

  return MODEL_FALLBACK_ORDER[currentIndex + 1];
}

/**
 * Check if error is a rate limit error
 * @param {Error} error - Error object
 * @returns {boolean} True if rate limit error
 */
export function isRateLimitError(error) {
  const message = error.message || '';

  return (
    message.includes('429') ||
    message.includes('quota') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('rate limit') ||
    message.includes('Quota exceeded')
  );
}

/**
 * Parse retry-after time from error
 * @param {Error} error - Error object
 * @returns {number} Milliseconds to wait before retry (default 60000)
 */
export function parseRetryAfter(error) {
  const message = error.message || '';

  // Look for patterns like "retry in 49.265030275s" or "retryDelay": "49s"
  const secondsMatch = message.match(/retry\s+in\s+([\d.]+)s/i) ||
                      message.match(/"retryDelay":\s*"([\d.]+)s"/);

  if (secondsMatch) {
    const seconds = parseFloat(secondsMatch[1]);
    return Math.ceil(seconds * 1000);
  }

  // Default to 60 seconds if can't parse
  return 60000;
}

/**
 * Get model display info
 * @param {string} modelId - Model identifier
 * @returns {object} Model info for logging
 */
export function getModelInfo(modelId) {
  const config = MODEL_CONFIGS[modelId];
  if (!config) {
    return { model: modelId, tier: 'unknown', rpm: 'unknown' };
  }

  return {
    model: modelId,
    tier: config.tier,
    rpm_free: config.rpm[0],
    delay_ms: getModelDelay(modelId, false)
  };
}

export default {
  MODEL_CONFIGS,
  MODEL_FALLBACK_ORDER,
  getModelDelay,
  getNextFallbackModel,
  isRateLimitError,
  parseRetryAfter,
  getModelInfo
};
