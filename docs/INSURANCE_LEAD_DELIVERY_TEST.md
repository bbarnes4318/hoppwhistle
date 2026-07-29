# Insurance Lead Delivery — Deploy and Test

This restores automatic Ameriquote/Boberdoo delivery for valid ACA and Final Expense CRM webhook submissions. B2B and invalid submissions are not posted.

## 1. Configure the production environment

Edit `/opt/hopwhistle/.env` on the Hopwhistle server and set:

```dotenv
# Keep TEST until the buyer confirms the test submission.
INSURANCE_LEAD_MODE=test
AMERIQUOTE_API_KEY=replace-with-real-key
AMERIQUOTE_ACA_SRC=PVNACA_aged
AMERIQUOTE_FE_SRC=PVNFE_aged
```

TEST mode automatically includes `Test_Lead=1` in the buyer payload.

## 2. Deploy the API

From the repository root on the server:

```bash
chmod +x scripts/deploy-insurance-lead-delivery.sh
sudo ./scripts/deploy-insurance-lead-delivery.sh
```

The script pulls `main`, performs a no-cache API build, recreates the API with the buyer-delivery environment variables, verifies the non-secret runtime configuration, and checks API health.

## 3. Send a Final Expense test lead

Use an unused test phone/email so the CRM creates an easy-to-find submission.

```bash
BASE_URL='https://api.hopwhistle.com'
HOPWHISTLE_API_KEY='replace-with-a-valid-hopwhistle-api-key'
TEST_ID="$(date +%s)"

curl -sS -X POST "$BASE_URL/api/v1/insurance-leads/inbound/fe" \
  -H "x-api-key: $HOPWHISTLE_API_KEY" \
  -H 'content-type: application/json' \
  --data-raw "{
    \"firstName\": \"Delivery\",
    \"lastName\": \"Test$TEST_ID\",
    \"phone\": \"6155550199\",
    \"email\": \"delivery.test+$TEST_ID@example.com\",
    \"address\": \"123 Main St\",
    \"city\": \"Nashville\",
    \"state\": \"TN\",
    \"zipCode\": \"37211\",
    \"birthDate\": \"01/01/1980\",
    \"gender\": \"Male\",
    \"source\": \"manual-smoke-test\",
    \"landingPage\": \"https://hopwhistle.com/test\",
    \"ipAddress\": \"127.0.0.1\"
  }"
```

A successful pipeline response must contain:

- `validationStatus: "VALID"`
- `postMode: "TEST"`
- `postStatus: "MATCHED"`, `"UNMATCHED"`, or `"ERROR"`
- a populated `ameriquoteStatus`

`postStatus: "HOLD"` means the deployed API does not include the restored delivery hook or the API container was recreated without the delivery Compose overlay.

## 4. Verify the CRM audit record

Copy `insuranceLeadId` and `submissionId` from the response:

```bash
curl -sS \
  "$BASE_URL/api/v1/insurance-leads/INSURANCE_LEAD_ID" \
  -H "x-api-key: $HOPWHISTLE_API_KEY"
```

The submission should show `postedAt`, `lastAttemptAt`, `attemptCount`, the buyer response status, and any buyer error. The activity timeline should contain the delivery result.

## 5. Test manual retry

Use this only for a valid submission that is not already `MATCHED`:

```bash
curl -sS -X POST \
  "$BASE_URL/api/v1/insurance-leads/INSURANCE_LEAD_ID/submissions/SUBMISSION_ID/retry" \
  -H "x-api-key: $HOPWHISTLE_API_KEY"
```

The response should return the real buyer status and must not contain `disabled: true`.

## 6. Switch to live delivery

Only after the TEST submission is confirmed by the buyer:

```bash
sudo sed -i 's/^INSURANCE_LEAD_MODE=.*/INSURANCE_LEAD_MODE=live/' /opt/hopwhistle/.env
cd /opt/hopwhistle
sudo ./scripts/deploy-insurance-lead-delivery.sh
```

After this restart, every valid ACA or Final Expense lead received through the inbound CRM webhook is posted to the buyer as a live lead.
