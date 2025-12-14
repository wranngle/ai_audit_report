# AI Audit Report Generator

## User Guide v1.0

A pipeline for generating professional audit reports from client intake data. Transforms structured workflow interviews into single-page "Traffic Light" diagnostic reports.

---

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [Pipeline Stages](#pipeline-stages)
5. [Input Files](#input-files)
6. [CLI Commands](#cli-commands)
7. [Schema Reference](#schema-reference)
8. [Prompt Registry](#prompt-registry)
9. [Customization](#customization)
10. [Troubleshooting](#troubleshooting)

---

## Overview

The AI Audit system generates professional process audit reports from raw interview notes or structured data.

**Simplified Flow (Recommended):**
```
Info Dump (text) → Extract → Transform → LLM Fill → Validate → Render → HTML Report
```

**Structured Flow (Advanced):**
```
Intake JSON + Measurements JSON → Transform → LLM Fill → Validate → Render → HTML Report
```

**Output:** A single-page HTML/PDF report with:
- Executive summary
- Scorecard with traffic light status indicators (🔴🟡🟢)
- Revenue bleed analysis
- Recommended fixes with effort/impact ratings
- Call-to-action for next steps

---

## Installation

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
cd "D:\Things\Work\Wranngle\AI Audit"
npm install
```

### Environment Variables

For LLM-powered extraction and narrative generation:

```bash
# Windows PowerShell
$env:GEMINI_API_KEY="your-gemini-api-key"
$env:ANTHROPIC_API_KEY="your-anthropic-api-key"

# Windows CMD
set GEMINI_API_KEY=your-gemini-api-key
set ANTHROPIC_API_KEY=your-anthropic-api-key

# Linux/macOS
export GEMINI_API_KEY="your-gemini-api-key"
export ANTHROPIC_API_KEY="your-anthropic-api-key"

# Or create a .env file in the AI Audit directory:
GEMINI_API_KEY=your-gemini-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

**API Key Usage:**
- `GEMINI_API_KEY` - Used by the **extract** stage (Gemini 2.0 Flash)
- `ANTHROPIC_API_KEY` - Used by the **LLM fill** stage (Claude for narratives)

---

## Quick Start

### Option A: From Unstructured Text (Recommended)

**1. Create an info dump file** (`notes.txt`):
```text
Client: Acme Corporation
Date: Dec 14, 2024
Interviewer: Your Name

They handle lead responses from their website. About 200 leads per month.
Process starts when someone fills out the contact form.

Current flow:
- Form submission goes to HubSpot
- Rep manually checks CRM for new leads every few hours
- Rep sends email or makes call

Problems:
- Takes average 4.5 hours to respond (should be under 15 minutes)
- Leads go cold, competitors get them first
- No alerts, reps forget to check

Each lost deal costs about $500.
They want instant notifications when high-value leads come in.
```

**2. Generate the report:**
```bash
node cli.js generate notes.txt report.html
```

**3. View the report:**
Open `report.html` in a browser. Done!

---

### Option B: From Structured JSON (Advanced)

### 1. Create Input Files

**Intake Packet** (`intake.json`):
```json
{
  "intake_version": "1.0.0",
  "captured_at": "2025-12-14T10:00:00Z",
  "captured_by": "auditor_name",

  "prepared_for": {
    "account_id": "CLIENT-001",
    "account_name": "Acme Corporation"
  },

  "section_a_workflow_definition": {
    "q01_workflow_name": "Lead Response Process",
    "q02_trigger_event": "New lead submitted via website form",
    "q03_business_objective": "Respond to leads within 5 minutes",
    "q04_end_condition": "Sales rep has made initial contact",
    "q05_outcome_owner": "Sales team lead"
  },

  "section_b_volume_timing": {
    "q06_runs_per_period": "200",
    "q06_period_unit": "month",
    "q07_avg_trigger_to_end": "4.5",
    "q07_time_unit": "hours",
    "q08_worst_case_delay": "24",
    "q08_delay_unit": "hours",
    "q09_business_hours_expected": "Yes, 9am-5pm weekdays"
  },

  "section_c_systems_handoffs": {
    "q10_systems_involved": [
      "Website form (Typeform)",
      "CRM (HubSpot)",
      "Email (Gmail)",
      "Slack notifications"
    ],
    "q11_manual_data_transfers": "Rep manually checks CRM for new leads",
    "q12_human_decision_gates": "Rep determines lead quality before outreach"
  },

  "section_d_failure_cost": {
    "q13_common_failures": "Leads sit unnoticed for hours, duplicate outreach",
    "q14_cost_if_slow_or_failed": "$500 average deal value lost per missed lead"
  },

  "section_e_priority": {
    "q15_one_thing_to_fix": "Instant notification when high-value lead arrives"
  }
}
```

**Measurements** (`measurements.json`):
```json
{
  "measurements": [
    {
      "id": "m_response_time",
      "name": "Average Response Time",
      "metric_type": "latency",
      "value": 4.5,
      "unit": "hours",
      "value_display": "4.5h",
      "threshold": {
        "target": 0.25,
        "target_display": "15 min",
        "healthy_max": 0.5,
        "warning_max": 2,
        "direction": "lower_is_better"
      },
      "status": "critical"
    }
  ],
  "bleed_total": {
    "value": 5000,
    "currency": "USD",
    "period": "month",
    "display": "$5,000/mo"
  }
}
```

### 2. Run the Pipeline

```bash
# Full pipeline with LLM (requires API key)
node cli.js full intake.json measurements.json report.html

# Transform only (no LLM, keeps placeholders)
node cli.js full intake.json measurements.json report.html --skip-llm

# Save intermediate JSON
node cli.js full intake.json measurements.json report.html --save-json
```

### 3. View the Report

Open `report.html` in a browser. Print to PDF for client delivery.

---

## Pipeline Stages

### Stage 1: Intake Validation

Validates the intake packet against schema requirements.

**Required fields:**
- `prepared_for.account_name`
- `section_a_workflow_definition.q01_workflow_name`
- `section_a_workflow_definition.q02_trigger_event`

### Stage 2: Measurements Validation

Validates measurement data for completeness and threshold configuration.

**Required per measurement:**
- `id` - Unique identifier
- `name` - Human-readable name
- `value` - Numeric value
- `value_display` - Formatted string (e.g., "4.5h", "15%")

### Stage 3: Transform

Converts intake + measurements into report JSON structure. Deterministic transformation—no LLM calls.

**Outputs:**
- Document metadata
- Scope statement (placeholder)
- Scorecard rows with status colors
- Revenue bleed calculations
- Recommended fixes
- CTA configuration

**Placeholder format:**
```
[LLM_PLACEHOLDER: field_name]
```

### Stage 4: LLM Fill

Uses Claude to generate narrative content. Each placeholder maps to a prompt in the registry.

**Fields filled:**
| Field | Prompt ID | Requires Approval |
|-------|-----------|-------------------|
| `document.title` | `document_title_v1` | No |
| `audit.scope.scope_statement` | `scope_statement_v1` | No |
| `audit.scope.in_scope[]` | `scope_items_v1` | No |
| `scorecard.executive_summary.body` | `executive_summary_v1` | **Yes** |
| `scorecard.rows[].finding.summary` | `finding_summary_v1` | No |
| `bleed.math_defender_text` | `math_defender_v1` | **Yes** |
| `fixes.items[].problem` | `fix_problem_v1` | No |
| `fixes.items[].solution` | `fix_solution_v1` | No |
| `cta.headline` | `cta_headline_v1` | No |

### Stage 5: Validate

Validates final report JSON against the comprehensive schema.

**Checks:**
- JSON Schema compliance (all required fields)
- Business rules (no unresolved placeholders)
- Value constraints (enums, formats)

### Stage 6: Render

Applies Mustache template to generate HTML output.

**Template:** `ai_audit_template_new.html`

---

## Input Files

### Intake Packet Template

Located at: `intake_packet_template.json`

#### Section A: Workflow Definition

| Field | Description | Example |
|-------|-------------|---------|
| `q01_workflow_name` | Name of the process being audited | "Lead Response Process" |
| `q02_trigger_event` | What starts this workflow | "New lead form submission" |
| `q03_business_objective` | Goal of the workflow | "Respond within 5 minutes" |
| `q04_end_condition` | When is it complete | "Rep makes initial contact" |
| `q05_outcome_owner` | Who is accountable | "Sales Manager" |

#### Section B: Volume & Timing

| Field | Description | Example |
|-------|-------------|---------|
| `q06_runs_per_period` | Volume count | "200" |
| `q06_period_unit` | Period type | "month" |
| `q07_avg_trigger_to_end` | Average duration | "4.5" |
| `q07_time_unit` | Duration unit | "hours" |
| `q08_worst_case_delay` | Maximum observed delay | "24" |
| `q08_delay_unit` | Delay unit | "hours" |

#### Section C: Systems & Handoffs

| Field | Description | Example |
|-------|-------------|---------|
| `q10_systems_involved` | Array of system names | ["HubSpot CRM", "Gmail"] |
| `q11_manual_data_transfers` | Manual work description | "Rep checks CRM manually" |
| `q12_human_decision_gates` | Human decisions required | "Quality assessment" |

#### Section D: Failure Cost

| Field | Description | Example |
|-------|-------------|---------|
| `q13_common_failures` | What goes wrong | "Leads ignored for hours" |
| `q14_cost_if_slow_or_failed` | Business impact | "$500 per missed lead" |

#### Section E: Priority

| Field | Description | Example |
|-------|-------------|---------|
| `q15_one_thing_to_fix` | Client's top priority | "Auto-notify on new leads" |

### Measurements File

Contains extracted metrics with thresholds.

```json
{
  "measurements": [
    {
      "id": "unique_id",
      "name": "Metric Name",
      "metric_type": "latency|error_rate|volume|complexity|cost|quality",
      "value": 42,
      "unit": "hours|percent|count|dollars",
      "value_display": "42h",
      "source": "intake.section_b.q07",
      "evidence": [
        {
          "type": "client_statement|log_excerpt|screenshot",
          "summary": "What the evidence shows"
        }
      ],
      "threshold": {
        "target": 24,
        "target_display": "24h",
        "healthy_max": 24,
        "warning_max": 48,
        "direction": "lower_is_better|higher_is_better"
      },
      "status": "healthy|warning|critical"
    }
  ],
  "bleed_assumptions": [
    {
      "id": "assumption_id",
      "label": "Description",
      "value": 100,
      "value_display": "$100"
    }
  ],
  "bleed_calculations": [
    {
      "id": "calc_id",
      "label": "Calculation name",
      "formula": "a × b",
      "result": 1000,
      "result_display": "$1,000"
    }
  ],
  "bleed_total": {
    "value": 5000,
    "currency": "USD",
    "period": "month",
    "display": "$5,000/mo"
  }
}
```

---

## CLI Commands

### Generate (Recommended)

Generate a complete report from unstructured text in one command.

```bash
node cli.js generate <info_dump.txt> <output.html> [options]
```

**Flow:** Info Dump → Extract → Transform → LLM Fill → Validate → Render

**Example:**
```bash
node cli.js generate notes.txt report.html
node cli.js generate notes.txt report.html --save-json
node cli.js generate notes.txt report.html --skip-llm
```

### Extract

Extract structured JSON files from unstructured text without generating a report.

```bash
node cli.js extract <info_dump.txt> [--output-dir <dir>]
```

**Outputs:**
- `intake_extracted.json` - Structured intake packet
- `measurements_extracted.json` - Extracted metrics and bleed calculations

**Example:**
```bash
node cli.js extract interview_notes.txt --output-dir ./extracted/
```

### Transform

Convert intake + measurements to report JSON (with placeholders).

```bash
node cli.js transform <intake.json> <measurements.json> <output.json>
```

### Validate

Check a report JSON against the schema.

```bash
node cli.js validate <report.json>
```

### Render

Generate HTML from validated report JSON.

```bash
node cli.js render <report.json> <output.html>
```

### Full Pipeline

Run all stages from structured JSON files.

```bash
node cli.js full <intake.json> <measurements.json> <output.html> [options]
```

**Options (for generate and full):**
| Flag | Description |
|------|-------------|
| `--skip-llm` | Skip LLM narrative generation, keep placeholders |
| `--save-json` | Save intermediate JSON files alongside output |

---

## Schema Reference

### Report JSON Structure

```
report.json
├── schema_version: "1.0.0"
├── document
│   ├── document_id
│   ├── title (LLM)
│   ├── created_at
│   ├── report_date
│   └── brand {}
├── prepared_for
│   ├── account_name
│   └── primary_contact {}
├── prepared_by
│   ├── producer_name
│   └── producer_email
├── audit
│   ├── scope
│   │   ├── scope_statement (LLM)
│   │   ├── in_scope[] (LLM)
│   │   ├── out_of_scope[] (LLM)
│   │   └── systems_involved[]
│   ├── methodology
│   │   ├── methods[]
│   │   └── limitations[] (LLM)
│   └── workflows[]
├── scorecard
│   ├── executive_summary.body (LLM)
│   └── rows[]
│       ├── category
│       ├── status: "critical|warning|healthy"
│       ├── finding.summary (LLM)
│       ├── finding.risk (LLM)
│       └── metrics[]
├── bleed
│   ├── total {}
│   ├── breakdown[]
│   ├── assumptions[]
│   ├── calculations[]
│   └── math_defender_text (LLM)
├── fixes
│   └── items[]
│       ├── problem (LLM)
│       ├── solution (LLM)
│       ├── impact {}
│       ├── effort {}
│       └── acceptance_criteria[] (LLM)
├── cta
│   ├── action_type: "book_call|view_proposal"
│   ├── headline (LLM)
│   ├── subtext (LLM)
│   ├── link
│   ├── phases[]
│   ├── proposal {} (optional)
│   └── secondary_action {} (optional)
└── rendering
    ├── mode: "conversion|internal|executive"
    └── page {}
```

### Status Values

| Status | Color | Meaning |
|--------|-------|---------|
| `critical` | 🔴 Red (#cf3c69) | Immediate action required |
| `warning` | 🟡 Yellow (#ff9e33) | Needs attention |
| `healthy` | 🟢 Green (#5D8C61) | Meeting targets |

### System Types

Valid values for `system_type` enum:

```
crm, email, calendar, spreadsheet, call_tracking,
custom_app, database, analytics, portal, phone,
sms, forms, property_management, erp, ticketing,
chat, marketing_automation, payment, other
```

---

## Prompt Registry

Located at: `prompts/prompt_registry.json`

### Structure

Each prompt defines:

```json
{
  "prompt_id": "unique_id_v1",
  "version": 1,
  "schema_path": "where.value.goes",
  "output_type": "string|array_of_strings|html_fragment",
  "max_tokens": 100,

  "allowed_input_types": ["workflow_name", "measurements"],
  "required_inputs": ["workflow_name"],

  "system_prompt": "Role and constraints...",
  "user_prompt_template": "Mustache template with {{variables}}",

  "output_constraints": {
    "must_contain": [],
    "must_not_contain": ["I think", "might be"],
    "max_length_chars": 500
  },

  "validation_rules": [],
  "approval_required": false
}
```

### Global Guardrails

```json
{
  "forbidden_phrases": ["I think", "might be", "approximately"],
  "insufficient_evidence_token": "[INSUFFICIENT_EVIDENCE]",
  "require_exact_value_quotes": true
}
```

### Adding Custom Prompts

1. Add prompt object to `prompts/prompt_registry.json`
2. Map placeholder name in `lib/llm_executor.js` → `PLACEHOLDER_TO_PROMPT`
3. Add placeholder insertion in `lib/transform.js` if needed

---

## Customization

### Branding

Edit `lib/transform.js` → `DEFAULT_CONFIG`:

```javascript
const DEFAULT_CONFIG = {
  producer: {
    name: "Your Name",
    email: "you@company.com",
    company: "Your Company"
  },
  brand: {
    brand_name: "Your Company",
    logo_uri: "logo.png",
    primary_domain: "yourcompany.com"
  },
  cta: {
    link: "https://calendly.com/yourlink",
    link_display: "Book a Call",
    call_duration_minutes: 30
  }
};
```

### Template Styling

Edit `ai_audit_template_new.html` CSS variables:

```css
:root {
  --critical: #cf3c69;  /* Red for critical status */
  --warning: #ff9e33;   /* Yellow for warning status */
  --healthy: #5D8C61;   /* Green for healthy status */
  --cta-bg: #ff5f00;    /* CTA button color */
}
```

### CTA Modes

The template supports two CTA modes:

**1. Book Call (default):**
```json
{
  "cta": {
    "action_type": "book_call",
    "headline": "Ready to fix this?",
    "link": "https://calendly.com/your-link"
  }
}
```

**2. View Proposal (Phase 2):**
```json
{
  "cta": {
    "action_type": "view_proposal",
    "headline": "Your Proposal is Ready",
    "link": "https://proposals.yoursite.com/abc123",
    "proposal": {
      "expires_display": "Expires in 7 days",
      "total_value": { "display": "$12,500" }
    },
    "secondary_action": {
      "label": "Have questions?",
      "link": "https://calendly.com/your-link"
    }
  }
}
```

---

## Troubleshooting

### Common Errors

**"Intake validation failed"**
- Check required fields are present
- Verify `account_name` is not empty
- Ensure `q01_workflow_name` and `q02_trigger_event` are filled

**"Measurements validation failed"**
- Each measurement needs `id`, `name`, `value`, `value_display`
- `bleed_total` is required

**"LLM placeholders remain"**
- Set `ANTHROPIC_API_KEY` environment variable
- Or use `--skip-llm` to keep placeholders

**"Gemini API key not configured"**
- Set `GEMINI_API_KEY` environment variable
- Or create a `.env` file with the key

**"Gemini API quota exceeded" (429 error)**
- The Gemini API has rate limits on the free tier
- Wait for the cooldown period (shown in error message)
- Or upgrade your Gemini API plan for higher limits

**"Schema validation errors"**
- Run `node cli.js validate report.json` for details
- Check enum values match allowed options
- Verify `additionalProperties` aren't present

### Running Tests

```bash
npm test
```

Expected output:
```
TEST 1: Validate Intake Packet       ✓
TEST 2: Validate Measurements        ✓
TEST 3: Transform Pipeline           ✓
TEST 4: Validate Hand-Crafted Report ✓
TEST 5: Full Pipeline (skip LLM)     ✓

RESULTS: 5 passed, 0 failed
```

### Debug Mode

For verbose output:

```bash
node cli.js full intake.json measurements.json report.html --verbose
```

### Schema Regeneration

If you modify `build_comprehensive_schema.js`:

```bash
node build_comprehensive_schema.js
```

This regenerates `big_json_schema.json`.

---

## File Structure

```
AI Audit/
├── cli.js                    # CLI entry point
├── lib/
│   ├── pipeline.js           # Pipeline orchestration
│   ├── extract.js            # Info dump → Structured JSON (Gemini API)
│   ├── transform.js          # Intake → Report JSON
│   ├── validate.js           # JSON Schema validation
│   └── llm_executor.js       # Claude API integration (narratives)
├── prompts/
│   └── prompt_registry.json  # LLM prompt definitions
├── ai_audit_template_new.html # Mustache HTML template
├── big_json_schema.json      # Report JSON schema
├── build_comprehensive_schema.js # Schema generator
├── intake_packet_template.json # Empty intake template
├── test_run/
│   ├── sample_info_dump.txt       # Example unstructured input
│   ├── intake_packet_filled.json  # Example intake
│   ├── measurements_extracted.json # Example measurements
│   ├── report_instance.json       # Hand-crafted example
│   └── run_pipeline_test.js       # Test suite
└── old/                      # Archived files
```

---

## Support

For issues or questions:
- GitHub: https://github.com/wranngle-systems/ai-audit
- Email: support@wranngle.com

---

*Wranngle Systems LLC © 2025*
