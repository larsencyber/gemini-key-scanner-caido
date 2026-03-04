import type { Caido } from "@caido/sdk-frontend";
import type { API, Events } from "backend";

export type FrontendSDK = Caido<API, Events>;

export type KeyStatus =
  | "pending"
  | "no_access"
  | "network_error"
  | "accessible"
  | "confirmed";

export type ExposedData = {
  fileCount: number;
  fileSnippets: string[];
  cachedCount: number;
  hasMoreFiles: boolean;
  hasMoreCached: boolean;
};

export type KeyFinding = {
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
