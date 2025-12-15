/**
 * pdf_generator.js - Automated PDF generation from HTML reports
 *
 * Uses Puppeteer to render HTML and save as PDF with proper styling.
 * Designed for single-page 8.5"x11" Traffic Light Reports.
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * Default PDF options for Traffic Light Reports
 */
const DEFAULT_PDF_OPTIONS = {
  format: 'Letter',
  printBackground: true,
  preferCSSPageSize: true,
  margin: {
    top: '0',
    right: '0',
    bottom: '0',
    left: '0'
  }
};

/**
 * Generate PDF from HTML file
 * @param {string} htmlPath - Path to the HTML file
 * @param {string} pdfPath - Output path for the PDF (optional, defaults to same name with .pdf)
 * @param {Object} options - PDF generation options
 * @returns {Promise<{success: boolean, pdfPath: string, size: number}>}
 */
export async function generatePDF(htmlPath, pdfPath = null, options = {}) {
  // Resolve paths
  const absoluteHtmlPath = path.resolve(htmlPath);

  if (!fs.existsSync(absoluteHtmlPath)) {
    throw new Error(`HTML file not found: ${absoluteHtmlPath}`);
  }

  // Default PDF path: same as HTML but with .pdf extension
  if (!pdfPath) {
    pdfPath = absoluteHtmlPath.replace(/\.html?$/i, '.pdf');
  }
  const absolutePdfPath = path.resolve(pdfPath);

  // Ensure output directory exists
  const outputDir = path.dirname(absolutePdfPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Merge options
  const pdfOptions = {
    ...DEFAULT_PDF_OPTIONS,
    ...options,
    path: absolutePdfPath
  };

  let browser = null;

  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    // Set viewport for consistent rendering
    await page.setViewport({
      width: 816,  // 8.5 inches at 96 DPI
      height: 1056, // 11 inches at 96 DPI
      deviceScaleFactor: 2
    });

    // Load HTML file
    const fileUrl = `file://${absoluteHtmlPath}`;
    await page.goto(fileUrl, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait for fonts to load
    await page.evaluateHandle('document.fonts.ready');

    // Small delay for any final rendering
    await new Promise(resolve => setTimeout(resolve, 500));

    // Generate PDF
    await page.pdf(pdfOptions);

    // Get file size
    const stats = fs.statSync(absolutePdfPath);

    return {
      success: true,
      pdfPath: absolutePdfPath,
      size: stats.size,
      sizeDisplay: `${(stats.size / 1024).toFixed(1)} KB`
    };

  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Generate PDF from HTML string content
 * @param {string} htmlContent - HTML content as string
 * @param {string} pdfPath - Output path for the PDF
 * @param {Object} options - PDF generation options
 * @returns {Promise<{success: boolean, pdfPath: string, size: number}>}
 */
export async function generatePDFFromContent(htmlContent, pdfPath, options = {}) {
  const absolutePdfPath = path.resolve(pdfPath);

  // Ensure output directory exists
  const outputDir = path.dirname(absolutePdfPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Merge options
  const pdfOptions = {
    ...DEFAULT_PDF_OPTIONS,
    ...options,
    path: absolutePdfPath
  };

  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    await page.setViewport({
      width: 816,
      height: 1056,
      deviceScaleFactor: 2
    });

    // Set content directly
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait for fonts to load
    await page.evaluateHandle('document.fonts.ready');

    // Small delay for any final rendering
    await new Promise(resolve => setTimeout(resolve, 500));

    // Generate PDF
    await page.pdf(pdfOptions);

    const stats = fs.statSync(absolutePdfPath);

    return {
      success: true,
      pdfPath: absolutePdfPath,
      size: stats.size,
      sizeDisplay: `${(stats.size / 1024).toFixed(1)} KB`
    };

  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
PDF Generator - Convert HTML reports to PDF

Usage:
  node lib/pdf_generator.js <input.html> [output.pdf]

Examples:
  node lib/pdf_generator.js samples/healthcare_report.html
  node lib/pdf_generator.js samples/report.html output/report.pdf
`);
    process.exit(0);
  }

  const htmlPath = args[0];
  const pdfPath = args[1] || null;

  console.log(`Generating PDF from ${htmlPath}...`);

  try {
    const result = await generatePDF(htmlPath, pdfPath);
    console.log(`✓ PDF saved: ${result.pdfPath} (${result.sizeDisplay})`);
  } catch (error) {
    console.error(`✗ PDF generation failed: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1]?.endsWith('pdf_generator.js')) {
  main();
}
