import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCatalog } from "../library/catalog.js";
import { loadProgress } from "../state/progress.js";

export function registerListLabs(server: McpServer): void {
  server.registerTool(
    "list_labs",
    {
      title: "List Labs",
      description:
        "List available CTF labs from all configured libraries. Filter by category, difficulty, or library source.",
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe("Filter by category (e.g. sqli)"),
        difficulty: z
          .enum(["apprentice", "practitioner", "expert"])
          .optional()
          .describe("Filter by difficulty level"),
        source: z
          .string()
          .optional()
          .describe("Filter by library source name"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ category, difficulty, source }) => {
      let labs = await getCatalog();
      const progress = await loadProgress();

      if (category) {
        labs = labs.filter(
          (l) => l.category.toLowerCase() === category.toLowerCase(),
        );
      }
      if (difficulty) {
        labs = labs.filter(
          (l) => l.difficulty.toLowerCase() === difficulty.toLowerCase(),
        );
      }
      if (source) {
        labs = labs.filter(
          (l) => l._libraryName?.toLowerCase() === source.toLowerCase(),
        );
      }

      if (labs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No labs match your filters. Try list_labs with no filters, or run refresh_catalog to update.",
            },
          ],
        };
      }

      const lines = labs.map((lab) => {
        const done = progress.labs[lab.id]?.completed ? "[DONE]" : "[    ]";
        return `${done} ${lab.id} -- ${lab.name} (${lab.difficulty}, ${lab.category}/${lab.subcategory})`;
      });

      lines.unshift(`${labs.length} lab(s) available:\n`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
