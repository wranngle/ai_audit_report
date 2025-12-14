# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wranngle Systems LLC is an AI services company. This repository contains an **AI Audit Report Generator** - a Node.js pipeline that transforms client workflow interviews into professional single-page diagnostic reports ("Traffic Light Reports"). The system uses LLMs (Gemini for extraction, Claude for narratives) to process unstructured text or structured JSON into validated, brand-consistent HTML/PDF reports.

## Brand Identity

**Company Name:** Wranngle (or Wranngle Systems LLC)

**Visual Theme:** Ultra-subtle cutesy lasso/desert/cactus cowboy imagery combined with clean modern tech minimalism. The logo features a stylized lowercase 'g' with a lasso-loop descender.

**Typography:**
- Headings: Outfit (600-800 weight)
- Body: Inter (400-500 weight)

### Color Palette

**Violet (accent/alerts):**
- Primary: `#cf3c69` (500), Bleed accent: `#972144` (700)

**Sunset (brand orange):**
- Logo/CTA: `#ff5f00` (500), Light mode logo: `#ff5f00`, Dark mode logo: `#ff7f00` (400)

**Sand (backgrounds):**
- Light bg: `#fcfaf5` (50), Cards: `#ffffff`, Borders: `#dac39f` (300)

**Night (text):**
- Primary text: `#12111a` (950), Muted: `#6a6380` (500)

### Theme CSS Variables

**Light Mode:**
```css
--bg-main: linear-gradient(to bottom, #fcfaf5, #ebdfc8);
--bg-surface: #ffffff;
--text-primary: #12111a;
--brand-logo: #ff5f00;
--action-primary: #ff5f00;
```

**Dark Mode:**
```css
--bg-main: linear-gradient(to bottom, #561329, #12111a);
--bg-surface: #201e28;
--text-primary: #fcfaf5;
--brand-logo: #ff7f00;
--action-primary: #ff7f00;
```

## Development Commands

**Setup:**
```bash
npm install
```

**Environment variables required:**
```bash
# Create .env file or set in shell
GEMINI_API_KEY=your-key-here      # Used by extract stage (Gemini 2.0 Flash)
ANTHROPIC_API_KEY=your-key-here   # Used by LLM fill stage (Claude)
```

**Primary workflows:**
```bash
# Generate report from unstructured text (recommended)
node cli.js generate notes.txt report.html

# Extract structured JSON from unstructured text
node cli.js extract notes.txt --output-dir ./extracted/

# Full pipeline from structured JSON
node cli.js full intake.json measurements.json report.html

# Transform only (no LLM, keeps placeholders)
node cli.js transform intake.json measurements.json output.json

# Validate report JSON
node cli.js validate report.json

# Render HTML from report JSON
node cli.js render report.json output.html
```

**Testing:**
```bash
npm test  # Runs test_run/run_pipeline_test.js
```

**Flags:**
- `--skip-llm` - Skip LLM narrative generation (keeps placeholders)
- `--save-json` - Save intermediate JSON alongside HTML output
- `--output-dir <dir>` - Specify output directory for extract command

## Architecture

**Pipeline stages:**
1. **Extract** (`lib/extract.js`) - Gemini API converts unstructured text → structured JSON (intake + measurements)
2. **Transform** (`lib/transform.js`) - Deterministic conversion: intake + measurements → report JSON with placeholders
3. **LLM Fill** (`lib/llm_executor.js`) - Claude API replaces placeholders with narrative content using prompt registry
4. **Validate** (`lib/validate.js`) - JSON Schema validation against `big_json_schema.json`
5. **Render** (`lib/pipeline.js`) - Mustache templating: report JSON → HTML using `ai_audit_template_new.html`

**Schema generation:**
The report schema is programmatically built by `build_comprehensive_schema.js`. To regenerate after schema changes:
```bash
node build_comprehensive_schema.js  # Outputs to big_json_schema.json
```

**Prompt system:**
LLM prompts are defined in `prompts/prompt_registry.json`. Each prompt specifies:
- `prompt_id` - Unique identifier (e.g., `executive_summary_v1`)
- `schema_path` - Where output goes in report JSON
- `output_type` - `string`, `array_of_strings`, or `html_fragment`
- `system_prompt` / `user_prompt_template` - Claude instructions with Mustache variables
- `approval_required` - Whether output needs manual review
- `output_constraints` - Forbidden phrases, max length, etc.

**Placeholder format:**
During transform, placeholders follow this pattern: `[LLM_PLACEHOLDER: field_name]`
These are replaced during the LLM fill stage using prompts mapped in `lib/llm_executor.js`.

## Key Files

- `cli.js` - CLI entry point
- `lib/pipeline.js` - Pipeline orchestration and Mustache rendering
- `lib/extract.js` - Gemini-powered extraction from unstructured text
- `lib/transform.js` - Intake → Report JSON transformation logic
- `lib/llm_executor.js` - Claude API integration for narrative generation
- `lib/validate.js` - JSON Schema validation (Ajv)
- `prompts/prompt_registry.json` - LLM prompt definitions
- `ai_audit_template_new.html` - Mustache template for HTML output
- `big_json_schema.json` - Comprehensive report JSON schema
- `build_comprehensive_schema.js` - Schema generator
- `intake_packet_template.json` - Empty intake template
- `test_run/sample_info_dump.txt` - Example unstructured input
- `test_run/intake_packet_filled.json` - Example structured intake
- `test_run/measurements_extracted.json` - Example measurements
- `test_run/run_pipeline_test.js` - Test suite
- `design_philosophy.txt` - Complete brand guidelines and color tokens

## AI Audit Report Structure

The Traffic Light Report (`ai_audit_draft.html`) is a single-page 8.5"×11" PDF-ready document with these zones:
1. **Header** - Wranngle logo + client info
2. **Executive Summary** - Key finding with revenue impact
3. **Scorecard Table** - Categories with 🔴🟡🟢 status dots + findings
4. **Revenue Bleed** - Monthly cost of identified issues
5. **Recommended Fixes** - Problem/Fix/Impact for each critical item
6. **CTA** - Booking link for implementation call

Status indicators: Critical (red `#cf3c69`), Warning (yellow `#ff9e33`), Healthy (green `#5D8C61`)

## Customization

**Branding configuration:**
Edit `lib/transform.js` → `DEFAULT_CONFIG` constant to change:
- Producer name/email
- Brand name and logo URI
- CTA link (Calendly, proposal system, etc.)
- Contact information

**Template styling:**
Edit `ai_audit_template_new.html` CSS variables to adjust colors, fonts, or layout. The template uses Mustache syntax for dynamic content injection.

**Adding new prompts:**
1. Add prompt definition to `prompts/prompt_registry.json`
2. Map placeholder name in `lib/llm_executor.js` → `PLACEHOLDER_TO_PROMPT` object
3. Insert placeholder in `lib/transform.js` where needed in report structure
4. Regenerate schema if adding new fields: `node build_comprehensive_schema.js`

**Status indicator colors:**
- Critical: `#cf3c69` (Violet-500, red dot 🔴)
- Warning: `#ff9e33` (Sunset-300, yellow dot 🟡)
- Healthy: `#5D8C61` (green dot 🟢)

## AI Audit Document Design Principles

When editing the Traffic Light Report or similar single-page documents, follow these principles:

1. **Minimize negative space** - Avoid excessive gaps between sections. Content should feel intentionally dense but readable, not sparse or wasteful.

2. **Top-align headers** - Logo and title should align to the top of their container, not bottom. Use `align-items: flex-start` for header zones.

3. **Readable text sizes** - Body text in fix blocks and content areas should be large enough to fill space purposefully (minimum 0.6875rem/11px). Small text creates unintentional negative space.

4. **Complete footers** - Always include copyright ("Wranngle Systems LLC © All Rights Reserved [YEAR]") and contact info with adequate bottom padding.

5. **Scrollable content** - Documents should scroll naturally (`overflow: auto`), not require zoom-out to view. Avoid `overflow: hidden` on body.

6. **Brand-consistent gradients** - Background gradients should flow from Sand (#fcfaf5) through warmer tones to Violet accents (#f9dce5, #e8b4c4) at the bottom.

7. **Even vertical distribution** - Use `justify-content: space-between` for flex containers with multiple items (like fix blocks) to distribute content evenly.

8. **Decorative breathing room** - Desert/cactus graphics need adequate height (3in+) and lower opacity (0.55) to enhance without overwhelming content.

## Typography

**Fonts:**
- Headings: Outfit (600-800 weight)
- Body: Inter (400-500 weight)

Load from Google Fonts in HTML templates or use system fallbacks for PDF generation.
