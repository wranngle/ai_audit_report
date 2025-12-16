/**
 * extract.js - LLM-Powered Data Extraction from Unstructured Text
 *
 * Parses info dumps, interview notes, and raw text into structured
 * intake packets and measurements for the audit pipeline.
 *
 * Uses Google Gemini API for extraction (REST API).
 *
 * Usage:
 *   import { Extractor } from './lib/extract.js';
 *   const extractor = new Extractor({ apiKey: 'your-gemini-key' });
 *   const { intake, measurements } = await extractor.extract(rawText);
 */

import {
  MODEL_FALLBACK_ORDER,
  getNextFallbackModel,
  isRateLimitError,
  parseRetryAfter,
  getModelInfo
} from './model_config.js';
import { GroqAdapter } from './groq_adapter.js';

/**
 * Extraction prompts - designed for accurate structured data extraction
 */
const EXTRACTION_SYSTEM_PROMPT = `You are a data extraction specialist for business process audits. Your job is to parse unstructured interview notes, info dumps, and raw text into precise structured JSON.

CRITICAL RULES:
1. Only extract information that is EXPLICITLY stated in the input
2. Use null for any field where information is not provided
3. Never invent, assume, or fabricate data
4. Extract exact numbers when given (don't round or estimate)
5. If a value is ambiguous, use the most conservative interpretation
6. Preserve the client's language when extracting descriptions

OUTPUT FORMAT:
You must output valid JSON only. No markdown, no explanation, no commentary.`;

const INTAKE_EXTRACTION_PROMPT = `Extract an intake packet from the following unstructured text.

<input_text>
{{text}}
</input_text>

Extract into this exact JSON structure (use null for missing fields):

{
  "intake_version": "1.0.0",
  "captured_at": "{{timestamp}}",
  "captured_by": "<extract interviewer name or use 'unknown'>",

  "prepared_for": {
    "account_id": "<generate as CLIENT-XXX or null>",
    "account_name": "<extract company/client name>"
  },

  "section_a_workflow_definition": {
    "q01_workflow_name": "<extract the main process/workflow being discussed>",
    "q02_trigger_event": "<what starts this workflow>",
    "q03_business_objective": "<goal of the workflow>",
    "q04_end_condition": "<when is it complete>",
    "q05_outcome_owner": "<who is responsible>"
  },

  "section_b_volume_timing": {
    "q06_runs_per_period": "<number as string>",
    "q06_period_unit": "<day|week|month|quarter|year>",
    "q07_avg_trigger_to_end": "<number as string>",
    "q07_time_unit": "<minutes|hours|days>",
    "q08_worst_case_delay": "<number as string or null>",
    "q08_delay_unit": "<minutes|hours|days or null>",
    "q09_business_hours_expected": "<Yes/No with details or null>"
  },

  "section_c_systems_handoffs": {
    "q10_systems_involved": ["<array of system names with tools in parens>"],
    "q11_manual_data_transfers": "<describe manual work>",
    "q12_human_decision_gates": "<describe human decisions required>"
  },

  "section_d_failure_cost": {
    "q13_common_failures": "<what goes wrong>",
    "q14_cost_if_slow_or_failed": "<business impact with $ amounts if mentioned>"
  },

  "section_e_priority": {
    "q15_one_thing_to_fix": "<client's stated priority or infer from context>"
  },

  "attachments": {
    "evidence_uris": [],
    "notes": "<any additional context or quotes>"
  }
}

Output ONLY the JSON object, no other text.`;

const MEASUREMENTS_EXTRACTION_PROMPT = `Extract measurements and bleed calculations from the following unstructured text and intake context.

<input_text>
{{text}}
</input_text>

<intake_context>
Workflow: {{workflow_name}}
Volume: {{volume}} per {{period}}
Systems: {{systems}}
</intake_context>

Extract into this exact JSON structure:

{
  "measurements": [
    {
      "id": "<m_descriptive_id>",
      "name": "<Human Readable Name>",
      "metric_type": "<latency|error_rate|volume|complexity|cost|quality>",
      "value": <number>,
      "unit": "<hours|minutes|days|percent|count|dollars>",
      "value_display": "<formatted like '26h' or '15%'>",
      "source": "<where this came from in the text>",
      "evidence": [
        {
          "type": "client_statement",
          "summary": "<exact or paraphrased quote>"
        }
      ],
      "threshold": {
        "target": <number or null>,
        "target_display": "<formatted target>",
        "healthy_max": <number for lower_is_better metrics>,
        "warning_max": <number>,
        "direction": "<lower_is_better|higher_is_better>"
      },
      "status": "<healthy|warning|critical based on value vs threshold>",
      "status_reason": "<brief explanation>"
    }
  ],

  "bleed_assumptions": [
    {
      "id": "<a_descriptive_id>",
      "label": "<what this assumption represents>",
      "value": <number>,
      "value_display": "<formatted>",
      "currency": "USD",
      "source": "<where extracted from>"
    }
  ],

  "bleed_calculations": [
    {
      "id": "<c_descriptive_id>",
      "label": "<calculation name>",
      "formula": "<readable formula like 'volume × rate × cost'>",
      "inputs": ["<assumption_ids used>"],
      "result": <number>,
      "result_display": "<formatted like '$4,050'>"
    }
  ],

  "bleed_total": {
    "value": <total monthly bleed number>,
    "currency": "USD",
    "period": "month",
    "display": "<formatted like '$4,050/mo'>"
  }
}

MEASUREMENT GUIDELINES:
- Create measurements for: response time, error/miss rates, delays, complexity (system count), manual effort
- Set thresholds based on industry standards if not explicitly stated:
  - Response time: healthy <1h, warning <4h, critical >4h
  - Error rates: healthy <5%, warning <10%, critical >10%
  - Manual handoffs: healthy ≤2, warning ≤4, critical >4
- Calculate status by comparing value to thresholds

BLEED CALCULATION GUIDELINES:
- Identify: volume, failure rate, cost per failure
- If cost per failure not stated, note it as an assumption
- Monthly bleed = volume × failure_rate × cost_per_failure
- If data is insufficient for bleed calc, use conservative estimates and note them

Output ONLY the JSON object, no other text.`;

/**
 * Extractor class
 */
export class Extractor {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    this.groqApiKey = options.groqApiKey || process.env.GROQ_API_KEY;
    this.model = options.model || MODEL_FALLBACK_ORDER[0]; // Start with best available model
    this.verbose = options.verbose !== false;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1/models';
    this.usePaidTier = options.usePaidTier || false;
    this.useGroq = options.useGroq || false; // Skip Gemini, use Groq directly

    // Model fallback tracking
    this.currentModel = this.model;
    this.fallbackHistory = [];

    // Groq adapter
    this.groqAdapter = this.groqApiKey ? new GroqAdapter({
      apiKey: this.groqApiKey,
      verbose: this.verbose
    }) : null;

    this.stats = {
      tokensUsed: 0,
      extractionTime: 0,
      modelUsed: this.currentModel,
      fallbacks: [],
      groqUsed: false
    };

    if (this.verbose) {
      if (this.useGroq && this.groqAdapter) {
        console.log(`Extractor initialized: Groq-only mode (${this.groqAdapter.model})`);
      } else {
        const modelInfo = getModelInfo(this.currentModel);
        console.log(`Extractor initialized: ${modelInfo.model} (${modelInfo.tier} tier)`);
      }
    }
  }

  /**
   * Attempt to fall back to next available model
   * @returns {boolean} True if fallback successful, false if no more fallbacks
   */
  fallbackToNextModel() {
    const nextModel = getNextFallbackModel(this.currentModel);

    if (!nextModel) {
      if (this.verbose) {
        console.log('⚠️  No more fallback models available');
      }
      return false;
    }

    const previousModel = this.currentModel;
    this.currentModel = nextModel;

    const fallbackInfo = {
      from: previousModel,
      to: nextModel,
      timestamp: new Date().toISOString()
    };

    this.fallbackHistory.push(fallbackInfo);
    this.stats.fallbacks.push(fallbackInfo);

    if (this.verbose) {
      const modelInfo = getModelInfo(nextModel);
      console.log(`🔄 Extraction fallback: ${previousModel} → ${nextModel} (${modelInfo.tier} tier)`);
    }

    return true;
  }

  /**
   * Log with timestamp
   */
  log(message) {
    if (this.verbose) {
      const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
      console.log(`[${timestamp}] ${message}`);
    }
  }

  /**
   * Call Gemini API for extraction (REST API) with model fallback
   */
  async callLLM(systemPrompt, userPrompt, maxRetries = 2) {
    // If useGroq flag is set, skip Gemini entirely
    if (this.useGroq && this.groqAdapter) {
      const result = await this.groqAdapter.generate(
        systemPrompt,
        userPrompt,
        {
          temperature: 0.3,
          maxTokens: 2000,
          maxRetries
        }
      );

      this.stats.groqUsed = true;
      this.stats.modelUsed = `groq:${this.groqAdapter.model}`;

      // Groq returns parsed JSON or string
      return result;
    }

    if (!this.apiKey) {
      throw new Error('Gemini API key not configured. Set GEMINI_API_KEY environment variable.');
    }

    const body = {
      contents: [
        {
          parts: [
            { text: `${systemPrompt}\n\n${userPrompt}` }
          ]
        }
      ]
    };

    let lastError;
    let fallbackAttempted = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const url = `${this.baseUrl}/${this.currentModel}:generateContent?key=${this.apiKey}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
          const errorMsg = data.error?.message || response.statusText;
          throw new Error(`Gemini API error ${response.status}: ${errorMsg}`);
        }

        // Extract text from response
        let text = '';
        if (data.candidates && data.candidates[0]?.content?.parts) {
          for (const part of data.candidates[0].content.parts) {
            if (part.text) {
              text += part.text;
            }
          }
        }

        // Track token usage if available
        if (data.usageMetadata) {
          this.stats.tokensUsed += (data.usageMetadata.promptTokenCount || 0) +
                                   (data.usageMetadata.candidatesTokenCount || 0);
        }

        this.stats.modelUsed = this.currentModel;

        // Extract JSON from response (handle potential markdown wrapping)
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

        return JSON.parse(jsonText.trim());
      } catch (err) {
        lastError = err;

        // Check if it's a rate limit error
        if (isRateLimitError(err)) {
          if (!fallbackAttempted) {
            // Try to fall back to next model
            if (this.fallbackToNextModel()) {
              fallbackAttempted = true;
              // Reset attempt counter for new model
              attempt = -1; // Will become 0 after continue
              continue;
            } else {
              // No more fallbacks, wait for retry-after period
              const retryAfter = parseRetryAfter(err);
              this.log(`Rate limit hit, waiting ${Math.ceil(retryAfter / 1000)}s...`);
              await this.sleep(retryAfter);
              continue;
            }
          }
        }

        // Check for other retryable errors
        const isRetryable = err.message.includes('fetch failed') ||
                           err.message.includes('network') ||
                           err.message.includes('ECONNRESET') ||
                           err.message.includes('timeout');

        if (isRetryable && attempt < maxRetries) {
          const retryDelay = 5000 * (attempt + 1); // 5s, 10s
          this.log(`Retry ${attempt + 1}/${maxRetries} after ${retryDelay / 1000}s...`);
          await this.sleep(retryDelay);
          continue;
        }
        break;
      }
    }

    console.error('Gemini API extraction error:', lastError.message);
    throw new Error(`Gemini API call failed: ${lastError.message}`);
  }

  /**
   * Sleep helper for rate limiting
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Sanitize extracted intake - replace nulls with sensible defaults
   * This handles cases where LLM returns null for optional fields that schema requires as strings
   */
  sanitizeIntake(intake) {
    const defaults = {
      // Section A - workflow definition
      'section_a_workflow_definition.q02_trigger_event': 'Request received',
      'section_a_workflow_definition.q03_business_objective': 'Complete the workflow efficiently',
      'section_a_workflow_definition.q04_end_condition': 'Process completed',
      'section_a_workflow_definition.q05_outcome_owner': 'Unknown',
      // Section B - volume/timing
      'section_b_volume_timing.q06_runs_per_period': 'Unknown',
      'section_b_volume_timing.q06_period_unit': 'month',
      'section_b_volume_timing.q07_avg_trigger_to_end': 'Unknown',
      'section_b_volume_timing.q07_time_unit': 'hours',
      'section_b_volume_timing.q08_worst_case_delay': 'Unknown',
      'section_b_volume_timing.q08_delay_unit': 'days',
      'section_b_volume_timing.q09_business_hours_expected': 'Yes',
      // Section C - systems
      'section_c_systems_handoffs.q11_manual_data_transfers': 'Manual data entry between systems',
      'section_c_systems_handoffs.q12_human_decision_gates': 'Human review and approval required',
      // Section D - failures
      'section_d_failure_cost.q13_common_failures': 'Process delays and errors',
      'section_d_failure_cost.q14_cost_if_slow_or_failed': 'Financial and operational impact',
      // Section E - priority
      'section_e_priority.q15_one_thing_to_fix': 'Automate manual processes',
      // Attachments
      'attachments.notes': ''
    };

    // Deep clone to avoid mutating original
    const sanitized = JSON.parse(JSON.stringify(intake));

    // Ensure captured_at is valid ISO timestamp
    if (!sanitized.captured_at || sanitized.captured_at === null) {
      sanitized.captured_at = new Date().toISOString();
    }

    // Apply defaults for null string fields
    for (const [path, defaultValue] of Object.entries(defaults)) {
      const parts = path.split('.');
      let obj = sanitized;
      let parent = null;
      let lastKey = null;

      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) {
          obj[parts[i]] = {};
        }
        parent = obj;
        obj = obj[parts[i]];
        lastKey = parts[i];
      }

      const finalKey = parts[parts.length - 1];
      if (obj[finalKey] === null || obj[finalKey] === undefined) {
        obj[finalKey] = defaultValue;
      }
    }

    // Ensure systems array exists
    if (!sanitized.section_c_systems_handoffs) {
      sanitized.section_c_systems_handoffs = {};
    }
    if (!Array.isArray(sanitized.section_c_systems_handoffs.q10_systems_involved)) {
      sanitized.section_c_systems_handoffs.q10_systems_involved = ['Unknown system'];
    }

    // Ensure attachments.evidence_uris is array
    if (!sanitized.attachments) {
      sanitized.attachments = {};
    }
    if (!Array.isArray(sanitized.attachments.evidence_uris)) {
      sanitized.attachments.evidence_uris = [];
    }

    return sanitized;
  }

  /**
   * Extract intake packet from raw text
   */
  async extractIntake(rawText) {
    this.log('Extracting intake packet...');

    const timestamp = new Date().toISOString();
    const prompt = INTAKE_EXTRACTION_PROMPT
      .replace('{{text}}', rawText)
      .replace('{{timestamp}}', timestamp);

    const intake = await this.callLLM(EXTRACTION_SYSTEM_PROMPT, prompt);

    // Ensure required fields have values
    if (!intake.prepared_for?.account_name) {
      throw new Error('Could not extract client/account name from input');
    }
    if (!intake.section_a_workflow_definition?.q01_workflow_name) {
      throw new Error('Could not extract workflow name from input');
    }

    // Generate default account_id if missing
    if (!intake.prepared_for.account_id) {
      const slug = intake.prepared_for.account_name
        .replace(/[^a-zA-Z0-9]/g, '')
        .substring(0, 8)
        .toUpperCase();
      intake.prepared_for.account_id = `CLIENT-${slug}-${Date.now().toString(36).toUpperCase()}`;
    }

    // Sanitize to replace nulls with defaults
    const sanitizedIntake = this.sanitizeIntake(intake);

    this.log(`  Client: ${sanitizedIntake.prepared_for.account_name}`);
    this.log(`  Workflow: ${sanitizedIntake.section_a_workflow_definition.q01_workflow_name}`);

    return sanitizedIntake;
  }

  /**
   * Extract measurements from raw text with intake context
   */
  async extractMeasurements(rawText, intake) {
    this.log('Extracting measurements...');

    const workflowName = intake.section_a_workflow_definition?.q01_workflow_name || 'Unknown';
    const volume = intake.section_b_volume_timing?.q06_runs_per_period || '?';
    const period = intake.section_b_volume_timing?.q06_period_unit || 'month';
    const systems = intake.section_c_systems_handoffs?.q10_systems_involved?.join(', ') || 'Unknown';

    const prompt = MEASUREMENTS_EXTRACTION_PROMPT
      .replace('{{text}}', rawText)
      .replace('{{workflow_name}}', workflowName)
      .replace('{{volume}}', volume)
      .replace('{{period}}', period)
      .replace('{{systems}}', systems);

    const measurements = await this.callLLM(EXTRACTION_SYSTEM_PROMPT, prompt);

    // Validate we got something useful
    if (!measurements.measurements || measurements.measurements.length === 0) {
      throw new Error('Could not extract any measurements from input');
    }

    this.log(`  Measurements: ${measurements.measurements.length}`);
    this.log(`  Bleed total: ${measurements.bleed_total?.display || 'Not calculated'}`);

    return measurements;
  }

  /**
   * Full extraction: raw text → intake + measurements
   */
  async extract(rawText) {
    const startTime = Date.now();

    this.log('Starting extraction from info dump...');
    this.log(`  Input length: ${rawText.length} chars`);

    // Step 1: Extract intake
    const intake = await this.extractIntake(rawText);

    // Step 2: Extract measurements with intake context
    const measurements = await this.extractMeasurements(rawText, intake);

    this.stats.extractionTime = Date.now() - startTime;

    this.log(`Extraction complete in ${this.stats.extractionTime}ms`);
    this.log(`  Tokens used: ${this.stats.tokensUsed}`);

    return { intake, measurements };
  }

  /**
   * Get extraction stats
   */
  getStats() {
    return { ...this.stats };
  }
}

export default { Extractor };
