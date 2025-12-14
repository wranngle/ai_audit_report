/**
 * run_pipeline_test.js - Test the full pipeline with existing test data
 *
 * Usage: node test_run/run_pipeline_test.js
 */

import { Pipeline } from '../lib/pipeline.js';
import { validateReport, validateIntake, validateMeasurements, formatErrors } from '../lib/validate.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runTests() {
  console.log('='.repeat(60));
  console.log('AI AUDIT PIPELINE TEST SUITE');
  console.log('='.repeat(60));
  console.log();

  let passed = 0;
  let failed = 0;

  // Test 1: Validate intake packet
  console.log('TEST 1: Validate Intake Packet');
  console.log('-'.repeat(40));
  try {
    const intake = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'intake_packet_filled.json'), 'utf8'
    ));
    const result = validateIntake(intake);
    if (result.valid) {
      console.log('✓ Intake validation passed');
      passed++;
    } else {
      console.log('✗ Intake validation failed');
      console.log(formatErrors(result));
      failed++;
    }
  } catch (err) {
    console.log('✗ Intake test error:', err.message);
    failed++;
  }
  console.log();

  // Test 2: Validate measurements
  console.log('TEST 2: Validate Measurements');
  console.log('-'.repeat(40));
  try {
    const measurements = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'measurements_extracted.json'), 'utf8'
    ));
    const result = validateMeasurements(measurements);
    if (result.valid) {
      console.log('✓ Measurements validation passed');
      if (result.warnings.length > 0) {
        console.log(`  (${result.warnings.length} warnings)`);
      }
      passed++;
    } else {
      console.log('✗ Measurements validation failed');
      console.log(formatErrors(result));
      failed++;
    }
  } catch (err) {
    console.log('✗ Measurements test error:', err.message);
    failed++;
  }
  console.log();

  // Test 3: Transform pipeline
  console.log('TEST 3: Transform Pipeline');
  console.log('-'.repeat(40));
  try {
    const pipeline = new Pipeline({ verbose: false });
    const intake = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'intake_packet_filled.json'), 'utf8'
    ));
    const measurements = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'measurements_extracted.json'), 'utf8'
    ));

    const { transform, getLLMPlaceholders } = await import('../lib/transform.js');
    const reportJson = transform(intake, measurements);
    const placeholders = getLLMPlaceholders(reportJson);

    console.log(`✓ Transform produced ${placeholders.length} LLM placeholders`);
    console.log(`  Client: ${reportJson.prepared_for?.account_name}`);
    console.log(`  Workflow: ${reportJson.audit?.workflows?.[0]?.name}`);
    console.log(`  Bleed: ${reportJson.bleed?.total?.display}`);
    passed++;
  } catch (err) {
    console.log('✗ Transform test error:', err.message);
    failed++;
  }
  console.log();

  // Test 4: Validate existing hand-crafted report
  console.log('TEST 4: Validate Hand-Crafted Report');
  console.log('-'.repeat(40));
  try {
    const report = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'report_instance.json'), 'utf8'
    ));
    const result = validateReport(report, { allowPlaceholders: true });
    if (result.valid) {
      console.log('✓ Report validation passed');
      passed++;
    } else {
      console.log('✗ Report validation failed');
      console.log(formatErrors(result));
      failed++;
    }
  } catch (err) {
    console.log('✗ Report validation error:', err.message);
    failed++;
  }
  console.log();

  // Test 5: Full pipeline (skip LLM)
  console.log('TEST 5: Full Pipeline (skip LLM)');
  console.log('-'.repeat(40));
  try {
    const pipeline = new Pipeline({
      skipLLM: true,
      allowPlaceholders: true,
      verbose: false
    });

    const result = await pipeline.run(
      path.join(__dirname, 'intake_packet_filled.json'),
      path.join(__dirname, 'measurements_extracted.json'),
      path.join(__dirname, 'output_pipeline_test.html'),
      { saveJson: true }
    );

    if (result.success) {
      console.log('✓ Full pipeline completed');
      console.log(`  Duration: ${result.stats.duration}ms`);
      console.log(`  Output: ${result.stats.stages.render?.outputPath}`);
      passed++;
    } else {
      console.log('✗ Pipeline failed:', result.error?.message);
      failed++;
    }
  } catch (err) {
    console.log('✗ Pipeline test error:', err.message);
    failed++;
  }
  console.log();

  // Summary
  console.log('='.repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
