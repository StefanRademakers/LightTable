# Command routing

Status: **target contract**.

The stable command ID and parameters describe intent; UI location does not.
Toolbar, menu, shortcut, Action and MCP must enter the same handler and receive
the same validation result. Host permission and serialization are adapters
around that handler, not alternate document mutation implementations.

## Route

```text
origin adapter -> command envelope -> capability/parameter validation
               -> one legacy OR kernel handler -> typed result
```

The envelope includes origin, explicit document address and transaction ID.
Kernel commands cannot resolve the target from a React closure or active tab.

## Migration switch

Routing is per semantic command, never per internal step. A feature flag may
choose the complete legacy handler or the complete kernel handler. It may not
send preview through one and commit/history through the other. Once the kernel
route passes its acceptance chain, remove the legacy route and imports before
marking the command migrated.

The public command catalog remains the external schema authority. The kernel
does not duplicate it; adapters translate catalog payloads into typed internal
commands at one boundary.
