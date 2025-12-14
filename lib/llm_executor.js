/**
 * llm_executor.js - LLM Narrative Field Generator
 *
 * Fills LLM placeholders in report JSON using prompts from the registry.
 * Enforces grounding rules: LLM can only use provided data, no fabrication.
 * Uses Google Gemini API for generation.
 *
 * Usage:
 *   import { LLMExecutor } from './lib/llm_executor.js';
 *   const executor = new LLMExecutor({ apiKey: process.env.GEMINI_API_KEY });
 *   const filledReport = await executor.fillPlaceholders(reportJson, context);
 */

import Mustache from 'mustache';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  MODEL_FALLBACK_ORDER,
  getModelDelay,
  getNextFallbackModel,
  isRateLimitError,
  parseRetryAfter,
  getModelInfo
} from './model_config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Mapping from placeholder names to prompt registry IDs
 */
const PLACEHOLDER_TO_PROMPT = {
  'document_title': 'document_title_v1',
  'scope_statement': 'scope_statement_v1',
  'scope_items': 'scope_items_v1',
  'out_of_scope': 'out_of_scope_v1',
  'limitations': 'limitations_v1',
  'executive_summary': 'executive_summary_v1',
  'finding_summary': 'finding_summary_v1',
  'finding_risk': 'finding_risk_v1',
  'math_defender_text': 'math_defender_v1',
  'fix_problem': 'fix_problem_v1',
  'fix_solution': 'fix_solution_v1',
  'acceptance_criteria': 'acceptance_criteria_v1',
  'impact_basis': 'impact_basis_v1',
  'cta_headline': 'cta_headline_v1',
  'cta_subtext': 'cta_subtext_v1'
};

/**
 * LLM Executor class - Uses Google Gemini API
 */
export class LLMExecutor {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    this.model = options.model || MODEL_FALLBACK_ORDER[0]; // Start with best available model
    this.maxRetries = options.maxRetries || 2;
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose !== false;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
    this.usePaidTier = options.usePaidTier || false;

    // Model fallback tracking
    this.currentModel = this.model;
    this.fallbackHistory = [];
    this.modelSwitches = 0;

    // Load prompt registry
    this.promptRegistry = this.loadPromptRegistry();

    // Track which fields need human approval
    this.approvalQueue = [];

    // Track execution stats
    this.stats = {
      promptsExecuted: 0,
      tokensUsed: 0,
      errors: [],
      approvalRequired: [],
      modelUsed: this.currentModel,
      fallbacks: []
    };

    if (this.verbose) {
      const modelInfo = getModelInfo(this.currentModel);
      console.log(`LLM Executor initialized: ${modelInfo.model} (${modelInfo.tier} tier, ${modelInfo.delay_ms}ms delay)`);
    }
  }

  /**
   * Load the prompt registry
   */
  loadPromptRegistry() {
    const registryPath = path.join(__dirname, '..', 'prompts', 'prompt_registry.json');
    try {
      const content = fs.readFileSync(registryPath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      console.warn('Could not load prompt registry:', err.message);
      return { prompts: [] };
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
    this.modelSwitches++;

    const fallbackInfo = {
      from: previousModel,
      to: nextModel,
      timestamp: new Date().toISOString()
    };

    this.fallbackHistory.push(fallbackInfo);
    this.stats.fallbacks.push(fallbackInfo);

    if (this.verbose) {
      const modelInfo = getModelInfo(nextModel);
      console.log(`🔄 Falling back: ${previousModel} → ${nextModel} (${modelInfo.tier} tier, ${modelInfo.delay_ms}ms delay)`);
    }

    return true;
  }

  /**
   * Get a prompt by ID
   */
  getPrompt(promptId) {
    return this.promptRegistry.prompts?.find(p => p.prompt_id === promptId);
  }

  /**
   * Extract context data for a prompt based on allowed inputs
   */
  extractContext(prompt, reportJson, additionalContext = {}) {
    const context = { ...additionalContext };

    // Map common context fields
    if (reportJson.audit?.workflows?.[0]) {
      const workflow = reportJson.audit.workflows[0];
      context.workflow_name = workflow.name;
      context.trigger = workflow.trigger;
      context.objective = workflow.objective;
      context.measurements = workflow.measurements?.map(m => ({
        name: m.name,
        value_display: m.value_display,
        target: m.target,
        threshold_display: m.target
      }));
    }

    if (reportJson.audit?.scope) {
      context.systems_involved = reportJson.audit.scope.systems_involved?.map(s => s.system_name);
      // Format time_window as readable string instead of object
      const tw = reportJson.audit.scope.time_window;
      if (tw) {
        const startDate = new Date(tw.start).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const endDate = new Date(tw.end).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        context.time_window = `${startDate} to ${endDate}`;
      }
    }

    if (reportJson.bleed) {
      context.bleed_total_display = reportJson.bleed.total?.display;
      context.period = reportJson.bleed.period;
      context.assumptions = reportJson.bleed.assumptions;
      context.calculations = reportJson.bleed.calculations;
    }

    if (reportJson.prepared_for) {
      context.client_name = reportJson.prepared_for.account_name;
    }

    if (reportJson.offer) {
      context.offer_sku_name = reportJson.offer.sku_name;
      context.offer_promise = "Single workflow audit with actionable fixes";
      context.booking_cta_text = "Book Implementation Call";
    }

    return context;
  }

  /**
   * Render the user prompt template with context
   */
  renderPrompt(prompt, context) {
    // Disable Mustache escaping for this render
    Mustache.escape = text => text;
    return Mustache.render(prompt.user_prompt_template, context);
  }

  /**
   * Call the Gemini API with retry logic and model fallback
   */
  async callLLM(prompt, context) {
    const userPrompt = this.renderPrompt(prompt, context);

    if (this.dryRun) {
      return {
        content: `[DRY_RUN: Would call LLM with prompt ${prompt.prompt_id}]`,
        tokens: 0
      };
    }

    if (!this.apiKey) {
      throw new Error('Gemini API key not set. Set GEMINI_API_KEY or pass apiKey option.');
    }

    // Combine system prompt and user prompt for Gemini
    const fullPrompt = prompt.system_prompt
      ? `${prompt.system_prompt}\n\n${userPrompt}`
      : userPrompt;

    const body = {
      contents: [{
        parts: [{ text: fullPrompt }]
      }],
      generationConfig: {
        maxOutputTokens: prompt.max_tokens || 200,
        temperature: 0.3
      }
    };

    // Retry loop with model fallback
    let lastError;
    let fallbackAttempted = false;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const url = `${this.baseUrl}/${this.currentModel}:generateContent?key=${this.apiKey}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Gemini API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const tokens = data.usageMetadata?.totalTokenCount || 0;

        this.stats.promptsExecuted++;
        this.stats.tokensUsed += tokens;
        this.stats.modelUsed = this.currentModel;

        return { content, tokens };
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
              if (this.verbose) {
                console.log(`    Rate limit hit, waiting ${Math.ceil(retryAfter / 1000)}s...`);
              }
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

        if (isRetryable && attempt < this.maxRetries) {
          const retryDelay = 5000 * (attempt + 1); // 5s, 10s
          if (this.verbose) {
            console.log(`    Retry ${attempt + 1}/${this.maxRetries} after ${retryDelay / 1000}s...`);
          }
          await this.sleep(retryDelay);
          continue;
        }
        break;
      }
    }

    this.stats.errors.push({
      prompt_id: prompt.prompt_id,
      model: this.currentModel,
      error: lastError.message
    });
    throw lastError;
  }

  /**
   * Validate LLM output against constraints
   */
  validateOutput(prompt, output) {
    const errors = [];
    const constraints = prompt.output_constraints || {};

    // Check max length
    if (constraints.max_length_chars && output.length > constraints.max_length_chars) {
      errors.push(`Output exceeds max length (${output.length} > ${constraints.max_length_chars})`);
    }

    // Check must contain
    if (constraints.must_contain) {
      constraints.must_contain.forEach(phrase => {
        if (!output.includes(phrase)) {
          errors.push(`Output missing required phrase: "${phrase}"`);
        }
      });
    }

    // Check must not contain
    if (constraints.must_not_contain) {
      constraints.must_not_contain.forEach(phrase => {
        if (output.toLowerCase().includes(phrase.toLowerCase())) {
          errors.push(`Output contains forbidden phrase: "${phrase}"`);
        }
      });
    }

    // Check for insufficient evidence marker
    if (output.includes('[INSUFFICIENT_EVIDENCE]')) {
      errors.push('LLM reported insufficient evidence');
    }

    return errors;
  }

  /**
   * Strip markdown code block artifacts from LLM output
   */
  stripMarkdown(text) {
    return text
      // Remove code block markers with optional language
      .replace(/^```(?:json|html|text|markdown)?\s*\n?/gim, '')
      .replace(/\n?```$/gim, '')
      // Clean up any leading/trailing whitespace
      .trim();
  }

  /**
   * Parse JSON array output (for array-type fields)
   */
  parseArrayOutput(output) {
    // First strip any markdown artifacts
    const cleaned = this.stripMarkdown(output);

    try {
      // Try to extract JSON array from output
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        return JSON.parse(match[0]);
      }
    } catch (err) {
      // Fall back to splitting by newlines
    }

    // Fall back: split by newlines and clean up
    return cleaned
      .split('\n')
      .map(line => line.replace(/^[\d\.\-\*]\s*/, '').trim())
      .filter(line => line.length > 0 && !line.startsWith('[') && !line.startsWith(']'));
  }

  /**
   * Extract the base placeholder name (before " for ") for prompt mapping
   */
  getBasePlaceholderName(fullName) {
    // Handle patterns like "finding_summary for Average Time..." → "finding_summary"
    const forIndex = fullName.indexOf(' for ');
    if (forIndex > 0) {
      return fullName.substring(0, forIndex);
    }
    return fullName;
  }

  /**
   * Sleep helper for rate limiting
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Find all placeholders in the report and their paths
   */
  findPlaceholders(obj, path = '') {
    const placeholders = [];

    if (typeof obj === 'string' && obj.includes('[LLM_PLACEHOLDER')) {
      const match = obj.match(/\[LLM_PLACEHOLDER:\s*([^\]]+)\]/);
      if (match) {
        placeholders.push({
          path,
          placeholderName: match[1].trim(),
          fullMatch: match[0]
        });
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((item, idx) => {
        placeholders.push(...this.findPlaceholders(item, `${path}[${idx}]`));
      });
    } else if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([key, value]) => {
        placeholders.push(...this.findPlaceholders(value, path ? `${path}.${key}` : key));
      });
    }

    return placeholders;
  }

  /**
   * Set a value at a path in an object
   */
  setAtPath(obj, path, value) {
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = isNaN(parts[i + 1]) ? {} : [];
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Get value at a path in an object
   */
  getAtPath(obj, path) {
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = obj;

    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }

    return current;
  }

  /**
   * Build context for a specific placeholder based on its path
   */
  buildContextForPlaceholder(placeholder, reportJson) {
    const context = this.extractContext(null, reportJson);

    // Add path-specific context
    if (placeholder.path.includes('scorecard.rows[')) {
      // Extract row index and get row data
      const match = placeholder.path.match(/scorecard\.rows\[(\d+)\]/);
      if (match) {
        const rowIdx = parseInt(match[1]);
        const row = reportJson.scorecard?.rows?.[rowIdx];
        if (row) {
          context.category = row.category;
          context.status = row.status;
          context.measurement_value = row.metrics?.[0]?.value_display;
          context.measurement_unit = '';
          context.threshold = row.metrics?.[1]?.value_display;
          context.cost_signal = reportJson.bleed?.total?.display;
        }
      }
    }

    if (placeholder.path.includes('fixes.items[')) {
      const match = placeholder.path.match(/fixes\.items\[(\d+)\]/);
      if (match) {
        const fixIdx = parseInt(match[1]);
        const fix = reportJson.fixes?.items?.[fixIdx];
        if (fix) {
          context.problem = fix.problem;
          context.solution = fix.solution;
          context.quick_win_flag = fix.quick_win;
          // Find related measurement
          const measurementId = fix.related_measurement_ids?.[0];
          const measurement = reportJson.audit?.workflows?.[0]?.measurements?.find(
            m => m.measurement_id === measurementId
          );
          if (measurement) {
            context.measurement_name = measurement.name;
            context.threshold = measurement.target;
            context.measurement_unit = '';
            context.finding_summary = context.measurement_name;
            context.measurement_value = measurement.value_display;
          }
        }
      }
    }

    // For executive summary, add critical finding
    if (placeholder.path.includes('executive_summary')) {
      const criticalRow = reportJson.scorecard?.rows?.find(r => r.status === 'critical');
      context.critical_finding = criticalRow?.category || 'Process bottleneck';
    }

    return context;
  }

  /**
   * Fill all LLM placeholders in the report
   */
  async fillPlaceholders(reportJson, options = {}) {
    const { skipApproval = false, onProgress = null } = options;

    // Rate limiting: delay is dynamic based on current model
    let lastRequestTime = 0;

    // Deep clone to avoid mutating original
    const filledReport = JSON.parse(JSON.stringify(reportJson));

    // Find all placeholders
    const placeholders = this.findPlaceholders(filledReport);

    console.log(`Found ${placeholders.length} LLM placeholders to fill`);

    for (let i = 0; i < placeholders.length; i++) {
      const placeholder = placeholders[i];

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: placeholders.length,
          path: placeholder.path,
          name: placeholder.placeholderName
        });
      }

      // Extract base name for prompt mapping (e.g., "finding_summary for X" → "finding_summary")
      const baseName = this.getBasePlaceholderName(placeholder.placeholderName);

      // Get the prompt for this placeholder
      const promptId = PLACEHOLDER_TO_PROMPT[baseName];
      if (!promptId) {
        console.warn(`No prompt mapping for placeholder: ${placeholder.placeholderName} (base: ${baseName})`);
        continue;
      }

      const prompt = this.getPrompt(promptId);
      if (!prompt) {
        console.warn(`Prompt not found in registry: ${promptId}`);
        continue;
      }

      // Check if approval required
      if (prompt.approval_required && !skipApproval) {
        this.stats.approvalRequired.push({
          path: placeholder.path,
          prompt_id: promptId,
          approval_gate: prompt.approval_gate
        });
      }

      try {
        // Rate limiting: wait if needed (delay is dynamic based on current model)
        const requestDelayMs = getModelDelay(this.currentModel, this.usePaidTier);
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        if (lastRequestTime > 0 && timeSinceLastRequest < requestDelayMs) {
          const waitTime = requestDelayMs - timeSinceLastRequest;
          if (this.verbose) {
            console.log(`    Rate limiting: waiting ${Math.round(waitTime / 1000)}s...`);
          }
          await this.sleep(waitTime);
        }

        // Build context for this placeholder
        const context = this.buildContextForPlaceholder(placeholder, filledReport);

        // Call LLM
        lastRequestTime = Date.now();
        const result = await this.callLLM(prompt, context);

        // Parse output based on type and strip markdown artifacts
        let output = this.stripMarkdown(result.content.trim());
        if (prompt.output_type === 'array_of_strings') {
          output = this.parseArrayOutput(output);
        }

        // Validate output
        const errors = this.validateOutput(prompt, typeof output === 'string' ? output : JSON.stringify(output));
        if (errors.length > 0) {
          console.warn(`Validation errors for ${placeholder.path}:`, errors);
          // Retry logic could go here
        }

        // For array outputs, replace the parent array instead of the placeholder element
        let targetPath = placeholder.path;
        if (prompt.output_type === 'array_of_strings' && Array.isArray(output)) {
          // If path ends with [N], replace the parent array
          const arrayPathMatch = targetPath.match(/^(.+)\[\d+\]$/);
          if (arrayPathMatch) {
            targetPath = arrayPathMatch[1];
          }
        }

        // Set the value in the report
        this.setAtPath(filledReport, targetPath, output);

        console.log(`  Filled: ${placeholder.path}`);

      } catch (err) {
        console.error(`Error filling ${placeholder.path}:`, err.message);
      }
    }

    return filledReport;
  }

  /**
   * Get execution statistics
   */
  getStats() {
    return {
      ...this.stats,
      registry_version: this.promptRegistry.registry_version
    };
  }

  /**
   * Get fields requiring human approval
   */
  getApprovalQueue() {
    return this.stats.approvalRequired;
  }

  /**
   * Final polishing pass - fixes common LLM output issues
   * Returns the polished report and a log of all changes made
   */
  polishReport(reportJson) {
    const polishLog = [];
    const polished = JSON.parse(JSON.stringify(reportJson));

    // Helper to log and apply a fix
    const applyFix = (path, before, after, reason) => {
      polishLog.push({
        timestamp: new Date().toISOString(),
        path,
        before: before?.substring?.(0, 100) || String(before).substring(0, 100),
        after: after?.substring?.(0, 100) || String(after).substring(0, 100),
        reason
      });
    };

    // 1. Strip markdown code block wrappers from all string fields
    const cleanMarkdown = (obj, path = '') => {
      if (typeof obj === 'string') {
        const cleaned = this.stripMarkdown(obj);
        if (cleaned !== obj) {
          applyFix(path, obj, cleaned, 'Removed markdown code block wrapper');
          return cleaned;
        }
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map((item, idx) => cleanMarkdown(item, `${path}[${idx}]`));
      }
      if (obj && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = cleanMarkdown(value, path ? `${path}.${key}` : key);
        }
        return result;
      }
      return obj;
    };

    // 2. Clean up limitations that contain template placeholders
    const cleanTemplatePlaceholders = (text) => {
      if (typeof text !== 'string') return text;
      // Remove template variables like [specific data point], [start date], etc.
      return text
        .replace(/\[specific data point\]/gi, 'key metrics')
        .replace(/\[start date\]/gi, 'the start of the analysis period')
        .replace(/\[end date\]/gi, 'the end of the analysis period')
        .replace(/\[missing period\/segment\]/gi, 'certain time periods')
        .replace(/\[specific data category\]/gi, 'certain data categories')
        .replace(/\[level of detail\]/gi, 'granular')
        .replace(/\[specific area of impact\]/gi, 'specific areas');
    };

    // Apply markdown cleaning
    const markdownCleaned = cleanMarkdown(polished);
    Object.assign(polished, markdownCleaned);

    // 3. Clean limitations array
    if (polished.audit?.methodology?.limitations) {
      polished.audit.methodology.limitations = polished.audit.methodology.limitations.map((lim, idx) => {
        const cleaned = cleanTemplatePlaceholders(lim);
        if (cleaned !== lim) {
          applyFix(`audit.methodology.limitations[${idx}]`, lim, cleaned, 'Replaced template placeholders with specific text');
        }
        return cleaned;
      });
    }

    // 4. Remove any JSON fragments from arrays (like out_of_scope)
    const cleanArrayField = (arr, path) => {
      if (!Array.isArray(arr)) return arr;
      const cleaned = arr.filter(item => {
        if (typeof item !== 'string') return true;
        // Remove JSON syntax artifacts
        const isArtifact = item.trim().match(/^[\[\]{}",]$/) ||
                          item.trim().startsWith('```') ||
                          item.trim().match(/^".*",?$/) ||
                          item.trim() === '[' ||
                          item.trim() === ']';
        if (isArtifact) {
          applyFix(path, item, '[REMOVED]', 'Removed JSON syntax artifact');
          return false;
        }
        return true;
      }).map(item => {
        if (typeof item === 'string') {
          // Clean quotes and trailing commas from items
          return item.replace(/^["']|["'],?$/g, '').trim();
        }
        return item;
      });
      return cleaned;
    };

    if (polished.audit?.scope?.in_scope) {
      polished.audit.scope.in_scope = cleanArrayField(polished.audit.scope.in_scope, 'audit.scope.in_scope');
    }
    if (polished.audit?.scope?.out_of_scope) {
      polished.audit.scope.out_of_scope = cleanArrayField(polished.audit.scope.out_of_scope, 'audit.scope.out_of_scope');
    }
    if (polished.audit?.methodology?.limitations) {
      polished.audit.methodology.limitations = cleanArrayField(polished.audit.methodology.limitations, 'audit.methodology.limitations');
    }

    // 5. Ensure fix solutions are complete sentences (not cut off)
    if (polished.fixes?.items) {
      polished.fixes.items.forEach((fix, idx) => {
        // If solution ends mid-word or without punctuation, add ellipsis
        if (fix.solution && typeof fix.solution === 'string') {
          const solution = fix.solution.trim();
          if (solution.length > 0 && !solution.match(/[.!?]$/)) {
            const fixed = solution + '.';
            applyFix(`fixes.items[${idx}].solution`, fix.solution, fixed, 'Added missing sentence-ending punctuation');
            fix.solution = fixed;
          }
        }
      });
    }

    // Store polish log in stats
    this.stats.polishLog = polishLog;

    if (this.verbose && polishLog.length > 0) {
      console.log(`\nPolishing: Applied ${polishLog.length} fixes`);
      polishLog.forEach(fix => {
        console.log(`  - ${fix.path}: ${fix.reason}`);
      });
    }

    return polished;
  }

  /**
   * Get the polish log from the last polishing operation
   */
  getPolishLog() {
    return this.stats.polishLog || [];
  }
}

/**
 * Convenience function for one-shot filling
 */
export async function fillReportNarratives(reportJson, options = {}) {
  const executor = new LLMExecutor(options);
  return executor.fillPlaceholders(reportJson, options);
}

export default { LLMExecutor, fillReportNarratives };
