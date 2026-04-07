import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateLabId } from "../docker/exec.js";
import { resolveLabSource } from "../library/catalog.js";
import { fetchHints } from "../library/client.js";
import { getLabProgress, recordHintUsed } from "../state/progress.js";

export function registerGetHint(server: McpServer): void {
  server.registerTool(
    "get_hint",
    {
      title: "Get Hint",
      description:
        "Get a hint for a lab. Hints are tiered (level 1 = gentle nudge, higher = more specific). Auto-increments if no level specified.",
      inputSchema: {
        labId: z
          .string()
          .describe("Lab identifier (e.g. sqli-01-the-leak)"),
        level: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Hint level (1 = vague, higher = more specific). Auto-increments if omitted.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ labId, level }) => {
      validateLabId(labId);

      const resolved = await resolveLabSource(labId);
      if (!resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Lab "${labId}" not found.`,
            },
          ],
          isError: true,
        };
      }

      const hintsFile = await fetchHints(resolved.source.url, labId);
      const hints = hintsFile.hints;
      const progress = await getLabProgress(labId);
      const maxSeen = progress?.maxHintLevel ?? 0;

      const targetLevel = level ?? maxSeen + 1;

      const hint = hints.find((h) => h.level === targetLevel);
      if (!hint) {
        if (targetLevel > hints.length) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No more hints available. You have seen all ${hints.length} hint(s) for this lab.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Hint level ${targetLevel} not found for this lab.`,
            },
          ],
          isError: true,
        };
      }

      await recordHintUsed(labId, targetLevel);

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Hint ${targetLevel}/${hints.length}: ${hint.title}`,
              "",
              hint.content,
            ].join("\n"),
          },
        ],
      };
    },
  );
}
