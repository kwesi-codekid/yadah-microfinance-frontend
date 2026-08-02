function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value == null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  apiBaseUrl: required("API_BASE_URL").replace(/\/$/, ""),

  sessionSecret: required(
    "SESSION_SECRET",
    process.env.NODE_ENV === "production" ? undefined : "dev-insecure-secret",
  ),

  isProduction: process.env.NODE_ENV === "production",
};
