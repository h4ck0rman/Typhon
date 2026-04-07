import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateLabId } from "../docker/exec.js";
import { resolveLabSource } from "../library/catalog.js";
import { fetchLabMetadata } from "../library/client.js";
import { toPublicMetadata } from "../types.js";
import { getLabProgress } from "../state/progress.js";

export function registerGetLabInfo(server: McpServer): void {
  server.registerTool(
    "get_lab_info",
    {
      title: "Get Lab Info",
      description:
        "Get detailed metadata for a specific lab. Flag values are never exposed.",
      inputSchema: {
        labId: z
          .string()
          .describe("Lab identifier (e.g. sqli-01-the-leak)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ labId }) => {
      validateLabId(labId);

      const resolved = await resolveLabSource(labId);
      if (!resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Lab "${labId}" not found. Run list_labs to see available labs.`,
            },
          ],
          isError: true,
        };
      }

      const metadata = await fetchLabMetadata(resolved.source.url, labId);
      const pub = toPublicMetadata(metadata);
      const progress = await getLabProgress(labId);

      const lines = [
        `# ${pub.name}`,
        "",
        `ID: ${pub.id}`,
        `Category: ${pub.category}/${pub.subcategory}`,
        `Difficulty: ${pub.difficulty}`,
        `DB Engine: ${pub.dbEngine}`,
        `Theme: ${pub.appTheme}`,
        `Author: ${pub.author}`,
        `Version: ${pub.version}`,
        `Tags: ${pub.tags.join(", ")}`,
        "",
        `## Description`,
        pub.description,
        "",
        `## Objective`,
        pub.objective,
        "",
        `## Briefing`,
        pub.briefing,
      ];

      if (pub.estimatedMinutes) {
        lines.push("", `Estimated time: ${pub.estimatedMinutes} minutes`);
      }
      if (pub.prerequisites.length > 0) {
        lines.push("", `Prerequisites: ${pub.prerequisites.join(", ")}`);
      }
      if (progress) {
        lines.push(
          "",
          `## Your Progress`,
          `Completed: ${progress.completed ? "Yes" : "No"}`,
          `Attempts: ${progress.attempts}`,
          `Hints used: ${progress.maxHintLevel}`,
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
