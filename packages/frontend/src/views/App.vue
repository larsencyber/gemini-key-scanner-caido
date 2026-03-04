<script setup lang="ts">
import Button from "primevue/button";
import Card from "primevue/card";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Tag from "primevue/tag";
import { onMounted, onUnmounted, ref } from "vue";

import { useSDK } from "@/plugins/sdk";
import type { KeyFinding } from "@/types";

function statusLabel(s: KeyFinding["status"]): string {
  switch (s) {
    case "confirmed":     return "HIGH";
    case "accessible":    return "MED";
    case "no_access":     return "NO ACCESS";
    case "network_error": return "ERROR";
    case "pending":       return "CHECKING…";
  }
}

function statusSeverity(s: KeyFinding["status"]): string {
  switch (s) {
    case "confirmed":     return "danger";
    case "accessible":    return "warn";
    case "no_access":     return "secondary";
    case "network_error": return "warn";
    case "pending":       return "info";
  }
}

const sdk = useSDK();

const findings = ref<KeyFinding[]>([]);
const loading = ref(false);
const manualKey = ref("");
const checkingManual = ref(false);

let stopListener: (() => void) | undefined;

async function loadFindings() {
  loading.value = true;
  const result = await sdk.backend.getFindings();
  if (result.kind === "Ok") {
    findings.value = result.value;
  }
  loading.value = false;
}

async function clearAll() {
  const result = await sdk.backend.clearFindings();
  if (result.kind === "Ok") {
    findings.value = [];
    sdk.window.showToast("Findings cleared", { variant: "success" });
  }
}

async function checkManualKey() {
  const key = manualKey.value.trim();
  if (key === "") return;
  checkingManual.value = true;
  const result = await sdk.backend.checkKey(key);
  checkingManual.value = false;
  if (result.kind === "Error") {
    sdk.window.showToast(result.error, { variant: "error" });
    return;
  }
  const finding = result.value;
  if (finding !== null) {
    const idx = findings.value.findIndex(f => f.key === finding.key);
    if (idx !== -1) {
      findings.value.splice(idx, 1, finding);
    } else {
      findings.value.push(finding);
    }
  }
  manualKey.value = "";
}

function maskedKey(key: string): string {
  return `${key.slice(0, 12)}…${key.slice(-4)}`;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    sdk.window.showToast("Copied to clipboard", { variant: "success", duration: 2000 });
  });
}

onMounted(async () => {
  await loadFindings();
  const handle = sdk.backend.onEvent("onNewFinding", (finding: KeyFinding) => {
    const idx = findings.value.findIndex(f => f.key === finding.key);
    if (idx !== -1) {
      findings.value.splice(idx, 1, finding);
    } else {
      findings.value.push(finding);
    }
  });
  stopListener = handle.stop.bind(handle);
});

onUnmounted(() => {
  stopListener?.();
});
</script>

<template>
  <div class="h-full p-4 bg-surface-800 text-surface-100 overflow-auto">
    <Card class="bg-surface-700 mb-4">
      <template #header>
        <div class="flex items-center justify-between px-4 pt-4">
          <div class="flex items-center gap-2">
            <i class="fas fa-key text-primary-400 text-lg"></i>
            <span class="text-surface-100 font-semibold text-base">Gemini Key Scanner</span>
            <Tag
              :value="`${findings.length} found`"
              :severity="findings.length > 0 ? 'danger' : 'secondary'"
              class="ml-2"
            />
          </div>
          <div class="flex items-center gap-2">
            <Button
              label="Refresh"
              icon="fas fa-rotate"
              size="small"
              variant="secondary"
              :loading="loading"
              @click="loadFindings"
            />
            <Button
              label="Clear"
              icon="fas fa-trash"
              size="small"
              variant="tertiary"
              :disabled="findings.length === 0"
              @click="clearAll"
            />
          </div>
        </div>
      </template>
      <template #content>
        <p class="text-surface-400 text-sm px-4 pb-2">
          Passively scans all proxied responses for <code class="text-primary-300">AIza…</code> keys
          and verifies Gemini API access. Confirmed keys are reported as native Caido findings.
        </p>
      </template>
    </Card>

    <!-- Manual check -->
    <Card class="bg-surface-700 mb-4">
      <template #header>
        <div class="px-4 pt-4 pb-1">
          <span class="text-surface-100 font-semibold text-sm">Manual Key Check</span>
        </div>
      </template>
      <template #content>
        <div class="flex items-center gap-2 px-4 pb-4">
          <input
            v-model="manualKey"
            placeholder="AIza…"
            class="flex-1 bg-surface-800 border border-surface-600 rounded px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-primary-500"
            @keydown.enter="checkManualKey"
          />
          <Button
            label="Check"
            icon="fas fa-magnifying-glass"
            size="small"
            :loading="checkingManual"
            @click="checkManualKey"
          />
        </div>
      </template>
    </Card>

    <!-- Findings table -->
    <Card class="bg-surface-700">
      <template #content>
        <DataTable
          :value="findings"
          :loading="loading"
          striped-rows
          size="small"
          class="text-sm"
          empty-message="No Gemini keys found yet — traffic is being scanned passively."
        >
          <Column field="status" header="Risk" style="min-width: 100px">
            <template #body="{ data }">
              <Tag
                :value="statusLabel(data.status)"
                :severity="statusSeverity(data.status)"
                class="text-xs font-bold"
              />
            </template>
          </Column>

          <Column field="key" header="API Key" style="min-width: 160px">
            <template #body="{ data }">
              <div class="flex items-center gap-2">
                <code class="text-primary-300 font-mono text-xs">{{ maskedKey(data.key) }}</code>
                <Button
                  icon="fas fa-copy"
                  size="small"
                  variant="tertiary"
                  class="p-0 h-5 w-5"
                  @click="copyToClipboard(data.key)"
                />
              </div>
            </template>
          </Column>

          <Column field="host" header="Host" style="min-width: 140px">
            <template #body="{ data }">
              <span class="text-surface-200">{{ data.host }}</span>
            </template>
          </Column>

          <Column field="models" header="Gemini Models" style="min-width: 200px">
            <template #body="{ data }">
              <div class="flex flex-wrap gap-1">
                <Tag
                  v-for="model in data.models.slice(0, 5)"
                  :key="model"
                  :value="model"
                  severity="warn"
                  class="text-xs"
                />
                <Tag
                  v-if="data.models.length > 5"
                  :value="`+${data.models.length - 5} more`"
                  severity="secondary"
                  class="text-xs"
                />
              </div>
            </template>
          </Column>

          <Column header="Exposed Data" style="min-width: 160px">
            <template #body="{ data }">
              <div v-if="data.exposedData" class="flex flex-col gap-1">
                <div v-if="data.exposedData.fileCount > 0" class="flex flex-col gap-0.5">
                  <Tag
                    :value="`${data.exposedData.fileCount}${data.exposedData.hasMoreFiles ? '+' : ''} file(s)`"
                    severity="warn"
                    class="text-xs self-start"
                  />
                  <span
                    v-if="data.exposedData.fileSnippets.length > 0"
                    class="text-surface-400 text-xs truncate max-w-36"
                    :title="data.exposedData.fileSnippets.join(', ')"
                  >{{ data.exposedData.fileSnippets[0] }}</span>
                </div>
                <Tag
                  v-if="data.exposedData.cachedCount > 0"
                  :value="`${data.exposedData.cachedCount}${data.exposedData.hasMoreCached ? '+' : ''} cached`"
                  severity="warn"
                  class="text-xs self-start"
                />
                <span
                  v-if="data.exposedData.fileCount === 0 && data.exposedData.cachedCount === 0"
                  class="text-surface-500 text-xs"
                >—</span>
              </div>
              <span v-else class="text-surface-600 text-xs">—</span>
            </template>
          </Column>

          <Column field="checkedAt" header="Detected" style="min-width: 140px">
            <template #body="{ data }">
              <span class="text-surface-400 text-xs">
                {{ new Date(data.checkedAt).toLocaleString() }}
              </span>
            </template>
          </Column>

          <Column header="PoC" style="min-width: 80px">
            <template #body="{ data }">
              <Button
                icon="fas fa-terminal"
                size="small"
                variant="tertiary"
                title="Copy curl PoC"
                @click="copyToClipboard(`curl 'https://generativelanguage.googleapis.com/v1beta/models?key=${data.key}'`)"
              />
            </template>
          </Column>
        </DataTable>
      </template>
    </Card>
  </div>
</template>
