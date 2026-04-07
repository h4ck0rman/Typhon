import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateLabId } from "../docker/exec.js";
import { appendFeedback, loadFeedback } from "../state/feedback.js";
import { auditLog } from "../state/audit.js";
import { feedbackRateLimiter } from "../state/rate-limit.js";

const MAX_FEEDBACK_ENTRIES = 1000;

export function registerSubmitFeedback(server: McpServer): void {
  server.registerTool(
    "submit_feedback",
    {
      title: "Submit Feedback",
      description:
        "Submit feedback about a lab or the platform in general.",
      inputSchema: {
        labId: z
          .string()
          .optional()
          .describe("Lab identifier (optional, omit for general feedback)"),
        rating: z
          .number()
          .int()
          .min(1)
          .max(5)
          .describe("Rating from 1 (poor) to 5 (excellent)"),
        comment: z
          .string()
          .max(2000)
          .optional()
          .describe("Free-form feedback comment (max 2000 chars)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ labId, rating, comment }) => {
      if (labId) {
        validateLabId(labId);
      }

      if (!feedbackRateLimiter.check("global")) {
        await auditLog({ severity: "warn", event: "feedback_rate_limited" });
        return {
          content: [
            {
              type: "text" as const,
              text: "Too many feedback submissions. Wait a moment before trying again (max 5 per minute).",
            },
          ],
          isError: true,
        };
      }

      const store = await loadFeedback();
      if (store.entries.length >= MAX_FEEDBACK_ENTRIES) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Feedback storage is full (${MAX_FEEDBACK_ENTRIES} entries). Please clear old feedback before submitting more.`,
            },
          ],
          isError: true,
        };
      }

      await appendFeedback({
        labId: labId ?? null,
        rating,
        comment: comment ?? null,
        submittedAt: new Date().toISOString(),
      });

      return {
        content: [
          {
            type: "text" as const,
            text: "Thank you for your feedback!",
          },
        ],
      };
    },
  );
}
