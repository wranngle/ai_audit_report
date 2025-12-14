// render_test.js - Renders test run report from JSON + Mustache template
import Mustache from "mustache";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parentDir = path.join(__dirname, "..");

const template = fs.readFileSync(path.join(parentDir, "ai_audit_template_new.html"), "utf8");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "report_instance.json")));

const output = Mustache.render(template, data);

fs.writeFileSync(path.join(__dirname, "output_test_report.html"), output);
console.log("Test report rendered to test_run/output_test_report.html");
