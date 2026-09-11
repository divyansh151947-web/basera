import { z } from "zod";

export const signupSchema = z.object({
  companyName: z.string().min(2).max(120),
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  phone: z.string().min(6).max(20).optional(),
});

export const leadCreateSchema = z.object({
  name: z.string().max(120).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal("")),
  source: z.enum(["WEBSITE_CHAT", "WEBSITE_FORM", "WHATSAPP", "INSTAGRAM", "FACEBOOK", "EMAIL", "API", "MANUAL"]),
  preferredCity: z.string().max(80).optional(),
  preferredLocality: z.string().max(120).optional(),
  propertyType: z.enum(["APARTMENT", "VILLA", "PLOT", "INDEPENDENT_HOUSE", "COMMERCIAL"]).optional(),
  bhk: z.number().int().min(1).max(10).optional(),
  budgetMinInr: z.number().int().min(0).optional(),
  budgetMaxInr: z.number().int().min(0).optional(),
  purpose: z.enum(["BUY", "RENT", "INVEST"]).optional(),
  timeline: z.string().max(120).optional(),
});

export const leadUpdateSchema = leadCreateSchema.partial().extend({
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "INTERESTED", "SITE_VISIT_SCHEDULED", "NEGOTIATION", "CONVERTED", "LOST", "NURTURE"]).optional(),
  assignedAgentId: z.string().optional().nullable(),
  optedOut: z.boolean().optional(),
});

export const propertySchema = z.object({
  projectName: z.string().min(2).max(160),
  developer: z.string().max(120).optional(),
  propertyType: z.enum(["APARTMENT", "VILLA", "PLOT", "INDEPENDENT_HOUSE", "COMMERCIAL"]),
  bhk: z.number().int().min(1).max(10).optional(),
  city: z.string().min(2).max(80),
  locality: z.string().min(2).max(120),
  address: z.string().max(300).optional(),
  priceMinInr: z.number().int().min(0),
  priceMaxInr: z.number().int().min(0),
  areaSqft: z.number().int().min(0).optional(),
  floor: z.string().max(40).optional(),
  amenitiesJson: z.string().optional(),
  parking: z.boolean().optional(),
  possessionDate: z.string().optional(),
  availability: z.enum(["AVAILABLE", "LIMITED", "SOLD_OUT", "UPCOMING"]).optional(),
  furnishing: z.enum(["UNFURNISHED", "SEMI_FURNISHED", "FULLY_FURNISHED"]).optional(),
  description: z.string().max(4000).optional(),
});

export const messageInSchema = z.object({
  content: z.string().min(1).max(4000),
  channel: z.enum(["WEBSITE_CHAT", "WHATSAPP", "INSTAGRAM", "FACEBOOK", "EMAIL"]).default("WEBSITE_CHAT"),
  leadId: z.string().optional(), // if omitted, a new lead is created (public widget use-case)
});

export const appointmentSchema = z.object({
  leadId: z.string(),
  propertyId: z.string().optional(),
  agentId: z.string().optional(),
  type: z.enum(["SITE_VISIT", "CALL", "MEETING"]),
  scheduledAt: z.string(),
  notes: z.string().max(1000).optional(),
});
