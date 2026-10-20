import "server-only";
import { db } from "@/db/client";
import { appointments, leads, properties, users } from "@/db/schema";
import { eq } from "drizzle-orm";

export type TenantAnalyticsSnapshot = {
  totalLeads: number;
  newLeads: number;
  qualifiedLeads: number;
  hotLeads: number;
  warmLeads: number;
  coldLeads: number;
  convertedLeads: number;
  conversionRate: number;
  siteVisits: number;
  totalPipelineValue: number;
  pipeline: { stage: string; count: number }[];
  leadSources: { source: string; count: number }[];
  appointmentStats: { total: number; scheduled: number; confirmed: number; completed: number; canceled: number; noShow: number };
  agentPerformance: { agentId: string; agentName: string; total: number; converted: number; siteVisits: number }[];
  propertyPerformance: { id: string; projectName: string; city: string; propertyType: string; availability: string; inquiryCount: number }[];
  recentLeads: { id: string; name: string; status: string; temperature: string; source: string; budgetMaxInr: number | null; updatedAt: string }[];
  recentActivity: { label: string; value: string; timestamp: string }[];
};

export async function getTenantAnalyticsSnapshot(organizationId: string, dbClient = db): Promise<TenantAnalyticsSnapshot> {
  const [leadRows, appointmentRows, propertyRows, teamRows] = await Promise.all([
    dbClient.select().from(leads).where(eq(leads.organizationId, organizationId)),
    dbClient.select().from(appointments).where(eq(appointments.organizationId, organizationId)),
    dbClient.select().from(properties).where(eq(properties.organizationId, organizationId)),
    dbClient.select().from(users).where(eq(users.organizationId, organizationId)),
  ]);

  const totalLeads = leadRows.length;
  const qualifiedLeads = leadRows.filter((lead) => lead.status === "QUALIFIED").length;
  const hotLeads = leadRows.filter((lead) => lead.temperature === "HOT").length;
  const warmLeads = leadRows.filter((lead) => lead.temperature === "WARM").length;
  const coldLeads = leadRows.filter((lead) => lead.temperature === "COLD").length;
  const convertedLeads = leadRows.filter((lead) => lead.status === "CONVERTED").length;
  const newLeads = leadRows.filter((lead) => lead.status === "NEW").length;
  const conversionRate = totalLeads === 0 ? 0 : Number(((convertedLeads / totalLeads) * 100).toFixed(1));
  const siteVisits = appointmentRows.filter((appointment) => appointment.type === "SITE_VISIT" && appointment.status !== "CANCELED").length;

  const totalPipelineValue = leadRows.reduce((sum, lead) => sum + Number(lead.budgetMaxInr ?? lead.budgetMinInr ?? 0), 0);

  const pipelineOrder = ["NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT_SCHEDULED", "NEGOTIATION", "CONVERTED"] as const;
  const pipeline = pipelineOrder.map((stage) => ({
    stage,
    count: leadRows.filter((lead) => lead.status === stage).length,
  }));

  const sourceMap = new Map<string, number>();
  for (const lead of leadRows) {
    sourceMap.set(lead.source, (sourceMap.get(lead.source) ?? 0) + 1);
  }
  const leadSources = Array.from(sourceMap.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  const appointmentStats = {
    total: appointmentRows.length,
    scheduled: appointmentRows.filter((appointment) => appointment.status === "SCHEDULED").length,
    confirmed: appointmentRows.filter((appointment) => appointment.status === "CONFIRMED").length,
    completed: appointmentRows.filter((appointment) => appointment.status === "COMPLETED").length,
    canceled: appointmentRows.filter((appointment) => appointment.status === "CANCELED").length,
    noShow: appointmentRows.filter((appointment) => appointment.status === "NO_SHOW").length,
  };

  const agentPerformance = teamRows
    .map((member) => {
      const assignedLeads = leadRows.filter((lead) => lead.assignedAgentId === member.id);
      const teamSiteVisits = appointmentRows.filter((appointment) => appointment.agentId === member.id && appointment.type === "SITE_VISIT");
      return {
        agentId: member.id,
        agentName: member.name,
        total: assignedLeads.length,
        converted: assignedLeads.filter((lead) => lead.status === "CONVERTED").length,
        siteVisits: teamSiteVisits.length,
      };
    })
    .filter((member) => member.total > 0 || member.siteVisits > 0)
    .sort((a, b) => b.total - a.total || b.converted - a.converted);

  const propertyPerformance = propertyRows
    .map((property) => {
      const inquiryCount = leadRows.filter(
        (lead) =>
          lead.preferredCity === property.city &&
          lead.propertyType === property.propertyType &&
          lead.status !== "LOST"
      ).length;
      return {
        id: property.id,
        projectName: property.projectName,
        city: property.city,
        propertyType: property.propertyType,
        availability: property.availability,
        inquiryCount,
      };
    })
    .filter((property) => property.inquiryCount > 0)
    .sort((a, b) => b.inquiryCount - a.inquiryCount)
    .slice(0, 6);

  const recentLeads = [...leadRows]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5)
    .map((lead) => ({
      id: lead.id,
      name: lead.name ?? "Unnamed lead",
      status: lead.status,
      temperature: lead.temperature,
      source: lead.source,
      budgetMaxInr: lead.budgetMaxInr ?? null,
      updatedAt: lead.updatedAt,
    }));

  const recentActivity = [...leadRows, ...appointmentRows]
    .map((item) => {
      if ("status" in item && "source" in item) {
        return {
          label: item.name ?? "Lead",
          value: item.status,
          timestamp: item.updatedAt,
        };
      }
      return {
        label: item.type === "SITE_VISIT" ? "Site visit" : item.type,
        value: item.status,
        timestamp: item.updatedAt,
      };
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 6);

  return {
    totalLeads,
    newLeads,
    qualifiedLeads,
    hotLeads,
    warmLeads,
    coldLeads,
    convertedLeads,
    conversionRate,
    siteVisits,
    totalPipelineValue,
    pipeline,
    leadSources,
    appointmentStats,
    agentPerformance,
    propertyPerformance,
    recentLeads,
    recentActivity,
  };
}
