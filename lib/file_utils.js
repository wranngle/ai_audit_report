/**
 * file_utils.js - Shared File Organization Utilities
 *
 * Provides consistent file naming, slugification, and output path generation
 * across all Wranngle pipeline tools.
 *
 * Output Structure:
 *   output/
 *     {company_slug}/
 *       {project_slug}/
 *         {type}_{company_slug}_{project_slug}_{timestamp}.{ext}
 *
 * Input Structure:
 *   input/
 *     {descriptive_name}.{ext}
 */

import fs from 'fs';
import path from 'path';

/**
 * Convert any string to a URL-safe slug
 * - Lowercase
 * - Replace non-alphanumeric with underscores
 * - Remove leading/trailing underscores
 * - Collapse multiple underscores
 * - Max 50 characters
 *
 * @param {string} text - Text to slugify
 * @param {number} maxLength - Maximum length (default 50)
 * @returns {string} Slugified text
 */
export function slugify(text, maxLength = 50) {
  if (!text || typeof text !== 'string') {
    return 'unknown';
  }

  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, maxLength);
}

/**
 * Generate consistent timestamp string
 * Format: YYYYMMDD_HHmmss
 *
 * @param {Date} date - Date to format (defaults to now)
 * @returns {string} Formatted timestamp
 */
export function generateTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

/**
 * Generate consistent ISO-style timestamp
 * Format: YYYY-MM-DD_HHmmss
 *
 * @param {Date} date - Date to format (defaults to now)
 * @returns {string} Formatted timestamp
 */
export function generateISOTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}-${month}-${day}_${hours}${minutes}${seconds}`;
}

/**
 * Ensure directory exists, creating it recursively if needed
 *
 * @param {string} dirPath - Directory path to ensure
 * @returns {boolean} True if directory was created, false if it already existed
 */
export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  }
  return false;
}

/**
 * Generate output file path with consistent organization
 *
 * Structure: output/{company}/{project}/{type}_{company}_{project}_{timestamp}.{ext}
 *
 * @param {Object} options - Path generation options
 * @param {string} options.outputDir - Base output directory (default: './output')
 * @param {string} options.type - File type prefix (e.g., 'audit', 'proposal', 'project_plan')
 * @param {string} options.company - Company/client name (will be slugified)
 * @param {string} options.project - Project/workflow name (will be slugified, optional)
 * @param {string} options.ext - File extension (e.g., 'html', 'json', 'pdf')
 * @param {Date} options.timestamp - Timestamp to use (default: now)
 * @param {boolean} options.flat - If true, skip company/project subdirectories
 * @returns {Object} { path, dir, filename, company_slug, project_slug, timestamp }
 */
export function generateOutputPath(options) {
  const {
    outputDir = './output',
    type = 'output',
    company = 'unknown',
    project = null,
    ext = 'html',
    timestamp = new Date(),
    flat = false
  } = options;

  const companySlug = slugify(company);
  const projectSlug = project ? slugify(project) : null;
  const ts = generateTimestamp(timestamp);

  // Build filename
  const filenameParts = [type, companySlug];
  if (projectSlug) {
    filenameParts.push(projectSlug);
  }
  filenameParts.push(ts);
  const filename = `${filenameParts.join('_')}.${ext}`;

  // Build directory path
  let dir;
  if (flat) {
    dir = outputDir;
  } else {
    const dirParts = [outputDir, companySlug];
    if (projectSlug) {
      dirParts.push(projectSlug);
    }
    dir = path.join(...dirParts);
  }

  // Ensure directory exists
  ensureDir(dir);

  const fullPath = path.join(dir, filename);

  return {
    path: fullPath,
    dir,
    filename,
    company_slug: companySlug,
    project_slug: projectSlug,
    timestamp: ts
  };
}

/**
 * Generate related output paths (e.g., .json, .pdf, _polish_log.json for an .html file)
 *
 * @param {string} basePath - Primary output path (e.g., report.html)
 * @param {Array<string>} extensions - Additional extensions to generate
 * @param {Array<string>} suffixes - Additional suffixes before extension (e.g., '_polish_log')
 * @returns {Object} Map of extension/suffix to path
 */
export function generateRelatedPaths(basePath, extensions = [], suffixes = []) {
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const base = path.basename(basePath, ext);

  const paths = {
    primary: basePath
  };

  // Generate paths for different extensions
  for (const newExt of extensions) {
    const key = newExt.replace(/^\./, '');
    paths[key] = path.join(dir, `${base}.${key}`);
  }

  // Generate paths for suffixes (keep original extension)
  for (const suffix of suffixes) {
    const key = suffix.replace(/^_/, '').replace(/_/g, '');
    paths[key] = path.join(dir, `${base}${suffix}${ext}`);
  }

  return paths;
}

/**
 * Generate input file path with consistent naming
 *
 * @param {Object} options - Path generation options
 * @param {string} options.inputDir - Base input directory (default: './input')
 * @param {string} options.name - Descriptive name for the file
 * @param {string} options.ext - File extension
 * @returns {Object} { path, dir, filename }
 */
export function generateInputPath(options) {
  const {
    inputDir = './input',
    name = 'input',
    ext = 'txt'
  } = options;

  const slug = slugify(name);
  const filename = `${slug}.${ext}`;

  ensureDir(inputDir);

  return {
    path: path.join(inputDir, filename),
    dir: inputDir,
    filename
  };
}

/**
 * Move file to old directory instead of deleting
 * Preserves history while cleaning up active directories
 *
 * @param {string} sourcePath - Path to file to move
 * @param {string} oldDir - Old directory path (default: './old')
 * @returns {string|null} New path if moved, null if source didn't exist
 */
export function moveToOld(sourcePath, oldDir = './old') {
  if (!fs.existsSync(sourcePath)) {
    return null;
  }

  ensureDir(oldDir);

  const filename = path.basename(sourcePath);
  const destPath = path.join(oldDir, filename);

  // Handle collision by adding timestamp
  let finalDest = destPath;
  if (fs.existsSync(destPath)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    const ts = generateTimestamp();
    finalDest = path.join(oldDir, `${base}_${ts}${ext}`);
  }

  fs.renameSync(sourcePath, finalDest);
  return finalDest;
}

/**
 * Parse existing output filename to extract metadata
 *
 * @param {string} filename - Filename to parse
 * @returns {Object|null} Parsed metadata or null if not valid format
 */
export function parseOutputFilename(filename) {
  // Expected format: {type}_{company}_{project}_{timestamp}.{ext}
  // or: {type}_{company}_{timestamp}.{ext}

  const ext = path.extname(filename).slice(1);
  const base = path.basename(filename, `.${ext}`);
  const parts = base.split('_');

  if (parts.length < 3) {
    return null;
  }

  // Last part is always timestamp (YYYYMMDD_HHmmss = 15 chars with underscore)
  // But since we split on underscore, timestamp is last 2 parts
  const timestampParts = parts.slice(-2);
  const timestamp = timestampParts.join('_');

  // Validate timestamp format
  if (!/^\d{8}_\d{6}$/.test(timestamp)) {
    return null;
  }

  const type = parts[0];
  const remaining = parts.slice(1, -2);

  let company, project;
  if (remaining.length === 1) {
    company = remaining[0];
    project = null;
  } else if (remaining.length >= 2) {
    company = remaining[0];
    project = remaining.slice(1).join('_');
  } else {
    return null;
  }

  return {
    type,
    company,
    project,
    timestamp,
    ext,
    filename
  };
}

export default {
  slugify,
  generateTimestamp,
  generateISOTimestamp,
  ensureDir,
  generateOutputPath,
  generateRelatedPaths,
  generateInputPath,
  moveToOld,
  parseOutputFilename
};
