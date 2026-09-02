"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui";

/**
 * Mint an agent API key (task #76). The plaintext comes back through the
 * action's return value — never a URL, never stored — and renders exactly
 * once. Copy it into the personal agent's MCP connector config.
 */

export interface KeyRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

type MintState = { key?: string; name?: string; error?: string } | null;

export function AgentKeys({
  keys,
  endpoint,
  mint,
  revoke,
}: {
  keys: KeyRow[];
  endpoint: string;
  mint: (state: MintState, fd: FormData) => Promise<MintState>;
  revoke: (keyId: string) => Promise<void>;
}) {
  const [state, mintAction, pending] = useActionState(mint, null);

  return (
    <div>
      <p className="mb-2 text-body text-neutral-500">
        Point any MCP-speaking assistant (Claude, Grok Bot, Copilot…) at{" "}
        <code className="rounded-inner bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">{endpoint}</code> with a key below as
        the bearer token. Reads mirror your own screens; the only write tool creates <em>drafts</em> behind your
        approval gates. Revoking a key cuts the agent off instantly.
      </p>

      {state?.key && (
        <div className="mb-3 rounded-inner border border-green-200 bg-green-50/70 p-3 dark:border-green-900 dark:bg-green-950/30">
          <p className="mb-1 text-body font-semibold text-green-800 dark:text-green-300">
            Key &ldquo;{state.name}&rdquo; created — copy it now, it is shown exactly once:
          </p>
          <code className="block select-all break-all rounded-inner bg-white/70 px-2 py-1 font-mono text-body dark:bg-black/30">
            {state.key}
          </code>
        </div>
      )}
      {state?.error && <p className="mb-3 text-copy text-red-700 dark:text-red-400">{state.error}</p>}

      <form action={mintAction} className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-copy">
          <span className="mb-1 block text-body text-neutral-500">Key name</span>
          <input
            name="name"
            placeholder="e.g. Chris's Claude"
            required
            className="w-52 rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <button
          disabled={pending}
          className={buttonClass("primary", "md")}
        >
          {pending ? "Minting…" : "Mint key"}
        </button>
      </form>

      {keys.length > 0 && (
        <div className="overflow-x-auto scroll-thin">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Created</th><th>Last used</th><th></th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="font-medium">{k.name}</td>
                  <td className="text-body text-neutral-500">{k.createdAt}</td>
                  <td className="text-body text-neutral-500">{k.lastUsedAt ?? "never"}</td>
                  <td className="text-right">
                    <form action={revoke.bind(null, k.id)}>
                      <button className={buttonClass("subtle", "md")}>revoke</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
