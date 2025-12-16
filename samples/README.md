# Sample Business Process Audit Scenarios

This directory contains input scenarios and showcase reports for the AI Audit Report Generator.

## Input Scenarios (Text Files)

### Core Scenarios

| File | Client | Industry | Process | Bleed |
|------|--------|----------|---------|-------|
| `healthcare_intake.txt` | Riverside Medical Group | Healthcare | Patient intake | $27,000/mo |
| `ecommerce_fulfillment.txt` | HomeGoods Express | E-commerce | Order fulfillment | $10,500/mo |
| `legal_contract_review.txt` | Morrison & Associates | Legal | Contract review | $100,500/mo |
| `support_ticket_routing.txt` | CloudTech Solutions | SaaS | Support tickets | $31,500/mo |

### Stress Test Scenarios

Various input formats to test extraction robustness:

| File | Format Style | Size |
|------|--------------|------|
| `stress_test_informal_chat.txt` | Slack/casual | 1KB |
| `stress_test_sparse_bullets.txt` | Minimal bullets | 305B |
| `stress_test_email_thread.txt` | Email thread | 1.5KB |
| `stress_test_verbose_narrative.txt` | Long prose | 2.9KB |
| `stress_test_mixed_messy.txt` | Mixed formatting | 1.3KB |
| `stress_test_minimal_edge.txt` | Bare minimum | 192B |
| `stress_test_qa_transcript.txt` | Interview Q&A | 1.8KB |

---

## Showcase Reports

Professional sample reports ready for client demos:

| Report | Client | Industry | Bleed |
|--------|--------|----------|-------|
| `wranngle_audit_morrison_law_contract_review.pdf` | Morrison & Associates | Legal | $100,500/mo |
| `wranngle_audit_acme_supply_inventory.pdf` | Acme Supply Co | Retail/Supply Chain | $30,000/mo |

---

## Usage

Generate a report from any input file:

```bash
# Standard generation
node cli.js generate samples/healthcare_intake.txt my_report.html

# Save intermediate JSON files
node cli.js generate samples/healthcare_intake.txt my_report.html --save-json

# Use Groq fallback when Gemini quota exhausted
node cli.js generate samples/healthcare_intake.txt my_report.html --use-groq
```

## Minimum Input Requirements

The system can generate reports from as little as 7 lines of text:

```
company name
workflow name
volume (e.g., "100/month")
time taken (e.g., "4 hours")
error rate (e.g., "20%")
cost impact (e.g., "$5k/month")
systems used
```

See `stress_test_minimal_edge.txt` for the minimum viable input example.
