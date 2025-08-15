import { z } from "zod";

export const TolerateSchema = z.object({
  // High level toggles to ignore whole categories
  httpErrors: z.boolean().optional(),
  consoleErrors: z.boolean().optional(),
  pageErrors: z.boolean().optional(),
  requestFailures: z.boolean().optional(),
  // Fine-grained allowlists
  httpStatusAllowlist: z.array(z.number()).optional(),
  httpUrlAllowlist: z.array(z.string()).optional(), // substring or regex pattern
  consolePatternAllowlist: z.array(z.string()).optional() // regex patterns
});

export const NavigateStep = z.object({
  action: z.literal("navigate"),
  url: z.string().optional(),     // absolute
  path: z.string().optional()     // relative to baseUrl
});

export const ClickStep = z.object({
  action: z.literal("click"),
  selector: z.string()
});

export const TypeStep = z.object({
  action: z.literal("type"),
  selector: z.string(),
  text: z.string(),
  pressEnter: z.boolean().optional()
});

export const FillStep = z.object({
  action: z.literal("fill"),
  selector: z.string(),
  text: z.string()
});

export const WaitForSelectorStep = z.object({
  action: z.literal("waitForSelector"),
  selector: z.string(),
  state: z.enum(["visible", "hidden", "attached", "detached"]).optional(),
  timeoutMs: z.number().optional()
});

export const ExpectVisibleStep = z.object({
  action: z.literal("expectVisible"),
  selector: z.string(),
  timeoutMs: z.number().optional()
});

export const ExpectTextStep = z.object({
  action: z.literal("expectText"),
  selector: z.string(),
  text: z.string(),
  timeoutMs: z.number().optional()
});

export const WaitMsStep = z.object({
  action: z.literal("wait"),
  ms: z.number().int().positive()
});

export const ScreenshotStep = z.object({
  action: z.literal("screenshot"),
  name: z.string().optional()
});

export const StepSchema = z.discriminatedUnion("action", [
  NavigateStep,
  ClickStep,
  TypeStep,
  FillStep,
  WaitForSelectorStep,
  ExpectVisibleStep,
  ExpectTextStep,
  WaitMsStep,
  ScreenshotStep
]);

export const TestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  baseUrl: z.string().url().optional(),
  steps: z.array(StepSchema).min(1),
  tolerate: TolerateSchema.optional()
});

export type TestDef = z.infer<typeof TestSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Tolerate = z.infer<typeof TolerateSchema>;
