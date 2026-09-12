import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VNEXT_ENV_VARS,
  vnextCapabilities,
  vnextEnvEnabled,
  vnextLaneActive,
  type VNextFlag,
} from "../src/lib/env/vnext-flags";
import type { TenantFeatureView } from "../src/lib/pursuits/tenant-flags";

/**
 * vNext flag scaffolding (Session 0). These tests exist to pin the two
 * properties that make the staging lane safe rather than merely convenient:
 *
 *   1. DEFAULT OFF. Unset and unrecognised values resolve to false, so demo and
 *      production stay dark by omission.
 *   2. NARROWING ONLY. A vNext flag can never satisfy the tenant gate. With
 *      every flag armed but `experience` false, every pursuit-facing capability
 *      is still off — which is the guarantee that a half-built roadmap feature
 *      cannot become a permission bypass.
 *
 * Pure env reads, so no database.
 */

const ALL: VNextFlag[] = [
  "context_health", "pursuit_state", "pursuit_memory", "pursuit_intelligence",
  "next_best_action", "control_plane", "dynamic_surfaces",
];

const TENANT_ON: TenantFeatureView = {
  experience: true, federation: true, governedAction: true, outcomeLearning: true,
};
const TENANT_OFF: TenantFeatureView = {
  experience: false, federation: false, governedAction: false, outcomeLearning: false,
};

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const k of VNEXT_ENV_VARS) saved.set(k, process.env[k]);
  try {
    for (const k of VNEXT_ENV_VARS) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const armAll = (): Record<string, string> =>
  Object.fromEntries(VNEXT_ENV_VARS.map((k) => [k, "1"]));

test("vnext: every flag defaults OFF when unset", () => {
  withEnv({}, () => {
    for (const f of ALL) assert.equal(vnextEnvEnabled(f), false, `${f} should default off`);
    assert.equal(vnextLaneActive(), false);
    const caps = vnextCapabilities(TENANT_ON);
    assert.deepEqual(Object.values(caps).filter(Boolean), [], "no capability on with no env set");
  });
});

test("vnext: unrecognised values are OFF, not truthy", () => {
  for (const bad of ["", "  ", "maybe", "0", "off", "no", "false", "enabled"]) {
    withEnv({ VNEXT_CONTEXT_HEALTH_ENABLED: bad }, () => {
      assert.equal(vnextEnvEnabled("context_health"), false, `"${bad}" must not enable`);
    });
  }
  for (const good of ["true", "1", "on", "yes", "TRUE", " On "]) {
    withEnv({ VNEXT_CONTEXT_HEALTH_ENABLED: good }, () => {
      assert.equal(vnextEnvEnabled("context_health"), true, `"${good}" should enable`);
    });
  }
});

test("vnext: flags cannot satisfy the tenant gate (narrowing only)", () => {
  withEnv(armAll(), () => {
    const caps = vnextCapabilities(TENANT_OFF);
    assert.equal(caps.contextHealth, false);
    assert.equal(caps.pursuitState, false);
    assert.equal(caps.pursuitMemory, false);
    assert.equal(caps.pursuitIntelligence, false);
    assert.equal(caps.nextBestAction, false);
    assert.equal(caps.dynamicSurfaces, false);
    // Control plane is backend infrastructure, deliberately independent of the
    // pursuit experience gate — it exposes no tenant surface.
    assert.equal(caps.controlPlane, true);
  });
});

test("vnext: dependency chains hold", () => {
  // Intelligence needs state AND memory: an explanation with no belief and no
  // history to cite would be narrative replacing evidence.
  withEnv({
    VNEXT_PURSUIT_INTELLIGENCE_ENABLED: "1",
    VNEXT_PURSUIT_STATE_ENABLED: "1",
  }, () => {
    assert.equal(vnextCapabilities(TENANT_ON).pursuitIntelligence, false, "missing memory");
  });

  withEnv({
    VNEXT_PURSUIT_INTELLIGENCE_ENABLED: "1",
    VNEXT_PURSUIT_STATE_ENABLED: "1",
    VNEXT_PURSUIT_MEMORY_ENABLED: "1",
  }, () => {
    assert.equal(vnextCapabilities(TENANT_ON).pursuitIntelligence, true);
  });

  // Next-best action and dynamic surfaces both require intelligence.
  withEnv({
    VNEXT_NEXT_BEST_ACTION_ENABLED: "1",
    VNEXT_DYNAMIC_SURFACES_ENABLED: "1",
  }, () => {
    const caps = vnextCapabilities(TENANT_ON);
    assert.equal(caps.nextBestAction, false);
    assert.equal(caps.dynamicSurfaces, false);
  });

  withEnv(armAll(), () => {
    const caps = vnextCapabilities(TENANT_ON);
    assert.equal(caps.nextBestAction, true);
    assert.equal(caps.dynamicSurfaces, true);
    assert.equal(vnextLaneActive(), true);
  });
});
