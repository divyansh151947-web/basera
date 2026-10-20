import "dotenv/config";
import bcrypt from "bcryptjs";
import { db, closeDatabase } from "../db/client";
import {
  plans, organizations, subscriptions, users, properties, leads,
  conversations, messages, aiConfigs, scoringConfigs, knowledgeDocuments, appointments,
} from "../db/schema";

/**
 * Populates realistic, clearly-labeled DEMO data (Section 38):
 * "UrbanNest Realty" — a fictional Noida/Gurgaon-focused brokerage — with
 * sample properties, leads at different funnel stages, and a couple of
 * seeded AI conversations so the product can be evaluated end-to-end
 * without connecting a real business.
 */

async function main() {
  console.log("Seeding database…");

  // ---- Plans (platform-wide) ----
  const [starter] = await db.insert(plans).values({
    name: "Starter", tier: "STARTER", monthlyPriceInr: 4999,
    leadLimit: 300, aiMessageLimit: 3000, teamMemberLimit: 3, propertyLimit: 50,
    features: JSON.stringify({ whatsapp: false, analytics: "basic" }),
  }).returning();

  const [professional] = await db.insert(plans).values({
    name: "Professional", tier: "PROFESSIONAL", monthlyPriceInr: 14999,
    leadLimit: 2000, aiMessageLimit: 20000, teamMemberLimit: 15, propertyLimit: 500,
    features: JSON.stringify({ whatsapp: true, analytics: "advanced" }),
  }).returning();

  await db.insert(plans).values({
    name: "Enterprise", tier: "ENTERPRISE", monthlyPriceInr: 0,
    leadLimit: 999999, aiMessageLimit: 999999, teamMemberLimit: 999, propertyLimit: 999999,
    features: JSON.stringify({ whatsapp: true, analytics: "advanced", customIntegrations: true }),
  });

  // ---- Demo organization ----
  const [org] = await db.insert(organizations).values({
    name: "UrbanNest Realty (Demo)", slug: "urbannest", isDemo: true,
    phone: "+91-98100-00000", email: "hello@urbannest.demo",
    locationsJson: JSON.stringify(["Sector 62, Noida", "DLF Cyber City, Gurgaon"]),
  }).returning();

  await db.insert(subscriptions).values({
    organizationId: org.id, planId: professional.id, status: "ACTIVE",
    currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
  });

  await db.insert(aiConfigs).values({
    organizationId: org.id,
    tone: "friendly_professional",
    primaryLanguage: "auto",
    greeting: "Hi! Welcome to UrbanNest Realty 🏠 Could you tell me what kind of property you're looking for?",
    followUpRulesJson: JSON.stringify({ intervalsDays: [1, 3, 7], maxAttempts: 3 }),
  });

  await db.insert(scoringConfigs).values({
    organizationId: org.id,
    weightsJson: JSON.stringify({}),
    hotThreshold: 80,
    warmThreshold: 50,
  });

  await db.insert(knowledgeDocuments).values([
    {
      organizationId: org.id, type: "FAQ", title: "Booking process",
      content: "To book a unit, customers pay a token amount of ₹1,00,000 to block the unit for 7 days, followed by the builder-buyer agreement and payment as per the construction-linked or down-payment plan chosen.",
    },
    {
      organizationId: org.id, type: "POLICY", title: "Site visit policy",
      content: "Site visits are available Tuesday–Sunday, 10am–6pm. Weekday visits can usually be scheduled within 24 hours; weekend slots should be booked at least 2 days in advance.",
    },
    {
      organizationId: org.id, type: "FAQ", title: "Loan assistance",
      content: "UrbanNest Realty has tie-ups with HDFC, SBI, and ICICI home loan desks who visit our office every Saturday to assist with pre-approval; we do not process loans directly.",
    },
  ]);

  // ---- Users ----
  const passwordHash = await bcrypt.hash("demo1234", 10);
  // Seeded demo/fictional accounts are pre-verified (Email 7A): they use
  // non-deliverable @demo addresses, so no real verification mail can ever
  // complete for them. Real signups start unverified and verify by link.
  const verifiedAt = new Date().toISOString();

  const [superAdmin] = await db.insert(users).values({
    organizationId: null, name: "Platform Admin", email: "superadmin@basera.demo",
    passwordHash, role: "SUPER_ADMIN", emailVerifiedAt: verifiedAt,
  }).returning();

  const [businessAdmin] = await db.insert(users).values({
    organizationId: org.id, name: "Rohit Malhotra", email: "admin@urbannest.demo",
    passwordHash, role: "BUSINESS_ADMIN", emailVerifiedAt: verifiedAt,
  }).returning();

  const [manager] = await db.insert(users).values({
    organizationId: org.id, name: "Priya Sharma", email: "manager@urbannest.demo",
    passwordHash, role: "MANAGER", emailVerifiedAt: verifiedAt,
  }).returning();

  const [agent1] = await db.insert(users).values({
    organizationId: org.id, name: "Aman Verma", email: "agent1@urbannest.demo", passwordHash,
    role: "SALES_AGENT", emailVerifiedAt: verifiedAt,
  }).returning();

  const [agent2] = await db.insert(users).values({
    organizationId: org.id, name: "Neha Kapoor", email: "agent2@urbannest.demo", passwordHash,
    role: "SALES_AGENT", emailVerifiedAt: verifiedAt,
  }).returning();

  // ---- Properties ----
  const propertyRows = await db.insert(properties).values([
    {
      organizationId: org.id, projectName: "Ivy Greens", developer: "Prateek Group",
      propertyType: "APARTMENT", bhk: 2, city: "Noida", locality: "Sector 150",
      priceMinInr: 6500000, priceMaxInr: 7200000, areaSqft: 1150, floor: "4th of 22",
      amenitiesJson: JSON.stringify(["Clubhouse", "Swimming Pool", "Gym", "Children's Play Area"]),
      parking: true, possessionDate: "2027-06-01", availability: "AVAILABLE", furnishing: "UNFURNISHED",
      description: "A mid-rise gated community facing the Noida golf course, close to the upcoming metro extension.",
      imagesJson: JSON.stringify([]),
    },
    {
      organizationId: org.id, projectName: "Ivy Greens", developer: "Prateek Group",
      propertyType: "APARTMENT", bhk: 3, city: "Noida", locality: "Sector 150",
      priceMinInr: 8800000, priceMaxInr: 9600000, areaSqft: 1550, floor: "8th of 22",
      amenitiesJson: JSON.stringify(["Clubhouse", "Swimming Pool", "Gym", "Jogging Track"]),
      parking: true, possessionDate: "2027-06-01", availability: "AVAILABLE", furnishing: "SEMI_FURNISHED",
      description: "Larger 3 BHK tower in the same Ivy Greens community, higher floors with golf-course views.",
      imagesJson: JSON.stringify([]),
    },
    {
      organizationId: org.id, projectName: "Palm Meadows", developer: "Migsun Group",
      propertyType: "APARTMENT", bhk: 2, city: "Greater Noida", locality: "Sector 1",
      priceMinInr: 4200000, priceMaxInr: 4800000, areaSqft: 980, floor: "6th of 15",
      amenitiesJson: JSON.stringify(["Gym", "Community Hall", "24x7 Security"]),
      parking: true, possessionDate: "2026-12-01", availability: "LIMITED", furnishing: "UNFURNISHED",
      description: "Budget-friendly 2 BHK close to the Yamuna Expressway, popular with first-time buyers.",
      imagesJson: JSON.stringify([]),
    },
    {
      organizationId: org.id, projectName: "Central Park Flower Valley", developer: "Central Park",
      propertyType: "APARTMENT", bhk: 3, city: "Gurgaon", locality: "Sector 33, Sohna Road",
      priceMinInr: 12500000, priceMaxInr: 13800000, areaSqft: 1780, floor: "12th of 24",
      amenitiesJson: JSON.stringify(["Clubhouse", "Tennis Court", "Swimming Pool", "Gym", "Spa"]),
      parking: true, possessionDate: "2026-03-01", availability: "AVAILABLE", furnishing: "SEMI_FURNISHED",
      description: "Premium township on Sohna Road with resort-style amenities and ready-to-move towers.",
      imagesJson: JSON.stringify([]),
    },
    {
      organizationId: org.id, projectName: "Central Park Flower Valley", developer: "Central Park",
      propertyType: "APARTMENT", bhk: 4, city: "Gurgaon", locality: "Sector 33, Sohna Road",
      priceMinInr: 18500000, priceMaxInr: 21000000, areaSqft: 2450, floor: "18th of 24",
      amenitiesJson: JSON.stringify(["Clubhouse", "Tennis Court", "Swimming Pool", "Gym", "Spa", "Concierge"]),
      parking: true, possessionDate: "2026-03-01", availability: "LIMITED", furnishing: "FULLY_FURNISHED",
      description: "Top-floor 4 BHK penthouse-style unit in the same premium Sohna Road township.",
      imagesJson: JSON.stringify([]),
    },
    {
      organizationId: org.id, projectName: "Sunrise Villas", developer: "Ansal API",
      propertyType: "VILLA", bhk: 4, city: "Gurgaon", locality: "Sector 57",
      priceMinInr: 32000000, priceMaxInr: 35000000, areaSqft: 3600, floor: "Ground+1",
      amenitiesJson: JSON.stringify(["Private Garden", "Clubhouse Access", "24x7 Security"]),
      parking: true, possessionDate: "2025-11-01", availability: "SOLD_OUT", furnishing: "UNFURNISHED",
      description: "Independent villa plots — currently sold out; kept in inventory for reference/waitlist only.",
      imagesJson: JSON.stringify([]),
    },
  ]).returning();

  // ---- Leads across the funnel ----
  const now = Date.now();
  const leadRows = await db.insert(leads).values([
    {
      organizationId: org.id, name: "Rahul Gupta", phone: "+91-98111-22334", source: "WEBSITE_CHAT",
      preferredCity: "Noida", preferredLocality: "Sector 150", propertyType: "APARTMENT", bhk: 3,
      budgetMinInr: 8000000, budgetMaxInr: 9000000, purpose: "BUY", timeline: "within 30 days",
      loanRequired: true, siteVisitInterest: true, status: "QUALIFIED", temperature: "HOT", score: 91,
      assignedAgentId: agent1.id,
      aiSummary: "HOT LEAD — 91/100\n\nName: Rahul Gupta\nRequirement: 3 BHK\nLocation: Sector 150, Noida\nBudget: ₹80–90 lakh\nTimeline: Within 30 days\nLoan: Required\nSite Visit: Interested\n\nAI Summary: Customer is actively looking for a 3 BHK in Noida and appears ready to visit suitable properties.",
      lastContactAt: new Date(now - 3600000).toISOString(),
    },
    {
      organizationId: org.id, name: "Ananya Singh", phone: "+91-99001-11223", source: "WHATSAPP",
      preferredCity: "Gurgaon", propertyType: "APARTMENT", bhk: 4,
      budgetMinInr: 18000000, budgetMaxInr: 22000000, purpose: "BUY", timeline: "within 60 days",
      siteVisitInterest: true, status: "SITE_VISIT_SCHEDULED", temperature: "HOT", score: 84,
      assignedAgentId: agent2.id,
      lastContactAt: new Date(now - 7200000).toISOString(),
    },
    {
      organizationId: org.id, name: "Vikram Rao", phone: "+91-97001-44556", source: "INSTAGRAM",
      preferredCity: "Greater Noida", bhk: 2, budgetMaxInr: 5000000, purpose: "BUY",
      status: "CONTACTED", temperature: "WARM", score: 58,
      lastContactAt: new Date(now - 86400000).toISOString(), nextFollowUpAt: new Date(now + 86400000).toISOString(),
    },
    {
      organizationId: org.id, name: "Sana Sheikh", email: "sana.sheikh@example.com", source: "WEBSITE_FORM",
      preferredCity: "Noida", bhk: 2, purpose: "RENT",
      status: "NEW", temperature: "COLD", score: 22,
    },
    {
      organizationId: org.id, name: "Karan Mehta", phone: "+91-96001-77889", source: "WEBSITE_CHAT",
      preferredCity: "Gurgaon", preferredLocality: "Sohna Road", bhk: 3, budgetMinInr: 12000000, budgetMaxInr: 14000000,
      purpose: "BUY", timeline: "3 months", loanRequired: true, status: "NEGOTIATION", temperature: "HOT", score: 88,
      assignedAgentId: agent1.id, lastContactAt: new Date(now - 10800000).toISOString(),
    },
    {
      organizationId: org.id, name: "Deepika Nair", phone: "+91-95001-99001", source: "FACEBOOK",
      preferredCity: "Noida", bhk: 2, budgetMaxInr: 4500000, purpose: "INVEST",
      status: "NURTURE", temperature: "COLD", score: 31, nextFollowUpAt: new Date(now + 3 * 86400000).toISOString(),
    },
    {
      organizationId: org.id, name: "Manoj Tiwari", phone: "+91-94001-00112", source: "MANUAL",
      preferredCity: "Gurgaon", bhk: 4, budgetMinInr: 30000000, purpose: "BUY",
      status: "LOST", temperature: "COLD", score: 40, assignedAgentId: agent2.id,
    },
    {
      organizationId: org.id, name: "Ritu Chawla", phone: "+91-93001-22114", source: "WEBSITE_CHAT",
      preferredCity: "Noida", preferredLocality: "Sector 150", bhk: 3, budgetMinInr: 8500000, budgetMaxInr: 9500000,
      purpose: "BUY", status: "CONVERTED", temperature: "WARM", score: 75, assignedAgentId: agent1.id,
    },
  ]).returning();

  // ---- Sample AI conversation for the top hot lead ----
  const rahul = leadRows[0];
  const [convo] = await db.insert(conversations).values({
    organizationId: org.id, leadId: rahul.id, channel: "WEBSITE_CHAT", status: "HUMAN_HANDLING",
    handoffReason: "Lead has reached HOT qualification threshold",
  }).returning();

  await db.insert(messages).values([
    { conversationId: convo.id, sender: "AI", content: "Hi! Welcome to UrbanNest Realty 🏠 Could you tell me what kind of property you're looking for?" },
    { conversationId: convo.id, sender: "LEAD", content: "bhai 3 bhk chahiye noida sector 150 me, budget 90 lakh tak" },
    { conversationId: convo.id, sender: "AI", content: "Great, a 3 BHK in Sector 150, Noida within ₹90 lakh — we have Ivy Greens by Prateek Group in that exact area, priced ₹88–96 lakh, possession expected June 2027. Would you like more details or to schedule a site visit?" },
    { conversationId: convo.id, sender: "LEAD", content: "haan site visit karna hai, is weekend possible?" },
    { conversationId: convo.id, sender: "AI", content: "Absolutely — weekend site visits need about 2 days' notice, so I'm connecting you with one of our property specialists to lock in a slot for you." },
  ]);

  await db.insert(appointments).values({
    organizationId: org.id, leadId: rahul.id, propertyId: propertyRows[1].id, agentId: agent1.id,
    type: "SITE_VISIT", scheduledAt: new Date(now + 2 * 86400000).toISOString(), status: "SCHEDULED",
    notes: "Customer requested a weekend slot; confirm gate pass at least 1 day prior.",
  });

  console.log("Seed complete.");
  console.log("Demo org slug: urbannest");
  console.log("Login as: admin@urbannest.demo / demo1234  (Business Admin)");
  console.log("        : manager@urbannest.demo / demo1234 (Manager)");
  console.log("        : agent1@urbannest.demo / demo1234  (Sales Agent)");
  console.log("        : superadmin@basera.demo / demo1234 (Super Admin)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => closeDatabase());
