# QPilot error codes

A local reference for the error codes QPilot returns in scheduled-order
and processing-cycle responses. Two layers:

1. **QPilot's own processing-failure codes** (11 total) — what surfaces as
   `processingErrorCode` on a scheduled order or processing cycle. Bounded,
   stable, programmatically annotated by this server (you'll see
   `processingErrorCodeName` and `processingErrorCodeMeaning` next to it in
   tool responses).
2. **Payment-gateway transaction codes** — when QPilot's code is 2000
   (PaymentFailed), the actual cause comes from the payment gateway
   underneath. Hundreds of these across ~10 gateways. Not annotated by this
   server (too many, too gateway-specific); listed here so a human can jump
   straight to the QPilot docs page for the gateway in play.

Captured 2026-06-08 from <https://docs.qpilot.cloud/>. Update this file
when QPilot publishes new codes — and update
`src/qpilot/processing_failure_codes.js` when Layer 1 changes.

---

## Layer 1 — Processing-failure codes

The complete set. Source:
<https://docs.qpilot.cloud/docs/scheduled-order-failure-codes.md>.

| Code | Name | What it means |
|---|---|---|
| 99 | `UnknownError` | An unknown error occurred during processing. |
| 1000 | `EmptyScheduledOrder` | No items were added to the scheduled order. |
| 1001 | `NoItemsToShip` | No items are available to process for the scheduled order. |
| 1002 | `ShippingRateNotFound` | One or more shipping rates could not be applied. |
| 1003 | `PaymentIntegrationNotFound` | The payment integration referenced by the order could not be found. |
| 1004 | `PaymentMethodNull` | No payment method is selected for the order. |
| 2000 | `PaymentFailed` | The payment method did not process successfully. See the gateway-specific code for the root cause. |
| 2001 | `PaymentGatewayCommunicationFailed` | The payment gateway failed to respond (timeout or transient gateway error). |
| 3000 | `ClientOrderCreationFailure` | The client site did not respond successfully to QPilot's request to create the order. |
| 3001 | `ClientOrderUpdateFailure` | The client site did not respond successfully to QPilot's request to update the order. |
| 3002 | `ClientOrderCreationInvalidResponse` | The client site responded to QPilot's create-order request with an invalid order. |

---

## Layer 2 — Payment-gateway codes

When a cycle ends with `processingErrorCode: 2000`, the gateway-specific
code lives elsewhere in the response (typically alongside the failure
message). Look up the gateway you're using and jump straight to the
matching QPilot docs page.

### Authorize.Net

- [E00007 — User authentication failed (invalid auth values)](https://docs.qpilot.cloud/docs/2000-authorizenet-user-authentication-failed-due-to-invalid-authentication-values.md)
- [E00008 — User authentication failed (account or API user)](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00008-user-authentication-failed-the-account-or-api-user.md)
- [E00013 — Amount is invalid](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00013-amount-is-invalid.md)
- [E00014 — Customer profile ID is required](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00014-customer-profile-id-is-required.md)
- [E00027 — Duplicate transaction submitted](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00027-a-duplicate-transaction-has-been-submitted.md)
- [E00027 — Error during processing (retry)](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00027-an-error-occurred-during-processing-_-please-try-again.md)
- [E00027 — Call merchant service](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00027-an-error-occurred-during-processing-call-merchant-service.md)
- [E00027 — Credit card expiration date invalid](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00027-credit-card-expiration-date-is-invalid.md)
- [E00027 — Line item 1 invalid](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00027-line-item-1-is-invalid.md)
- [E00027 — Line item 2 invalid](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00027-line-item-2-is-invalid.md)
- [E00027 — Payment declined](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00027-payment-collection-failed-payment-has-been-declined.md)
- [E00027 — Processor config invalid](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00027-the-configuration-with-processor-is-invalid-call-merchant-service.md)
- [E00040 — Customer/payment profile not found](https://docs.qpilot.cloud/docs/2000-authorizenet-customer-profile-id-or-customer-payment-profile-id-not-found.md)
- [E00104 — Server in maintenance](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00104-server-in-maintenance-please-try-again-later.md)
- [E00121 — No default payment/shipping profile](https://docs.qpilot.cloud/docs/2000-authorizenet-error-code-e00121-no-default-payment-shipping-profile-found.md)
- [Credit card has expired](https://docs.qpilot.cloud/docs/2000-authorizenet-the-credit-card-has-expired.md)
- [Credit card number invalid](https://docs.qpilot.cloud/docs/2000-authorizenet-the-credit-card-number-is-invalid.md)
- [AVS mismatch](https://docs.qpilot.cloud/docs/2000-authorizenet-the-transaction-has-been-declined-because-of-an-avs-mismatch-the-address.md)
- [Transaction declined](https://docs.qpilot.cloud/docs/2000-authorizenet-this-transaction-has-been-declined.md)

### Braintree

- [Processor declined](https://docs.qpilot.cloud/docs/2000-braintree-error-code-_-processor-declined.md)
- [2000 — Do not honor](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2000-do-not-honor.md)
- [2001 — Insufficient funds](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2001-insufficient-funds.md)
- [2004 — Expired card](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2004-expired-card.md)
- [2005 — Invalid credit card number](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2005-invalid-credit-card-number.md)
- [2007 — No account](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2007-no-account.md)
- [2014 — Fraud suspected](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2014-processor-declined-fraud-suspected.md)
- [2015 — Transaction not allowed](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2015-transaction-not-allowed.md)
- [2019 — Invalid transaction](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2019-invalid-transaction.md)
- [2037 — Already reversed](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2037-already-reversed.md)
- [2038 — Processor declined](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2038-processor-declined.md)
- [2044 — Declined, call issuer](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2044-declined-call-issuer.md)
- [2046 — Declined](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2046-declined.md)
- [2047 — Call issuer, pick up card](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2047-call-issuer-pick-up-card.md)
- [2057 — Issuer/cardholder restriction](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2057-issuer-or-cardholder-has-put-a-restriction-on-the.md)
- [2070 — PayPal buyer revoked pre-approved payment](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2070-paypal-buyer-revoked-pre-approved-payment-authorization.md)
- [2074 — PayPal funding instrument declined](https://docs.qpilot.cloud/docs/2000-braintree-error-code-2074-funding-instrument-in-the-paypal-account-was-declined.md)
- [3000 — Processor network unavailable](https://docs.qpilot.cloud/docs/2000-braintree-error-code-3000-processor-network-unavailable-try-again.md)
- [81813 — Postal code invalid characters](https://docs.qpilot.cloud/docs/2000-braintree-error-code-81813-postal-code-can-only-contain-letters-numbers.md)
- [91508 — Cannot determine payment method](https://docs.qpilot.cloud/docs/2000-braintree-error-code-91508-cannot-determine-payment-method.md)
- [91518 — Payment method token / customer conflict](https://docs.qpilot.cloud/docs/2000-braintree-error-code-91518-cannot-provide-both-payment_method_token-and-customer_id-unless-the-payment_method-belongs-to-the-customer.md)
- [91518 — Payment method token invalid](https://docs.qpilot.cloud/docs/2000-braintree-error-code-91518-payment-method-token-is-invalid.md)
- [Authentication exception](https://docs.qpilot.cloud/docs/2000-braintree-error-code-exception-of-type-braintree-authentication-exception.md)
- [Gateway rejected (risk threshold)](https://docs.qpilot.cloud/docs/2000-braintree-gateway-rejected-risk-threshold.md)

### CyberSource

- [101 — Missing fields](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-101-reject.md)
- [102 — Invalid fields](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-102-reject.md)
- [150 — System failure](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-150-error.md)
- [151 — Server timeout](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-151-error.md)
- [200 — AVS decline](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-200-reject.md)
- [202 — Expired card](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-202-reject.md)
- [203 — General decline](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-203-reject.md)
- [204 — Insufficient funds](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-204-reject.md)
- [205 — Lost or stolen](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-205-reject.md)
- [231 — Invalid account](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-231-reject.md)
- [233 — General decline](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-233-reject.md)
- [236 — Reject](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-236-reject.md)
- [480 — Review](https://docs.qpilot.cloud/docs/2000-cybersource-error-code-480-review.md)

### NMI

- [200 — Declined](https://docs.qpilot.cloud/docs/2000-nmi-error-code-200-decline.md)
- [200 — Issuer declined](https://docs.qpilot.cloud/docs/2000-nmi-error-code-200-issuer-declined.md)
- [200 — Declined by authorization system](https://docs.qpilot.cloud/docs/2000-nmi-error-code-200-transaction-declined-by-authorization-system.md)
- [200 — Restricted card](https://docs.qpilot.cloud/docs/2000-nmi-error-code-200-transaction-declined-restricted-card.md)
- [201 — Do not honor](https://docs.qpilot.cloud/docs/2000-nmi-error-code-201-do-not-honor.md)
- [202 — Insufficient funds](https://docs.qpilot.cloud/docs/2000-nmi-error-code-202-insufficient-funds.md)
- [202 — Limit exceeded](https://docs.qpilot.cloud/docs/2000-nmi-error-code-202-transaction-declined-limit-exceeded.md)
- [204 — Issuer declined](https://docs.qpilot.cloud/docs/2000-nmi-error-code-204-issuer-declined__.md)
- [204 — MCC declined](https://docs.qpilot.cloud/docs/2000-nmi-error-code-204-issuer-declined-mcc.md)
- [220 — Invalid customer vault id](https://docs.qpilot.cloud/docs/2000-nmi-error-code-220-invalid-customer-vault-id-specified-refid_.md)
- [220 — Invalid account](https://docs.qpilot.cloud/docs/2000-nmi-error-code-220-invld-acct.md)
- [220 — Invalid card](https://docs.qpilot.cloud/docs/2000-nmi-error-code-220-transaction-declined-invalid-card.md)
- [222 — Account closed](https://docs.qpilot.cloud/docs/2000-nmi-error-code-222-account-closed.md)
- [223 — Expired card](https://docs.qpilot.cloud/docs/2000-nmi-error-code-223-expired-card.md)
- [224 — Invalid expiration date](https://docs.qpilot.cloud/docs/2000-nmi-error-code-224-invld-exp-date.md)
- [250 — Pick up card](https://docs.qpilot.cloud/docs/2000-nmi-error-code-250-pic-up.md)
- [250 — Pick up card (NF)](https://docs.qpilot.cloud/docs/2000-nmi-error-code-250-pick-up-card-nf.md)
- [251 — Lost card](https://docs.qpilot.cloud/docs/2000-nmi-error-code-251-pick-up-card-l.md)
- [252 — Stolen card](https://docs.qpilot.cloud/docs/2000-nmi-error-code-252-pick-up-card-s.md)
- [253 — Stolen card (special)](https://docs.qpilot.cloud/docs/2000-nmi-error-code-253-pick-up-card-sf.md)
- [264 — Try again later](https://docs.qpilot.cloud/docs/2000-nmi-error-code-264-decline-try-later.md)
- [300 — Amount exceeds max ticket](https://docs.qpilot.cloud/docs/2000-nmi-error-code-300-amount-exceeds-the-maximum-ticket-allowed.md)
- [300 — AVS rejected](https://docs.qpilot.cloud/docs/2000-nmi-error-code-300-avs-rejected.md)
- [300 — Duplicate transaction](https://docs.qpilot.cloud/docs/2000-nmi-error-code-300-duplicate-transaction-refid__.md)
- [300 — Invalid customer vault id](https://docs.qpilot.cloud/docs/2000-nmi-error-code-300-invalid-customer-vault-id-specified-refid_.md)
- [300 — User not allowed to process sale](https://docs.qpilot.cloud/docs/2000-nmi-error-code-300-user_-is-not-allowed-to-process-sale.md)
- [400 — General error](https://docs.qpilot.cloud/docs/2000-nmi-error-code-400-general-error.md)
- [410 — Invalid merchant id](https://docs.qpilot.cloud/docs/2000-nmi-error-code-410-invld-merch-id.md)
- [430 — Duplicate transaction](https://docs.qpilot.cloud/docs/2000-nmi-error-code-430-duplicate-transaction-refid__.md)
- [441 — Invalid transaction](https://docs.qpilot.cloud/docs/2000-nmi-error-code-441-invalid-transaction.md)
- [Card declined](https://docs.qpilot.cloud/docs/2000-nmi-error-code-your-card-was-declined.md)
- [Invalid expiration date](https://docs.qpilot.cloud/docs/2000-nmi-invld-exp-date.md)

### Paya

- [Payment method missing customer id](https://docs.qpilot.cloud/docs/2000-paya-payment-method-is-missing-customer-id.md)
- [000000 — Internal server error](https://docs.qpilot.cloud/docs/2000-payav1-error-code-000000-internal-server-error.md)
- [000004 — Hold call](https://docs.qpilot.cloud/docs/2000-payav1-error-code-000004-hold-call.md)
- [000005 — Decline](https://docs.qpilot.cloud/docs/2000-payav1-error-code-000005-decline.md)
- [000014 — Card number error](https://docs.qpilot.cloud/docs/2000-payav1-error-code-000014-card-no-error.md)
- [000015 — No such issuer](https://docs.qpilot.cloud/docs/2000-payav1-error-code-000015-no-such-issuer.md)
- [000041 — Hold call](https://docs.qpilot.cloud/docs/2000-payav1-error-code-000041-hold-call.md)
- [000043 — Hold call](https://docs.qpilot.cloud/docs/2000-payav1-error-code-000043-hold-call.md)
- [000051 — Decline (insufficient funds)](https://docs.qpilot.cloud/docs/2000-payav1-error-code-000051-decline.md)
- [000051 — Insufficient funds](https://docs.qpilot.cloud/docs/2000-payav1-error-code-000051-insufficient-funds.md)
- [000054 — Expired card](https://docs.qpilot.cloud/docs/2000-payav1-error-code-000054-expired-card.md)
- [100000 — Service unavailable](https://docs.qpilot.cloud/docs/2000-payav1-error-code-100000-service-is-currently-not-available-service-is-temporarily.md)
- [100011 — Script error / callout policy](https://docs.qpilot.cloud/docs/2000-payav1-error-code-100011-internal-script-execution-error-service-callout-policy-execution-error.md)
- [400000 — Request error](https://docs.qpilot.cloud/docs/2000-payav1-error-code-400000-there-was-a-problem-with-the-request-please-see.md)
- [AVS failure](https://docs.qpilot.cloud/docs/paya-avs-failure.md)

### PayPal

- [10002 — Internal error](https://docs.qpilot.cloud/docs/2000-paypal-failure-code-10002-internal-error.md)
- [10002 — Security header invalid](https://docs.qpilot.cloud/docs/2000-paypal-failure-code-10002-security-header-is-not-valid.md)
- [10201 — Agreement canceled](https://docs.qpilot.cloud/docs/2000-paypal-agreement-canceled.md)
- [10207 — Transaction failed; alternate funding](https://docs.qpilot.cloud/docs/2000-paypal-failure-code-10207-transaction-failed-but-user-has-alternate-funding-source.md)
- [10413 — Cart total mismatch](https://docs.qpilot.cloud/docs/2000-paypal-failure-code-10413-the-totals-of-the-cart-item-amounts.md)
- [10417 — Payment method](https://docs.qpilot.cloud/docs/2000-paypal-failure-code-10417-the-transaction-did-not-complete-with-the.md)
- [10417 (alt)](https://docs.qpilot.cloud/docs/2000-paypal-failure-code-10417.md)
- [11451 — Invalid ID](https://docs.qpilot.cloud/docs/2000-paypal-failure-code-11451.md)
- [Restricted account](https://docs.qpilot.cloud/docs/2000-paypal-restricted-account.md)
- [Security error](https://docs.qpilot.cloud/docs/2000-paypal-security-error.md)
- [Service unavailable](https://docs.qpilot.cloud/docs/2000-paypal-serviceunavailable-service-unavailable.md)
- [Transaction cannot complete](https://docs.qpilot.cloud/docs/2000-paypal-transaction-cannot-complete.md)

### Shopify

- [Payment method expired](https://docs.qpilot.cloud/docs/2000-shopify-expired-payment-method.md)
- [Payment failed](https://docs.qpilot.cloud/docs/2000-shopify-payment-failed.md)
- [Payment method declined](https://docs.qpilot.cloud/docs/2000-shopify-payment-method-declined.md)

### Square

- [429 — Too many requests](https://docs.qpilot.cloud/docs/2000-square-429-too-many-requests.md)
- [Request error](https://docs.qpilot.cloud/docs/2000-square-an-error-occurred-while-sending-the-request.md)
- [Card expired (authorization)](https://docs.qpilot.cloud/docs/2000-square-error-code-card-expired-authorization-error-card-expired.md)
- [Card expired (declined)](https://docs.qpilot.cloud/docs/2000-square-error-code-card-expired-card-expired-authorization-error-card-expired.md)
- [Card not supported](https://docs.qpilot.cloud/docs/2000-square-error-code-card-not-supported-the-card-is-not-supported-either.md)
- [Declined](https://docs.qpilot.cloud/docs/2000-square-error-code-declined.md)
- [Generic decline](https://docs.qpilot.cloud/docs/2000-square-error-code-generic-decline-authorization-error-generic-decline.md)
- [Insufficient funds](https://docs.qpilot.cloud/docs/2000-square-error-code-insufficient-funds-your-card-has-insufficient-funds.md)
- [PAN_FAILURE](https://docs.qpilot.cloud/docs/2000-square-error-code-pan-failure-authorization-error-pan-failure.md)
- [TRANSACTION_LIMIT](https://docs.qpilot.cloud/docs/2000-square-error-code-transaction-limit-authorization-error-error-code-transaction-limit.md)
- [Address verification](https://docs.qpilot.cloud/docs/2000-square-error-code-transaction-limit-authorization-error-transaction-limit-error-code-address-verification.md)
- [TRANSACTION_LIMIT (alt)](https://docs.qpilot.cloud/docs/2000-square-error-code-transaction-limit-authorization-error-transaction-limit.md)
- [Amount limits exceeded](https://docs.qpilot.cloud/docs/2000-square-error-code-transaction-limit-the-card-issuer-has-determined-the-payment.md)
- [Unauthorized](https://docs.qpilot.cloud/docs/2000-square-error-code-unauthorized-this-request-could-not-be-authorized.md)
- [Voice failure](https://docs.qpilot.cloud/docs/2000-square-error-code-voice-failure-authorization-error-voice-failure.md)
- [Forbidden](https://docs.qpilot.cloud/docs/2000-square-forbidden-forbidden.md)
- [Generic decline (alt)](https://docs.qpilot.cloud/docs/2000-square-generic-decline-authorization-error-generic-decline.md)
- [Internal server error](https://docs.qpilot.cloud/docs/2000-square-internalservererror-internal-server-error.md)
- [Invalid account](https://docs.qpilot.cloud/docs/2000-square-invalid-account-authorization-error-invalid-account.md)
- [Service unavailable](https://docs.qpilot.cloud/docs/2000-square-serviceunavailable-service-unavailable.md)

### Stripe

- [Source not attached to customer](https://docs.qpilot.cloud/docs/2000-stripe-a-source-must-be-attached-to-a-customer-to-be-used-as.md)
- [Card declined — invalid account](https://docs.qpilot.cloud/docs/2000-stripe-error-code-card-declined-invalid-account.md)
- [Card declined — invalid amount](https://docs.qpilot.cloud/docs/2000-stripe-error-code-card-declined-invalid-amount.md)
- [Card declined — unsupported purchase](https://docs.qpilot.cloud/docs/2000-stripe-error-code-card-declined-your-card-does-not-support-this-type-of.md)
- [Card declined — insufficient funds](https://docs.qpilot.cloud/docs/2000-stripe-error-code-card-declined-your-card-has-insufficient-funds.md)
- [Card declined](https://docs.qpilot.cloud/docs/2000-stripe-error-code-card-declined-your-card-was-declined.md)
- [Card expired](https://docs.qpilot.cloud/docs/2000-stripe-error-code-expired-false-card-your-card-has-expired.md)
- [Incorrect card number](https://docs.qpilot.cloud/docs/2000-stripe-error-code-incorrect-number-your-card-number-is-incorrect.md)
- [Incorrect zip](https://docs.qpilot.cloud/docs/2000-stripe-error-code-incorrect-zip-the-zip-code-you-supplied-failed-validation.md)
- [Missing customer link](https://docs.qpilot.cloud/docs/2000-stripe-error-code-missing-customer-_-does-not-have-a-linked.md)
- [Empty customer parameter](https://docs.qpilot.cloud/docs/2000-stripe-error-code-parameter-invalid-empty-you-passed-an-empty-string-for-customer.md)
- [Missing source or customer](https://docs.qpilot.cloud/docs/2000-stripe-error-code-parameter-missing-must-provide-source-or-customer.md)
- [Source not chargeable](https://docs.qpilot.cloud/docs/2000-stripe-error-code-payment-method-unexpected-state-the-source-you-provided-is.md)
- [No such customer (test vs live)](https://docs.qpilot.cloud/docs/2000-stripe-error-code-resource-missing-no-such-customer-__a-similar.md)
- [No such customer](https://docs.qpilot.cloud/docs/2000-stripe-error-code-resource-missing-no-such-customer-cus__.md)
- [No such payment method](https://docs.qpilot.cloud/docs/2000-stripe-error-code-resource-missing-no-such-paymentmethod-__.md)
- [No such token](https://docs.qpilot.cloud/docs/2000-stripe-error-code-resource-missing-no-such-token-_.md)
- [Secret key required (publishable key used)](https://docs.qpilot.cloud/docs/2000-stripe-error-code-secret-key-required-this-api-call-cannot-be-made.md)
- [Test mode only](https://docs.qpilot.cloud/docs/2000-stripe-error-code-testmode-charges-only-your-account-cannot-currently-make-live.md)
- [Source already consumed](https://docs.qpilot.cloud/docs/2000-stripe-the-reusable-source-you-provided-is-consumed-because-it-was-previously.md)

### TrustCommerce

- [Decline — call](https://docs.qpilot.cloud/docs/2000-trustcommerce-error-code-decline-call.md)
- [Decline — card error](https://docs.qpilot.cloud/docs/2000-trustcommerce-error-code-decline-carderror.md)
- [Decline — decline](https://docs.qpilot.cloud/docs/2000-trustcommerce-error-code-decline-decline.md)
- [Declined — AVS failed](https://docs.qpilot.cloud/docs/2000-trustcommerce-error-code-declined-address-verification-system-avs-failed.md)
- [Declined — expired card](https://docs.qpilot.cloud/docs/2000-trustcommerce-error-code-declined-card-expired.md)
- [Declined — fraud](https://docs.qpilot.cloud/docs/2000-trustcommerce-error-code-declined-fraud.md)

### OPayo

- [9999 — Internal server error](https://docs.qpilot.cloud/docs/2000-opayo-9999-internal-server-error.md)

---

## Updating this file

When QPilot publishes a new failure code (rare) or a new gateway code (more
common), add it to the appropriate section above. If it's a Layer 1 code,
also add it to the constant map in
`src/qpilot/processing_failure_codes.js` and add a test case in
`test/qpilot/processing_failure_codes.test.js`. The annotator is data-driven
— the code itself rarely needs to change.
