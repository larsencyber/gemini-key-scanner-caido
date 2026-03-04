import type { DefineAPI, DefineEvents, SDK } from "caido:plugin";
import { fetch } from "caido:http";

type Result<T> = { kind: "Ok"; value: T } | { kind: "Error"; error: string };

type KeyStatus =
  | "pending"
  | "no_access"
  | "network_error"
  | "accessible"
  | "confirmed";

type ExposedData = {
  fileCount: number;
  fileSnippets: string[];
  cachedCount: number;
  hasMoreFiles: boolean;
  hasMoreCached: boolean;
};

type KeyFinding = {
  key: string;
  host: string;
  path: string;
  requestId: string;
  models: string[];
  checkedAt: string;
  status: KeyStatus;
  httpCode: number;
  exposedData?: ExposedData;
};

type VerificationResult =
  | { outcome: "network_error"; error: string }
  | { outcome: "no_access"; httpCode: number }
  | { outcome: "accessible"; httpCode: number; models: string[] }
  | { outcome: "confirmed"; httpCode: number; models: string[] };

const checkedKeys = new Set<string>();
const findings: KeyFinding[] = [];

function extractKeys(text: string): string[] {
  const re = /AIza[-0-9A-Za-z_]{35}/g;
  const keys = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] !== undefined) keys.add(m[0]);
  }
  return [...keys];
}

function extractModels(json: string): string[] {
  const re = /"name"\s*:\s*"models\/([^"]+)"/g;
  const models: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(json)) !== null) {
    const name = m[1];
    if (name !== undefined && /gemini|flash|pro/i.test(name) && !models.includes(name)) {
      models.push(name);
    }
  }
  return models;
}

async function verifyGeminiAccess(key: string): Promise<VerificationResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

  let resp: Awaited<ReturnType<typeof fetch>>;
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Caido/1.0)",
        "Accept": "application/json",
      },
    });
  } catch (e) {
    return { outcome: "network_error", error: String(e) };
  }

  const httpCode = resp.status;

  if (httpCode !== 200) {
    return { outcome: "no_access", httpCode };
  }

  const body = await resp.text();
  const models = extractModels(body);

  if (models.length === 0) {
    return { outcome: "accessible", httpCode, models: [] };
  }
  return { outcome: "confirmed", httpCode, models };
}

async function fetchExposedData(key: string): Promise<ExposedData> {
  let fileCount = 0;
  let fileSnippets: string[] = [];
  let hasMoreFiles = false;
  let cachedCount = 0;
  let hasMoreCached = false;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/files?key=${key}`,
      { method: "GET", headers: { "Accept": "application/json" } },
    );
    if (resp.status === 200) {
      const body = await resp.text();
      try {
        const data = JSON.parse(body) as {
          files?: Array<{ name: string; displayName?: string }>;
          nextPageToken?: string;
        };
        const files = data.files ?? [];
        fileCount = files.length;
        fileSnippets = files
          .slice(0, 3)
          .map(f => f.displayName ?? f.name.replace("files/", ""));
        hasMoreFiles = !!data.nextPageToken;
      } catch (_) { /* ignore parse errors */ }
    }
  } catch (_) { /* ignore network errors */ }

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${key}`,
      { method: "GET", headers: { "Accept": "application/json" } },
    );
    if (resp.status === 200) {
      const body = await resp.text();
      try {
        const data = JSON.parse(body) as {
          cachedContents?: unknown[];
          nextPageToken?: string;
        };
        cachedCount = (data.cachedContents ?? []).length;
        hasMoreCached = !!data.nextPageToken;
      } catch (_) { /* ignore parse errors */ }
    }
  } catch (_) { /* ignore network errors */ }

  return { fileCount, fileSnippets, cachedCount, hasMoreFiles, hasMoreCached };
}

function buildNoAccessDesc(key: string, host: string, httpCode: number): string {
  return [
    `A Google API key was detected in a response from **${host}** but verified to have **no Gemini API access**.`,
    "",
    `**Key:** \`${key}\``,
    `**Verification result:** HTTP ${httpCode} — key is invalid, revoked, or restricted to other APIs.`,
    "",
    "No action is required for Gemini access specifically, but the key may still be sensitive for other Google APIs it is scoped to.",
  ].join("\n");
}

function buildNetworkErrorDesc(key: string, host: string, error: string): string {
  return [
    `A Google API key was detected in a response from **${host}** but Gemini verification failed due to a network error.`,
    "",
    `**Key:** \`${key}\``,
    `**Error:** ${error}`,
    "",
    "**Verify manually:**",
    "```",
    `curl "https://generativelanguage.googleapis.com/v1beta/models?key=${key}"`,
    "```",
  ].join("\n");
}

function buildAccessibleDesc(key: string, host: string, exposed: ExposedData): string {
  const lines = [
    `A Google API key was detected in a response from **${host}** and the Gemini API responded with HTTP 200, but no Gemini/Flash/Pro models were listed.`,
    "",
    `**Key:** \`${key}\``,
    "",
    "The key may have access to the Generative Language API but with no usable Gemini models, or the project may have the API enabled without model permissions.",
  ];

  if (exposed.fileCount > 0 || exposed.cachedCount > 0) {
    lines.push("", "**Exposed data found:**");
    if (exposed.fileCount > 0) {
      lines.push(`- **Uploaded files:** ${exposed.fileCount}${exposed.hasMoreFiles ? "+" : ""} file(s)`);
      if (exposed.fileSnippets.length > 0) {
        lines.push(`  e.g. ${exposed.fileSnippets.join(", ")}`);
      }
    }
    if (exposed.cachedCount > 0) {
      lines.push(`- **Cached contents:** ${exposed.cachedCount}${exposed.hasMoreCached ? "+" : ""} item(s)`);
    }
  }

  lines.push(
    "",
    "**Check for files/caches:**",
    "```",
    `curl "https://generativelanguage.googleapis.com/v1beta/files?key=${key}"`,
    "```",
  );
  return lines.join("\n");
}

function buildConfirmedDesc(key: string, host: string, models: string[], exposed: ExposedData): string {
  const list = models.slice(0, 10).join(", ");
  const lines = [
    `A Google API key was found in a response from **${host}** and **verified** to have active Gemini API access.`,
    "",
    `**Key:** \`${key}\``,
    "",
    `**Available Gemini models (${models.length}):** ${list}${models.length > 10 ? ` … and ${models.length - 10} more` : ""}`,
  ];

  if (exposed.fileCount > 0 || exposed.cachedCount > 0) {
    lines.push("", "**Exposed data found:**");
    if (exposed.fileCount > 0) {
      lines.push(`- **Uploaded files:** ${exposed.fileCount}${exposed.hasMoreFiles ? "+" : ""} file(s)`);
      if (exposed.fileSnippets.length > 0) {
        lines.push(`  e.g. ${exposed.fileSnippets.join(", ")}`);
      }
    }
    if (exposed.cachedCount > 0) {
      lines.push(`- **Cached contents:** ${exposed.cachedCount}${exposed.hasMoreCached ? "+" : ""} item(s)`);
    }
  }

  lines.push(
    "",
    "**Proof of concept:**",
    "```",
    `curl "https://generativelanguage.googleapis.com/v1beta/models?key=${key}"`,
    "```",
    "",
    "**Check for exposed files:**",
    "```",
    `curl "https://generativelanguage.googleapis.com/v1beta/files?key=${key}"`,
    "```",
    "",
    "**Remediation:** Rotate the key immediately in the Google Cloud Console and restrict its allowed APIs.",
  );
  return lines.join("\n");
}

function buildFindingTitle(status: KeyStatus): string {
  switch (status) {
    case "confirmed":     return "[HIGH] Exposed Google API Key with Active Gemini Access";
    case "accessible":    return "[MED] Google API Key — Gemini API Accessible (No Models)";
    case "no_access":     return "[INFO] Google API Key Found — No Gemini Access";
    case "network_error": return "[INFO] Google API Key Found — Verification Failed";
    default:              return "[INFO] Potential Google API Key Detected";
  }
}

async function processKey(
  sdk: SDK<API, Events>,
  key: string,
  host: string,
  path: string,
  requestId: string,
  request: Parameters<Parameters<SDK["events"]["onInterceptResponse"]>[0]>[1],
): Promise<void> {
  const pendingFinding: KeyFinding = {
    key, host, path, requestId,
    models: [], httpCode: 0,
    checkedAt: new Date().toISOString(),
    status: "pending",
  };
  upsertFinding(pendingFinding);
  sdk.api.send("onNewFinding", pendingFinding);

  sdk.console.log(`[gemini-key-scanner] Verifying ${key.slice(0, 12)}...`);
  const result = await verifyGeminiAccess(key);
  sdk.console.log(`[gemini-key-scanner] ${key.slice(0, 12)}... → ${result.outcome}`);

  let finalStatus: KeyStatus;
  let models: string[] = [];
  let httpCode = 0;
  let description: string;
  let exposedData: ExposedData | undefined;

  switch (result.outcome) {
    case "confirmed":
      finalStatus = "confirmed";
      models = result.models;
      httpCode = result.httpCode;
      exposedData = await fetchExposedData(key);
      description = buildConfirmedDesc(key, host, models, exposedData);
      break;
    case "accessible":
      finalStatus = "accessible";
      httpCode = result.httpCode;
      exposedData = await fetchExposedData(key);
      description = buildAccessibleDesc(key, host, exposedData);
      break;
    case "no_access":
      finalStatus = "no_access";
      httpCode = result.httpCode;
      description = buildNoAccessDesc(key, host, httpCode);
      break;
    case "network_error":
      finalStatus = "network_error";
      description = buildNetworkErrorDesc(key, host, result.error);
      break;
  }

  const verifiedFinding: KeyFinding = {
    key, host, path, requestId,
    models, httpCode,
    exposedData,
    checkedAt: new Date().toISOString(),
    status: finalStatus,
  };
  upsertFinding(verifiedFinding);
  sdk.api.send("onNewFinding", verifiedFinding);

  await sdk.findings.create({
    title: buildFindingTitle(finalStatus),
    description,
    reporter: "gemini-key-scanner",
    request,
    dedupeKey: `gemini-key-result-${key}`,
  });
}

function upsertFinding(f: KeyFinding): void {
  const idx = findings.findIndex(x => x.key === f.key);
  if (idx !== -1) {
    findings.splice(idx, 1, f);
  } else {
    findings.push(f);
  }
}

const getFindings = (_sdk: SDK): Result<KeyFinding[]> => {
  return { kind: "Ok", value: [...findings] };
};

const clearFindings = (_sdk: SDK): Result<void> => {
  findings.length = 0;
  checkedKeys.clear();
  return { kind: "Ok", value: undefined };
};

const checkKey = async (sdk: SDK, key: string): Promise<Result<KeyFinding | null>> => {
  sdk.console.log(`[gemini-key-scanner] Manual check: ${key.slice(0, 12)}...`);
  const result = await verifyGeminiAccess(key);

  let status: KeyStatus;
  let models: string[] = [];
  let httpCode = 0;
  let exposedData: ExposedData | undefined;

  switch (result.outcome) {
    case "confirmed":
      status = "confirmed"; models = result.models; httpCode = result.httpCode;
      exposedData = await fetchExposedData(key);
      break;
    case "accessible":
      status = "accessible"; httpCode = result.httpCode;
      exposedData = await fetchExposedData(key);
      break;
    case "no_access":     status = "no_access"; httpCode = result.httpCode; break;
    case "network_error": status = "network_error"; break;
  }

  const finding: KeyFinding = {
    key, host: "manual-check", path: "", requestId: "",
    models, httpCode,
    exposedData,
    checkedAt: new Date().toISOString(),
    status,
  };
  upsertFinding(finding);
  sdk.api.send("onNewFinding", finding);
  return { kind: "Ok", value: finding };
};

export type API = DefineAPI<{
  getFindings: typeof getFindings;
  clearFindings: typeof clearFindings;
  checkKey: typeof checkKey;
}>;

export type Events = DefineEvents<{
  onNewFinding: (finding: KeyFinding) => void;
}>;

export function init(sdk: SDK<API, Events>) {
  sdk.api.register("getFindings", getFindings);
  sdk.api.register("clearFindings", clearFindings);
  sdk.api.register("checkKey", checkKey);

  sdk.events.onInterceptResponse(async (evtSdk, request, response) => {
    const host = request.getHost();
    evtSdk.console.log(`[gemini-key-scanner] Scanning response from ${host}`);

    const body = response.getBody();
    if (body === undefined) return;

    const text = body.toText();
    const keys = extractKeys(text);
    if (keys.length === 0) return;

    evtSdk.console.log(`[gemini-key-scanner] Found ${keys.length} candidate key(s) on ${host}`);

    const path = request.getPath();
    const requestId = request.getId();

    for (const key of keys) {
      if (checkedKeys.has(key)) continue;
      checkedKeys.add(key);
      await processKey(evtSdk, key, host, path, requestId, request);
    }
  });

  sdk.console.log("[gemini-key-scanner] Loaded — passive scan active");
}
