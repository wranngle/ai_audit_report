/**
 * pipeline.js - Unified Audit Report Generation Pipeline
 *
 * Orchestrates the full flow:
 *   Intake → Transform → Validate → LLM Fill → Validate → Render
 *
 * Usage:
 *   import { Pipeline } from './lib/pipeline.js';
 *   const pipeline = new Pipeline();
 *   await pipeline.run(intakePath, measurementsPath, outputPath);
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Mustache from 'mustache';

import { transform, getLLMPlaceholders } from './transform.js';
import { validateReport, validateIntake, validateMeasurements, formatErrors } from './validate.js';
import { LLMExecutor } from './llm_executor.js';
import { BatchLLMExecutor } from './llm_batch_executor.js';
import { Extractor } from './extract.js';
import { generatePDF } from './pdf_generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Pipeline configuration
 */
const DEFAULT_CONFIG = {
  templatePath: path.join(__dirname, '..', 'ai_audit_template_new.html'),
  skipPDF: false,  // Set to true to skip PDF generation
  dryRun: false,
  allowPlaceholders: false,
  verbose: true,
  geminiApiKey: null  // Can be set directly or via GEMINI_API_KEY env var
};

/**
 * Pipeline class
 */
export class Pipeline {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      startTime: null,
      endTime: null,
      stages: {}
    };
  }

  /**
   * Log with timestamp
   */
  log(message, level = 'info') {
    if (this.config.verbose || level === 'error') {
      const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
      const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '✓';
      console.log(`[${timestamp}] ${prefix} ${message}`);
    }
  }

  /**
   * Convert string to URL-safe slug
   */
  slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30);
  }

  /**
   * Stage 1: Load and validate intake
   */
  loadIntake(intakePath) {
    this.log(`Loading intake from ${intakePath}`);
    const intake = JSON.parse(fs.readFileSync(intakePath, 'utf8'));

    const validation = validateIntake(intake);
    if (!validation.valid) {
      this.log('Intake validation failed:', 'error');
      console.error(formatErrors(validation));
      throw new Error('Intake validation failed');
    }

    this.stats.stages.intake = { valid: true, path: intakePath };
    this.log(`Intake loaded: ${intake.prepared_for?.account_name}`);
    return intake;
  }

  /**
   * Stage 2: Load and validate measurements
   */
  loadMeasurements(measurementsPath) {
    this.log(`Loading measurements from ${measurementsPath}`);
    const measurements = JSON.parse(fs.readFileSync(measurementsPath, 'utf8'));

    const validation = validateMeasurements(measurements);
    if (!validation.valid) {
      this.log('Measurements validation failed:', 'error');
      console.error(formatErrors(validation));
      throw new Error('Measurements validation failed');
    }

    if (validation.warnings.length > 0) {
      validation.warnings.forEach(w => this.log(w.message, 'warn'));
    }

    this.stats.stages.measurements = {
      valid: true,
      path: measurementsPath,
      count: measurements.measurements?.length || 0
    };
    this.log(`Measurements loaded: ${measurements.measurements?.length} metrics`);
    return measurements;
  }

  /**
   * Stage 3: Transform intake + measurements to report JSON
   */
  transformToReport(intake, measurements) {
    this.log('Transforming to report JSON...');
    const reportJson = transform(intake, measurements);

    // Check for placeholders
    const placeholders = getLLMPlaceholders(reportJson);
    this.stats.stages.transform = {
      complete: true,
      placeholders: placeholders.length
    };

    this.log(`Transform complete: ${placeholders.length} LLM placeholders`);
    return reportJson;
  }

  /**
   * Stage 4: Fill LLM placeholders using batch executor
   * Uses single master prompt + self-verification instead of per-field prompts
   */
  async fillNarratives(reportJson) {
    this.log('Filling narrative fields with batch LLM...');

    // Use new batch executor (single prompt + refinement)
    const batchExecutor = new BatchLLMExecutor({
      apiKey: this.config.geminiApiKey || process.env.GEMINI_API_KEY,
      groqApiKey: process.env.GROQ_API_KEY,
      dryRun: this.config.dryRun,
      verbose: this.config.verbose,
      skipRefinement: this.config.skipRefinement || false,
      useGroq: this.config.useGroq
    });

    const filledReport = await batchExecutor.fillAllNarratives(reportJson);

    const batchStats = batchExecutor.getStats();
    this.stats.stages.llm = {
      complete: true,
      apiCalls: batchStats.apiCalls,
      tokensUsed: batchStats.tokensUsed,
      generationTime: batchStats.generationTime,
      refinementTime: batchStats.refinementTime,
      modelUsed: batchStats.modelUsed,
      groqUsed: batchStats.groqUsed
    };

    this.log(`Batch LLM complete: ${batchStats.apiCalls} API calls, ${batchStats.tokensUsed} tokens`);
    if (batchStats.refinementTime > 0) {
      this.log(`Self-verification took ${batchStats.refinementTime}ms`);
    }

    return filledReport;
  }

  /**
   * Stage 5: Validate final report
   */
  validateFinal(reportJson) {
    this.log('Validating final report...');

    const validation = validateReport(reportJson, {
      allowPlaceholders: this.config.allowPlaceholders,
      strictBusinessRules: true
    });

    this.stats.stages.validation = {
      valid: validation.valid,
      errors: validation.errors.length,
      warnings: validation.warnings.length,
      placeholders: validation.placeholders.length
    };

    if (!validation.valid) {
      this.log('Final validation failed:', 'error');
      console.error(formatErrors(validation));
      if (!this.config.allowPlaceholders) {
        throw new Error('Final validation failed');
      }
    }

    if (validation.warnings.length > 0) {
      validation.warnings.forEach(w => this.log(w.message, 'warn'));
    }

    this.log(`Validation complete: ${validation.errors.length} errors, ${validation.warnings.length} warnings`);
    return validation;
  }

  /**
   * Stage 6: Render to HTML
   */
  render(reportJson, outputPath) {
    this.log(`Rendering to ${outputPath}...`);

    const template = fs.readFileSync(this.config.templatePath, 'utf8');
    const html = Mustache.render(template, reportJson);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, html);

    this.stats.stages.render = {
      complete: true,
      outputPath,
      size: html.length
    };

    this.log(`Rendered: ${outputPath} (${(html.length / 1024).toFixed(1)} KB)`);
    return html; // Return HTML for optional polish pass
  }

  /**
   * Stage 7: Generate PDF from HTML
   */
  async generatePDF(htmlPath) {
    const pdfPath = htmlPath.replace(/\.html?$/i, '.pdf');
    this.log(`Generating PDF: ${pdfPath}...`);

    try {
      const result = await generatePDF(htmlPath, pdfPath);

      this.stats.stages.pdf = {
        complete: true,
        pdfPath: result.pdfPath,
        size: result.size
      };

      this.log(`PDF saved: ${result.pdfPath} (${result.sizeDisplay})`);
      return result;
    } catch (error) {
      this.log(`PDF generation failed: ${error.message}`);
      this.stats.stages.pdf = {
        complete: false,
        error: error.message
      };
      // Don't throw - PDF is optional, HTML is still valid
      return null;
    }
  }

  /**
   * Stage 8: Final HTML polish pass (optional)
   * Sends the rendered HTML through LLM to fix text quality issues
   */
  async polishHTMLPass(html, outputPath) {
    this.log('Running final HTML polish pass...');

    const executor = new LLMExecutor({
      apiKey: this.config.geminiApiKey || process.env.GEMINI_API_KEY,
      groqApiKey: process.env.GROQ_API_KEY,
      dryRun: this.config.dryRun,
      verbose: this.config.verbose,
      useGroq: this.config.useGroq
    });

    const { html: polishedHtml, changes } = await executor.polishHTML(html);

    // Write polished HTML to output
    fs.writeFileSync(outputPath, polishedHtml);

    this.stats.stages.htmlPolish = {
      complete: true,
      changes: changes.length,
      changesSummary: changes
    };

    this.log(`HTML polish complete: ${changes.length} improvements`);
    changes.forEach(c => this.log(`  - ${c.reason}`));

    return polishedHtml;
  }

  /**
   * Run the full pipeline
   */
  async run(intakePath, measurementsPath, outputPath, options = {}) {
    this.stats.startTime = Date.now();

    try {
      // Stage 1: Load intake
      const intake = this.loadIntake(intakePath);

      // Stage 2: Load measurements
      const measurements = this.loadMeasurements(measurementsPath);

      // Stage 3: Transform
      let reportJson = this.transformToReport(intake, measurements);

      // Stage 4: LLM fill
      reportJson = await this.fillNarratives(reportJson);

      // Stage 5: Validate
      this.validateFinal(reportJson);

      // Stage 6: Render
      const html = this.render(reportJson, outputPath);

      // Stage 7: HTML polish pass
      if (!options.skipHtmlPolish) {
        await this.polishHTMLPass(html, outputPath);
      }

      // Save intermediate JSON if requested
      if (options.saveJson) {
        const jsonPath = outputPath.replace(/\.html$/, '.json');
        fs.writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2));
        this.log(`Saved JSON: ${jsonPath}`);

        // Save polish log for review if any fixes were applied
        if (this.stats.polishLog?.length > 0) {
          const polishLogPath = outputPath.replace(/\.html$/, '_polish_log.json');
          fs.writeFileSync(polishLogPath, JSON.stringify(this.stats.polishLog, null, 2));
          this.log(`Saved polish log: ${polishLogPath}`);
        }

        // Save HTML polish changes if any
        if (this.stats.stages.htmlPolish?.changesSummary?.length > 0) {
          const htmlPolishLogPath = outputPath.replace(/\.html$/, '_html_polish_log.json');
          fs.writeFileSync(htmlPolishLogPath, JSON.stringify(this.stats.stages.htmlPolish.changesSummary, null, 2));
          this.log(`Saved HTML polish log: ${htmlPolishLogPath}`);
        }
      }

      // Stage 8: Generate PDF (unless skipped)
      if (!options.skipPDF && !this.config.skipPDF) {
        await this.generatePDF(outputPath);
      }

      this.stats.endTime = Date.now();
      this.stats.duration = this.stats.endTime - this.stats.startTime;

      this.log(`Pipeline complete in ${this.stats.duration}ms`);
      return { success: true, stats: this.stats, reportJson };

    } catch (err) {
      this.stats.endTime = Date.now();
      this.stats.error = err.message;
      this.log(`Pipeline failed: ${err.message}`, 'error');
      return { success: false, stats: this.stats, error: err };
    }
  }

  /**
   * Run transform only (no LLM, no render)
   */
  transformOnly(intakePath, measurementsPath, outputJsonPath) {
    const intake = this.loadIntake(intakePath);
    const measurements = this.loadMeasurements(measurementsPath);
    const reportJson = this.transformToReport(intake, measurements);

    fs.writeFileSync(outputJsonPath, JSON.stringify(reportJson, null, 2));
    this.log(`Saved draft JSON: ${outputJsonPath}`);

    return reportJson;
  }

  /**
   * Extract intake + measurements from unstructured text
   */
  async extract(infoDumpPath, options = {}) {
    this.log(`Loading info dump from ${infoDumpPath}`);
    const rawText = fs.readFileSync(infoDumpPath, 'utf8');

    const extractor = new Extractor({
      apiKey: this.config.geminiApiKey || process.env.GEMINI_API_KEY,
      groqApiKey: process.env.GROQ_API_KEY,
      verbose: this.config.verbose,
      useGroq: this.config.useGroq
    });

    const { intake, measurements } = await extractor.extract(rawText);

    this.stats.stages.extract = {
      complete: true,
      tokensUsed: extractor.getStats().tokensUsed,
      client: intake.prepared_for?.account_name,
      workflow: intake.section_a_workflow_definition?.q01_workflow_name,
      measurementCount: measurements.measurements?.length || 0
    };

    // Save intermediate files if requested
    if (options.outputDir) {
      // Generate unique identifiable filenames with client slug and timestamp
      const clientSlug = this.slugify(intake.prepared_for?.account_name || 'unknown');
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

      const intakePath = path.join(options.outputDir, `intake_${clientSlug}_${timestamp}.json`);
      const measurementsPath = path.join(options.outputDir, `measurements_${clientSlug}_${timestamp}.json`);

      fs.writeFileSync(intakePath, JSON.stringify(intake, null, 2));
      fs.writeFileSync(measurementsPath, JSON.stringify(measurements, null, 2));

      this.log(`Saved: ${intakePath}`);
      this.log(`Saved: ${measurementsPath}`);

      // Store paths for later reference
      this.stats.stages.extract.intakePath = intakePath;
      this.stats.stages.extract.measurementsPath = measurementsPath;
    }

    return { intake, measurements };
  }

  /**
   * Generate report from unstructured info dump (full pipeline)
   * Info Dump → Extract → Transform → LLM Fill → Validate → Render → HTML Polish
   */
  async generate(infoDumpPath, outputPath, options = {}) {
    this.stats.startTime = Date.now();

    try {
      // Stage 0: Extract from info dump
      const { intake, measurements } = await this.extract(infoDumpPath, {
        outputDir: options.saveJson ? path.dirname(outputPath) : null
      });

      // Validate extracted data
      const intakeValidation = validateIntake(intake);
      if (!intakeValidation.valid) {
        this.log('Extracted intake validation failed:', 'error');
        console.error(formatErrors(intakeValidation));
        throw new Error('Extracted intake validation failed');
      }

      const measurementsValidation = validateMeasurements(measurements);
      if (!measurementsValidation.valid) {
        this.log('Extracted measurements validation failed:', 'error');
        console.error(formatErrors(measurementsValidation));
        throw new Error('Extracted measurements validation failed');
      }

      // Stage 1: Transform
      let reportJson = this.transformToReport(intake, measurements);

      // Stage 2: LLM fill
      reportJson = await this.fillNarratives(reportJson);

      // Stage 3: Validate
      this.validateFinal(reportJson);

      // Stage 4: Render
      const html = this.render(reportJson, outputPath);

      // Stage 5: HTML polish pass
      if (!options.skipHtmlPolish) {
        await this.polishHTMLPass(html, outputPath);
      }

      // Save intermediate JSON if requested
      if (options.saveJson) {
        const jsonPath = outputPath.replace(/\.html$/, '.json');
        fs.writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2));
        this.log(`Saved JSON: ${jsonPath}`);

        // Save HTML polish changes if any
        if (this.stats.stages.htmlPolish?.changesSummary?.length > 0) {
          const htmlPolishLogPath = outputPath.replace(/\.html$/, '_html_polish_log.json');
          fs.writeFileSync(htmlPolishLogPath, JSON.stringify(this.stats.stages.htmlPolish.changesSummary, null, 2));
          this.log(`Saved HTML polish log: ${htmlPolishLogPath}`);
        }
      }

      // Stage 6: Generate PDF (unless skipped)
      if (!options.skipPDF && !this.config.skipPDF) {
        await this.generatePDF(outputPath);
      }

      this.stats.endTime = Date.now();
      this.stats.duration = this.stats.endTime - this.stats.startTime;

      this.log(`Pipeline complete in ${this.stats.duration}ms`);
      return { success: true, stats: this.stats, reportJson };

    } catch (err) {
      this.stats.endTime = Date.now();
      this.stats.error = err.message;
      this.log(`Pipeline failed: ${err.message}`, 'error');
      return { success: false, stats: this.stats, error: err };
    }
  }
}

/**
 * CLI entry point
 */
export async function cli(args) {
  const [command, ...rest] = args;

  const usage = `
AI Audit Report Pipeline

Commands:
  generate <info_dump.txt> <output.html>
    ⭐ RECOMMENDED: Generate report from unstructured text
    Flow: Info Dump → Extract → Transform → Fill → Validate → Render

  extract <info_dump.txt> [--output-dir <dir>]
    Extract structured JSON from unstructured text
    Outputs: intake_extracted.json, measurements_extracted.json

  transform <intake.json> <measurements.json> <output.json>
    Transform intake + measurements to report JSON (with placeholders)

  validate <report.json>
    Validate report JSON against schema

  render <report.json> <output.html>
    Render report JSON to HTML

  full <intake.json> <measurements.json> <output.html>
    Run full pipeline from structured JSON: transform → fill → validate → render

Options:
  --skip-pdf     Skip PDF generation (HTML only)
  --use-groq     Use Groq API directly (skip Gemini when quotas exhausted)
  --save-json    Save intermediate JSON files alongside output
  --verbose      Show detailed progress

Examples:
  node cli.js generate notes.txt report.html
  node cli.js generate notes.txt report.html --save-json
  node cli.js extract interview.txt --output-dir ./extracted/
`;

  if (!command || command === '--help' || command === '-h') {
    console.log(usage);
    return;
  }

  const pipeline = new Pipeline({
    skipPDF: rest.includes('--skip-pdf'),
    useGroq: rest.includes('--use-groq'),
    skipRefinement: rest.includes('--skip-refinement'),
    dryRun: rest.includes('--dry-run'),
    verbose: true
  });

  const paths = rest.filter(r => !r.startsWith('--'));

  switch (command) {
    case 'generate':
      if (paths.length < 2) {
        console.error('Usage: generate <info_dump.txt> <output.html>');
        process.exit(1);
      }
      await pipeline.generate(paths[0], paths[1], {
        skipPDF: rest.includes('--skip-pdf'),
        saveJson: rest.includes('--save-json')
      });
      break;

    case 'extract':
      if (paths.length < 1) {
        console.error('Usage: extract <info_dump.txt> [--output-dir <dir>]');
        process.exit(1);
      }
      const outputDirIdx = rest.indexOf('--output-dir');
      const outputDir = outputDirIdx >= 0 ? rest[outputDirIdx + 1] : '.';
      await pipeline.extract(paths[0], { outputDir });
      break;

    case 'transform':
      if (paths.length < 3) {
        console.error('Usage: transform <intake.json> <measurements.json> <output.json>');
        process.exit(1);
      }
      pipeline.transformOnly(paths[0], paths[1], paths[2]);
      break;

    case 'validate':
      if (paths.length < 1) {
        console.error('Usage: validate <report.json>');
        process.exit(1);
      }
      const reportJson = JSON.parse(fs.readFileSync(paths[0], 'utf8'));
      const result = validateReport(reportJson, { allowPlaceholders: true });
      console.log(formatErrors(result));
      console.log(`\nValid: ${result.valid}`);
      break;

    case 'render':
      if (paths.length < 2) {
        console.error('Usage: render <report.json> <output.html>');
        process.exit(1);
      }
      const report = JSON.parse(fs.readFileSync(paths[0], 'utf8'));
      pipeline.render(report, paths[1]);
      break;

    case 'full':
      if (paths.length < 3) {
        console.error('Usage: full <intake.json> <measurements.json> <output.html>');
        process.exit(1);
      }
      await pipeline.run(paths[0], paths[1], paths[2], {
        saveJson: rest.includes('--save-json')
      });
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log(usage);
      process.exit(1);
  }
}

export default { Pipeline, cli };
