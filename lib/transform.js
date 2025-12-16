/**
 * transform.js - Converts Intake Packet + Measurements to Report JSON
 *
 * This is the deterministic transformation layer. It does NOT generate
 * narrative content - that's handled by the LLM executor.
 *
 * Usage:
 *   import { transform } from './lib/transform.js';
 *   const reportJson = transform(intakePacket, measurements, config);
 */

import { randomUUID } from 'crypto';

/**
 * Default configuration for the transformer
 */
const DEFAULT_CONFIG = {
  producer: {
    name: "",
    email: "audit@wranngle.com",
    company: "Wranngle Systems LLC"
  },
  brand: {
    brand_name: "Wranngle Systems LLC",
    logo_uri: "https://i.ibb.co/sdfPMCVx/wranngle-color-transparent.png",
    primary_domain: "wranngle.com"
  },
  offer: {
    sku_code: "WR-AI-AUDIT-100",
    sku_name: "AI Process Audit (Phase 1)",
    display_in_footer: true
  },
  cta: {
    link: "https://calendly.com/wranngle",
    link_display: "calendly.com/wranngle",
    call_duration_minutes: 30
  },
  rendering: {
    mode: "conversion",
    page_size: "letter",
    margins: { top: 0.35, right: 0.35, bottom: 0.45, left: 0.35 },
    max_pages: 1
  }
};

/**
 * Format a date for display
 */
function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Get year from ISO string
 */
function getYear(isoString) {
  return new Date(isoString).getFullYear().toString();
}

/**
 * Determine status from measurement thresholds
 */
function deriveStatus(measurement) {
  if (measurement.status) return measurement.status;

  const threshold = measurement.threshold;
  if (!threshold) return 'warning';

  const value = measurement.value;
  const direction = threshold.direction || 'lower_is_better';

  if (direction === 'lower_is_better') {
    if (value <= threshold.healthy_max) return 'healthy';
    if (value <= threshold.warning_max) return 'warning';
    return 'critical';
  } else {
    if (value >= threshold.healthy_min) return 'healthy';
    if (value >= threshold.warning_min) return 'warning';
    return 'critical';
  }
}

/**
 * Build systems_involved from intake
 */
function buildSystemsInvolved(intake) {
  const systems = intake.section_c_systems_handoffs?.q10_systems_involved || [];
  return systems.map((name, idx) => ({
    system_name: name.split('(')[0].trim(),
    system_type: inferSystemType(name),
    environment: "prod"
  }));
}

/**
 * Infer system type from name
 * Valid enum values: crm, marketing_automation, email, sms, forms,
 * call_tracking, ticketing, spreadsheet, database, payment, calendar, custom_app, other
 */
function inferSystemType(name) {
  const lower = name.toLowerCase();
  if (lower.includes('crm') || lower.includes('hubspot') || lower.includes('salesforce')) return 'crm';
  if (lower.includes('email') || lower.includes('outlook') || lower.includes('gmail') || lower.includes('mail')) return 'email';
  if (lower.includes('calendar') || lower.includes('google calendar') || lower.includes('outlook calendar')) return 'calendar';
  if (lower.includes('excel') || lower.includes('spreadsheet') || lower.includes('sheets') || lower.includes('airtable')) return 'spreadsheet';
  if (lower.includes('phone') || lower.includes('call') || lower.includes('twilio') || lower.includes('ringcentral')) return 'call_tracking';
  if (lower.includes('portal') || lower.includes('app')) return 'custom_app';
  if (lower.includes('ticket') || lower.includes('zendesk') || lower.includes('freshdesk')) return 'ticketing';
  if (lower.includes('sms') || lower.includes('text')) return 'sms';
  if (lower.includes('form') || lower.includes('typeform') || lower.includes('jotform')) return 'forms';
  if (lower.includes('database') || lower.includes('sql') || lower.includes('postgres') || lower.includes('mysql')) return 'database';
  if (lower.includes('payment') || lower.includes('stripe') || lower.includes('paypal')) return 'payment';
  if (lower.includes('marketing') || lower.includes('mailchimp') || lower.includes('klaviyo')) return 'marketing_automation';
  return 'other';
}

/**
 * Build workflow steps from intake
 */
function buildWorkflowSteps(intake) {
  const steps = [];
  let seq = 1;

  // Step 1: Trigger (automation)
  steps.push({
    step_id: `step-${seq}`,
    sequence: seq++,
    name: intake.section_a_workflow_definition?.q02_trigger_event || "Trigger event",
    owner_type: "automation"
  });

  // Parse manual transfers for additional steps
  const manualTransfers = intake.section_c_systems_handoffs?.q11_manual_data_transfers || "";
  if (manualTransfers) {
    steps.push({
      step_id: `step-${seq}`,
      sequence: seq++,
      name: "Manual data transfer",
      owner_type: "human"
    });
  }

  // Human decision gates
  const humanGates = intake.section_c_systems_handoffs?.q12_human_decision_gates || "";
  if (humanGates) {
    steps.push({
      step_id: `step-${seq}`,
      sequence: seq++,
      name: "Human review/decision",
      owner_type: "human"
    });
  }

  // End condition
  steps.push({
    step_id: `step-${seq}`,
    sequence: seq++,
    name: intake.section_a_workflow_definition?.q04_end_condition || "Workflow complete",
    owner_type: "human"
  });

  return steps;
}

/**
 * Build measurements array for workflow
 */
function buildWorkflowMeasurements(measurements) {
  return measurements.measurements.map(m => ({
    measurement_id: m.id,
    name: m.name,
    metric_type: m.metric_type,
    value: buildMeasurementValue(m),
    value_display: m.value_display,
    // Only include target if one exists (schema requires string, not null)
    ...(m.threshold?.target_display ? { target: m.threshold.target_display } : {}),
    method: m.source?.includes('intake') ? 'stakeholder_interview' : 'system_analysis',
    evidence: m.evidence?.map(e => ({
      evidence_id: `ev-${randomUUID().slice(0, 8)}`,
      source_id: "src-intake-call",
      evidence_type: e.type || "client_statement",
      summary: e.summary
    })) || []
  }));
}

/**
 * Normalize duration unit to schema-allowed values
 * Allowed: s, m, h, d, w, mo, y
 */
function normalizeDurationUnit(unit) {
  if (!unit) return 'd';
  const lower = unit.toLowerCase().trim();

  // Direct mappings
  const unitMap = {
    's': 's', 'sec': 's', 'secs': 's', 'second': 's', 'seconds': 's',
    'm': 'm', 'min': 'm', 'mins': 'm', 'minute': 'm', 'minutes': 'm',
    'h': 'h', 'hr': 'h', 'hrs': 'h', 'hour': 'h', 'hours': 'h',
    'd': 'd', 'day': 'd', 'days': 'd', 'business day': 'd', 'business days': 'd',
    'w': 'w', 'wk': 'w', 'wks': 'w', 'week': 'w', 'weeks': 'w',
    'mo': 'mo', 'month': 'mo', 'months': 'mo',
    'y': 'y', 'yr': 'y', 'yrs': 'y', 'year': 'y', 'years': 'y'
  };

  return unitMap[lower] || 'd';
}

/**
 * Build measurement value object
 */
function buildMeasurementValue(m) {
  switch (m.metric_type) {
    case 'latency':
      return {
        kind: 'duration',
        duration: {
          value: m.value,
          unit: normalizeDurationUnit(m.unit),
          display: m.value_display
        }
      };
    case 'error_rate':
    case 'quality':
      return {
        kind: 'percentage',
        value: m.value,
        scale: 'percent',
        display: m.value_display
      };
    case 'complexity':
      return {
        kind: 'count',
        value: m.value,
        display: m.value_display
      };
    default:
      // Default to 'count' - valid schema enum value
      return {
        kind: 'count',
        value: m.value,
        display: m.value_display
      };
  }
}

/**
 * Check if a measurement is a baseline/context value (not an actionable finding)
 */
function isBaselineMetric(m) {
  const name = m.name.toLowerCase();
  const id = m.id?.toLowerCase() || '';

  // Baseline values that are inputs to calculations, not problems
  const baselinePatterns = [
    'lifetime value', 'ltv', 'hourly cost', 'hourly rate',
    'volume', 'count', 'target time', 'goal', 'target sla'
  ];

  // Check if it's explicitly marked as baseline
  if (m.status === 'healthy' && m.status_reason?.toLowerCase().includes('baseline')) {
    return true;
  }

  // Check name patterns for baseline values
  if (baselinePatterns.some(p => name.includes(p) || id.includes(p))) {
    // Exception: if it has a threshold and is not healthy, it's actionable
    if (m.threshold && m.status && m.status !== 'healthy') {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Generate a sensible default target for a measurement when none is provided
 * Uses industry-standard benchmarks based on metric type
 */
function generateDefaultTarget(m) {
  const metricType = m.metric_type;
  const value = m.value;
  const name = m.name?.toLowerCase() || '';
  const unit = m.unit || '';
  const isCurrency = unit === 'dollars' || unit === 'USD' || unit === '$' || m.value_display?.startsWith('$');

  // Cost metrics - aim for reduction with currency formatting
  if (metricType === 'cost' || isCurrency) {
    const improved = Math.round(value * 0.5);
    return `< $${improved}`;
  }

  // Error rates should target low values (< 5%)
  if (metricType === 'error_rate' || name.includes('error') || name.includes('rate')) {
    return '< 5%';
  }

  // Quality metrics - aim for high percentages
  if (metricType === 'quality' || name.includes('quality') || name.includes('accuracy')) {
    return '> 95%';
  }

  // SLA/completion percentages should be high
  if (name.includes('sla') || name.includes('completion') || name.includes('on-time')) {
    return '> 95%';
  }

  // Latency/time metrics - aim for 50% improvement or industry standards
  if (metricType === 'latency' || name.includes('time') || name.includes('delay') || name.includes('response')) {
    // Parse value and unit to suggest improvement
    if (unit === 'h' || unit.includes('hour')) {
      const hours = parseFloat(value);
      if (hours > 24) return '< 24h';
      if (hours > 4) return '< 4h';
      if (hours > 1) return '< 1h';
      return '< 30m';
    }
    if (unit === 'd' || unit.includes('day')) {
      const days = parseFloat(value);
      if (days > 7) return '< 7d';
      if (days > 3) return '< 3d';
      if (days > 1) return '< 24h';
      return '< 1d';
    }
    if (unit === 'm' || unit.includes('min')) {
      const mins = parseFloat(value);
      if (mins > 30) return '< 30m';
      if (mins > 15) return '< 15m';
      return '< 5m';
    }
    // Default: aim for 50% of current value
    return `< ${Math.round(value * 0.5)}${unit}`;
  }

  // Complexity/count metrics - aim for reduction
  if (metricType === 'complexity' || name.includes('step') || name.includes('handoff') || name.includes('system')) {
    return `< ${Math.max(1, Math.round(value * 0.5))}`;
  }

  // Percentage-based failures - aim for low percentages
  if (name.includes('fail') || name.includes('miss') || name.includes('drop')) {
    return '< 10%';
  }

  // Default: aim for 50% reduction with same display format
  if (typeof value === 'number') {
    const improved = Math.round(value * 0.5);
    // Preserve percentage format if original was percentage
    if (m.value_display?.includes('%')) {
      return `< ${improved}%`;
    }
    // Handle currency (dollars, USD, etc.)
    if (unit === 'dollars' || unit === 'USD' || unit === '$' || m.value_display?.startsWith('$')) {
      return `< $${improved}`;
    }
    return `< ${improved}${unit}`;
  }

  // Fallback: use industry benchmark language
  return 'Industry Benchmark';
}

/**
 * Build scorecard rows from measurements
 * Filters to show only actionable findings (critical/warning) and limits rows for one-page report
 * Maximum 3 rows to fit on single page without cutting off bottom content
 */
function buildScorecardRows(measurements, maxRows = 3) {
  // Filter out baseline/context metrics and healthy items
  const actionableMeasurements = measurements.measurements.filter(m => {
    const status = deriveStatus(m);

    // Skip healthy baselines
    if (status === 'healthy') return false;

    // Skip baseline context metrics
    if (isBaselineMetric(m)) return false;

    // Include critical and warning items
    return true;
  });

  // Sort by severity (critical first) then by value magnitude
  const sorted = actionableMeasurements.sort((a, b) => {
    const statusA = deriveStatus(a);
    const statusB = deriveStatus(b);
    if (statusA === 'critical' && statusB !== 'critical') return -1;
    if (statusB === 'critical' && statusA !== 'critical') return 1;
    return 0;
  });

  // Limit to max rows
  const limited = sorted.slice(0, maxRows);

  return limited.map(m => {
    const status = deriveStatus(m);
    const hasTarget = m.threshold?.target_display || m.threshold?.target != null;

    // Build metrics array - always include target (generate sensible default if missing)
    const metrics = [
      {
        label: "Your metric",
        value_display: m.value_display,
        measurement_id: m.id,
        is_benchmark: false
      }
    ];

    // Always add a target metric - generate default if none exists
    if (hasTarget) {
      metrics.push({
        label: "Target",
        value_display: m.threshold?.target_display || String(m.threshold?.target),
        is_benchmark: true
      });
    } else {
      // Generate sensible default target based on metric type and current value
      const defaultTarget = generateDefaultTarget(m);
      metrics.push({
        label: "Target",
        value_display: defaultTarget,
        is_benchmark: true
      });
    }

    return {
      row_id: `row-${m.id}`,
      category: m.name,
      status: status,
      status_is_critical: status === 'critical',
      has_metrics: true,
      finding: {
        summary: `[LLM_PLACEHOLDER: finding_summary for ${m.name}]`,
        risk: status !== 'healthy' ? `[LLM_PLACEHOLDER: finding_risk for ${m.name}]` : null
      },
      metrics: metrics,
      measurement_ids: [m.id]
    };
  });
}

/**
 * Build bleed section from measurements
 */
function buildBleed(measurements) {
  const bleedData = measurements.bleed_total || { value: 0, currency: 'USD', period: 'month' };
  const assumptions = measurements.bleed_assumptions || [];
  const calculations = measurements.bleed_calculations || [];

  return {
    currency: bleedData.currency || 'USD',
    period: bleedData.period || 'month',
    period_display: bleedData.period === 'month' ? 'Per Month' : `Per ${bleedData.period}`,
    total: {
      amount: bleedData.value,
      currency: bleedData.currency || 'USD',
      display: bleedData.display || `$${bleedData.value.toLocaleString()}`
    },
    breakdown: [{
      item_id: "bleed-primary",
      label: "Primary Bleed",
      status: "critical",
      amount: {
        amount: bleedData.value,
        currency: bleedData.currency || 'USD',
        display: bleedData.display || `$${bleedData.value.toLocaleString()}`
      },
      driver_measurement_ids: measurements.measurements.filter(m => m.status === 'critical').map(m => m.id)
    }],
    assumptions: assumptions.map(a => ({
      assumption_id: a.id,
      name: a.label,
      value: a.value,
      unit: a.value_display?.replace(String(a.value), '').trim() || '',
      source_or_basis: a.source || 'Client-provided estimate',
      confidence: 'medium'
    })),
    calculations: calculations.map(c => ({
      calc_id: c.id,
      label: c.label,
      formula: c.formula,
      inputs: c.inputs || [],
      result_amount: {
        amount: c.result,
        currency: 'USD'
      },
      attribution_breakdown_item_id: "bleed-primary"
    })),
    math_defender_text: "[LLM_PLACEHOLDER: math_defender_text]"
  };
}

/**
 * Group related measurements into fix categories
 * This consolidates multiple symptoms of the same root problem
 */
function groupMeasurementsForFixes(measurements) {
  const groups = {
    sla_latency: { label: 'SLA/Latency Issues', measurements: [], priority: 1 },
    automation: { label: 'Manual Process Automation', measurements: [], priority: 2 },
    visibility: { label: 'Process Visibility', measurements: [], priority: 3 },
    quality: { label: 'Quality Issues', measurements: [], priority: 4 }
  };

  measurements.forEach(m => {
    const name = m.name.toLowerCase();
    const id = m.id?.toLowerCase() || '';

    // Skip baseline metrics
    if (isBaselineMetric(m)) return;

    // Categorize by type
    if (name.includes('sla') || name.includes('delay') || name.includes('time') ||
        m.metric_type === 'latency') {
      groups.sla_latency.measurements.push(m);
    } else if (name.includes('manual') || name.includes('sync') || name.includes('wasted') ||
               name.includes('systems')) {
      groups.automation.measurements.push(m);
    } else if (name.includes('visibility') || name.includes('miss rate') ||
               m.metric_type === 'error_rate') {
      groups.visibility.measurements.push(m);
    } else {
      groups.quality.measurements.push(m);
    }
  });

  return groups;
}

/**
 * Build fixes section from measurements and intake
 * Limits to 3-4 consolidated fixes for one-page report
 */
function buildFixes(intake, measurements, maxFixes = 4) {
  const criticalMeasurements = measurements.measurements.filter(m =>
    deriveStatus(m) === 'critical' && !isBaselineMetric(m)
  );

  const clientPriority = intake.section_e_priority?.q15_one_thing_to_fix || "";
  const bleedPeriod = measurements.bleed_total?.period || 'month';
  const totalBleed = measurements.bleed_total?.value || 0;

  // Group measurements into fix categories
  const groups = groupMeasurementsForFixes(criticalMeasurements);

  // Build fix items from groups (only groups with measurements)
  const activeGroups = Object.entries(groups)
    .filter(([_, g]) => g.measurements.length > 0)
    .sort((a, b) => a[1].priority - b[1].priority)
    .slice(0, maxFixes);

  // Calculate total weight for proportional distribution
  const totalWeight = activeGroups.reduce((sum, [_, g]) => sum + g.measurements.length, 0);

  const items = activeGroups.map(([key, group], idx) => {
    const primaryMeasurement = group.measurements[0];
    const relatedIds = group.measurements.map(m => m.id);
    // Proportional share of total bleed based on measurement weight
    const impactShare = relatedIds.length / totalWeight;
    const recoveryAmount = Math.round(totalBleed * impactShare);

    return {
      fix_id: `fix-${idx + 1}`,
      status: "proposed",
      severity: "critical",
      bleed_period: bleedPeriod,
      problem: `[LLM_PLACEHOLDER: fix_problem for ${group.label}]`,
      solution: `[LLM_PLACEHOLDER: fix_solution for ${group.label}]`,
      quick_win: idx === 0,
      impact: {
        estimated_recovery: {
          amount: recoveryAmount,
          currency: "USD",
          display: `$${recoveryAmount.toLocaleString()}`
        },
        basis: "[LLM_PLACEHOLDER: impact_basis]",
        maps_to_breakdown_item_ids: ["bleed-primary"],
        tier: impactShare > 0.3 ? "high" : "medium"
      },
      effort: {
        tier: idx === 0 ? "low" : (relatedIds.length > 2 ? "high" : "medium"),
        estimated_hours_range: {
          min_hours: idx === 0 ? 8 : (relatedIds.length > 2 ? 24 : 16),
          most_likely_hours: idx === 0 ? 16 : (relatedIds.length > 2 ? 40 : 24),
          max_hours: idx === 0 ? 24 : (relatedIds.length > 2 ? 60 : 40)
        },
        skills_required: ["automation", "API"]
      },
      turnaround: {
        label: idx === 0 ? "7-14 Days" : (relatedIds.length > 2 ? "30-45 Days" : "14-21 Days"),
        business_days_min: idx === 0 ? 7 : (relatedIds.length > 2 ? 30 : 14),
        business_days_max: idx === 0 ? 14 : (relatedIds.length > 2 ? 45 : 21)
      },
      dependencies: [],
      acceptance_criteria: ["[LLM_PLACEHOLDER: acceptance_criteria]"],
      related_measurement_ids: relatedIds
    };
  });

  return {
    quick_win_fix_id: items[0]?.fix_id || null,
    items
  };
}

/**
 * Build CTA section
 */
function buildCTA(config) {
  return {
    phases: [
      { phase_id: "phase_1_audit", label: "Phase 1: Audit", state: "complete", is_last: false },
      { phase_id: "phase_2_stabilize", label: "Phase 2: Stabilize", state: "current", is_last: false },
      { phase_id: "phase_3_scale", label: "Phase 3: Scale", state: "upcoming", is_last: true }
    ],
    current_phase: "phase_2_stabilize",
    completed_phase_ids: ["phase_1_audit"],
    headline: "[LLM_PLACEHOLDER: cta_headline]",
    subtext: "[LLM_PLACEHOLDER: cta_subtext]",
    link: config.cta.link,
    link_display: config.cta.link_display,
    call_duration_minutes: config.cta.call_duration_minutes
  };
}

/**
 * Main transform function
 * @param {Object} intake - The intake packet JSON
 * @param {Object} measurements - The extracted measurements JSON
 * @param {Object} userConfig - Optional configuration overrides
 * @returns {Object} The report JSON (with LLM placeholders for narrative fields)
 */
export function transform(intake, measurements, userConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const now = new Date().toISOString();
  const workflowName = intake.section_a_workflow_definition?.q01_workflow_name || "Unnamed Workflow";

  // Build scorecard rows first so we can count statuses from filtered results
  const scorecardRows = buildScorecardRows(measurements);

  // Count statuses from the filtered scorecard rows (what's actually shown)
  const statusCounts = { critical: 0, warning: 0, healthy: 0 };
  scorecardRows.forEach(row => {
    statusCounts[row.status]++;
  });

  return {
    schema_version: "1.0.0",
    document: {
      document_id: randomUUID(),
      created_at: now,
      report_date: formatDate(now),
      report_year: getYear(now),
      title: `AI Process Audit: ${workflowName}`,
      subtitle: "",
      confidentiality: "confidential",
      locale: "en-US",
      timezone: "America/Indiana/Indianapolis",
      brand: config.brand
    },
    prepared_for: {
      account_id: intake.prepared_for?.account_id || "unknown",
      account_name: intake.prepared_for?.account_name || "Unknown Client",
      industry: "Unknown",
      primary_contact: {
        name: "Unknown",
        title: "Unknown",
        email: "unknown@example.com",
        role_in_decision: "economic_buyer"
      }
    },
    prepared_by: {
      producer_name: config.producer.name,
      producer_email: config.producer.email,
      producer_company: config.producer.company
    },
    audit: {
      audit_id: `audit-${getYear(now)}-${randomUUID().slice(0, 8)}`,
      scope: {
        scope_statement: "[LLM_PLACEHOLDER: scope_statement]",
        in_scope: ["[LLM_PLACEHOLDER: scope_items]"],
        out_of_scope: ["[LLM_PLACEHOLDER: out_of_scope]"],
        systems_involved: buildSystemsInvolved(intake),
        time_window: {
          start: new Date(Date.now() - 30*24*60*60*1000).toISOString(),
          end: now,
          timezone: "America/Indiana/Indianapolis"
        }
      },
      methodology: {
        methods: [{
          method_type: "stakeholder_interview",
          details: "30-minute intake call",
          sample_size: 1
        }],
        data_sources: [{
          source_id: "src-intake-call",
          source_type: "interview",
          source_label: `Intake interview (${formatDate(now)})`
        }],
        limitations: ["[LLM_PLACEHOLDER: limitations]"],
        confidence: {
          rating: "medium",
          rationale: "Client-provided estimates without system log validation"
        }
      },
      workflows: [{
        workflow_id: `wf-${randomUUID().slice(0, 8)}`,
        name: workflowName,
        trigger: intake.section_a_workflow_definition?.q02_trigger_event || "Unknown trigger",
        objective: intake.section_a_workflow_definition?.q03_business_objective || "Unknown objective",
        primary_kpi: `${measurements.measurements[0]?.name || 'Primary metric'} target`,
        steps: buildWorkflowSteps(intake),
        measurements: buildWorkflowMeasurements(measurements)
      }]
    },
    scorecard: {
      executive_summary: {
        body: "[LLM_PLACEHOLDER: executive_summary]",
        generated_by: "pending_llm"
      },
      rows: scorecardRows,
      overall: {
        status_distribution: statusCounts
      }
    },
    bleed: buildBleed(measurements),
    fixes: buildFixes(intake, measurements),
    cta: buildCTA(config),
    benchmarks: [],
    sources: [],
    rendering: {
      mode: config.rendering.mode,
      is_conversion_mode: config.rendering.mode === "conversion",
      page: {
        size: config.rendering.page_size,
        margins_in: config.rendering.margins
      },
      layout_guards: {
        max_pages: config.rendering.max_pages
      }
    },
    offer: config.offer
  };
}

/**
 * Get list of LLM placeholder fields in the report
 */
export function getLLMPlaceholders(reportJson) {
  const placeholders = [];

  function findPlaceholders(obj, path = '') {
    if (typeof obj === 'string' && obj.startsWith('[LLM_PLACEHOLDER:')) {
      const match = obj.match(/\[LLM_PLACEHOLDER:\s*([^\]]+)\]/);
      if (match) {
        placeholders.push({
          path: path,
          prompt_id: match[1].trim()
        });
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((item, idx) => findPlaceholders(item, `${path}[${idx}]`));
    } else if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([key, value]) => {
        findPlaceholders(value, path ? `${path}.${key}` : key);
      });
    }
  }

  findPlaceholders(reportJson);
  return placeholders;
}

export default { transform, getLLMPlaceholders };
