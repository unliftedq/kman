// TODO(M5): generate one `delegate_<peer>` MCP tool per peer agent.
//   Each tool description = peer agent's profile.description + soul summary.
//   Calling agent excluded from catalog (no self-loop).
//   Tool body invokes `delego run <peer> --task ... --output json` (or in-process equivalent).
//   Enforce max_spawn_depth and cycle detection via DELEGO_RUN_CHAIN env var.
export {};
