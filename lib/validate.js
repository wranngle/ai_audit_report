/**
 * validate.js - JSON Schema validation layer using AJV
 *
 * Validates report JSON against the big_json_schema.json schema.
 * Also provides custom validation for business rules not expressible in JSON Schema.
 *
 * Usage:
 *   import { validateReport, validateIntake, validateMeasurements } from './lib/validate.js';
 *   const result = validateReport(reportJson);
 *   if (!result.valid) console.error(result.errors);
 */

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize AJV with draft-2020-12 support
const ajv = new Ajv2020({
  allErrors: true,          // Report all errors, not just first
  verbose: true,            // Include schema and data in errors
  strict: false,            // Allow additional keywords
  allowUnionTypes: true     // Allow union types
});

// Add format validators (date-time, uri, email, etc.)
addFormats(ajv);

// Load schemas
let reportSchema = null;
let intakeSchema = null;

/**
 * Load the report schema (lazy loading)
 */
function getReportSchema() {
  if (!reportSchema) {
    const schemaPath = path.join(__dirname, '..', 'big_json_schema.json');
    reportSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  }
  return reportSchema;
}

/**
 * Intake packet schema (inline since it's simpler)
 */
function getIntakeSchema() {
  if (!intakeSchema) {
    intakeSchema = {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "Intake Packet",
      "type": "object",
      "required": ["intake_version", "captured_at", "prepared_for", "section_a_workflow_definition"],
      "properties": {
        "intake_version": { "type": "string" },
        "captured_at": { "type": "string", "format": "date-time" },
        "captured_by": { "type": "string" },
        "prepared_for": {
          "type": "object",
          "required": ["account_name"],
          "properties": {
            "account_id": { "type": "string" },
            "account_name": { "type": "string" }
          }
        },
        "section_a_workflow_definition": {
          "type": "object",
          "required": ["q01_workflow_name", "q02_trigger_event"],
          "properties": {
            "q01_workflow_name": { "type": "string", "minLength": 1 },
            "q02_trigger_event": { "type": "string", "minLength": 1 },
            "q03_business_objective": { "type": "string" },
            "q04_end_condition": { "type": "string" },
            "q05_outcome_owner": { "type": "string" }
          }
        },
        "section_b_volume_timing": {
          "type": "object",
          "properties": {
            "q06_runs_per_period": { "type": "string" },
            "q06_period_unit": { "type": "string" },
            "q07_avg_trigger_to_end": { "type": "string" },
            "q07_time_unit": { "type": "string" },
            "q08_worst_case_delay": { "type": "string" },
            "q08_delay_unit": { "type": "string" },
            "q09_business_hours_expected": { "type": "string" }
          }
        },
        "section_c_systems_handoffs": {
          "type": "object",
          "properties": {
            "q10_systems_involved": { "type": "array", "items": { "type": "string" } },
            "q11_manual_data_transfers": { "type": "string" },
            "q12_human_decision_gates": { "type": "string" }
          }
        },
        "section_d_failure_cost": {
          "type": "object",
          "properties": {
            "q13_common_failures": { "type": "string" },
            "q14_cost_if_slow_or_failed": { "type": "string" }
          }
        },
        "section_e_priority": {
          "type": "object",
          "properties": {
            "q15_one_thing_to_fix": { "type": "string" }
          }
        },
        "attachments": {
          "type": "object",
          "properties": {
            "evidence_uris": { "type": "array", "items": { "type": "string" } },
            "notes": { "type": "string" }
          }
        }
      }
    };
  }
  return intakeSchema;
}

/**
 * Measurements schema (inline)
 */
function getMeasurementsSchema() {
  return {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "Measurements Extraction",
    "type": "object",
    "required": ["measurements"],
    "properties": {
      "measurements": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "required": ["id", "name", "value", "value_display"],
          "properties": {
            "id": { "type": "string" },
            "name": { "type": "string" },
            "metric_type": { "type": "string", "enum": ["latency", "error_rate", "quality", "complexity", "volume", "cost"] },
            "value": { "type": "number" },
            "unit": { "type": "string" },
            "value_display": { "type": "string" },
            "source": { "type": "string" },
            "status": { "type": ["string", "null"], "enum": ["critical", "warning", "healthy", null] },
            "status_reason": { "type": ["string", "null"] },
            "threshold": {
              "type": ["object", "null"],
              "properties": {
                "target": { "type": ["number", "null"] },
                "target_display": { "type": ["string", "null"] },
                "healthy_max": { "type": ["number", "null"] },
                "warning_max": { "type": ["number", "null"] },
                "direction": { "type": ["string", "null"], "enum": ["lower_is_better", "higher_is_better", null] }
              }
            },
            "evidence": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "type": { "type": "string" },
                  "summary": { "type": "string" }
                }
              }
            }
          }
        }
      },
      "bleed_assumptions": { "type": "array" },
      "bleed_calculations": { "type": "array" },
      "bleed_total": {
        "type": "object",
        "required": ["value"],
        "properties": {
          "value": { "type": "number" },
          "currency": { "type": "string" },
          "period": { "type": "string" },
          "display": { "type": "string" }
        }
      }
    }
  };
}

/**
 * Custom business rules validation
 */
function validateBusinessRules(reportJson) {
  const errors = [];

  // Rule 1: Bleed total must match sum of breakdown items
  if (reportJson.bleed?.breakdown && reportJson.bleed?.total) {
    const breakdownSum = reportJson.bleed.breakdown.reduce(
      (sum, item) => sum + (item.amount?.amount || 0), 0
    );
    if (Math.abs(breakdownSum - reportJson.bleed.total.amount) > 0.01) {
      errors.push({
        rule: 'bleed_sum_mismatch',
        message: `Bleed breakdown sum (${breakdownSum}) does not match total (${reportJson.bleed.total.amount})`,
        path: 'bleed.total.amount'
      });
    }
  }

  // Rule 2: At least one critical finding should have a corresponding fix
  const criticalRows = reportJson.scorecard?.rows?.filter(r => r.status === 'critical') || [];
  const criticalMeasurementIds = criticalRows.flatMap(r => r.measurement_ids || []);
  const fixMeasurementIds = reportJson.fixes?.items?.flatMap(f => f.related_measurement_ids || []) || [];

  criticalMeasurementIds.forEach(mid => {
    if (!fixMeasurementIds.includes(mid)) {
      errors.push({
        rule: 'critical_without_fix',
        message: `Critical measurement ${mid} has no corresponding fix`,
        path: `fixes.items`,
        severity: 'warning'
      });
    }
  });

  // Rule 3: Quick win fix should exist if fixes are present
  if (reportJson.fixes?.items?.length > 0 && !reportJson.fixes?.quick_win_fix_id) {
    errors.push({
      rule: 'missing_quick_win',
      message: 'Fixes present but no quick_win_fix_id specified',
      path: 'fixes.quick_win_fix_id',
      severity: 'warning'
    });
  }

  // Rule 4: Executive summary should not contain LLM placeholders in final output
  if (reportJson.scorecard?.executive_summary?.body?.includes('[LLM_PLACEHOLDER')) {
    errors.push({
      rule: 'unresolved_placeholder',
      message: 'Executive summary contains unresolved LLM placeholder',
      path: 'scorecard.executive_summary.body',
      severity: 'error'
    });
  }

  // Rule 5: Math defender text should not contain placeholders
  if (reportJson.bleed?.math_defender_text?.includes('[LLM_PLACEHOLDER')) {
    errors.push({
      rule: 'unresolved_placeholder',
      message: 'Math defender text contains unresolved LLM placeholder',
      path: 'bleed.math_defender_text',
      severity: 'error'
    });
  }

  return errors;
}

/**
 * Check for LLM placeholders in the report
 */
function findUnresolvedPlaceholders(reportJson) {
  const placeholders = [];

  function search(obj, path = '') {
    if (typeof obj === 'string' && obj.includes('[LLM_PLACEHOLDER')) {
      placeholders.push({ path, value: obj });
    } else if (Array.isArray(obj)) {
      obj.forEach((item, idx) => search(item, `${path}[${idx}]`));
    } else if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([key, value]) => {
        search(value, path ? `${path}.${key}` : key);
      });
    }
  }

  search(reportJson);
  return placeholders;
}

/**
 * Validate a report JSON against the schema
 * @param {Object} reportJson - The report to validate
 * @param {Object} options - Validation options
 * @returns {Object} { valid: boolean, errors: Array, warnings: Array, placeholders: Array }
 */
export function validateReport(reportJson, options = {}) {
  const {
    allowPlaceholders = false,   // Allow LLM placeholders (for draft validation)
    strictBusinessRules = true   // Enforce business rules
  } = options;

  const schema = getReportSchema();
  const validate = ajv.compile(schema);
  const schemaValid = validate(reportJson);

  const result = {
    valid: schemaValid,
    errors: [],
    warnings: [],
    placeholders: []
  };

  // Collect schema errors
  if (!schemaValid && validate.errors) {
    result.errors = validate.errors.map(err => ({
      type: 'schema',
      path: err.instancePath,
      message: err.message,
      params: err.params
    }));
  }

  // Check for unresolved placeholders
  result.placeholders = findUnresolvedPlaceholders(reportJson);
  if (!allowPlaceholders && result.placeholders.length > 0) {
    result.valid = false;
    result.placeholders.forEach(p => {
      result.errors.push({
        type: 'placeholder',
        path: p.path,
        message: `Unresolved LLM placeholder: ${p.value}`
      });
    });
  }

  // Business rules validation
  if (strictBusinessRules) {
    const businessErrors = validateBusinessRules(reportJson);
    businessErrors.forEach(err => {
      if (err.severity === 'warning') {
        result.warnings.push(err);
      } else {
        result.errors.push({ type: 'business_rule', ...err });
        result.valid = false;
      }
    });
  }

  return result;
}

/**
 * Validate an intake packet
 */
export function validateIntake(intakeJson) {
  const schema = getIntakeSchema();
  const validate = ajv.compile(schema);
  const valid = validate(intakeJson);

  return {
    valid,
    errors: valid ? [] : validate.errors.map(err => ({
      type: 'schema',
      path: err.instancePath,
      message: err.message,
      params: err.params
    })),
    warnings: [],
    placeholders: []
  };
}

/**
 * Validate measurements extraction
 */
export function validateMeasurements(measurementsJson) {
  const schema = getMeasurementsSchema();
  const validate = ajv.compile(schema);
  const valid = validate(measurementsJson);

  const result = {
    valid,
    errors: valid ? [] : validate.errors.map(err => ({
      type: 'schema',
      path: err.instancePath,
      message: err.message,
      params: err.params
    })),
    warnings: [],
    placeholders: []
  };

  // Additional checks
  if (measurementsJson.measurements) {
    measurementsJson.measurements.forEach((m, idx) => {
      // Check for missing evidence
      if (!m.evidence || m.evidence.length === 0) {
        result.warnings.push({
          type: 'missing_evidence',
          path: `measurements[${idx}].evidence`,
          message: `Measurement "${m.name}" has no evidence records`
        });
      }

      // Check for missing threshold
      if (!m.threshold) {
        result.warnings.push({
          type: 'missing_threshold',
          path: `measurements[${idx}].threshold`,
          message: `Measurement "${m.name}" has no threshold defined`
        });
      }
    });
  }

  return result;
}

/**
 * Format validation errors for display
 */
export function formatErrors(validationResult) {
  const lines = [];

  if (validationResult.errors.length > 0) {
    lines.push('ERRORS:');
    validationResult.errors.forEach((err, idx) => {
      lines.push(`  ${idx + 1}. [${err.type}] ${err.path}: ${err.message}`);
    });
  }

  if (validationResult.warnings.length > 0) {
    lines.push('WARNINGS:');
    validationResult.warnings.forEach((warn, idx) => {
      lines.push(`  ${idx + 1}. [${warn.type || warn.rule}] ${warn.path}: ${warn.message}`);
    });
  }

  if (validationResult.placeholders.length > 0) {
    lines.push(`PLACEHOLDERS: ${validationResult.placeholders.length} unresolved`);
    validationResult.placeholders.forEach(p => {
      lines.push(`  - ${p.path}`);
    });
  }

  return lines.join('\n');
}

export default {
  validateReport,
  validateIntake,
  validateMeasurements,
  formatErrors
};
