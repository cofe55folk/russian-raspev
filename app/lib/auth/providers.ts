export type AuthProviderId = "google" | "apple" | "yandex" | "vk" | "phone";
export type AuthProviderKind = "oauth" | "phone";

export type AuthProviderStatus = {
  id: AuthProviderId;
  kind: AuthProviderKind;
  enabled: boolean;
  missingEnv: string[];
};

type ProviderDefinition = {
  id: AuthProviderId;
  kind: AuthProviderKind;
  requiredEnv: string[];
};

const AUTH_PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: "google",
    kind: "oauth",
    requiredEnv: ["RR_AUTH_GOOGLE_CLIENT_ID", "RR_AUTH_GOOGLE_CLIENT_SECRET"],
  },
  {
    id: "apple",
    kind: "oauth",
    requiredEnv: [
      "RR_AUTH_APPLE_CLIENT_ID",
      "RR_AUTH_APPLE_TEAM_ID",
      "RR_AUTH_APPLE_KEY_ID",
      "RR_AUTH_APPLE_PRIVATE_KEY",
    ],
  },
  {
    id: "yandex",
    kind: "oauth",
    requiredEnv: [
      "RR_AUTH_YANDEX_CLIENT_ID",
      "RR_AUTH_YANDEX_CLIENT_SECRET",
      "RR_AUTH_YANDEX_REDIRECT_URI",
    ],
  },
  {
    id: "vk",
    kind: "oauth",
    requiredEnv: ["RR_AUTH_VK_CLIENT_ID", "RR_AUTH_VK_CLIENT_SECRET", "RR_AUTH_VK_REDIRECT_URI"],
  },
  {
    id: "phone",
    kind: "phone",
    requiredEnv: ["RR_AUTH_PHONE_PROVIDER", "RR_AUTH_PHONE_API_KEY"],
  },
];

function isEnvPresent(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export function listAuthProvidersStatus(): AuthProviderStatus[] {
  return AUTH_PROVIDER_DEFINITIONS.map((provider) => {
    if (provider.id === "phone") {
      const missingEnv: string[] = [];
      const phoneEnabled = process.env.RR_AUTH_PHONE_ENABLED === "true";
      const phoneProvider = process.env.RR_AUTH_PHONE_PROVIDER?.trim();
      if (!phoneEnabled) missingEnv.push("RR_AUTH_PHONE_ENABLED=true");
      if (!phoneProvider) missingEnv.push("RR_AUTH_PHONE_PROVIDER");
      if (phoneProvider && phoneProvider !== "mock" && !isEnvPresent("RR_AUTH_PHONE_API_KEY")) {
        missingEnv.push("RR_AUTH_PHONE_API_KEY");
      }
      return {
        id: provider.id,
        kind: provider.kind,
        enabled: missingEnv.length === 0,
        missingEnv,
      };
    }

    const missingEnv = provider.requiredEnv.filter((name) => !isEnvPresent(name));
    return {
      id: provider.id,
      kind: provider.kind,
      enabled: missingEnv.length === 0,
      missingEnv,
    };
  });
}
