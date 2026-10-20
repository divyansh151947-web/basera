import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: "/",
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "/tour",
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: "/voice",
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: "/signup",
      lastModified,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: "/login",
      lastModified,
      changeFrequency: "yearly",
      priority: 0.4,
    },
  ];
}
