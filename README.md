# acme-expenses — external app starter (Bridge v1)

This starter kit is **Bridge-only** (iframe → host via postMessage), using the recommended helper `createAppsBridgeV1()`.

## 1) Serve

Serve these files with any static server (http/https).

Current `entryUrl`: https://acme.example/app
Example allowed origin: http://localhost:5173

## 2) Register in the host (My apps)

- appId: acme-expenses
- name: acme-expenses
- entryUrl: https://acme.example/app
- allowedOrigins: http://localhost:5173
- permissionsRequested: finance:transactions:create

## 3) Configure allowedParentOrigin (IMPORTANT)

In `index.html` / `app.js`, set:

- `allowedParentOrigin` (aka "host origin") to the **exact** origin of the host page embedding your iframe.
- Never use `"*"` as targetOrigin.

Why: the host validates `event.origin` and `event.source` (parent window) before accepting Bridge messages.

## 4) Supported actions (Bridge v1 today)

- getHostContext
- createExpense
- createIncome
- listTransactionsMonth
- getTransactionRangeDetails
- listCategories
- createPaymentPlan
- listPaymentPlans
- createIncomePlan
- listIncomePlans
- listOverduePayments
- destroy (cleanup)

## 5) Troubleshooting

- NOT_AUTHED: the user is not logged in on the host. Log in and retry.
- MISSING_PERMISSION: missing `finance:transactions:create` (applies to createExpense/createIncome).
- UNKNOWN: generic/uncategorized error (check message/stack, retry).

## 6) Cleanup

Call `bridge.destroy()` when your app is done (removes listeners and rejects pending requests).
