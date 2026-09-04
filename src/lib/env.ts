export const env = {
  databaseUrl: process.env.DATABASE_URL || "file:./prisma/dev.db",
  appMode: process.env.APP_MODE || "demo",
  razorpayMode: process.env.RAZORPAY_MODE || "mock",
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  demoOperatorId: process.env.DEMO_OPERATOR_ID || "demo-finance-operator",
  appName: process.env.NEXT_PUBLIC_APP_NAME || "Equilibrium",
  nodeEnv: process.env.NODE_ENV || "development",
  aiProvider: process.env.AI_PROVIDER || "mock",
  azureDocumentIntelligenceEndpoint: process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || "",
  azureDocumentIntelligenceKey: process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || "",
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT || "",
  azureOpenAIKey: process.env.AZURE_OPENAI_KEY || "",
  azureOpenAIDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || "",
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-10-21",
};

export function assertDemoMode() {
  if (env.appMode !== "demo") {
    throw new Error("This operation is only available in demo mode");
  }
}
