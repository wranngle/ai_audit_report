# AI Audit Report Generator

**Professional workflow diagnostic reports powered by AI**

A Node.js pipeline that transforms unstructured client interview notes into polished, single-page "Traffic Light" diagnostic reports. Built by Wranngle Systems LLC for rapid business process auditing and client conversion.

![Status](https://img.shields.io/badge/status-production-green)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)
![License](https://img.shields.io/badge/license-proprietary-blue)

---

## Introduction

The AI Audit Report Generator is an intelligent document pipeline designed to accelerate business process consulting. It addresses the challenge of converting raw client intake data—whether from phone calls, Teams chats, or unstructured notes—into professional, actionable audit reports that drive client engagement and revenue.

**What it does:** Takes messy interview transcripts and generates branded, single-page HTML/PDF reports with executive summaries, traffic-light scorecards (🔴🟡🟢), revenue bleed calculations, and recommended fixes. The system uses a multi-stage pipeline combining deterministic transformations with LLM-powered narrative generation to ensure both accuracy and persuasiveness.

**How it fits:** This tool serves as the diagnostic phase in Wranngle's client workflow. After an initial intake call, auditors use this pipeline to quickly produce a compelling visual report that identifies process bottlenecks, quantifies revenue impact, and sets up the proposal phase. The output becomes a conversion asset—clients see their problems clearly visualized and quantified, making the next steps obvious.

---

## Official Documentation

- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs) - Used for extraction and narrative generation
- [Mustache.js Documentation](https://github.com/janl/mustache.js/) - Template rendering engine
- [AJV JSON Schema Validator](https://ajv.js.org/) - Schema validation
- [Node.js Documentation](https://nodejs.org/docs/latest/api/) - Runtime environment

---

## Terminology

- **Traffic Light Report** - A single-page diagnostic document using color-coded status indicators (🔴 critical, 🟡 warning, 🟢 healthy) to visualize process health
- **Intake Packet** - Structured JSON containing client workflow definition, systems, timing, and failure costs extracted from interview notes
- **Measurements** - Quantified metrics with thresholds (latency, error rates, manual handoffs) used to calculate status and revenue bleed
- **Revenue Bleed** - Monthly cost of process inefficiencies calculated from failure rates, volumes, and per-incident costs
- **LLM Placeholder** - Template field in format `[LLM_PLACEHOLDER: field_name]` that gets replaced by AI-generated narrative during the fill stage
- **Prompt Registry** - JSON configuration file (`prompts/prompt_registry.json`) defining LLM instructions, constraints, and validation rules for each narrative field
- **Info Dump** - Unstructured text input (interview transcripts, meeting notes) that gets extracted into structured data
- **Pipeline Stages** - Six sequential processing steps: Extract → Transform → Validate → LLM Fill → Validate → Render
- **Scorecard** - Table showing workflow categories with status dots and diagnostic findings
- **CTA (Call-to-Action)** - Report footer section with booking link or proposal access

---

## Quick Start

### Prerequisites

- **Node.js** 18 or higher
- **npm** (included with Node.js)
- **API Keys:**
  - `GEMINI_API_KEY` for extraction and narratives (required, can use `--skip-llm` to skip narrative generation)

### Installation

1. **Clone or download this repository**

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure API keys:**

   Create a `.env` file in the project root:
   ```bash
   # Gemini API (used for extraction and LLM narrative generation)
   GEMINI_API_KEY=your-gemini-api-key-here
   ```

   **Alternative:** Set environment variables directly:
   ```bash
   # Windows PowerShell
   $env:GEMINI_API_KEY="your-key"

   # Linux/macOS
   export GEMINI_API_KEY="your-key"
   ```

### Generate Your First Report

**1. Create an info dump file** (`notes.txt`):
```text
Client: Acme Corporation
Date: Dec 14, 2024
Interviewer: John Doe

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

**3. View the output:**
Open `report.html` in your browser. You now have a professional diagnostic report ready for client delivery.

---

## Guide

### Understanding the Pipeline

The system processes data through six stages:

#### 1. Extract (Gemini-powered)
Converts unstructured text → structured JSON using Gemini 2.0 Flash. Extracts:
- Client information
- Workflow definition
- Systems involved
- Timing metrics
- Failure costs

**Input:** Raw text file
**Output:** `intake_extracted.json` + `measurements_extracted.json`

#### 2. Transform (Deterministic)
Converts intake + measurements → report JSON structure with LLM placeholders.

**No AI calls—pure data transformation:**
- Maps intake fields to report schema
- Calculates status colors from thresholds
- Builds scorecard rows
- Generates fix recommendations structure
- Inserts placeholders for narratives

**Output:** Report JSON with `[LLM_PLACEHOLDER: field_name]` markers

#### 3. Validate (Pre-LLM)
Checks report structure against `big_json_schema.json`:
- Required fields present
- Enum values valid
- Data types correct
- Placeholders allowed at this stage

#### 4. LLM Fill (Narrative Generation)
Replaces placeholders with AI-generated content using prompts from the registry.

**Fields generated:**
| Field | Prompt | Approval? |
|-------|--------|-----------|
| Executive summary | `executive_summary_v1` | **Yes** |
| Document title | `document_title_v1` | No |
| Scope statement | `scope_statement_v1` | No |
| Finding summaries | `finding_summary_v1` | No |
| Risk explanations | `finding_risk_v1` | No |
| Math defender | `math_defender_v1` | **Yes** |
| Fix problems/solutions | `fix_problem_v1`, `fix_solution_v1` | No |
| CTA headline/subtext | `cta_headline_v1`, `cta_subtext_v1` | No |

*Note: Fields marked "Yes" for approval should be reviewed before client delivery.*

#### 5. Validate (Post-LLM)
Final validation ensuring:
- No unresolved placeholders
- All narratives meet length constraints
- Business rules satisfied (e.g., executive summary and math defender must not contain placeholders)

#### 6. Render (Mustache)
Applies `ai_audit_template_new.html` template to generate final HTML.

**Output:** Single-page report ready for browser viewing or PDF export

---

### CLI Commands Reference

#### Generate Report (Recommended)

Generate complete report from unstructured text:

```bash
node cli.js generate <input.txt> <output.html> [options]
```

**Options:**
- `--skip-llm` - Skip narrative generation (keeps placeholders)
- `--save-json` - Save intermediate JSON files

**Examples:**
```bash
# Standard usage
node cli.js generate interview_notes.txt client_report.html

# Save intermediate files for debugging
node cli.js generate notes.txt report.html --save-json

# Skip LLM (for testing or when API unavailable)
node cli.js generate notes.txt report.html --skip-llm
```

#### Extract Only

Extract structured JSON without generating report:

```bash
node cli.js extract <input.txt> [--output-dir <directory>]
```

**Outputs:**
- `intake_extracted.json` - Structured intake packet
- `measurements_extracted.json` - Metrics and bleed calculations

**Example:**
```bash
node cli.js extract meeting_transcript.txt --output-dir ./extracted/
```

#### Transform

Convert intake + measurements to report JSON (deterministic, no LLM):

```bash
node cli.js transform <intake.json> <measurements.json> <output.json>
```

#### Validate

Check report JSON against schema:

```bash
node cli.js validate <report.json>
```

**Useful for debugging pipeline issues or verifying custom reports.**

#### Render

Generate HTML from validated report JSON:

```bash
node cli.js render <report.json> <output.html>
```

#### Full Pipeline

Run complete pipeline from structured JSON files:

```bash
node cli.js full <intake.json> <measurements.json> <output.html> [options]
```

**Options:**
- `--skip-llm` - Skip narrative generation
- `--save-json` - Save intermediate JSON

**Example:**
```bash
node cli.js full intake.json measurements.json report.html
```

---

### Working with Structured Input Files

For advanced users or integration scenarios, you can provide pre-structured JSON files instead of unstructured text.

#### Intake Packet Structure

**File:** `intake.json`

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
    "q08_delay_unit": "hours"
  },

  "section_c_systems_handoffs": {
    "q10_systems_involved": [
      "Website form (Typeform)",
      "CRM (HubSpot)",
      "Email (Gmail)"
    ],
    "q11_manual_data_transfers": "Rep manually checks CRM",
    "q12_human_decision_gates": "Rep determines lead quality"
  },

  "section_d_failure_cost": {
    "q13_common_failures": "Leads sit unnoticed for hours",
    "q14_cost_if_slow_or_failed": "$500 per missed lead"
  },

  "section_e_priority": {
    "q15_one_thing_to_fix": "Instant notification for high-value leads"
  }
}
```

**See `intake_packet_template.json` for an empty template.**

#### Measurements Structure

**File:** `measurements.json`

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

**Metric types:** `latency`, `error_rate`, `volume`, `complexity`, `cost`, `quality`
**Status values:** `healthy`, `warning`, `critical`

---

### Customization

#### Branding Configuration

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
    logo_uri: "your-logo.png",
    primary_domain: "yourcompany.com"
  },
  cta: {
    link: "https://calendly.com/your-booking-link",
    link_display: "Book a Call",
    call_duration_minutes: 30
  }
};
```

#### Template Styling

Edit `ai_audit_template_new.html` CSS variables:

```css
:root {
  --critical: #cf3c69;  /* Red for critical status */
  --warning: #ff9e33;   /* Yellow for warning */
  --healthy: #5D8C61;   /* Green for healthy */
  --cta-bg: #ff5f00;    /* CTA button color */
  --ink-primary: #12111a; /* Text color */
  --bg-page: #fcfaf5;   /* Background */
}
```

#### Adding Custom Prompts

**1. Add prompt to `prompts/prompt_registry.json`:**

```json
{
  "prompt_id": "my_custom_field_v1",
  "version": 1,
  "schema_path": "custom.field.path",
  "output_type": "string",
  "max_tokens": 150,
  "system_prompt": "You are a technical writer...",
  "user_prompt_template": "Generate content for {{context_var}}",
  "output_constraints": {
    "must_not_contain": ["I think", "approximately"],
    "max_length_chars": 500
  },
  "approval_required": false
}
```

**2. Map placeholder in `lib/llm_executor.js`:**

```javascript
const PLACEHOLDER_TO_PROMPT = {
  'my_custom_field': 'my_custom_field_v1',
  // ... existing mappings
};
```

**3. Insert placeholder in `lib/transform.js` where needed**

**4. Regenerate schema (if adding new fields):**
```bash
node build_comprehensive_schema.js
```

---

### Testing

Run the test suite:

```bash
npm test
```

**Expected output:**
```
TEST 1: Validate Intake Packet       ✓
TEST 2: Validate Measurements        ✓
TEST 3: Transform Pipeline           ✓
TEST 4: Validate Hand-Crafted Report ✓
TEST 5: Full Pipeline (skip LLM)     ✓

RESULTS: 5 passed, 0 failed
```

**Test render only:**
```bash
npm run test:render
```

---

### Project Structure

```
ai_audit_report/
├── cli.js                          # CLI entry point
├── lib/
│   ├── pipeline.js                 # Pipeline orchestration
│   ├── extract.js                  # Gemini-powered extraction
│   ├── transform.js                # Deterministic transformation
│   ├── llm_executor.js             # Gemini narrative generation
│   └── validate.js                 # JSON Schema validation
├── prompts/
│   └── prompt_registry.json        # LLM prompt definitions
├── ai_audit_template_new.html      # Mustache HTML template
├── big_json_schema.json            # Comprehensive report schema
├── build_comprehensive_schema.js   # Schema generator
├── intake_packet_template.json     # Empty intake template
├── test_run/
│   ├── run_pipeline_test.js        # Test suite
│   ├── sample_info_dump.txt        # Example input
│   ├── intake_packet_filled.json   # Example intake
│   ├── measurements_extracted.json # Example measurements
│   └── report_instance.json        # Hand-crafted example
└── old/                            # Archived test outputs
```

---

## FAQ

### General Questions

**Q: What file formats does the pipeline accept as input?**
**A:** The pipeline accepts plain text files (`.txt`) for the `generate` and `extract` commands. For advanced workflows, you can provide structured JSON files (intake + measurements) directly to the `full` command. The output is always HTML, which can be printed to PDF from any browser.

**Q: Do I need both API keys to run the pipeline?**
**A:** Yes. `GEMINI_API_KEY` is required for both extraction (converting unstructured text to JSON) and narrative generation. If not provided, you can use the `--skip-llm` flag to generate reports with placeholder text instead of AI-generated narratives. This is useful for testing or when API quotas are exceeded.

**Q: What happens when I hit API rate limits?**
**A:** The pipeline includes automatic model fallback to handle rate limits gracefully. When the primary model hits quota limits, it automatically switches to alternative models in this order:
1. `gemini-2.5-flash` (premium quality, 5 RPM free tier)
2. `gemini-2.5-flash-lite` (lite version, 10 RPM free tier)
3. `gemma-3-27b` (large open model, 19 RPM free tier)
4. `gemma-3-12b` → `gemma-3-4b` → `gemma-3-2b` → `gemma-3-1b` (progressively smaller models, 30 RPM)

Each model has different rate limits (RPM = requests per minute). The system automatically adjusts delays between requests based on the current model's limits. If all models are rate-limited, it waits for the retry-after period specified by the API.

**Q: How much does it cost to generate a report?**
**A:** Costs depend on API usage. A typical report uses:
- **Gemini (extraction):** ~5,000-10,000 tokens (~$0.01-0.02 at current rates)
- **Gemini (narratives):** ~8,000-12,000 tokens (~$0.02-0.03 at current rates)

Total cost per report: **$0.03-0.05**. Use `--skip-llm` for free (no narrative generation).

**Q: Can I run this on a server or integrate it into another application?**
**A:** Yes. The CLI is designed for automation. You can call it from scripts, CI/CD pipelines, or wrap it in an API. All commands support non-interactive execution and return proper exit codes (0 for success, 1 for failure).

**Q: What languages are supported for the input text?**
**A:** The extraction stage uses Gemini, which supports multiple languages. However, prompts are currently written in English, so output narratives will be in English. For non-English inputs, Gemini will extract the data correctly, but you may need to customize the prompt registry for localized narratives.

### Technical Questions

**Q: Why are some placeholders not filled even though I have an API key set?**
**A:** Check the validation errors by running `node cli.js validate your_report.json`. Common causes:
1. API key is incorrect or expired
2. API quota exceeded (429 error) - wait or upgrade plan
3. Prompt registry mapping is missing - check `lib/llm_executor.js`
4. Network connectivity issues

**Q: How do I regenerate the JSON schema after modifying the structure?**
**A:** Run `node build_comprehensive_schema.js`. This reads the schema definition in `build_comprehensive_schema.js` and outputs `big_json_schema.json`. The validator (`lib/validate.js`) uses this schema to check reports.

**Q: What's the difference between `generate` and `full` commands?**
**A:**
- `generate` - Takes unstructured text, extracts to JSON, then runs full pipeline
- `full` - Takes pre-structured intake.json and measurements.json, skips extraction

Use `generate` for interview notes. Use `full` when you already have structured data (e.g., from a form or API).

**Q: Can I customize which LLM is used for narrative generation?**
**A:** Yes. The LLM executor (`lib/llm_executor.js`) uses Gemini by default (model: `gemini-2.0-flash-exp`). You can change this in the constructor:

```javascript
this.model = options.model || 'gemini-2.0-flash-exp';
```

Or pass it as an option when instantiating `LLMExecutor`.

**Q: How do I debug schema validation errors?**
**A:** Run:
```bash
node cli.js validate report.json
```

This shows detailed error messages including:
- Missing required fields
- Invalid enum values
- Type mismatches
- Unresolved placeholders

### Sales & Administrative Questions

**Q: What's the typical turnaround time from intake call to delivered report?**
**A:** With this tool, **5-15 minutes**:
1. Intake call (20-30 minutes)
2. Save notes to text file (1 minute)
3. Run `generate` command (1-2 minutes)
4. Review and customize output (3-10 minutes)
5. Export to PDF (30 seconds)

Manual report creation typically takes 2-4 hours.

**Q: Can I white-label the reports for my own consulting business?**
**A:** Yes, this is a proprietary tool of Wranngle Systems LLC. Contact `support@wranngle.com` for licensing options. The branding (logo, colors, contact info) can be customized in `lib/transform.js` and `ai_audit_template_new.html`.

**Q: What happens if a client's workflow doesn't fit the standard intake structure?**
**A:** The extraction stage is flexible—Gemini will extract what it can and use `null` for missing fields. You can:
1. Run extraction to see what's captured
2. Manually edit the extracted JSON files
3. Re-run the pipeline with `full` command

For highly custom workflows, consider creating a custom prompt or extending the intake schema.

**Q: Are the revenue bleed calculations legally defensible?**
**A:** The bleed calculations are **estimates** based on client-provided data. The "Math Defender" section in the report explicitly states assumptions and calculation logic. Always review and verify with clients before presenting financial projections. This tool is for diagnostic and conversion purposes, not financial auditing.

**Q: Can I batch-process multiple clients at once?**
**A:** Yes. Use shell scripting to loop through files:

```bash
for file in clients/*.txt; do
  node cli.js generate "$file" "reports/$(basename "$file" .txt).html"
done
```

Each report processes independently. Be mindful of API rate limits when batch-processing.

---

## Troubleshooting

### Common Errors

**"Intake validation failed"**
- **Cause:** Required fields missing or empty
- **Fix:** Ensure `account_name`, `q01_workflow_name`, and `q02_trigger_event` are present in intake.json
- **Check:** Run `node cli.js validate intake.json`

**"Measurements validation failed"**
- **Cause:** Measurement objects missing required fields
- **Fix:** Each measurement needs `id`, `name`, `value`, `value_display`, and `bleed_total` must exist
- **Check:** Validate with schema using the validate command

**"LLM placeholders remain"**
- **Cause:** API key not configured or LLM stage failed
- **Fix:** Set `GEMINI_API_KEY` environment variable or use `--skip-llm` flag
- **Alternative:** Check API key validity at [Google AI Studio](https://aistudio.google.com/app/apikey)

**"Gemini API key not configured"**
- **Cause:** Environment variable not set
- **Fix:** Add to `.env` file or set environment variable:
  ```bash
  # Windows
  set GEMINI_API_KEY=your-key-here

  # Linux/Mac
  export GEMINI_API_KEY=your-key-here
  ```

**"Gemini API quota exceeded" (429 error)**
- **Cause:** Free tier rate limits hit
- **Fix:** Wait for cooldown period (shown in error) or upgrade Gemini API plan
- **Workaround:** Use `--skip-llm` for testing without API calls

**"Schema validation errors"**
- **Cause:** Report JSON doesn't match schema requirements
- **Fix:** Run detailed validation:
  ```bash
  node cli.js validate report.json
  ```
- **Check:** Enum values, required fields, data types

### Getting Help

For issues not covered here:
- Check `CLAUDE.md` for developer architecture details
- Run tests: `npm test` to verify system health
- Email: support@wranngle.com
- GitHub Issues: Report bugs or feature requests

---

*Wranngle Systems LLC © 2025 | AI-Powered Business Process Consulting*
