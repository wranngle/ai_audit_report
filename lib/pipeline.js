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
import { slugify, generateOutputPath, generateRelatedPaths, ensureDir } from './file_utils.js';

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
   * Convert string to URL-safe slug (uses shared file_utils)
   */
  slugify(text) {
    return slugify(text, 30);
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
   * Generate organized output path for a report
   * If outputPath is a directory or ends with / or \, auto-generates filename
   * Otherwise uses the provided path but organizes into company/project subdirs
   *
   * @param {Object} reportJson - The report JSON (for extracting company/project)
   * @param {string} outputPath - User-provided output path
   * @param {Object} options - Additional options
   * @returns {string} Final output path
   */
  resolveOutputPath(reportJson, outputPath, options = {}) {
    const company = reportJson.prepared_for?.account_name || 'unknown';
    const workflow = reportJson.scorecard?.categories?.[0]?.category_name || null;
    const baseOutputDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'output');

    // Check if outputPath is a directory (ends with / or \ or is existing dir)
    const isDirectory = outputPath.endsWith('/') || outputPath.endsWith('\\') ||
                        (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory());

    if (isDirectory || !outputPath) {
      // Auto-generate organized path
      const outputDir = outputPath || baseOutputDir;
      const result = generateOutputPath({
        outputDir,
        type: 'audit',
        company,
        project: workflow,
        ext: 'html'
      });
      return result.path;
    }

    // User provided a specific filename - organize into company subfolder
    if (options.organize !== false) {
      const dir = path.dirname(outputPath);
      const filename = path.basename(outputPath);
      const companySlug = slugify(company);
      const organizedDir = path.join(dir, companySlug);
      ensureDir(organizedDir);
      return path.join(organizedDir, filename);
    }

    return outputPath;
  }

  /**
   * Stage 6: Render to HTML
   */
  render(reportJson, outputPath) {
    this.log(`Rendering to ${outputPath}...`);

    const template = fs.readFileSync(this.config.templatePath, 'utf8');
    const html = Mustache.render(template, reportJson);

    // Ensure output directory exists
    ensureDir(path.dirname(outputPath));

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
      // Generate organized output paths using file_utils
      const company = intake.prepared_for?.account_name || 'unknown';
      const workflow = intake.section_a_workflow_definition?.q01_workflow_name;

      const intakeOutput = generateOutputPath({
        outputDir: options.outputDir,
        type: 'intake',
        company,
        project: workflow,
        ext: 'json'
      });

      const measurementsOutput = generateOutputPath({
        outputDir: options.outputDir,
        type: 'measurements',
        company,
        project: workflow,
        ext: 'json'
      });

      fs.writeFileSync(intakeOutput.path, JSON.stringify(intake, null, 2));
      fs.writeFileSync(measurementsOutput.path, JSON.stringify(measurements, null, 2));

      this.log(`Saved: ${intakeOutput.path}`);
      this.log(`Saved: ${measurementsOutput.path}`);

      // Store paths for later reference
      this.stats.stages.extract.intakePath = intakeOutput.path;
      this.stats.stages.extract.measurementsPath = measurementsOutput.path;
    }

    return { intake, measurements };
  }

  /**
   * Generate report from unstructured info dump (full pipeline)
   * Info Dump → Extract → Transform → LLM Fill → Validate → Render → HTML Polish
   *
   * Output is organized by company/project in the output directory:
   *   output/{company}/{project}/audit_{company}_{project}_{timestamp}.html
   */
  async generate(infoDumpPath, outputPath, options = {}) {
    this.stats.startTime = Date.now();

    try {
      // Stage 0: Extract from info dump
      const { intake, measurements } = await this.extract(infoDumpPath, {
        outputDir: options.saveJson ? (options.outputDir || './output') : null
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

      // Resolve output path (organize by company/project)
      const finalOutputPath = this.resolveOutputPath(reportJson, outputPath, {
        organize: options.organize !== false
      });

      // Stage 4: Render
      const html = this.render(reportJson, finalOutputPath);

      // Stage 5: HTML polish pass
      if (!options.skipHtmlPolish) {
        await this.polishHTMLPass(html, finalOutputPath);
      }

      // Generate related file paths
      const relatedPaths = generateRelatedPaths(finalOutputPath, ['json', 'pdf'], ['_polish_log']);

      // Save intermediate JSON if requested
      if (options.saveJson) {
        fs.writeFileSync(relatedPaths.json, JSON.stringify(reportJson, null, 2));
        this.log(`Saved JSON: ${relatedPaths.json}`);

        // Save HTML polish changes if any
        if (this.stats.stages.htmlPolish?.changesSummary?.length > 0) {
          fs.writeFileSync(relatedPaths.polishlog, JSON.stringify(this.stats.stages.htmlPolish.changesSummary, null, 2));
          this.log(`Saved HTML polish log: ${relatedPaths.polishlog}`);
        }
      }

      // Stage 6: Generate PDF (unless skipped)
      if (!options.skipPDF && !this.config.skipPDF) {
        await this.generatePDF(finalOutputPath);
      }

      this.stats.endTime = Date.now();
      this.stats.duration = this.stats.endTime - this.stats.startTime;

      this.log(`Pipeline complete in ${this.stats.duration}ms`);
      return { success: true, stats: this.stats, reportJson, outputPath: finalOutputPath };

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
  generate <input> [output]
    ⭐ RECOMMENDED: Generate report from unstructured text
    Flow: Info Dump → Extract → Transform → Fill → Validate → Render

  extract <input> [-o <dir>]
    Extract structured JSON from unstructured text

  transform <intake.json> <measurements.json> <output.json>
    Transform intake + measurements to report JSON

  validate <report.json>
    Validate report JSON against schema

  render <report.json> <output.html>
    Render report JSON to HTML

Options:
  -o, --output   Output directory or file
  --skip-pdf     Skip PDF generation
  --use-groq     Use Groq API
  --save-json    Save intermediate JSON

Examples:
  node cli.js generate notes.txt
  node cli.js generate notes.txt -o ./output/
  node cli.js generate notes.txt report.html --save-json
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

  // Parse -o/--output option first
  const outputIdx = rest.findIndex(r => r === '-o' || r === '--output');
  const outputOpt = outputIdx >= 0 ? rest[outputIdx + 1] : null;

  // Filter paths (exclude flags and their values)
  const paths = rest.filter((r, i) => {
    if (r.startsWith('-')) return false;
    // Exclude the value after -o/--output
    if (outputIdx >= 0 && i === outputIdx + 1) return false;
    return true;
  });

  switch (command) {
    case 'generate':
      if (paths.length < 1) {
        console.error('Usage: generate <input> [output] [-o <dir>]');
        process.exit(1);
      }
      const genOutput = outputOpt || paths[1] || './output/';
      await pipeline.generate(paths[0], genOutput, {
        skipPDF: rest.includes('--skip-pdf'),
        saveJson: rest.includes('--save-json')
      });
      break;

    case 'extract':
      if (paths.length < 1) {
        console.error('Usage: extract <input> [-o <dir>]');
        process.exit(1);
      }
      const extractDir = outputOpt || '.';
      await pipeline.extract(paths[0], { outputDir: extractDir });
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
