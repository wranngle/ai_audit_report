/**
 * Mock LLM Filler - Simulates LLM responses for testing
 *
 * This script fills all 29 LLM placeholders with realistic content
 * based on the Greenfield Property Management intake data.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock LLM responses based on Greenfield Property Management context
const MOCK_RESPONSES = {
  // Document title
  'document_title': 'Maintenance Request Scheduling Process Audit',

  // Scope statement
  'scope_statement': 'This audit examined the end-to-end maintenance request scheduling workflow at Greenfield Property Management, from tenant request submission through technician appointment confirmation. The analysis focused on manual handoffs, data transfer delays, and scheduling bottlenecks impacting SLA compliance.',

  // In-scope items
  'scope_items': [
    'Tenant request intake from AppFolio portal',
    'Coordinator triage and prioritization process',
    'Technician availability checking in Google Calendar',
    'Work order creation in Excel spreadsheet',
    'Tenant confirmation call workflow'
  ],

  // Out-of-scope items
  'out_of_scope': [
    'Technician dispatch and on-site work execution',
    'Parts ordering and inventory management',
    'Billing and payment processing',
    'Tenant satisfaction surveys post-service'
  ],

  // Methodology limitations
  'limitations': [
    'Findings based on stakeholder interview without direct system log validation',
    'Volume and timing estimates are client-reported averages',
    'Sample size limited to single 30-minute intake session'
  ],

  // Executive summary
  'executive_summary': 'Greenfield Property Management\'s maintenance scheduling workflow suffers from significant manual bottlenecks that drive a 15% SLA miss rate and an estimated $4,050 monthly revenue bleed. The core issue is a fragmented tech stack requiring coordinators to manually copy data between five disconnected systems—portal, email, calendar, spreadsheet, and phone—creating delays and error opportunities at each handoff. Implementing automated request intake with calendar integration would eliminate 80% of manual data entry and reduce average scheduling time from 26 hours to under 4 hours.',

  // Scorecard findings - Data Flow
  'finding_summary_0': 'Coordinators manually transcribe request details from portal email notifications into Excel, then cross-reference Google Calendar for technician availability—a process taking 8-12 minutes per request.',
  'finding_risk_0': 'Manual copy-paste introduces transcription errors (wrong addresses, misread priorities) and creates delays during high-volume periods like Monday mornings.',

  // Scorecard findings - Response Time
  'finding_summary_1': 'Average time from request to confirmed appointment is 26 hours, with worst-case delays reaching 4 days. 15% of routine requests miss the 24-hour SLA target.',
  'finding_risk_1': 'SLA violations trigger $150 tenant credits per incident plus staff escalation time. Delayed emergency responses can cause property damage (e.g., burst pipes).',

  // Scorecard findings - Error Rate
  'finding_summary_2': 'Double-bookings occur when calendar isn\'t refreshed before scheduling. Requests buried in email inbox lead to missed appointments and tenant no-shows from delayed confirmation calls.',
  'finding_risk_2': 'Each scheduling error generates an average of 45 minutes of rework plus negative tenant reviews impacting lease renewal rates.',

  // Scorecard findings - Manual Handoffs
  'finding_summary_3': 'Five manual system handoffs per request: Portal → Email → Spreadsheet → Calendar → Phone. Each handoff introduces latency and human decision gates.',
  'finding_risk_3': 'Complexity increases training time for new coordinators and creates single points of failure when experienced staff are unavailable.',

  // Bleed math defender
  'math_defender_text': 'Revenue bleed calculation based on 180 monthly requests × 15% SLA miss rate = 27 violations × $150 average credit = $4,050/month. This conservative estimate excludes indirect costs such as property damage from delayed emergency response, negative review impact on lease renewals, and coordinator overtime during peak periods.',

  // Fix 1 - Automated Intake
  'fix_0_problem': 'Manual copy-paste from portal notifications to work order spreadsheet takes 8-12 minutes per request and introduces transcription errors.',
  'fix_0_solution': 'Implement Zapier integration to automatically create work orders from AppFolio form submissions, populating all required fields without human intervention.',
  'fix_0_impact_basis': 'Eliminates 10 minutes of data entry per request × 180 requests = 30 hours/month coordinator time recovered. Removes transcription error risk entirely.',
  'fix_0_acceptance': 'New maintenance requests appear in work order system within 60 seconds of submission with 100% field accuracy.',

  // Fix 2 - Calendar Integration
  'fix_1_problem': 'Coordinators manually check Google Calendar for each technician\'s availability, often working with stale data and causing double-bookings.',
  'fix_1_solution': 'Deploy real-time calendar sync showing technician availability directly in the scheduling interface, with automatic conflict detection.',
  'fix_1_impact_basis': 'Reduces availability checking from 5 minutes to 30 seconds per request. Prevents double-booking errors (estimated 3-5 per month).',
  'fix_1_acceptance': 'Scheduling interface displays live technician availability with sub-5-second refresh. Zero double-bookings in first 30 days.',

  // Fix 3 - Auto-Confirmation
  'fix_2_problem': 'Manual phone calls to confirm appointments delay the process and create no-shows when calls aren\'t completed promptly.',
  'fix_2_solution': 'Implement automated SMS/email confirmation with tenant self-service rescheduling link, escalating to phone only for unresponsive tenants.',
  'fix_2_impact_basis': 'Reduces confirmation touchpoints by 80%. Tenants confirm within minutes vs. hours. Self-service rescheduling reduces coordinator intervention.',
  'fix_2_acceptance': 'Confirmation sent within 2 minutes of scheduling. 70%+ tenant confirmation rate within 2 hours. Phone follow-up only for non-responders.',

  // CTA
  'cta_headline': 'Ready to Cut Your Scheduling Time by 85%?',
  'cta_subtext': 'Book a 30-minute implementation call to map your current workflow and get a custom automation roadmap for Greenfield Property Management.'
};

/**
 * Fill a single placeholder value
 */
function getPlaceholderValue(path) {
  // Map paths to response keys
  const pathMap = {
    'document.title': 'document_title',
    'audit.scope.scope_statement': 'scope_statement',
    'audit.scope.in_scope[0]': 'scope_items',
    'audit.scope.out_of_scope[0]': 'out_of_scope',
    'audit.methodology.limitations[0]': 'limitations',
    'scorecard.executive_summary.body': 'executive_summary',
    'scorecard.rows[0].finding.summary': 'finding_summary_0',
    'scorecard.rows[0].finding.risk': 'finding_risk_0',
    'scorecard.rows[1].finding.summary': 'finding_summary_1',
    'scorecard.rows[1].finding.risk': 'finding_risk_1',
    'scorecard.rows[2].finding.summary': 'finding_summary_2',
    'scorecard.rows[2].finding.risk': 'finding_risk_2',
    'scorecard.rows[3].finding.summary': 'finding_summary_3',
    'scorecard.rows[3].finding.risk': 'finding_risk_3',
    'bleed.math_defender_text': 'math_defender_text',
    'fixes.items[0].problem': 'fix_0_problem',
    'fixes.items[0].solution': 'fix_0_solution',
    'fixes.items[0].impact.basis': 'fix_0_impact_basis',
    'fixes.items[0].acceptance_criteria[0]': 'fix_0_acceptance',
    'fixes.items[1].problem': 'fix_1_problem',
    'fixes.items[1].solution': 'fix_1_solution',
    'fixes.items[1].impact.basis': 'fix_1_impact_basis',
    'fixes.items[1].acceptance_criteria[0]': 'fix_1_acceptance',
    'fixes.items[2].problem': 'fix_2_problem',
    'fixes.items[2].solution': 'fix_2_solution',
    'fixes.items[2].impact.basis': 'fix_2_impact_basis',
    'fixes.items[2].acceptance_criteria[0]': 'fix_2_acceptance',
    'cta.headline': 'cta_headline',
    'cta.subtext': 'cta_subtext'
  };

  const key = pathMap[path];
  if (!key) return null;

  return MOCK_RESPONSES[key];
}

/**
 * Fill placeholders in a JSON object
 */
function fillPlaceholders(obj, parentPath = '') {
  if (typeof obj === 'string') {
    if (obj.includes('[LLM_PLACEHOLDER')) {
      const value = getPlaceholderValue(parentPath);
      if (value !== null) {
        return value;
      }
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    // Check if this is an array placeholder that should be expanded
    if (obj.length === 1 && typeof obj[0] === 'string' && obj[0].includes('[LLM_PLACEHOLDER')) {
      const value = getPlaceholderValue(parentPath + '[0]');
      if (Array.isArray(value)) {
        return value;
      }
    }
    return obj.map((item, idx) => fillPlaceholders(item, `${parentPath}[${idx}]`));
  }

  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const newPath = parentPath ? `${parentPath}.${key}` : key;
      result[key] = fillPlaceholders(value, newPath);
    }
    return result;
  }

  return obj;
}

/**
 * Main: Fill placeholders in the transformer output
 */
async function main() {
  const inputPath = path.join(__dirname, 'cli_transform_test.json');
  const outputPath = path.join(__dirname, 'report_with_narratives.json');

  console.log('Loading transformer output...');
  const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  console.log('Filling LLM placeholders with mock responses...');
  const filled = fillPlaceholders(report);

  console.log('Writing filled report...');
  fs.writeFileSync(outputPath, JSON.stringify(filled, null, 2));

  // Count remaining placeholders
  const remaining = JSON.stringify(filled).match(/\[LLM_PLACEHOLDER/g) || [];
  console.log(`\nDone! ${29 - remaining.length}/29 placeholders filled.`);
  if (remaining.length > 0) {
    console.log(`Remaining placeholders: ${remaining.length}`);
  }
  console.log(`Output: ${outputPath}`);
}

main().catch(console.error);
