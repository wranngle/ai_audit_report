/**
 * Wranngle AI Audit Traffic Light Report Data Model
 * SKU: WR-AI-AUDIT-100
 *
 * Use this type definition when rendering ai_audit_draft_sample.html
 * with templating engines (Handlebars, EJS, Mustache, etc.)
 */

export type Status = 'critical' | 'warning' | 'healthy';
export type StepState = 'complete' | 'current' | 'upcoming';

export interface MetricChip {
  label: string;
  value: string;
}

export interface Finding {
  metrics?: {
    yours: MetricChip;
    benchmark: MetricChip;
  };
  text: string;
  risk?: string;
  meta?: string;
}

export interface ScorecardRow {
  category: string;
  status: Status;
  finding: Finding;
}

export interface BleedBreakdownItem {
  status: 'critical' | 'warning';
  label: string;
  amount: string;
}

export interface Bleed {
  totalAmount: string;
  period: string;
  breakdown: BleedBreakdownItem[];
  assumptions?: string;
}

export interface Fix {
  status: Status;
  problem: string;
  fix: string;
  impact: string;
  pills?: string[];
}

export interface CTAStep {
  label: string;
  state: StepState;
}

export interface CTA {
  steps: CTAStep[];
  headline: string;
  subtext: string;
  link: {
    url: string;
    display: string;
  };
}

export interface Footer {
  contactName: string;
  contactEmail: string;
  website: string;
  sku: string;
  copyrightYear?: number;
}

export interface AIAuditReport {
  client: {
    name: string;
    reportDate: string; // ISO date format YYYY-MM-DD
  };
  executiveSummary: {
    bodyText: string; // supports {{bleedAmount}} placeholder
    bleedAmount: string;
  };
  scorecard: ScorecardRow[];
  bleed: Bleed;
  fixes: Fix[];
  cta: CTA;
  footer: Footer;
}
