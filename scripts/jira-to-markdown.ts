#!/usr/bin/env tsx
/**
 * jira-to-markdown.ts
 *
 * Converts a JIRA XML RSS export to Markdown issue files in ~/.orchestrator/issues/.
 *
 * Usage:
 *   tsx scripts/jira-to-markdown.ts <path-to-export.xml>
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });

function parseXmlText(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

function parseXmlAttr(xml: string, tag: string, attr: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i"));
  return match ? match[1].trim() : "";
}

function parseAllMatches(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
  return xml.match(re) ?? [];
}

function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return turndown.turndown(html).trim();
}

function extractAcceptanceCriteria(markdown: string): string {
  const headingPatterns = [
    /^#{1,4}\s+(acceptance criteria|ac|definition of done|requirements)\s*$/im,
  ];
  for (const pattern of headingPatterns) {
    const match = markdown.match(pattern);
    if (!match || match.index === undefined) continue;

    const afterHeading = markdown.slice(match.index + match[0].length).trim();
    // Take everything up to the next heading
    const nextHeading = afterHeading.match(/^#{1,4}\s+/m);
    const section = nextHeading?.index !== undefined
      ? afterHeading.slice(0, nextHeading.index).trim()
      : afterHeading.trim();

    if (section) return section;
  }
  return "";
}

function parseComments(itemXml: string): Array<{ author: string; date: string; body: string }> {
  const commentBlocks = parseAllMatches(itemXml, "comment");
  return commentBlocks.map((block) => {
    const author = parseXmlAttr(block, "comment", "author");
    const created = parseXmlAttr(block, "comment", "created");
    const inner = block.replace(/^<comment[^>]*>/, "").replace(/<\/comment>$/, "").trim();
    return {
      author: author || "unknown",
      date: created || "",
      body: htmlToMarkdown(inner),
    };
  });
}

function parseSprintValues(itemXml: string): string[] {
  // Find the sprint custom field block
  const sprintFieldMatch = itemXml.match(
    /<customfield[^>]*key="com\.pyxis\.greenhopper\.jira:gh-sprint"[^>]*>([\s\S]*?)<\/customfield>/i,
  );
  if (!sprintFieldMatch) return [];
  const fieldBlock = sprintFieldMatch[1];
  const values = parseAllMatches(fieldBlock, "customfieldvalue");
  return values.map((v) => v.replace(/<customfieldvalue[^>]*>/, "").replace(/<\/customfieldvalue>/, "").trim());
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
  comments: Array<{ author: string; date: string; body: string }>;
}

function parseItem(itemXml: string): Issue {
  const key = parseXmlText(itemXml, "key");
  const summary = parseXmlText(itemXml, "summary");
  const type = parseXmlText(itemXml, "type");
  const link = parseXmlText(itemXml, "link");
  const status = parseXmlText(itemXml, "status");
  const descriptionHtml = parseXmlText(itemXml, "description");

  const descriptionMd = htmlToMarkdown(descriptionHtml);
  const acceptanceCriteria = extractAcceptanceCriteria(descriptionMd);

  const sprints = parseSprintValues(itemXml);
  const sprint = sprints.length > 0 ? sprints[sprints.length - 1] : "";

  const comments = parseComments(itemXml);

  return { id: key, title: summary, type, sprint, url: link, status, description: descriptionMd, acceptanceCriteria, comments };
}

function buildMarkdown(issue: Issue): string {
  const frontmatter = [
    "---",
    `id: ${issue.id}`,
    `title: "${issue.title.replace(/"/g, '\\"')}"`,
    `type: ${issue.type}`,
    issue.sprint ? `sprint: "${issue.sprint}"` : null,
    issue.url ? `url: ${issue.url}` : null,
    issue.status ? `status: "${issue.status}"` : null,
    "---",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const sections: string[] = [frontmatter, ""];

  sections.push("## Description", "");
  sections.push(issue.description || "_No description provided._", "");

  sections.push("## Acceptance Criteria", "");
  sections.push(issue.acceptanceCriteria || "_No acceptance criteria found. Fill in before running the orchestrator._", "");

  if (issue.comments.length > 0) {
    sections.push("## Comments", "");
    for (const comment of issue.comments) {
      sections.push(`**${comment.author}** (${comment.date})`, "");
      sections.push(comment.body, "");
    }
  }

  return sections.join("\n").trimEnd() + "\n";
}

function main() {
  const xmlPath = process.argv[2];
  if (!xmlPath) {
    console.error("Usage: tsx scripts/jira-to-markdown.ts <path-to-export.xml>");
    process.exit(1);
  }

  const xml = readFileSync(xmlPath, "utf-8");

  const items = parseAllMatches(xml, "item");
  if (items.length === 0) {
    console.error("No <item> elements found in the XML file.");
    process.exit(1);
  }

  const outputDir = join(homedir(), ".orchestrator", "issues");
  mkdirSync(outputDir, { recursive: true });

  for (const itemXml of items) {
    const issue = parseItem(itemXml);
    if (!issue.id) {
      console.warn("Skipping item with no key.");
      continue;
    }
    const outputPath = join(outputDir, `${issue.id}.md`);
    writeFileSync(outputPath, buildMarkdown(issue), "utf-8");
    console.log(`Written: ${outputPath}`);
  }
}

main();
