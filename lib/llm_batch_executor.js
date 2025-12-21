/**
 * llm_batch_executor.js - Single-Call LLM Narrative Generator
 *
 * Replaces the per-field prompt approach with a single master prompt
 * that generates ALL narrative content in one LLM call, followed by
 * a self-verification refinement pass.
 *
 * Benefits:
 * - Fewer API calls (2-3 instead of 33+)
 * - Better consistency across all generated content
 * - LLM self-verification improves quality
 * - Faster overall execution
 *
 * Usage:
 *   import { BatchLLMExecutor } from './lib/llm_batch_executor.js';
 *   const executor = new BatchLLMExecutor({ apiKey: process.env.GEMINI_API_KEY });
 *   const filledReport = await executor.fillAllNarratives(reportJson, context);
 */

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
import { GroqAdapter } from './groq_adapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Master system prompt for generating all narratives at once
 */
const MASTER_SYSTEM_PROMPT = `You are a professional business process auditor writing content for an AI Process Audit. Your task is to generate ALL narrative content for the report in a single, well-structured JSON response.

CRITICAL RULES:
1. Use ONLY the data provided - never invent numbers, names, or facts
2. Be concise and professional - no fluff, no hedging language
3. Use active voice and specific language
4. Quote exact values from the provided measurements
5. Every field must have a value - use context clues to write appropriate content
6. Output ONLY valid JSON - no markdown, no explanation

FORBIDDEN PHRASES (never use these):
- "I think", "might be", "could be", "approximately", "around", "roughly"
- "I believe", "probably", "perhaps", "maybe"

TONE:
- Professional and authoritative
- Direct and actionable
- Urgent but not alarmist
- Focused on business impact`;

/**
 * Generate the master prompt for all narratives
 */
function buildMasterPrompt(reportJson) {
  const workflow = reportJson.audit?.workflows?.[0];
  const bleed = reportJson.bleed;
  const scorecard = reportJson.scorecard;
  const fixes = reportJson.fixes;
  const clientName = reportJson.prepared_for?.account_name || 'Client';

  // Format time window
  const tw = reportJson.audit?.scope?.time_window;
  let timeWindow = 'the analysis period';
  if (tw) {
    const startDate = new Date(tw.start).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const endDate = new Date(tw.end).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    timeWindow = `${startDate} to ${endDate}`;
  }

  return `Generate ALL narrative content for this audit report. Use the data below.

<audit_context>
Client: ${clientName}
Workflow: ${workflow?.name || 'Unknown'}
Trigger: ${workflow?.trigger || 'Unknown'}
Objective: ${workflow?.objective || 'Unknown'}
Time Window: ${timeWindow}
Systems: ${reportJson.audit?.scope?.systems_involved?.map(s => s.system_name).join(', ') || 'Unknown'}
</audit_context>

<measurements>
${workflow?.measurements?.map(m => `- ${m.name}: ${m.value_display} (target: ${m.target || 'not set'}, status: ${m.status})`).join('\n') || 'No measurements'}
</measurements>

<bleed_data>
Total Bleed: ${bleed?.total?.display || '$0'}
Period: ${bleed?.period || 'month'}
Volume: ${workflow?.volume || 'Derived from calculations'}
Assumptions (includes cost per failure, hourly rates): ${JSON.stringify(bleed?.assumptions || [])}
Calculations (SHOWS THE FULL FORMULA including volume): ${JSON.stringify(bleed?.calculations || [])}
NOTE: When writing math_defender, you MUST include the volume number from the calculations!
</bleed_data>

<scorecard_rows>
${scorecard?.rows?.map((r, i) => `Row ${i + 1}: ${r.category} - Status: ${r.status} - Metrics: ${r.metrics?.map(m => m.value_display).join(', ')}`).join('\n') || 'No rows'}
</scorecard_rows>

<fixes>
${fixes?.items?.map((f, i) => `Fix ${i + 1}: Related to ${f.related_measurement_ids?.[0] || 'general'}, Quick win: ${f.quick_win}, Effort: ${f.implementation?.effort_level}, Impact tier: ${f.impact?.tier}, Recovery: ${f.impact?.estimated_recovery?.display || 'TBD'}`).join('\n') || 'No fixes'}
</fixes>

Generate this exact JSON structure with all narrative fields filled:

{
  "document_title": "AI Process Audit: [Workflow Name]",

  "scope_statement": "[2-3 sentence scope statement describing what was audited, when, and which systems]",

  "in_scope": ["[item 1]", "[item 2]", "[item 3]", "[item 4]"],

  "out_of_scope": ["[item 1]", "[item 2]", "[item 3]"],

  "limitations": ["[limitation 1]", "[limitation 2]"],

  "executive_summary": "[2 sentences: First states the critical bottleneck with exact value, second states the bleed amount and urgency. Wrap money in <strong> tags]",

  "scorecard_findings": [
    ${scorecard?.rows?.map((r, i) => `{
      "row_index": ${i},
      "category": "${r.category}",
      "summary": "[One sentence explaining the BUSINESS IMPACT of this metric - why does this number hurt the business? Don't just restate the metric - explain what it MEANS for operations, customers, or revenue. Include the exact metric value with <strong> tags around key numbers.]",
      "risk": "Risk: [Specific consequence if not fixed - lost customers, compliance risk, employee burnout, etc.]"
    }`).join(',\n    ')}
  ],

  "math_defender": "[MUST include ALL 3 parts of the formula: VOLUME × RATE × COST. Example: 'Based on 160 tickets/month × 35% missed SLA rate × $75 cost per failure = $4,200'. Never omit the volume!]",

  "fixes": [
    ${fixes?.items?.map((f, i) => `{
      "fix_index": ${i},
      "problem": "[The specific operational pain point this fix addresses - must directly relate to one of the scorecard findings above]",
      "solution": "[Concrete action: verb + what technology/process + expected outcome]",
      "impact_basis": "[HOW this fix reduces the pain - explain the mechanism, NOT the dollar amount]",
      "acceptance_criteria": ["[Measurable success criterion]", "[Testable validation step]"]
    }`).join(',\n    ')}
  ],

  "cta_headline": "[3-8 word headline with urgency, e.g., 'Stop losing $X monthly']",

  "cta_subtext": "[10-20 word supporting sentence about next steps]"
}

Output ONLY the JSON object:`;
}

/**
 * Refinement prompt for self-verification
 */
const REFINEMENT_SYSTEM_PROMPT = `You are a quality assurance editor reviewing AI-generated content for a business report. Your job is to verify and improve the content while ensuring it remains grounded in the source data.

VERIFICATION CHECKLIST:
1. All numbers match the source data exactly
2. No fabricated information
3. Professional tone throughout
4. No hedging language (might, could, approximately)
5. All sentences are complete and grammatically correct
6. Money values are wrapped in <strong> tags where appropriate
7. Content is concise - no unnecessary words
8. Risk statements start with "Risk:"
9. Fix solutions are actionable one-liners

IMPROVEMENTS TO MAKE:
- Fix any awkward phrasing
- Ensure consistent voice and tone
- Tighten verbose sentences
- Add missing punctuation
- Remove any placeholder text like [INSUFFICIENT_EVIDENCE]

OUTPUT: Return the IMPROVED JSON with the same structure. Only modify text content, not structure.`;

function buildRefinementPrompt(generatedContent, sourceData) {
  return `Review and improve this generated content. Verify it against the source data.

<generated_content>
${JSON.stringify(generatedContent, null, 2)}
</generated_content>

<source_data>
${JSON.stringify(sourceData, null, 2)}
</source_data>

Verify all numbers match the source. Fix any quality issues. Return the improved JSON:`;
}

/**
 * Batch LLM Executor class
 */
export class BatchLLMExecutor {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    this.groqApiKey = options.groqApiKey || process.env.GROQ_API_KEY;
    this.model = options.model || MODEL_FALLBACK_ORDER[0];
    this.maxRetries = options.maxRetries || 3;
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose !== false;
    // Use v1beta for Gemini 3 models, v1 for others
    const apiVersion = this.model.startsWith('gemini-3') ? 'v1beta' : 'v1';
    this.baseUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models`;
    this.skipRefinement = options.skipRefinement || false;
    this.useGroq = options.useGroq || false; // Skip Gemini, go straight to Groq

    // Model fallback tracking
    this.currentModel = this.model;
    this.fallbackHistory = [];

    // Groq adapter for fallback
    this.groqAdapter = this.groqApiKey ? new GroqAdapter({
      apiKey: this.groqApiKey,
      verbose: this.verbose
    }) : null;

    // Stats
    this.stats = {
      apiCalls: 0,
      tokensUsed: 0,
      generationTime: 0,
      refinementTime: 0,
      modelUsed: this.currentModel,
      groqUsed: false
    };

    if (this.verbose) {
      if (this.useGroq && this.groqAdapter) {
        console.log(`Batch LLM Executor initialized: Groq-only mode (${this.groqAdapter.model})`);
      } else {
        const modelInfo = getModelInfo(this.currentModel);
        console.log(`Batch LLM Executor initialized: ${modelInfo.model} (${modelInfo.tier} tier)`);
        if (this.groqAdapter) {
          console.log(`  Groq fallback: Available (${this.groqAdapter.model})`);
        }
      }
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Attempt to fall back to next model
   */
  fallbackToNextModel() {
    const nextModel = getNextFallbackModel(this.currentModel);
    if (!nextModel) {
      if (this.verbose) console.log('⚠️  No more fallback models available');
      return false;
    }

    const previousModel = this.currentModel;
    this.currentModel = nextModel;

    // Update API version for Gemini 3 models
    const apiVersion = this.currentModel.startsWith('gemini-3') ? 'v1beta' : 'v1';
    this.baseUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models`;

    this.fallbackHistory.push({ from: previousModel, to: nextModel });

    if (this.verbose) {
      const modelInfo = getModelInfo(nextModel);
      console.log(`🔄 Falling back: ${previousModel} → ${nextModel} (${modelInfo.tier} tier)`);
    }

    return true;
  }

  /**
   * Call LLM with retry and fallback logic
   */
  async callLLM(systemPrompt, userPrompt, maxTokens = 4000) {
    if (this.dryRun) {
      return { content: '{}', tokens: 0 };
    }

    // If useGroq flag is set, skip Gemini entirely
    if (this.useGroq && this.groqAdapter) {
      if (this.verbose) {
        console.log(`  Using Groq directly (${this.groqAdapter.model})`);
      }
      const result = await this.groqAdapter.generate(systemPrompt, userPrompt, {
        maxTokens,
        jsonMode: true
      });
      this.stats.apiCalls++;
      this.stats.groqUsed = true;
      this.stats.modelUsed = `groq:${this.groqAdapter.model}`;
      const tokens = this.groqAdapter.stats.tokensUsed;
      this.stats.tokensUsed += tokens;
      return { content: typeof result === 'string' ? result : JSON.stringify(result), tokens };
    }

    if (!this.apiKey) {
      throw new Error('Gemini API key not set');
    }

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const body = {
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.3
      }
    };

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

        this.stats.apiCalls++;
        this.stats.tokensUsed += tokens;
        this.stats.modelUsed = this.currentModel;

        return { content, tokens };
      } catch (err) {
        lastError = err;

        if (isRateLimitError(err)) {
          if (!fallbackAttempted && this.fallbackToNextModel()) {
            fallbackAttempted = true;
            attempt = -1;
            continue;
          }

          const retryAfter = parseRetryAfter(err);
          if (this.verbose) {
            console.log(`    Rate limit hit, waiting ${Math.ceil(retryAfter / 1000)}s...`);
          }
          await this.sleep(retryAfter);
          continue;
        }

        const isRetryable = err.message.includes('fetch failed') || err.message.includes('network');
        if (isRetryable && attempt < this.maxRetries) {
          await this.sleep(5000 * (attempt + 1));
          continue;
        }
        break;
      }
    }

    // Try Groq as final fallback
    if (this.groqAdapter && isRateLimitError(lastError)) {
      if (this.verbose) {
        console.log(`🔄 All Gemini models exhausted, falling back to Groq`);
      }

      try {
        const result = await this.groqAdapter.generate(systemPrompt, userPrompt, {
          temperature: 0.3,
          maxTokens,
          maxRetries: this.maxRetries
        });

        this.stats.apiCalls++;
        this.stats.groqUsed = true;
        this.stats.modelUsed = `groq:${this.groqAdapter.model}`;

        const content = typeof result === 'string' ? result : JSON.stringify(result);
        return { content, tokens: this.groqAdapter.stats.tokensUsed };
      } catch (groqErr) {
        if (this.verbose) console.log(`⚠️  Groq fallback also failed: ${groqErr.message}`);
      }
    }

    throw lastError;
  }

  /**
   * Parse JSON from LLM output, handling markdown artifacts
   */
  parseJSON(text) {
    // Strip markdown code blocks
    let cleaned = text
      .replace(/^```(?:json)?\s*\n?/gim, '')
      .replace(/\n?```$/gim, '')
      .trim();

    // Try to extract JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }

    throw new Error('Could not parse JSON from LLM output');
  }

  /**
   * Main entry point: Fill all narratives in a single batch
   */
  async fillAllNarratives(reportJson) {
    const startTime = Date.now();

    console.log('Stage 1: Generating all narratives in single LLM call...');

    // Build master prompt
    const masterPrompt = buildMasterPrompt(reportJson);

    // Call LLM for initial generation
    const genResult = await this.callLLM(MASTER_SYSTEM_PROMPT, masterPrompt, 6000);
    let generatedContent;

    try {
      generatedContent = this.parseJSON(genResult.content);
    } catch (err) {
      console.error('Failed to parse generated content:', err.message);
      console.error('Raw output:', genResult.content.substring(0, 500));
      throw new Error('LLM returned invalid JSON');
    }

    this.stats.generationTime = Date.now() - startTime;
    console.log(`  Generated ${Object.keys(generatedContent).length} narrative fields in ${this.stats.generationTime}ms`);

    // Stage 2: Refinement pass (unless skipped)
    if (!this.skipRefinement) {
      console.log('Stage 2: Self-verification refinement pass...');
      const refineStart = Date.now();

      const sourceData = {
        measurements: reportJson.audit?.workflows?.[0]?.measurements,
        bleed: reportJson.bleed,
        client: reportJson.prepared_for?.account_name
      };

      const refinePrompt = buildRefinementPrompt(generatedContent, sourceData);
      const refineResult = await this.callLLM(REFINEMENT_SYSTEM_PROMPT, refinePrompt, 6000);

      try {
        generatedContent = this.parseJSON(refineResult.content);
        this.stats.refinementTime = Date.now() - refineStart;
        console.log(`  Refinement complete in ${this.stats.refinementTime}ms`);
      } catch (err) {
        console.warn('Refinement parse failed, using original content');
      }
    }

    // Stage 3: Apply generated content to report
    console.log('Stage 3: Mapping content to report structure...');
    const filledReport = this.applyGeneratedContent(reportJson, generatedContent);

    console.log(`Batch LLM complete: ${this.stats.apiCalls} API calls, ${this.stats.tokensUsed} tokens`);

    return filledReport;
  }

  /**
   * Apply generated content to report JSON structure
   */
  applyGeneratedContent(reportJson, generated) {
    const report = JSON.parse(JSON.stringify(reportJson));

    // Document title
    if (generated.document_title) {
      report.document.title = generated.document_title;
    }

    // Scope
    if (generated.scope_statement) {
      report.audit.scope.scope_statement = generated.scope_statement;
    }
    if (generated.in_scope) {
      report.audit.scope.in_scope = generated.in_scope;
    }
    if (generated.out_of_scope) {
      report.audit.scope.out_of_scope = generated.out_of_scope;
    }

    // Methodology limitations
    if (generated.limitations) {
      report.audit.methodology.limitations = generated.limitations;
    }

    // Executive summary
    if (generated.executive_summary) {
      report.scorecard.executive_summary.body = generated.executive_summary;
    }

    // Scorecard findings
    if (generated.scorecard_findings && report.scorecard?.rows) {
      generated.scorecard_findings.forEach(finding => {
        const row = report.scorecard.rows[finding.row_index];
        if (row) {
          row.finding = row.finding || {};
          row.finding.summary = finding.summary;
          row.finding.risk = finding.risk;
        }
      });
    }

    // Math defender
    if (generated.math_defender) {
      report.bleed.math_defender_text = generated.math_defender;
    }

    // Fixes
    if (generated.fixes && report.fixes?.items) {
      generated.fixes.forEach(fix => {
        const item = report.fixes.items[fix.fix_index];
        if (item) {
          item.problem = fix.problem;
          item.solution = fix.solution;
          if (item.impact) {
            item.impact.basis = fix.impact_basis;
          }
          if (fix.acceptance_criteria) {
            item.acceptance_criteria = fix.acceptance_criteria;
          }
        }
      });
    }

    // CTA
    if (generated.cta_headline) {
      report.cta.headline = generated.cta_headline;
    }
    if (generated.cta_subtext) {
      report.cta.subtext = generated.cta_subtext;
    }

    return report;
  }

  /**
   * Get execution stats
   */
  getStats() {
    return this.stats;
  }
}

export default { BatchLLMExecutor };
