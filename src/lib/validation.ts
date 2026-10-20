import { z } from "zod";

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

/** Canonical workspace-name form for duplicate detection: trimmed,
 *  case-insensitive, collapsed inner whitespace. */
export function normalizeWorkspaceName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when a database error is a uniqueness/duplicate-key violation
 *  (SQLite and PostgreSQL shapes). Used to map race-safe constraint
 *  errors to friendly duplicate messages without leaking SQL. */
export function isUniqueViolation(error: unknown) {
  if (error != null && typeof error === "object" && (error as { code?: unknown }).code === "23505") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /unique|duplicate|UNIQUE constraint failed/i.test(message);
}

export function normalizeSignupInput(input: unknown) {
  if (!input || typeof input !== "object") return {} as Record<string, unknown>;

  const value = input as Record<string, unknown>;
  return {
    companyName: typeof value.companyName === "string" ? value.companyName.trim() : "",
    name: typeof value.name === "string" ? value.name.trim() : "",
    email: normalizeEmail(value.email),
    password: typeof value.password === "string" ? value.password : "",
    phone: typeof value.phone === "string" && value.phone.trim() ? value.phone.trim() : undefined,
  };
}

export const signupSchema = z.object({
  companyName: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(2, "Company name is required.").max(120, "Company name must be at most 120 characters.")
  ),
  name: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(2, "Your name is required.").max(120, "Your name must be at most 120 characters.")
  ),
  email: z.preprocess(
    (value) => normalizeEmail(value),
    z.string().email("Please enter a valid email address.")
  ),
  password: z.preprocess(
    (value) => (typeof value === "string" ? value : value),
    z.string().min(8, "Password must be at least 8 characters.").max(200, "Password must be at most 200 characters.")
  ),
  phone: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(6, "Phone number must be at least 6 characters.").max(20, "Phone number must be at most 20 characters.").optional()
  ),
});

export const buyerSignupSchema = z.object({
  name: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(2, "Your name is required.").max(120, "Your name must be at most 120 characters.")
  ),
  email: z.preprocess(
    (value) => normalizeEmail(value),
    z.string().email("Please enter a valid email address.")
  ),
  password: z.preprocess(
    (value) => (typeof value === "string" ? value : value),
    z.string().min(8, "Password must be at least 8 characters.").max(200, "Password must be at most 200 characters.")
  ),
  phone: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(6, "Phone number must be at least 6 characters.").max(20, "Phone number must be at most 20 characters.").optional()
  ),
});

export function normalizeBuyerSignupInput(input: unknown) {
  if (!input || typeof input !== "object") return {} as Record<string, unknown>;

  const value = input as Record<string, unknown>;
  return {
    name: typeof value.name === "string" ? value.name.trim() : "",
    email: normalizeEmail(value.email),
    password: typeof value.password === "string" ? value.password : "",
    phone: typeof value.phone === "string" && value.phone.trim() ? value.phone.trim() : undefined,
  };
}

export function validateBuyerSignupInput(input: unknown) {
  const normalized = normalizeBuyerSignupInput(input);
  const parsed = buyerSignupSchema.safeParse(normalized);
  if (parsed.success) return null;

  return {
    message: parsed.error.issues[0]?.message ?? "Please check your details and try again.",
    code: "VALIDATION_ERROR",
  };
}

export function validateSignupInput(input: unknown) {
  const normalized = normalizeSignupInput(input);
  const parsed = signupSchema.safeParse(normalized);
  if (parsed.success) return null;

  return {
    message: parsed.error.issues[0]?.message ?? "Please check your details and try again.",
    code: "VALIDATION_ERROR",
  };
}

export const forgotPasswordSchema = z.object({
  email: z.preprocess((value) => normalizeEmail(value), z.string().email("Please enter a valid email address.")),
});

export function validateForgotPasswordInput(input: unknown) {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (parsed.success) return null;

  return {
    message: parsed.error.issues[0]?.message ?? "Please check your email and try again.",
    code: "VALIDATION_ERROR",
  };
}

export const passwordResetSchema = z.object({
  token: z.string().min(1, "Reset token is required."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200, "Password must be at most 200 characters."),
});

export function validatePasswordResetInput(input: unknown) {
  const parsed = passwordResetSchema.safeParse(input);
  if (parsed.success) return null;

  return {
    message: parsed.error.issues[0]?.message ?? "Please check your reset details and try again.",
    code: "VALIDATION_ERROR",
  };
}

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(200, "Password must be at most 200 characters."),
    newPassword: z.string().min(8, "Password must be at least 8 characters.").max(200, "Password must be at most 200 characters."),
    confirmNewPassword: z.string().min(1, "Confirm your new password.").max(200, "Password must be at most 200 characters."),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "New passwords do not match.",
    path: ["confirmNewPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "New password must be different from your current password.",
    path: ["newPassword"],
  });

export function validateChangePasswordInput(input: unknown) {
  const parsed = changePasswordSchema.safeParse(input);
  if (parsed.success) return null;

  return {
    message: parsed.error.issues[0]?.message ?? "Please check your password details and try again.",
    code: "VALIDATION_ERROR" as const,
  };
}

const leadBaseShape = {
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  source: z.enum(["WEBSITE_CHAT", "WEBSITE_FORM", "WHATSAPP", "INSTAGRAM", "FACEBOOK", "EMAIL", "API", "MANUAL", "VOICE"]),
  preferredCity: z.string().trim().max(80).optional(),
  preferredLocality: z.string().trim().max(120).optional(),
  propertyType: z.enum(["APARTMENT", "VILLA", "PLOT", "INDEPENDENT_HOUSE", "COMMERCIAL"]).optional(),
  bhk: z.number().int().min(1).max(10).optional(),
  budgetMinInr: z.number().int().min(0).max(10000000000).optional(),
  budgetMaxInr: z.number().int().min(0).max(10000000000).optional(),
  purpose: z.enum(["BUY", "RENT", "INVEST"]).optional(),
  timeline: z.string().trim().max(120).optional(),
};

function budgetRangeIsValid(data: { budgetMinInr?: number; budgetMaxInr?: number }) {
  return data.budgetMinInr == null || data.budgetMaxInr == null || data.budgetMaxInr >= data.budgetMinInr;
}

export const leadCreateSchema = z.object(leadBaseShape).refine(budgetRangeIsValid, {
  message: "Maximum budget must be greater than or equal to minimum budget.",
  path: ["budgetMaxInr"],
});

export const leadUpdateSchema = z
  .object({
    ...leadBaseShape,
    source: leadBaseShape.source.optional(),
    status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "INTERESTED", "SITE_VISIT_SCHEDULED", "NEGOTIATION", "CONVERTED", "LOST", "NURTURE"]).optional(),
    assignedAgentId: z.string().max(64).optional().nullable(),
    optedOut: z.boolean().optional(),
  })
  .refine(budgetRangeIsValid, {
    message: "Maximum budget must be greater than or equal to minimum budget.",
    path: ["budgetMaxInr"],
  });

const propertyBaseShape = {
  projectName: z.string().trim().min(2).max(160),
  developer: z.string().trim().max(120).optional(),
  propertyType: z.enum(["APARTMENT", "VILLA", "PLOT", "INDEPENDENT_HOUSE", "COMMERCIAL"]),
  bhk: z.number().int().min(1).max(10).optional(),
  city: z.string().trim().min(2).max(80),
  locality: z.string().trim().min(2).max(120),
  address: z.string().trim().max(300).optional(),
  priceMinInr: z.number().int().min(0).max(10000000000),
  priceMaxInr: z.number().int().min(0).max(10000000000),
  areaSqft: z.number().int().min(0).max(1000000).optional(),
  floor: z.string().trim().max(40).optional(),
  amenitiesJson: z.string().max(8000).optional(),
  parking: z.boolean().optional(),
  possessionDate: z.string().trim().max(40).optional(),
  availability: z.enum(["AVAILABLE", "LIMITED", "SOLD_OUT", "UPCOMING"]).optional(),
  furnishing: z.enum(["UNFURNISHED", "SEMI_FURNISHED", "FULLY_FURNISHED"]).optional(),
  description: z.string().trim().max(4000).optional(),
};

function priceRangeIsValid(data: { priceMinInr?: number; priceMaxInr?: number }) {
  // Full creates always carry both prices; partial updates may carry only
  // one side, which cannot be range-checked without the stored row — so the
  // refinement only fires when both bounds are present.
  if (data.priceMinInr == null || data.priceMaxInr == null) return true;
  return data.priceMaxInr >= data.priceMinInr;
}

export const propertySchema = z.object(propertyBaseShape).refine(priceRangeIsValid, {
  message: "Maximum price must be greater than or equal to minimum price.",
  path: ["priceMaxInr"],
});

export const propertyUpdateSchema = z.object(propertyBaseShape).partial().refine(priceRangeIsValid, {
  message: "Maximum price must be greater than or equal to minimum price.",
  path: ["priceMaxInr"],
});

export const messageInSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  channel: z.enum(["WEBSITE_CHAT", "WHATSAPP", "INSTAGRAM", "FACEBOOK", "EMAIL"]).default("WEBSITE_CHAT"),
  leadId: z.string().max(64).optional(),
});

export const appointmentSchema = z.object({
  leadId: z.string().min(1).max(64),
  propertyId: z.string().max(64).optional(),
  agentId: z.string().max(64).optional(),
  type: z.enum(["SITE_VISIT", "CALL", "MEETING"]),
  scheduledAt: z.string().min(1).max(64).refine(
    (value) => !Number.isNaN(Date.parse(value)),
    { message: "Scheduled time must be a valid date and time." }
  ),
  notes: z.string().trim().max(1000).optional(),
});
