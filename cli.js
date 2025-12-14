#!/usr/bin/env node
/**
 * AI Audit Pipeline CLI
 *
 * Usage:
 *   node cli.js generate <info_dump.txt> <output.html> [--skip-llm] [--save-json]
 *   node cli.js extract <info_dump.txt> [--output-dir <dir>]
 *   node cli.js transform <intake.json> <measurements.json> <output.json>
 *   node cli.js validate <report.json>
 *   node cli.js render <report.json> <output.html>
 *   node cli.js full <intake.json> <measurements.json> <output.html> [--skip-llm] [--save-json]
 */

import 'dotenv/config';
import { cli } from './lib/pipeline.js';

cli(process.argv.slice(2));
