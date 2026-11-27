/**
 * Everything the "Add service" catalogue shows. Only entries with status
 * "available" can be connected; "soon" entries are listed so people can see
 * what's planned, and never behave as if they work. "builtin" entries need no
 * connection at all.
 */
export const INTEGRATION_CATEGORIES = [
  { id: "ai", label: "AI models" },
  { id: "email", label: "Email" },
  { id: "messaging", label: "Messaging" },
  { id: "storage", label: "Files & storage" },
  { id: "productivity", label: "Docs & data" },
  { id: "developer", label: "Developer" },
] as const;

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number]["id"];

export type CatalogEntry = {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  status: "available" | "soon" | "builtin";
  /** How it's connected: an API key / app password form, the local Claude CLI switch, or nothing. */
  connect: "credential" | "local-claude" | "none";
  /** Nodes that use it, for the catalogue card. */
  usedBy: string[];
};

export const INTEGRATION_CATALOG: CatalogEntry[] = [
  // AI models
  { id: "openai", name: "OpenAI", description: "GPT text models and image generation.", category: "ai", status: "available", connect: "credential", usedBy: ["AI Text", "AI Image"] },
  { id: "claude-cli", name: "Claude (local CLI)", description: "Your signed-in Claude Code on this computer. Personal use.", category: "ai", status: "available", connect: "local-claude", usedBy: ["AI Text"] },
  { id: "anthropic", name: "Anthropic API", description: "Claude models with your own Anthropic API key.", category: "ai", status: "soon", connect: "credential", usedBy: ["AI Text"] },
  { id: "google", name: "Google Gemini", description: "Gemini models for text and images.", category: "ai", status: "soon", connect: "credential", usedBy: ["AI Text", "AI Image"] },
  { id: "mistral", name: "Mistral", description: "Mistral and Codestral text models.", category: "ai", status: "soon", connect: "credential", usedBy: ["AI Text"] },
  { id: "ollama", name: "Ollama", description: "Open models running on your own machine.", category: "ai", status: "soon", connect: "credential", usedBy: ["AI Text"] },

  // Email
  { id: "gmail", name: "Gmail", description: "Send email from your Gmail with an app password.", category: "email", status: "available", connect: "credential", usedBy: ["Send Email"] },
  { id: "outlook", name: "Outlook", description: "Send email from Outlook / Microsoft 365.", category: "email", status: "soon", connect: "credential", usedBy: ["Send Email"] },
  { id: "smtp", name: "SMTP server", description: "Any mail server: Zoho, Fastmail, Mailgun and more.", category: "email", status: "soon", connect: "credential", usedBy: ["Send Email"] },
  { id: "resend", name: "Resend", description: "Transactional email API.", category: "email", status: "soon", connect: "credential", usedBy: ["Send Email"] },

  // Messaging
  { id: "slack", name: "Slack", description: "Post messages to a channel.", category: "messaging", status: "soon", connect: "credential", usedBy: ["Send Message"] },
  { id: "discord", name: "Discord", description: "Post to a channel through a webhook.", category: "messaging", status: "soon", connect: "credential", usedBy: ["Send Message"] },
  { id: "telegram", name: "Telegram", description: "Send messages from a bot.", category: "messaging", status: "soon", connect: "credential", usedBy: ["Send Message"] },
  { id: "twilio", name: "Twilio SMS", description: "Send text messages.", category: "messaging", status: "soon", connect: "credential", usedBy: ["Send Message"] },

  // Files & storage
  { id: "library", name: "Orbyte asset library", description: "Save outputs and generated images with provenance.", category: "storage", status: "builtin", connect: "none", usedBy: ["Output", "AI Image"] },
  { id: "google-drive", name: "Google Drive", description: "Save files to a Drive folder.", category: "storage", status: "soon", connect: "credential", usedBy: ["Output"] },
  { id: "dropbox", name: "Dropbox", description: "Save files to Dropbox.", category: "storage", status: "soon", connect: "credential", usedBy: ["Output"] },
  { id: "s3", name: "Amazon S3", description: "Upload files to an S3-compatible bucket.", category: "storage", status: "soon", connect: "credential", usedBy: ["Output"] },

  // Docs & data
  { id: "notion", name: "Notion", description: "Create pages and database rows.", category: "productivity", status: "soon", connect: "credential", usedBy: ["Output"] },
  { id: "google-sheets", name: "Google Sheets", description: "Append rows to a spreadsheet.", category: "productivity", status: "soon", connect: "credential", usedBy: ["Output"] },
  { id: "airtable", name: "Airtable", description: "Create and update records.", category: "productivity", status: "soon", connect: "credential", usedBy: ["Output"] },

  // Developer
  { id: "http", name: "Any HTTP API", description: "Call any public API or webhook with the HTTP Request node.", category: "developer", status: "builtin", connect: "none", usedBy: ["HTTP Request"] },
  { id: "github", name: "GitHub", description: "Open issues and comment on pull requests.", category: "developer", status: "soon", connect: "credential", usedBy: ["HTTP Request"] },
];
