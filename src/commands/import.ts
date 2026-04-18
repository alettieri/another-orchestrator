import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { XMLParser } from "fast-xml-parser";
import TurndownService from "turndown";
import {
  type LoadConfigOptions,
  resolveOrchestratorHome,
} from "../core/config.js";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
});

const JIRA_SPRINT_FIELD_KEY = "com.pyxis.greenhopper.jira:gh-sprint";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep description and comment content as raw HTML strings so turndown can convert them
  stopNodes: ["*.description", "*.comment"],
  isArray: (name) =>
    ["item", "comment", "customfield", "customfieldvalue"].includes(name),
});

function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return turndown.turndown(html).trim();
}

function extractAcceptanceCriteria(markdown: string): string {
  const pattern =
    /^#{1,4}\s+(acceptance criteria|ac|definition of done|requirements)\s*$/im;
  const match = markdown.match(pattern);
  if (!match || match.index === undefined) return "";

  const afterHeading = markdown.slice(match.index + match[0].length).trim();
  const nextHeading = afterHeading.match(/^#{1,4}\s+/m);
  return nextHeading?.index !== undefined
    ? afterHeading.slice(0, nextHeading.index).trim()
    : afterHeading.trim();
}

interface Comment {
  author: string;
  date: string;
  body: string;
}

interface Issue {
  id: string;
  title: string;
  type: string;
  sprint: string;
  url: string;
  status: string;
  description: string;
  acceptanceCriteria: string;
  comments: Comment[];
}

// biome-ignore lint/suspicious/noExplicitAny: fast-xml-parser returns untyped objects
type XmlNode = any;

function parseComments(item: XmlNode): Comment[] {
  const comments: XmlNode[] = item.comments?.comment ?? [];
  return comments.map((c: XmlNode) => ({
    author: c["@_author"] ?? "unknown",
    date: c["@_created"] ?? "",
    body: htmlToMarkdown(c["#text"] ?? ""),
  }));
}

function parseSprintValues(item: XmlNode): string[] {
  const customfields: XmlNode[] = item.customfields?.customfield ?? [];
  const sprintField = customfields.find(
    (f: XmlNode) => f["@_key"] === JIRA_SPRINT_FIELD_KEY,
  );
  if (!sprintField) return [];
  const values: XmlNode[] =
    sprintField.customfieldvalues?.customfieldvalue ?? [];
  return values.map((v: XmlNode) => v["#text"] ?? v);
}

function parseItem(item: XmlNode): Issue {
  const descriptionMd = htmlToMarkdown(item.description ?? "");
  const sprints = parseSprintValues(item);
  return {
    id: item.key?.["#text"] ?? item.key ?? "",
    title: item.summary ?? "",
    type: item.type?.["#text"] ?? item.type ?? "",
    url: item.link ?? "",
    status: item.status?.["#text"] ?? item.status ?? "",
    sprint: sprints.at(-1) ?? "",
    description: descriptionMd,
    acceptanceCriteria: extractAcceptanceCriteria(descriptionMd),
    comments: parseComments(item),
  };
}

function buildMarkdown(issue: Issue): string {
  const lines = [
    "---",
    `id: ${issue.id}`,
    `title: "${issue.title.replace(/"/g, '\\"')}"`,
    `type: ${issue.type}`,
    ...(issue.sprint ? [`sprint: "${issue.sprint}"`] : []),
    ...(issue.url ? [`url: ${issue.url}`] : []),
    ...(issue.status ? [`status: "${issue.status}"`] : []),
    "---",
    "",
    "## Description",
    "",
    issue.description || "_No description provided._",
    "",
    "## Acceptance Criteria",
    "",
    issue.acceptanceCriteria ||
      "_No acceptance criteria found. Fill in before running the orchestrator._",
    "",
  ];

  if (issue.comments.length > 0) {
    lines.push("## Comments", "");
    for (const comment of issue.comments) {
      lines.push(
        `**${comment.author}** (${comment.date})`,
        "",
        comment.body,
        "",
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function convertJiraXml(xmlPath: string, outputDir: string): string[] {
  const xml = readFileSync(xmlPath, "utf-8");
  const parsed = parser.parse(xml);
  const items: XmlNode[] = parsed?.rss?.channel?.item ?? [];

  if (items.length === 0)
    throw new Error("No <item> elements found in the XML file.");

  mkdirSync(outputDir, { recursive: true });

  const written: string[] = [];
  for (const item of items) {
    const issue = parseItem(item);
    if (!issue.id) {
      console.warn(chalk.yellow("Warning:"), "Skipping item with no key.");
      continue;
    }
    const outputPath = join(outputDir, `${issue.id}.md`);
    writeFileSync(outputPath, buildMarkdown(issue), "utf-8");
    written.push(outputPath);
  }
  return written;
}

export function register(
  program: Command,
  _getConfigOptions: () => LoadConfigOptions,
): void {
  program
    .command("import <file>")
    .description(
      "Convert a JIRA XML export to Markdown issue files in ~/.orchestrator/issues/",
    )
    .option("-o, --out <dir>", "Output directory")
    .action((file: string, opts: { out?: string }) => {
      const outputDir = opts.out ?? join(resolveOrchestratorHome(), "issues");
      try {
        const written = convertJiraXml(file, outputDir);
        for (const path of written) {
          console.log(`${chalk.green("✓")} ${path}`);
        }
        console.log(
          chalk.dim(`\n${written.length} issue(s) written to ${outputDir}`),
        );
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });
}
