# Sample Business Process Audit Scenarios

This directory contains diverse sample scenarios demonstrating the AI Audit Report Generator across different industries and process types.

## Scenarios

### 1. Healthcare - Patient Intake (`healthcare_intake.txt`)
**Client:** Riverside Medical Group
**Industry:** Healthcare / Medical Practice
**Process:** New patient intake and appointment scheduling
**Volume:** 450 new patients/month
**Key Problems:**
- 30% no-show rate due to incomplete paperwork
- 72-hour average intake time (48-hour SLA target)
- 15% data entry error rate on critical medical information
- Manual insurance verification taking 45 min/patient
- 7 disconnected systems causing bottlenecks

**Revenue Bleed:** $27,000/month from no-shows

**Automation Opportunities:**
- Digital intake forms with auto-send
- Automated insurance verification API integration
- EHR data sync to eliminate manual entry
- Real-time tracking dashboard

---

### 2. E-commerce - Order Fulfillment (`ecommerce_fulfillment.txt`)
**Client:** HomeGoods Express
**Industry:** E-commerce / Retail
**Process:** Order fulfillment from Shopify to shipment
**Volume:** 2,800 orders/month
**Key Problems:**
- 25% of orders miss 24-hour shipping SLA
- Inventory spreadsheet out of sync causes 8% overselling
- Manual shipping label generation and tracking updates
- Items can't be found in warehouse (no location tracking)
- 10% tracking number entry errors

**Revenue Bleed:** ~$10,500/month from delays and overselling

**Automation Opportunities:**
- Real-time Shopify-inventory sync
- Auto-generate shipping labels via API
- Warehouse location tracking system
- Automated tracking number updates

---

### 3. Legal Services - Contract Review (`legal_contract_review.txt`)
**Client:** Morrison & Associates Law Firm
**Industry:** Legal Services / Corporate Law
**Process:** Vendor contract reviews for corporate clients
**Volume:** 85 contracts/month
**Key Problems:**
- 40% of contracts miss 3-day SLA
- No standardized clause library - attorneys re-invent wheel
- Inconsistent risk assessment between associates and partners
- Version control issues on multi-person edits
- $12,000/month billing leakage from poor time tracking

**Revenue Bleed:** ~$18,000/month from delays and billing leakage

**Automation Opportunities:**
- AI-powered clause library with semantic search
- Automated risk flagging for problematic clauses
- Template-based contract generation
- Automated time tracking integration

---

### 4. SaaS - Customer Support Ticket Routing (`support_ticket_routing.txt`)
**Client:** CloudTech Solutions
**Industry:** SaaS / Software
**Process:** Support ticket routing and resolution
**Volume:** 1,200 tickets/month
**Key Problems:**
- 35% of tickets miss 2-hour first response SLA
- Manual routing creates support manager bottleneck
- 20% miscategorization rate requiring re-routing
- No integration between Zendesk and Jira (duplicate work)
- Outdated knowledge base - specialists can't find solutions

**Revenue Bleed:** ~$31,500/month from SLA misses

**Automation Opportunities:**
- Auto-route tickets using ML classification
- Zendesk-Jira integration for bug tracking
- AI-powered knowledge base search
- Automated engineering team notifications for urgent issues

---

## Usage

To generate a report from any scenario:

```bash
# Full pipeline with LLM narratives (requires GEMINI_API_KEY)
node cli.js generate samples/healthcare_intake.txt samples/healthcare_report.html --save-json

# Use Groq API when Gemini quota is exhausted (requires GROQ_API_KEY)
node cli.js generate samples/healthcare_intake.txt samples/healthcare_report.html --save-json --use-groq

# Quick structure without narratives (for testing)
node cli.js generate samples/healthcare_intake.txt samples/healthcare_report.html --save-json --skip-llm
```

## Generated Reports

All four scenario reports have been successfully generated:

| Report | Measurements | Revenue Bleed | HTML Size | LLM Placeholders | Status |
|--------|--------------|---------------|-----------|------------------|--------|
| **Healthcare** | 9 metrics | $27,000/mo | 33.2 KB | 29 | ✅ Generated |
| **E-commerce** | 13 metrics | $13,860/mo | 33.8 KB | 33 | ✅ Generated |
| **Legal** | 17 metrics | $100,500/mo | 35.5 KB | 37 | ✅ Generated |
| **SaaS Support** | 10 metrics | $27,563/mo | 34.7 KB | 37 | ✅ Generated |

**Note:** All reports were generated with `--skip-llm` flag due to Gemini API free tier quota limits. LLM placeholders indicate where narrative text would appear in a full generation. The data extraction, metrics calculation, and report structure are complete.

## Output Files

Generated reports include:
- **HTML Report** - Single-page Traffic Light diagnostic report
- **JSON Report** - Structured data with all metrics and findings
- **Intake JSON** - Extracted workflow definition
- **Measurements JSON** - Extracted metrics with thresholds

## Scenario Diversity

These scenarios demonstrate the pipeline's versatility across:
- **Industries:** Healthcare, E-commerce, Legal, SaaS
- **Process Types:** Customer-facing, internal operations, professional services, technical support
- **Volumes:** 85/month (legal) to 2,800/month (e-commerce)
- **SLA Targets:** 2 hours (support) to 48 hours (healthcare)
- **Automation Complexity:** Simple integrations to complex AI/ML solutions

All scenarios are realistic, based on common pain points in each industry vertical.
