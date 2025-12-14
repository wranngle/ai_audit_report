// render.js - Renders AI Audit report from JSON + Mustache template
import Mustache from "mustache";
import fs from "fs";

const template = fs.readFileSync("ai_audit_template_new.html", "utf8");
const data = JSON.parse(fs.readFileSync("ai_audit_sample_instance_new.json"));

const output = Mustache.render(template, data);

fs.writeFileSync("output_report.html", output);
console.log("Report rendered to output_report.html");
